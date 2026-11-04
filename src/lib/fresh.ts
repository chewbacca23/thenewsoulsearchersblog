/** How long a new post stays marked so people can spot it. */
export const FRESH_DAYS = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when `at` falls inside the last `FRESH_DAYS` (Berlin calendar days). */
export function isFresh(
  at: Date | number | string | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (at == null || at === '') return false;
  const then =
    at instanceof Date ? at.valueOf() : typeof at === 'number' ? at : Date.parse(String(at));
  if (!Number.isFinite(then)) return false;
  const nowMs = now instanceof Date ? now.valueOf() : now;
  if (!Number.isFinite(nowMs)) return false;
  const age = nowMs - then;
  return age >= 0 && age < FRESH_DAYS * MS_PER_DAY;
}

/** True if any date in the list is still fresh. */
export function anyFresh(
  dates: readonly (Date | number | string | null | undefined)[],
  now: Date | number = Date.now(),
): boolean {
  return dates.some((date) => isFresh(date, now));
}
