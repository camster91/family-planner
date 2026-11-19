/**
 * Deployment gates for app-held ("managed") AI (#144, owner decision
 * 2026-11-19). Server-only: reads Worker vars/secrets. Never import from a
 * client component; the browser only ever learns `available: true|false`.
 *
 * Everything is OFF unless every gate below is explicitly on:
 * - `FAMILY_CLAUDE_AI_READY` must be exactly "1" (unset, "0", "true" = off);
 * - `FAMILY_AI_PROVIDER_DISABLED` is the global kill switch ("1" = paused);
 * - the AI usage meter must be ready (`FAMILY_AI_USAGE_READY` and
 *   `FAMILY_AI_USAGE_ROLLBACK_READY`), because every call reserves budget;
 * - the one app key, `FAMILY_AI_ANTHROPIC_API_KEY`, must be set as a Worker
 *   secret. It follows the existing `<SCOPE>_ANTHROPIC_API_KEY` secret naming
 *   (`EVENT_IMPORT_ANTHROPIC_API_KEY`, `INVENTORY_SCAN_ANTHROPIC_API_KEY`).
 * Each household must then opt in (parent-only Settings switch, off by default).
 */
import { isAiUsageReady } from "@/lib/ai-usage-gates";
import { canUseCapture } from "@/lib/role-capabilities";

export const CLAUDE_AI_READY_ENV = "FAMILY_CLAUDE_AI_READY";
export const CLAUDE_AI_KEY_ENV = "FAMILY_AI_ANTHROPIC_API_KEY";
export const AI_PROVIDER_DISABLED_ENV = "FAMILY_AI_PROVIDER_DISABLED";

type Env = Record<string, string | undefined>;

/** The global kill switch. */
export function aiProviderPaused(env: Env = process.env): boolean {
  return env[AI_PROVIDER_DISABLED_ENV] === "1";
}

/** The app key, or null. The value never leaves the server and is never logged. */
export function claudeApiKey(env: Env = process.env): string | null {
  const key = env[CLAUDE_AI_KEY_ENV]?.trim();
  return key ? key : null;
}

/** True only when the deployment may call Claude at all (before household opt-in). */
export function claudeAiDeploymentReady(env: Env = process.env): boolean {
  return (
    env[CLAUDE_AI_READY_ENV] === "1" &&
    !aiProviderPaused(env) &&
    claudeApiKey(env) !== null &&
    (env === process.env ? isAiUsageReady() : usageReady(env))
  );
}

function usageReady(env: Env): boolean {
  return (
    env.FAMILY_AI_USAGE_READY === "1" &&
    env.FAMILY_AI_USAGE_ROLLBACK_READY === "1"
  );
}

/**
 * Who may use app-held AI: parents and teens; never children, never roles this
 * file does not know. Shared tablet sessions are refused earlier, by
 * `authenticateWithFamily` (paired-device refusal), and the launcher is hidden
 * on device/fridge surfaces.
 */
export function canUseManagedAi(role: string | null | undefined): boolean {
  // Same rule as AI capture (D4, #102): parent and teen only.
  return canUseCapture(role);
}
