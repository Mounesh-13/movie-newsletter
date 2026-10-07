import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// RED gate: fails until sendEmail.js exists
import { buildEmailHtml, parseTestEmail, parseDryRun, buildTestPayload, buildBroadcastPayload, sendBroadcast, sendDailyEmail, getSubscribers, requireSendConfig, requireTestEmail } from './sendEmail.js';

const movie = { title: 'Jurassic Park', release_date: '1993-06-11' };
const facts = ['Fact one.', 'Fact two.', 'Fact three.'];

// Isolate env mutations between tests (node --test runs files in sequence)
const savedEnv = {};
for (const k of ['RESEND_API_KEY', 'RESEND_AUDIENCE_ID', 'RESEND_FROM']) savedEnv[k] = process.env[k];
function restoreEnv() {
  for (const k of ['RESEND_API_KEY', 'RESEND_AUDIENCE_ID', 'RESEND_FROM']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

describe('buildEmailHtml', () => {
  it('includes title, year, header, facts, footer, unsubscribe tag', () => {
    const html = buildEmailHtml(movie, facts);
    assert.match(html, /Jurassic Park/);
    assert.match(html, /1993/);
    assert.match(html, /Today's Pick/);
    assert.match(html, /Fact one/);
    assert.match(html, /Fact two/);
    assert.match(html, /Fact three/);
    assert.match(html, /Movie data via TMDB and Wikipedia\./);
    assert.match(html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  });

  it('uses inline CSS only (no external stylesheets)', () => {
    const html = buildEmailHtml(movie, facts);
    assert.doesNotMatch(html, /<link/i);
    assert.doesNotMatch(html, /@import/i);
    assert.match(html, /style="/);
  });

  it('escapes HTML in facts to prevent broken markup', () => {
    const html = buildEmailHtml(movie, ['<script>alert(1)</script>']);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});

describe('parseTestEmail', () => {
  it('extracts --test=email from argv', () => {
    assert.equal(parseTestEmail(['node', 'sendEmail.js', '--test=me@example.com']), 'me@example.com');
  });
  it('returns null when flag is absent', () => {
    assert.equal(parseTestEmail(['node', 'sendEmail.js']), null);
  });
});

describe('--dry-run payload', () => {
  it('detects the --dry-run flag', () => {
    assert.equal(parseDryRun(['node', 'sendEmail.js', '--test=a@b.com', '--dry-run']), true);
    assert.equal(parseDryRun(['node', 'sendEmail.js', '--test=a@b.com']), false);
  });

  it('builds the exact single-send body with no network involved', () => {
    const html = buildEmailHtml(movie, facts);
    const body = buildTestPayload({ from: 'News <news@example.com>', subject: 'S', html, email: 'me@x.com' });
    assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'subject', 'to']);
    assert.deepEqual(body.to, ['me@x.com']);
    assert.equal(body.from, 'News <news@example.com>');
    // Documents current truth: no List-Unsubscribe headers are sent (see report).
    assert.ok(!('headers' in body));
    // And the tag is literal pre-send — substitution (if any) happens server-side.
    assert.match(body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  });
});

describe('getSubscribers', () => {
  it('fetches audience contacts and filters unsubscribed', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    const fetchFn = async (url) => ({
      ok: true,
      json: async () => ({
        data: [
          { email: 'a@example.com', unsubscribed: false },
          { email: 'b@example.com', unsubscribed: true },
        ],
      }),
    });
    const subs = await getSubscribers({ fetchFn });
    assert.deepEqual(subs, ['a@example.com']);
  });
});

describe('sendDailyEmail', () => {
  function broadcastFetch() {
    const calls = [];
    const fetchFn = async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@example.com', unsubscribed: false }] }) };
      }
      if (url === 'https://api.resend.com/broadcasts') {
        return { ok: true, json: async () => ({ object: 'broadcast', id: 'bcast-1' }) };
      }
      return { ok: true, json: async () => ({ id: 'email-id-1' }) };
    };
    return { calls, fetchFn };
  }

  it('sends the audience via Broadcasts API scoped to RESEND_AUDIENCE_ID', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const { calls, fetchFn } = broadcastFetch();
    const result = await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 });
    const created = calls.find((c) => c.url === 'https://api.resend.com/broadcasts');
    assert.ok(created, 'must POST /broadcasts');
    assert.equal(created.body.segment_id, 'aud_123');
    assert.equal(created.body.from, 'News <news@example.com>');
    assert.equal(created.body.send, true);
    assert.match(created.body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
    assert.ok(!calls.some((c) => c.url === 'https://api.resend.com/emails/batch'), 'no raw batch on audience path');
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.broadcastId, 'bcast-1');
    restoreEnv();
  });

  it('rejects loudly when broadcast creation fails', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const fetchFn = async (url) => {
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@example.com', unsubscribed: false }] }) };
      }
      return { ok: false, status: 422, json: async () => ({}) };
    };
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 }), /Broadcast send failed: HTTP 422/);
    restoreEnv();
  });

  it('rejects when the broadcast response has no id', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const fetchFn = async (url) => {
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@example.com', unsubscribed: false }] }) };
      }
      return { ok: true, json: async () => ({ object: 'broadcast' }) };
    };
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 }), /no broadcast id/i);
    restoreEnv();
  });

  it('--test path stays on raw /emails and never touches /broadcasts', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_FROM = 'News <news@example.com>';
    delete process.env.RESEND_AUDIENCE_ID;
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ id: 'e1' }) };
    };
    // Broadcasts has no ad-hoc recipient: raw /emails is correct for test
    // sends, where unsubscribe compliance doesn't apply.
    const result = await sendDailyEmail(movie, facts, { fetchFn, testEmail: 'me@x.com' });
    assert.equal(result.sent, 1);
    assert.deepEqual(urls, ['https://api.resend.com/emails']);
    restoreEnv();
  });

  it('audience path still requires RESEND_AUDIENCE_ID', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_FROM = 'News <news@example.com>';
    delete process.env.RESEND_AUDIENCE_ID;
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn: async () => ({}) }), /RESEND_AUDIENCE_ID/);
    restoreEnv();
  });

  it('throws clearly when RESEND_API_KEY is missing', async () => {
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    process.env.RESEND_FROM = 'News <news@example.com>';
    delete process.env.RESEND_API_KEY;
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn: async () => ({}) }), /RESEND_API_KEY is missing/);
    restoreEnv();
  });
});

describe('blocker 1+3: fail-closed config validation', () => {
  it('requireSendConfig names each missing variable exactly', () => {
    for (const missing of ['RESEND_API_KEY', 'RESEND_AUDIENCE_ID', 'RESEND_FROM']) {
      process.env.RESEND_API_KEY = 'k';
      process.env.RESEND_AUDIENCE_ID = 'a';
      process.env.RESEND_FROM = 'f';
      delete process.env[missing];
      assert.throws(() => requireSendConfig(), new RegExp(missing), missing);
    }
    restoreEnv();
  });

  it('treats empty-string values as missing', () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_AUDIENCE_ID = 'a';
    process.env.RESEND_FROM = '   ';
    assert.throws(() => requireSendConfig(), /RESEND_FROM/);
    restoreEnv();
  });

  it('sendDailyEmail refuses when RESEND_FROM is unset', async () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_AUDIENCE_ID = 'a';
    delete process.env.RESEND_FROM;
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn: async () => ({}) }), /RESEND_FROM/);
    restoreEnv();
  });

  it('requireTestEmail refuses a direct run without --test', () => {
    assert.throws(() => requireTestEmail(null), /Refusing to send to the real audience/);
    assert.equal(requireTestEmail('me@example.com'), 'me@example.com');
  });

  it('passes RESEND_FROM into the test call and the broadcast payload', async () => {    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_AUDIENCE_ID = 'a';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const bodies = [];
    const fetchFn = async (url, opts) => {
      if (opts?.body) bodies.push({ url, body: JSON.parse(opts.body) });
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@x.com', unsubscribed: false }] }) };
      }
      if (url === 'https://api.resend.com/broadcasts') {
        return { ok: true, json: async () => ({ object: 'broadcast', id: 'b1' }) };
      }
      return { ok: true, json: async () => ({ id: 'e1' }) };
    };
    await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0, testEmail: 'me@x.com' });
    assert.equal(bodies[bodies.length - 1].body.from, 'News <news@example.com>');
    bodies.length = 0;
    await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 });
    const created = bodies.find((b) => b.url === 'https://api.resend.com/broadcasts');
    assert.equal(created.body.from, 'News <news@example.com>');
    restoreEnv();
  });
});

describe('audience ID is optional on the --test path', () => {
  it('--test send works with blank RESEND_AUDIENCE_ID', async () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_FROM = 'News <news@example.com>';
    delete process.env.RESEND_AUDIENCE_ID;
    let called = false;
    const fetchFn = async () => { called = true; return { ok: true, json: async () => ({ id: 'e1' }) }; };
    const result = await sendDailyEmail(movie, facts, { fetchFn, testEmail: 'me@x.com' });
    assert.equal(result.sent, 1);
    assert.equal(called, true);
    restoreEnv();
  });

  it('requireSendConfig validates only the keys it is given', () => {
    const env = { RESEND_API_KEY: 'k', RESEND_FROM: 'f' };
    assert.doesNotThrow(() => requireSendConfig(env, ['RESEND_API_KEY', 'RESEND_FROM']));
    assert.throws(() => requireSendConfig(env), /RESEND_AUDIENCE_ID/);
  });

  it('audience path still refuses a blank audience ID', async () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_FROM = 'News <news@example.com>';
    delete process.env.RESEND_AUDIENCE_ID;
    await assert.rejects(() => getSubscribers({ fetchFn: async () => ({}) }), /RESEND_AUDIENCE_ID/);
    restoreEnv();
  });
});

describe('blocker 2: no global-contacts fallback', () => {
  it('fails loudly on a wrong audience ID and never touches the global list', async () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_AUDIENCE_ID = 'aud_wrong';
    const calledUrls = [];
    const fetchFn = async (url) => {
      calledUrls.push(url);
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await assert.rejects(() => getSubscribers({ fetchFn }), /aud_wrong|Failed to fetch contacts/);
    assert.ok(calledUrls.length > 0);
    assert.ok(calledUrls.every((u) => u.includes('aud_wrong')), `global fallback hit: ${calledUrls}`);
    restoreEnv();
  });
});

describe('delivery to friends', () => {
  it('rejects sandbox audience sends before making any API calls', async () => {
    try {
      process.env.RESEND_API_KEY = 'fake';
      process.env.RESEND_AUDIENCE_ID = 'segment_123';
      for (const from of ['onboarding@resend.dev', 'Movie Newsletter <onboarding@RESEND.DEV>']) {
        process.env.RESEND_FROM = from;
        let calls = 0;
        await assert.rejects(() => sendDailyEmail(movie, facts, {
          fetchFn: async () => { calls++; throw new Error('must not call'); },
        }), /verified domain.*account owner/);
        assert.equal(calls, 0);
      }
    } finally { restoreEnv(); }
  });

  it('still allows a sandbox test email to the owner', async () => {
    try {
      process.env.RESEND_API_KEY = 'fake';
      process.env.RESEND_FROM = 'onboarding@resend.dev';
      const result = await sendDailyEmail(movie, facts, {
        testEmail: 'owner@example.com',
        fetchFn: async (url, opts) => {
          assert.equal(url, 'https://api.resend.com/emails');
          assert.deepEqual(JSON.parse(opts.body).to, ['owner@example.com']);
          return { ok: true };
        },
      });
      assert.equal(result.sent, 1);
    } finally { restoreEnv(); }
  });

  it('broadcasts to the configured newsletter segment, not just the owner', async () => {
    try {
      process.env.RESEND_API_KEY = 'fake';
      process.env.RESEND_AUDIENCE_ID = 'segment_friends';
      process.env.RESEND_FROM = 'Movies <news@example.com>';
      let broadcasts = 0;
      const result = await sendDailyEmail(movie, facts, {
        fetchFn: async (url, opts) => {
          if (url.endsWith('/contacts')) {
            assert.ok(url.includes('segment_friends'));
            return { ok: true, json: async () => ({ data: [
              { email: 'owner@example.com', unsubscribed: false },
              { email: 'friend@example.com', unsubscribed: false },
              { email: 'unsubscribed@example.com', unsubscribed: true },
            ] }) };
          }
          assert.equal(url, 'https://api.resend.com/broadcasts');
          const payload = JSON.parse(opts.body);
          assert.equal(payload.segment_id, 'segment_friends');
          assert.equal(payload.send, true);
          assert.ok(!('to' in payload));
          broadcasts++;
          return { ok: true, json: async () => ({ id: 'broadcast_friends' }) };
        },
      });
      assert.equal(broadcasts, 1);
      assert.equal(result.sent, 2);
    } finally { restoreEnv(); }
  });
});
