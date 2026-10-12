/**
 * Server capability gate for the optional person-chat Today context.
 *
 * The exact value is intentional: an omitted variable, a typo, and every
 * value other than `1` keep this dormant. This module must stay server-only.
 */
export const ASSISTANT_TODAY_ENABLED_ENV = "ASSISTANT_TODAY_ENABLED";

export function isAssistantTodayEnabled(
  env: { [key: string]: string | undefined } = process.env,
): boolean {
  return env[ASSISTANT_TODAY_ENABLED_ENV] === "1";
}
