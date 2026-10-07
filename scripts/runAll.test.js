import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// runAll.js must export the approval-gate flow (RED until implemented)
import { runAll, prepareDraft, sendApproved, recordSentId } from './runAll.js';

const movie = { id: 11, title: 'Jurassic Park', release_date: '1993-06-11', vote_average: 8, vote_count: 9000, overview: 'Dinos.' };
const facts = ['Fact one.', 'Fact two.', 'Fact three.'];
const quiet = { log() {}, warn() {}, error() {} };

let dir;
let sentPath;
let pendingPath;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runall-'));
  sentPath = join(dir, 'sent.json');
  pendingPath = join(dir, 'pending.json');
  await writeFile(sentPath, '[]', 'utf8');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

describe('prepareDraft (default runAll, no send)', () => {
  it('picks + facts, writes pending.json, does NOT send or touch sent.json', async () => {
    let sentCalled = false;
    const result = await runAll({
      pickFn: async () => movie,
      factsFn: async () => facts,
      sendFn: async () => { sentCalled = true; },
      sentPath, pendingPath, logger: quiet,
    });
    assert.equal(result.status, 'pending-review');
    assert.equal(sentCalled, false);
    assert.deepEqual(JSON.parse(await readFile(pendingPath, 'utf8')).movie, movie);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), []);
  });

  it('prepareDraft helper is exported and behaves the same', async () => {
    const result = await prepareDraft({ pickFn: async () => movie, factsFn: async () => facts, pendingPath, logger: quiet });
    assert.equal(result.status, 'pending-review');
    assert.ok(await exists(pendingPath));
  });

  it('no movie (null): warns, writes nothing', async () => {
    const result = await runAll({
      pickFn: async () => null,
      factsFn: async () => facts,
      sendFn: async () => { throw new Error('must not send'); },
      sentPath, pendingPath, logger: quiet,
    });
    assert.equal(result.status, 'skipped-no-movie');
    assert.equal(await exists(pendingPath), false);
  });

  it('no movie (pick throws No eligible): warns, writes nothing', async () => {
    const result = await runAll({
      pickFn: async () => { throw new Error('No eligible movies found for today.'); },
      factsFn: async () => facts,
      sendFn: async () => { throw new Error('must not send'); },
      sentPath, pendingPath, logger: quiet,
    });
    assert.equal(result.status, 'skipped-no-movie');
  });

  it('facts null: errors, writes nothing', async () => {
    const result = await runAll({
      pickFn: async () => movie,
      factsFn: async () => null,
      sendFn: async () => { throw new Error('must not send'); },
      sentPath, pendingPath, logger: quiet,
    });
    assert.equal(result.status, 'skipped-no-facts');
    assert.equal(await exists(pendingPath), false);
  });
});

describe('sendApproved (approve=true)', () => {
  it('sends pending draft, records id, removes pending.json', async () => {
    await writeFile(pendingPath, JSON.stringify({ movie, facts }), 'utf8');
    let sentArgs = null;
    const result = await runAll({
      approve: true,
      sendFn: async (m, f) => { sentArgs = [m, f]; return { sent: 2, failed: 0 }; },
      sentPath, pendingPath, logger: quiet,
    });
    assert.equal(result.status, 'sent');
    assert.deepEqual(sentArgs, [movie, facts]);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), [11]);
    assert.equal(await exists(pendingPath), false);
  });

  it('sendApproved helper is exported and behaves the same', async () => {
    await writeFile(pendingPath, JSON.stringify({ movie, facts }), 'utf8');
    const result = await sendApproved({ sendFn: async () => ({ sent: 1, failed: 0 }), sentPath, pendingPath, logger: quiet });
    assert.equal(result.status, 'sent');
  });

  it('approve with no pending draft throws clearly', async () => {
    await assert.rejects(
      () => runAll({ approve: true, sendFn: async () => ({}), sentPath, pendingPath, logger: quiet }),
      /no pending draft/i,
    );
  });

  it('incomplete delivery keeps pending.json, records nothing', async () => {
    for (const zeroResult of [{ sent: 0, failed: 2 }, { sent: 0, failed: 0 }, { sent: 1, failed: 1 }]) {
      await writeFile(pendingPath, JSON.stringify({ movie, facts }), 'utf8');
      await writeFile(sentPath, '[]', 'utf8');
      const result = await runAll({
        approve: true,
        sendFn: async () => zeroResult,
        sentPath, pendingPath, logger: quiet,
      });
      assert.equal(result.status, 'skipped-send-failed', JSON.stringify(zeroResult));
      assert.equal(await exists(pendingPath), true, 'draft must be kept for retry');
      assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), [], 'id must NOT be recorded');
    }
  });

  it('does not duplicate an id already in sent.json', async () => {
    await writeFile(sentPath, '[11]', 'utf8');
    await recordSentId(sentPath, 11);
    assert.deepEqual(JSON.parse(await readFile(sentPath, 'utf8')), [11]);
  });
});
