import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';

dotenv.config();

const WIKI_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export function buildPrompt(title, year, combinedText, strict = false) {
  const base =
    `Using ONLY the following text about the movie '${title}' (${year}), ` +
    `extract exactly 3 lesser-known, specific, interesting facts. ` +
    `Do not invent or add any information not present in this text. ` +
    `If the text doesn't contain enough distinct facts, say so rather than making things up. ` +
    `Keep each fact to 1-2 sentences, written in a casual, engaging tone suitable for an email newsletter.\n\n` +
    `Text: ${combinedText}\n\n` +
    `Return ONLY a JSON array of exactly 3 strings, nothing else.`;
  if (!strict) return base;
  return base + `\n\nIMPORTANT: Return ONLY a valid JSON array of exactly 3 strings. No markdown, no code fences, no explanation.`;
}

function wikiTitleVariants(title, year) {
  const variants = [title];
  if (year) {
    variants.push(`${title} (film)`);
    variants.push(`${title} (${year} film)`);
  } else {
    variants.push(`${title} (film)`);
  }
  return [...new Set(variants)];
}

export async function fetchWikipediaText(title, year, fetchFn = fetch) {
  for (const variant of wikiTitleVariants(title, year)) {
    const url = `${WIKI_BASE}/${encodeURIComponent(variant)}`;
    let res;
    try {
      res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    } catch {
      continue; // network blip -> try next variant
    }
    if (res.ok) {
      try {
        const data = await res.json();
        if (data.extract) return data.extract;
      } catch {
        continue;
      }
    }
    // non-OK (incl. 404) -> try next variant
  }
  return null;
}

function extractGeminiText(data) {
  try {
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  } catch {
    return '';
  }
}

function parseFactsText(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // strip markdown code fences if the model adds them despite instructions
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) cleaned = fence[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((s) => typeof s === 'string')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function callGemini(apiKey, prompt, fetchFn = fetch, model = DEFAULT_MODEL) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      throw new Error(`Gemini request failed: ${err.message}`);
    }
    if (res.ok) {
      const data = await res.json();
      return extractGeminiText(data);
    }
    // Retry once on transient rate-limit/overload; fail fast otherwise
    // (e.g. 404 = unknown model, 400 = bad request — retrying is pointless).
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    throw new Error(`Gemini request failed: HTTP ${res.status}`);
  }
}

export async function getFacts(movie, { fetchFn = fetch, model = DEFAULT_MODEL } = {}) {
  if (!movie || !movie.title) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is missing. Add it to your local .env file (see .env.example).');
    return null;
  }

  const year = (movie.release_date || '').slice(0, 4);
  let wikiText = null;
  try {
    wikiText = await fetchWikipediaText(movie.title, year, fetchFn);
  } catch {
    wikiText = null;
  }

  const overview = movie.overview || '';
  const combinedText = [wikiText, overview].filter(Boolean).join('\n\n');
  if (!combinedText) return null;

  const prompt = buildPrompt(movie.title, year, combinedText);
  try {
    const first = await callGemini(apiKey, prompt, fetchFn, model);
    const parsed = parseFactsText(first);
    if (parsed) return parsed;

    // Retry once with a stricter prompt
    const strictPrompt = buildPrompt(movie.title, year, combinedText, true);
    const second = await callGemini(apiKey, strictPrompt, fetchFn, model);
    return parseFactsText(second);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return null;
  }
}

const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const sample = {
    title: 'Jurassic Park',
    release_date: '1993-06-11',
    overview:
      'A pragmatic paleontologist visiting an almost complete theme park is tasked with protecting a couple of kids after a power failure sets the cloned dinosaurs loose.',
  };
  getFacts(sample).then((facts) => {
    if (!facts) {
      console.error('Error: could not generate facts (returned null). Check GEMINI_API_KEY and network, then retry.');
      process.exit(1);
    }
    console.log(JSON.stringify(facts, null, 2));
  });
}
