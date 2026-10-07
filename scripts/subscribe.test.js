import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// RED gate: fails until web/api/subscribe.js exists
import handler from '../web/api/subscribe.js';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

beforeEach(() => {
  delete process.env.NEWSLETTER_CONTACT_SOURCE;
  process.env.RESEND_API_KEY = 'fake-key';
  process.env.RESEND_AUDIENCE_ID = 'aud_123';
});

describe('POST /api/subscribe', () => {
  it('adds a valid email to the audience and returns success', async () => {
    let sentUrl = '';
    let sentBody = null;
    const fetchFn = async (url, opts) => {
      sentUrl = url;
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'contact-1' }) };
    };
    const req = { method: 'POST', body: { email: 'fan@example.com' } };
    const res = mockRes();
    await handler(req, res, { fetchFn });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(sentUrl, 'https://api.resend.com/contacts');
    assert.equal(sentBody.email, 'fan@example.com');
    assert.deepEqual(sentBody.segments, [{ id: 'aud_123' }]);
  });

  it('rejects invalid emails with 400', async () => {
    for (const bad of ['not-an-email', 'a@b', '@x.com', '']) {
      const res = mockRes();
      await handler({ method: 'POST', body: { email: bad } }, res, { fetchFn: async () => { throw new Error('must not call'); } });
      assert.equal(res.statusCode, 400, bad);
    }
  });

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {});
    assert.equal(res.statusCode, 405);
  });

  it('returns 500 when env vars are missing', async () => {
    delete process.env.RESEND_API_KEY;
    const res = mockRes();
    await handler({ method: 'POST', body: { email: 'fan@example.com' } }, res, {});
    assert.equal(res.statusCode, 500);
  });

  it('returns 502 with a clean message when Resend fails', async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ message: 'invalid' }) });
    const res = mockRes();
    await handler({ method: 'POST', body: { email: 'fan@example.com' } }, res, { fetchFn });
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /could not subscribe/i);
  });

  it('rejects missing or blank segment configuration without creating an orphan contact', async () => {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.RESEND_AUDIENCE_ID;
      else process.env.RESEND_AUDIENCE_ID = value;
      const res = mockRes();
      await handler({ method: 'POST', body: { email: 'fan@example.com' } }, res, {
        fetchFn: async () => { throw new Error('must not call'); },
      });
      assert.equal(res.statusCode, 500);
      assert.match(res.body.error, /not configured/);
    }
  });

  it('allows global signups only with explicit all-newsletter-contacts configuration', async () => {
    process.env.NEWSLETTER_CONTACT_SOURCE = 'all';
    delete process.env.RESEND_AUDIENCE_ID;
    try {
      const res = mockRes();
      await handler({ method: 'POST', body: { email: 'friend@example.com' } }, res, {
        fetchFn: async (url, opts) => {
          assert.deepEqual(JSON.parse(opts.body), { email: 'friend@example.com', unsubscribed: false });
          return { ok: true };
        },
      });
      assert.equal(res.statusCode, 200);
    } finally { delete process.env.NEWSLETTER_CONTACT_SOURCE; }
  });

  it('trims the configured segment ID', async () => {
    process.env.RESEND_AUDIENCE_ID = '  segment_123  ';
    const res = mockRes();
    await handler({ method: 'POST', body: { email: 'fan@example.com' } }, res, {
      fetchFn: async (url, opts) => {
        assert.deepEqual(JSON.parse(opts.body).segments, [{ id: 'segment_123' }]);
        return { ok: true };
      },
    });
    assert.equal(res.statusCode, 200);
  });
});
