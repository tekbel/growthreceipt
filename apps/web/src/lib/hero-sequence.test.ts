import assert from "node:assert/strict";
import { test } from "node:test";
import { nextChange, SEQUENCE_END, STAGE_COUNT, stageAt, stageStatus } from "./hero-sequence.ts";

test("stages follow the timeline and finish once", () => {
  assert.equal(stageAt(0), 0);
  assert.equal(stageAt(999), 0);
  assert.equal(stageAt(1000), 1);
  assert.equal(stageAt(2100), 2);
  assert.equal(stageAt(3200), 3);
  assert.equal(stageAt(SEQUENCE_END - 1), 3);
  assert.equal(stageAt(SEQUENCE_END), STAGE_COUNT);
  assert.equal(stageAt(SEQUENCE_END * 10), STAGE_COUNT);
});

test("next change walks every boundary, then stops", () => {
  const seen: number[] = [];
  for (let at: number | null = 0; at !== null; at = nextChange(at)) seen.push(at);
  assert.deepEqual(seen, [0, 1000, 2100, 3200, SEQUENCE_END]);
  assert.equal(nextChange(1500), 2100);
});

test("status marks done, active and pending stages", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => stageStatus(index, 2)),
    ["done", "done", "active", "pending"],
  );
});

test("the finished sequence leaves the recommendation waiting for approval", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => stageStatus(index, STAGE_COUNT)),
    ["done", "done", "done", "waiting"],
  );
});
