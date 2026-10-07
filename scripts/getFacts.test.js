import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// RED gate: this import fails until getFacts.js exists
import { getFacts, buildPrompt, fetchWikipediaText } from './getFacts.js';

const sampleMovie = {
  title: 'Jurassic Park',
  release_date: '1993-06-11',
  overview: 'A theme park with cloned dinosaurs.',
};

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj };
}

describe('buildPrompt', () => {
  it('is grounded and asks for JSON array only', () => {
    const p = buildPrompt('Jurassic Park', '1993', 'Some text');
    assert.match(p, /Using ONLY the following text/);
    assert.match(p, /Jurassic Park/);
    assert.match(p, /Return ONLY a JSON array of exactly 3 strings/);
  });
});

describe('fetchWikipediaText', () => {
  it('returns extract on first hit', async () => {
    const fetchFn = async () => jsonResponse({ extract: 'Wiki text here' });
    const text = await fetchWikipediaText('Jurassic Park', '1993', fetchFn);
    assert.equal(text, 'Wiki text here');
  });

  it('retries with (film) variant after 404, then falls back to null', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (calls.length === 1) return { ok: false, status: 404 };
      return jsonResponse({ extract: 'Film page text' });
    };
    const text = await fetchWikipediaText('Dune', '1984', fetchFn);
    assert.equal(text, 'Film page text');
    assert.ok(calls.length >= 2);
    assert.ok(calls[1].includes('(film)') || calls[1].includes('%20'));
  });

  it('returns null when all variants fail', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 });
    const text = await fetchWikipediaText('Nope', '2000', fetchFn);
    assert.equal(text, null);
  });
});

describe('getFacts', () => {
  it('returns 3 facts on happy path', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    const fetchFn = async (url) => {
      if (url.includes('wikipedia.org')) return jsonResponse({ extract: 'Wiki extract.' });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '["fact one", "fact two", "fact three"]' }] } }] });
    };
    const facts = await getFacts(sampleMovie, { fetchFn });
    assert.equal(facts.length, 3);
  });

  it('falls back to TMDB overview when Wikipedia fails', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    let geminiPrompt = '';
    const fetchFn = async (url, opts) => {
      if (url.includes('wikipedia.org')) return { ok: false, status: 404 };
      geminiPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '["a", "b", "c"]' }] } }] });
    };
    const facts = await getFacts(sampleMovie, { fetchFn });
    assert.equal(facts.length, 3);
    assert.ok(geminiPrompt.includes(sampleMovie.overview));
  });

  it('retries once on transient Gemini 5xx then succeeds', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    const urls = [];
    let calls = 0;
    const fetchFn = async (url) => {
      urls.push(url);
      if (url.includes('wikipedia.org')) return jsonResponse({ extract: 'Wiki.' });
      calls++;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '["x", "y", "z"]' }] } }] });
    };
    const facts = await getFacts(sampleMovie, { fetchFn });
    assert.deepEqual(facts, ['x', 'y', 'z']);
  });

  it('calls a model that exists (gemini-2.5-flash), not the removed 2.0-flash', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      if (url.includes('wikipedia.org')) return jsonResponse({ extract: 'Wiki.' });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '["a", "b", "c"]' }] } }] });
    };
    await getFacts(sampleMovie, { fetchFn });
    const geminiUrl = urls.find((u) => u.includes('generativelanguage'));
    assert.ok(geminiUrl.includes('gemini-2.5-flash'), geminiUrl);
    assert.ok(!geminiUrl.includes('gemini-2.0-flash'));
  });

  it('retries Gemini once when first response is not valid JSON', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    let calls = 0;
    const fetchFn = async (url) => {
      if (url.includes('wikipedia.org')) return jsonResponse({ extract: 'Wiki.' });
      calls++;
      if (calls === 1) {
        return jsonResponse({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] });
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '["x", "y", "z"]' }] } }] });
    };
    const facts = await getFacts(sampleMovie, { fetchFn });
    assert.deepEqual(facts, ['x', 'y', 'z']);
    assert.equal(calls, 2);
  });

  it('returns null when everything fails', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    const fetchFn = async (url) => {
      if (url.includes('wikipedia.org')) return { ok: false, status: 404 };
      return { ok: false, status: 500 };
    };
    const facts = await getFacts(sampleMovie, { fetchFn });
    assert.equal(facts, null);
  });

  it('returns null when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const facts = await getFacts(sampleMovie, { fetchFn: async () => { throw new Error('should not be called'); } });
    assert.equal(facts, null);
  });
});
