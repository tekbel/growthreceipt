// Timing for the four stage sequence in the home hero. Pure, so it can be tested without a browser.

/** When each stage becomes active, in milliseconds from the start. */
export const STAGE_STARTS = [0, 1000, 2100, 3200] as const;
/** From this point the finished sequence stays on screen. It never loops. */
export const SEQUENCE_END = 4400;
export const STAGE_COUNT = STAGE_STARTS.length;

export type StageStatus = "done" | "active" | "pending" | "waiting";

/** The active stage at a given time. Returns STAGE_COUNT once the sequence has finished. */
export function stageAt(elapsed: number): number {
  if (elapsed >= SEQUENCE_END) return STAGE_COUNT;
  let stage = 0;
  STAGE_STARTS.forEach((start, index) => {
    if (elapsed >= start) stage = index;
  });
  return stage;
}

/** The next moment the stage changes, or null when the sequence has finished. */
export function nextChange(elapsed: number): number | null {
  for (const moment of [...STAGE_STARTS, SEQUENCE_END]) if (moment > elapsed) return moment;
  return null;
}

/** Once finished, every stage is done except the last, which waits for the founder. */
export function stageStatus(index: number, current: number): StageStatus {
  if (current >= STAGE_COUNT) return index === STAGE_COUNT - 1 ? "waiting" : "done";
  if (index < current) return "done";
  return index === current ? "active" : "pending";
}
