import dotenv from 'dotenv';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

dotenv.config();

const SENT_PATH = new URL('../data/sent.json', import.meta.url);

export function anniversaryBonus(releaseYear, currentYear) {
  const yearsAgo = currentYear - releaseYear;
  if (yearsAgo === 50 || yearsAgo === 75 || yearsAgo === 100) return 15;
  if (yearsAgo === 25 || yearsAgo === 30 || yearsAgo === 40) return 10;
  if (yearsAgo === 10 || yearsAgo === 20) return 5;
  return 0;
}

export function calculateScore(movie, currentYear) {
  const releaseYear = new Date(movie.release_date).getFullYear();
  const base = movie.vote_average * 10;
  const popularity = Math.log10(movie.vote_count) * 2;
  return base + popularity + anniversaryBonus(releaseYear, currentYear);
}

export function pickWinner(movies, sentIds = [], currentYear = new Date().getFullYear()) {
  const sent = new Set(sentIds);
  const candidates = movies
    .filter((m) => m.vote_count >= 500)
    .filter((m) => !sent.has(m.id))
    .map((m) => ({ ...m, score: calculateScore(m, currentYear) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

async function loadSentIds(sentPath = SENT_PATH) {
  try {
    const raw = await readFile(sentPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdir(dirname(fileURLToPath(sentPath)), { recursive: true });
      await writeFile(sentPath, '[]', 'utf8');
      return [];
    }
    throw new Error(`Failed to read sent.json: ${err.message}`);
  }
}

async function fetchMoviesForDate(apiKey, yyyyMmDd, fetchFn) {
  const url = new URL('https://api.themoviedb.org/3/discover/movie');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('primary_release_date.gte', yyyyMmDd);
  url.searchParams.set('primary_release_date.lte', yyyyMmDd);
  url.searchParams.set('sort_by', 'vote_count.desc');
  url.searchParams.set('include_adult', 'false');

  let res;
  try {
    res = await fetchFn(url.toString());
  } catch (err) {
    throw new Error(`TMDB request failed for ${yyyyMmDd}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`TMDB request failed for ${yyyyMmDd}: HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.results ?? [];
}

export async function pickMovie({ fetchFn = fetch, today = new Date(), sentPath = SENT_PATH } = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is missing. Add it to your local .env file (see .env.example).');
  }

  const currentYear = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const all = [];
  for (let year = 1950; year <= currentYear; year++) {
    const dateStr = `${year}-${mm}-${dd}`;
    const results = await fetchMoviesForDate(apiKey, dateStr, fetchFn);
    for (const r of results) {
      all.push({
        id: r.id,
        title: r.title,
        release_date: r.release_date,
        vote_average: r.vote_average,
        vote_count: r.vote_count,
        overview: r.overview,
      });
    }
  }

  const sentIds = await loadSentIds(sentPath);
  const winner = pickWinner(all, sentIds, currentYear);
  if (!winner) {
    throw new Error('No eligible movies found for today (all filtered out or already sent).');
  }
  return winner;
}

const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  pickMovie()
    .then((movie) => console.log(JSON.stringify(movie, null, 2)))
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
