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

/** Curation budget: distinct-seed failures tolerated before a journey is
 *  moved to QUARANTINE (a seed-stable failure is always a defect, never
 *  quarantined). No code path consumes this today — quarantine curation is a
 *  deliberate human decision recorded in QUARANTINE below. */
export const FLAKE_BUDGET = 3;

/** Journeys currently quarantined (removed from the blocking set). */
export const QUARANTINE: QuarantineEntry[] = [];

const quarantinedJourneyIds = new Set(QUARANTINE.map((q) => q.journeyId));

export function isQuarantined(journeyId: string): boolean {
  return quarantinedJourneyIds.has(journeyId);
}
