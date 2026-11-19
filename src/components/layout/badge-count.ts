/**
 * Shared count cap for the top bar's badges (bell and review inbox). Kept in
 * its own tiny module so each lazily loaded badge chunk stays independent.
 */

/** The badge shows exact counts up to this; one more row reads as "9+". */
export const BELL_COUNT_MAX = 9;

/** What a badge and its link's name say for a count. */
export const bellCountLabel = (count: number) =>
  count > BELL_COUNT_MAX ? `${BELL_COUNT_MAX}+` : String(count);
