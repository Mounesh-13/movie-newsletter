import dotenv from 'dotenv';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickMovie } from './pickMovie.js';
import { getFacts } from './getFacts.js';
import { sendDailyEmail } from './sendEmail.js';

dotenv.config();

const SENT_PATH = new URL('../data/sent.json', import.meta.url);
const PENDING_PATH = new URL('../data/pending.json', import.meta.url);

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
  pendingPath = PENDING_PATH,
  logger = console,
  approve = false,
} = {}) {
  if (approve) {
    return sendApproved({ sendFn, sentPath, pendingPath, logger });
  }
  return prepareDraft({ pickFn, factsFn, pendingPath, logger });
}

export async function prepareDraft({
  pickFn = pickMovie,
  factsFn = getFacts,
  pendingPath = PENDING_PATH,
  logger = console,
} = {}) {
  let movie = null;
  try {
    movie = await pickFn();
  } catch (err) {
    if (isExhaustedError(err)) {
      logger.warn(`Warning: ${err.message} Nothing to prepare today. Exiting cleanly.`);
      return { status: 'skipped-no-movie', timestamp: new Date().toISOString() };
    }
    throw err;
  }
  if (!movie) {
    logger.warn('Warning: no movie found (all candidates exhausted/already sent). Nothing to prepare today. Exiting cleanly.');
    return { status: 'skipped-no-movie', timestamp: new Date().toISOString() };
  }

  const facts = await factsFn(movie);
  if (!facts) {
    logger.error('Error: fact generation failed (returned null). No draft written.');
    return { status: 'skipped-no-facts', movie, timestamp: new Date().toISOString() };
  }

  await mkdir(dirname(toFsPath(pendingPath)), { recursive: true });
  await writeFile(pendingPath, JSON.stringify({ movie, facts, preparedAt: new Date().toISOString() }, null, 2), 'utf8');
  const timestamp = new Date().toISOString();
  logger.log(`Draft ready for review: "${movie.title}" (TMDB id ${movie.id}) at ${timestamp}. Run with --approve to send.`);
  logger.log(`Facts: ${JSON.stringify(facts)}`);
  return { status: 'pending-review', movie, facts, timestamp };
}

export async function sendApproved({
  sendFn = sendDailyEmail,
  sentPath = SENT_PATH,
  pendingPath = PENDING_PATH,
  logger = console,
} = {}) {
  let draft;
  try {
    draft = JSON.parse(await readFile(pendingPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('No pending draft found. Run without --approve first to prepare one.');
    }
    throw new Error(`Failed to read pending draft: ${err.message}`);
  }
  const { movie, facts } = draft ?? {};
  if (!movie || !Array.isArray(facts) || facts.length !== 3) {
    throw new Error('Pending draft is invalid (needs a movie and exactly 3 facts). Re-run without --approve.');
  }

  const sendResult = await sendFn(movie, facts);
  if (sendResult.sent === 0) {
    logger.error(`Error: delivery count is 0 (failed ${sendResult.failed}). NOT recording id; draft kept for retry.`);
    return { status: 'skipped-send-failed', movie, facts, sendResult, timestamp: new Date().toISOString() };
  }
  await recordSentId(sentPath, movie.id);
  await rm(pendingPath, { force: true });

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
  const approved = process.argv.includes('--approve');
  runAll({ approve: approved })
    .then((result) => {
      // exit 0: sent, or clean skips (no movie). exit 1: needs human attention.
      if (result.status === 'sent' || result.status === 'skipped-no-movie' || result.status === 'pending-review') process.exit(0);
      process.exit(1);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
