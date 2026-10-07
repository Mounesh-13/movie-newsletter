import dotenv from 'dotenv';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickMovie } from './pickMovie.js';
import { getFacts } from './getFacts.js';
import { sendDailyEmail } from './sendEmail.js';

dotenv.config();

const SENT_PATH = new URL('../data/sent.json', import.meta.url);

function toFsPath(p) {
  return typeof p === 'string' ? p : fileURLToPath(p);
}

export async function recordSentId(sentPath, id) {
  let ids = [];
  try {
    const raw = await readFile(sentPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Failed to read sent.json: ${err.message}`);
  }
  if (!ids.includes(id)) {
    ids.push(id);
    await mkdir(dirname(toFsPath(sentPath)), { recursive: true });
    await writeFile(sentPath, JSON.stringify(ids, null, 2), 'utf8');
  }
  return ids;
}

function isExhaustedError(err) {
  return /no eligible movies/i.test(err?.message ?? '');
}

export async function runAll({
  pickFn = pickMovie,
  factsFn = getFacts,
  sendFn = sendDailyEmail,
  sentPath = SENT_PATH,
  logger = console,
} = {}) {
  let movie = null;
  try {
    movie = await pickFn();
  } catch (err) {
    if (isExhaustedError(err)) {
      logger.warn(`Warning: ${err.message} Nothing to send today. Exiting cleanly.`);
      return { status: 'skipped-no-movie', timestamp: new Date().toISOString() };
    }
    throw err;
  }
  if (!movie) {
    logger.warn('Warning: no movie found (all candidates exhausted/already sent). Nothing to send today. Exiting cleanly.');
    return { status: 'skipped-no-movie', timestamp: new Date().toISOString() };
  }

  const facts = await factsFn(movie);
  if (!facts) {
    logger.error('Error: fact generation failed (returned null). Skipping send to avoid a broken email.');
    return { status: 'skipped-no-facts', movie, timestamp: new Date().toISOString() };
  }

  const sendResult = await sendFn(movie, facts);
  await recordSentId(sentPath, movie.id);

  const timestamp = new Date().toISOString();
  logger.log(`Summary: sent "${movie.title}" (TMDB id ${movie.id}) at ${timestamp}. Result: ${sendResult.sent} delivered, ${sendResult.failed} failed.`);
  return { status: 'sent', movie, facts, sendResult, timestamp };
}

const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runAll()
    .then((result) => {
      if (result.status === 'skipped-no-facts') process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
