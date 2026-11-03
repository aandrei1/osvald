/** Time source, so flow tests can pin `stage_entered_at` and the recovery cutoff. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
