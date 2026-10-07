import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gmailConfig, gmailRaw, sendGmail } from './gmail.js';
import { getAllNewsletterSubscribers } from './sendEmail.js';

const env = { GMAIL_USER: 'owner@gmail.com', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' };
const options = { env, recipients: ['one@example.com', 'two@example.com'], subject: 'Today’s movie', html: '<p>Hello</p>', deliveryKey: 'movie:123' };
const ok = data => ({ ok: true, json: async () => data });

describe('Gmail OAuth delivery', () => {
  it('requires OAuth configuration without an App Password or domain', () => {
    assert.deepEqual(gmailConfig(env), env);
    assert.throws(() => gmailConfig({}), /GOOGLE_REFRESH_TOKEN/);
  });
  it('encodes Unicode and rejects header injection', () => {
    const raw = Buffer.from(gmailRaw({ from: env.GMAIL_USER, to: 'friend@example.com', subject: '🎬 Movie', html: '<p>🎬</p>' }), 'base64url').toString();
    assert.match(raw, /To: friend@example.com\r\n/);
    assert.match(raw, /List-Unsubscribe: <mailto:owner@gmail.com/);
    assert.equal(Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString(), '<p>🎬</p>');
    assert.throws(() => gmailRaw({ from: env.GMAIL_USER, to: 'a@b.com\r\nBcc: victim@example.com', subject: '', html: '' }), /Invalid/);
  });
  it('sends private individual messages and deduplicates recipients', async () => {
    const messages = [];
    const journal = {};
    const result = await sendGmail({ ...options, recipients: [...options.recipients, 'ONE@example.com'],
      loadJournalFn: async () => journal, saveJournalFn: async () => {},
      fetchFn: async (url, opts) => {
        if (url.includes('/token')) {
          assert.equal(new URLSearchParams(opts.body).get('grant_type'), 'refresh_token');
          return ok({ access_token: 'access' });
        }
        messages.push(Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString());
        return ok({ id: 'message' });
      },
    });
    assert.deepEqual(result, { sent: 2, failed: 0 });
    assert.equal(messages.length, 2);
    assert.ok(!messages[0].includes('two@example.com'));
    assert.ok(!messages[1].includes('one@example.com'));
    assert.equal(Object.keys(journal).length, 2);
    assert.ok(!JSON.stringify(journal).includes('@'));
  });
  it('stops on provider failure and skips accepted recipients on retry', async () => {
    const journal = {};
    let calls = 0;
    const first = await sendGmail({ ...options, loadJournalFn: async () => journal, saveJournalFn: async () => {},
      fetchFn: async url => url.includes('/token') ? ok({ access_token: 'access' }) : ++calls === 1 ? ok({ id: 'm1' }) : { ok: false, status: 429 },
    });
    assert.deepEqual(first, { sent: 1, failed: 1 });
    calls = 0;
    const retry = await sendGmail({ ...options, loadJournalFn: async () => journal, saveJournalFn: async () => {},
      fetchFn: async url => { if (url.includes('/token')) return ok({ access_token: 'access' }); calls++; return ok({ id: 'm2' }); },
    });
    assert.deepEqual(retry, { sent: 2, failed: 0 });
    assert.equal(calls, 1);
  });
  it('fails on expired authorization without sending or leaking credentials', async () => {
    let calls = 0;
    await assert.rejects(() => sendGmail({ ...options, loadJournalFn: async () => ({}),
      fetchFn: async () => { calls++; return { ok: false, status: 400 }; },
    }), /authorization failed/);
    assert.equal(calls, 1);
  });
  it('test mail does not touch the delivery journal', async () => {
    const result = await sendGmail({ ...options, recipients: ['owner@gmail.com'], test: true,
      loadJournalFn: async () => { throw new Error('must not load'); }, saveJournalFn: async () => { throw new Error('must not save'); },
      fetchFn: async url => ok(url.includes('/token') ? { access_token: 'a' } : { id: 'm' }),
    });
    assert.equal(result.sent, 1);
  });
  it('limits audience size before making requests', async () => {
    await assert.rejects(() => sendGmail({ ...options, recipients: Array.from({ length: 101 }, (_, i) => `friend${i}@example.com`) }), /limited to 100/);
  });
});

describe('explicit global newsletter contacts', () => {
  it('reads every page, excludes unsubscribed contacts and deduplicates', async () => {
    let calls = 0;
    const emails = await getAllNewsletterSubscribers({ apiKey: 'key', fetchFn: async url => {
      calls++;
      if (calls === 1) return ok({ data: [{ id: '1', email: 'a@example.com', unsubscribed: true }, { id: '2', email: 'b@example.com', unsubscribed: false }], has_more: true });
      assert.equal(new URL(url).searchParams.get('after'), '2');
      return ok({ data: [{ id: '3', email: 'B@example.com', unsubscribed: false }, { id: '4', email: 'c@example.com', unsubscribed: false }], has_more: false });
    } });
    assert.deepEqual(emails, ['b@example.com', 'c@example.com']);
    assert.equal(calls, 2);
  });
  it('does not accept a partially retrieved list', async () => {
    let calls = 0;
    await assert.rejects(() => getAllNewsletterSubscribers({ apiKey: 'key', fetchFn: async () => ++calls === 1
      ? ok({ data: [{ id: '1', email: 'a@example.com' }], has_more: true }) : { ok: false, status: 500 } }), /HTTP 500/);
  });
});

it('the newsletter test path selects Gmail without requiring Resend configuration', async () => {
  const { sendDailyEmail } = await import('./sendEmail.js');
  const changes = { ...env, EMAIL_PROVIDER: 'gmail', RESEND_API_KEY: undefined, RESEND_FROM: undefined, RESEND_AUDIENCE_ID: undefined };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    let raw;
    const result = await sendDailyEmail({ id: 123, title: 'A Movie', release_date: '2000-01-01' }, ['One', 'Two', 'Three'], {
      testEmail: 'friend@example.com',
      fetchFn: async (url, opts) => {
        if (url.includes('/token')) return ok({ access_token: 'access' });
        assert.ok(url.startsWith('https://gmail.googleapis.com/'));
        raw = Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString();
        return ok({ id: 'message' });
      },
    });
    assert.deepEqual(result, { sent: 1, failed: 0 });
    const html = Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString();
    assert.match(html, /mailto:owner@gmail.com/);
    assert.ok(!html.includes('RESEND_UNSUBSCRIBE_URL'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
