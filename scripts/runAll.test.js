import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// RED gate: fails until runAll.js exists
import { runAll, recordSentId } from './runAll.js';

const movie = { id: 11, title: 'Jurassic Park', release_date: '1993-06-11', vote_average: 8, vote_count: 9000, overview: 'Dinos.' };
const facts = ['Fact one.', 'Fact two.', 'Fact three.'];

let dir;
let sentPath;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runall-'));
  sentPath = join(dir, 'sent.json');
  await writeFile(sentPath, '[]', 'utf8');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runAll', () => {
  it('happy path: picks, facts, sends, records id, returns sent', async () => {
    const calls = [];
    const result = await runAll({
      pickFn: async () => movie,
      factsFn: async () => facts,
      sendFn: async () => { calls.push('send'); return { sent: 2, failed: 0 }; },
      sentPath,
      logger: { log() {}, warn() {}, error() {} },
    });
    assert.equal(result.status, 'sent');
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), [11]);
    assert.deepEqual(calls, ['send']);
  });

  it('no movie (null): warns, skips send, exits cleanly', async () => {
    let sentCalled = false;
    const result = await runAll({
      pickFn: async () => null,
      factsFn: async () => facts,
      sendFn: async () => { sentCalled = true; },
      sentPath,
      logger: { log() {}, warn() {}, error() {} },
    });
    assert.equal(result.status, 'skipped-no-movie');
    assert.equal(sentCalled, false);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), []);
  });

  it('no movie (pick throws No eligible): warns, skips send', async () => {
    let sentCalled = false;
    const result = await runAll({
      pickFn: async () => { throw new Error('No eligible movies found for today (all filtered out or already sent).'); },
      factsFn: async () => facts,
      sendFn: async () => { sentCalled = true; },
      sentPath,
      logger: { log() {}, warn() {}, error() {} },
    });
    assert.equal(result.status, 'skipped-no-movie');
    assert.equal(sentCalled, false);
  });

  it('facts null: errors, skips send, does not record id', async () => {
    let sentCalled = false;
    const result = await runAll({
      pickFn: async () => movie,
      factsFn: async () => null,
      sendFn: async () => { sentCalled = true; },
      sentPath,
      logger: { log() {}, warn() {}, error() {} },
    });
    assert.equal(result.status, 'skipped-no-facts');
    assert.equal(sentCalled, false);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), []);
  });

  it('does not duplicate an id already in sent.json', async () => {
    await writeFile(sentPath, '[11]', 'utf8');
    await recordSentId(sentPath, 11);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), [11]);
  });
});
