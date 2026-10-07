import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// RED gate: fails until sendEmail.js exists
import { buildEmailHtml, parseTestEmail, parseDryRun, buildTestPayload, sendDailyEmail, getSubscribers, requireSendConfig, requireTestEmail } from './sendEmail.js';

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
  it('batch-sends to subscribers and reports counts', async () => {
    process.env.RESEND_API_KEY = 'fake';
    process.env.RESEND_AUDIENCE_ID = 'aud_123';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const calls = [];
    const fetchFn = async (url, opts) => {
      calls.push(url);
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@example.com', unsubscribed: false }] }) };
      }
      return { ok: true, json: async () => ({ id: 'email-id-1' }) };
    };
    const result = await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 });
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.ok(calls.some((u) => u.includes('/emails')));
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

  it('passes RESEND_FROM into both test and batch send calls', async () => {    process.env.RESEND_API_KEY = 'k';
    process.env.RESEND_AUDIENCE_ID = 'a';
    process.env.RESEND_FROM = 'News <news@example.com>';
    const bodies = [];
    const fetchFn = async (url, opts) => {
      if (opts?.body) bodies.push(JSON.parse(opts.body));
      if (url.includes('/contacts')) {
        return { ok: true, json: async () => ({ data: [{ email: 'a@x.com', unsubscribed: false }] }) };
      }
      return { ok: true, json: async () => ({ id: 'e1' }) };
    };
    await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0, testEmail: 'me@x.com' });
    assert.equal(bodies[bodies.length - 1].from, 'News <news@example.com>');
    bodies.length = 0;
    await sendDailyEmail(movie, facts, { fetchFn, delayMs: 0 });
    const batch = bodies.find((b) => Array.isArray(b));
    assert.ok(batch.every((m) => m.from === 'News <news@example.com>'));
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
