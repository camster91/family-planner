import type { D1Store } from "@/lib/cloudflare/database";
import { callActorAllowed } from "./authority";
import type { CallActor } from "./protocol";
import type { NativeCallOwner } from "./native-registration-contract";
import { nativeTokenAad, openNativeToken } from "./native-token";
import {
  androidWakeHintSchema,
  sendAndroidCallWake,
  type AndroidWakeConfig,
  type AndroidWakeHint,
  type AndroidWakeResult,
} from "./android-wake";

type Input = {
  caller: Extract<CallActor, { kind: "person" }>;
  target: NativeCallOwner;
  hint: AndroidWakeHint;
};
type Config = AndroidWakeConfig & {
  tokenKey?: string;
  previousTokenKey?: string;
};
type Deps = { fetchImpl?: typeof fetch; now?: () => number };

/**
 * Internal coordinator entry, not an HTTP API or a device-enumeration endpoint.
 * Raw destinations never come from the caller or leave this server module.
 * stillRinging must check canonical call ID/participants/deadline/cancellation;
 * it has no permissive default. Native call state/ownership must exist before
 * wiring this to a reachable product path. Paired native callers remain gated.
 */
export async function dispatchRegisteredAndroidWake(
  db: D1Store,
  config: Config,
  input: Input,
  stillRinging: () => Promise<boolean>,
  deps: Deps = {},
): Promise<AndroidWakeResult> {
  const now = deps.now ?? Date.now;
  if (!config.enabled) return { status: "unavailable" };
  if (
    input.caller.kind !== "person" ||
    input.caller.familyId !== input.target.familyId ||
    !androidWakeHintSchema.safeParse(input.hint).success
  )
    return { status: "unavailable" };
  const read = async () => {
    if (!(await callActorAllowed(db, input.caller, now()))) return null;
    const { target, hint } = input;
    const row = await db
      .withSession("first-primary")
      .prepare(
        `SELECT i.push_token_enc FROM "NativeCallInstallation" i
       JOIN "User" u ON u.id=i.user_id AND u.family_id=i.family_id AND u.token_version=i.generation
       JOIN "Family" f ON f.id=i.family_id
       WHERE i.id=? AND i.user_id=? AND i.family_id=? AND i.generation=?
       AND i.epoch=? AND i.revision=? AND i.platform='android' AND i.provider='fcm'
       AND i.revoked_at IS NULL AND i.expires_at>? AND i.push_token_enc IS NOT NULL
       AND u.role IN ('parent','teen','child') AND json_extract(f.features,'$.calling')=1`,
      )
      .bind(
        hint.installationId,
        target.userId,
        target.familyId,
        target.generation,
        hint.epoch,
        hint.revision,
        now(),
      )
      .first<{ push_token_enc: string }>();
    return row
      ? openNativeToken(
          row.push_token_enc,
          nativeTokenAad(hint.installationId, target, "android", hint),
          config.tokenKey,
          config.previousTokenKey,
        )
      : null;
  };
  try {
    // All database/call authority work runs under the transport's one deadline,
    // including an initial hung D1/call-state check. Destination is captured only
    // after the first canonical read, then compared again after OAuth.
    let destination: string | null = null;
    const check = async () => {
      if (!(await stillRinging())) return false;
      const latest = await read();
      if (!latest || (destination !== null && latest !== destination))
        return false;
      destination = latest;
      return true;
    };
    // The transport needs a destination before building the provider request.
    // Resolve it through an internal getter only after the first authority check.
    return await sendAndroidCallWake(
      config,
      () => destination,
      input.hint,
      check,
      deps,
    );
  } catch {
    return { status: "unavailable" };
  }
}
