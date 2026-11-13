import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, runWalkthrough } from '../../games/src/verify.mjs';

for (const entry of GAMES) {
  test(`walkthrough: ${entry.id} reaches max score and wins`, async () => {
    const r = await runWalkthrough(entry);
    assert.deepEqual(r.problems, []);
    assert.equal(r.score, entry.maxScore);
  });
}
