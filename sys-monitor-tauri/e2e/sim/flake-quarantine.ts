/**
 * Flake-quarantine list and budget mechanics (task 5.3).
 *
 * A journey that fails under a FIXED seed is a defect (blocking, must be
 * fixed). A journey that fails only across DISTINCT seeds beyond the budget
 * is quarantined: removed from the blocking set, tracked here until fixed.
 * The CI simulation job is blocking for the mock lane. Quarantine only
 * affects a journey explicitly listed here; an empty quarantine list keeps
 * the full registered matrix required.
 *
 * Entries are keyed by journey id. The budget is the number of distinct-seed
 * failures tolerated before a journey is quarantined.
 */
export interface QuarantineEntry {
  journeyId: string;
  reason: string;
  /** Opened when the budget was exceeded; closed when fixed. */
  opened: string;
  closed?: string;
  /** Distinct seeds that reproduced the failure (tracking). */
  seeds: number[];
}

/** Journeys currently quarantined (removed from the blocking set). */
export const QUARANTINE: QuarantineEntry[] = [];

const quarantinedJourneyIds = new Set(QUARANTINE.map((q) => q.journeyId));

export function isQuarantined(journeyId: string): boolean {
  return quarantinedJourneyIds.has(journeyId);
}
