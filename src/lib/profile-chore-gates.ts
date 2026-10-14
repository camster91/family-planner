/** Server-only rollout gates for name-only profile chores. */
export const PROFILE_CHORE_ENABLE_ENV = "HOUSEHOLD_PROFILE_CHORE_ENABLED";
export const PROFILE_CHORE_ROLLBACK_READY_ENV =
  "HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY";
/**
 * Separate release-controller opt-in for profile-owned recurring work.
 * This remains private and is intentionally absent from the public manifest.
 */
export const PROFILE_CHORE_RECURRENCE_ENABLE_ENV =
  "HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED";

export function isProfileChoreEnabled(): boolean {
  return (
    process.env[PROFILE_CHORE_ENABLE_ENV] === "1" &&
    process.env[PROFILE_CHORE_ROLLBACK_READY_ENV] === "1"
  );
}

export function isProfileChoreRecurrenceSupported(): boolean {
  return (
    isProfileChoreEnabled() &&
    process.env[PROFILE_CHORE_RECURRENCE_ENABLE_ENV] === "1"
  );
}
