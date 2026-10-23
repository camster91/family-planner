/** Private rollout controls; never a public/offline capability advertisement. */
export const ROUTINE_SCHEDULE_WRITE_ENV = "ROUTINE_SCHEDULE_ENABLED";
export const ROUTINE_SCHEDULE_READY_ENV = "ROUTINE_SCHEDULE_ROLLBACK_READY";
export function isRoutineScheduleExpansionEnabled(): boolean {
  return (
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] === "1" &&
    process.env[ROUTINE_SCHEDULE_READY_ENV] === "1"
  );
}
