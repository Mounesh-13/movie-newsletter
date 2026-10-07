import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// RED gate: fails until sendEmail.js exists
import { buildEmailHtml, parseTestEmail, sendDailyEmail, getSubscribers } from './sendEmail.js';

const movie = { title: 'Jurassic Park', release_date: '1993-06-11' };
const facts = ['Fact one.', 'Fact two.', 'Fact three.'];

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
    assert.match(html, /\{\{\{UNSUBSCRIBE_URL\}\}\}/);
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
    delete process.env.RESEND_API_KEY;
    await assert.rejects(() => sendDailyEmail(movie, facts, { fetchFn: async () => ({}) }), /RESEND_API_KEY is missing/);
  });
});
