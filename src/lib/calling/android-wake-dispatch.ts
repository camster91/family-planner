import type { D1Store } from "@/lib/cloudflare/database";
import { readCurrentAndroidBinding } from "./native-binding";
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
export type RegisteredAndroidWakeConfig = AndroidWakeConfig & {
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
  config: RegisteredAndroidWakeConfig,
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
    const row = await readCurrentAndroidBinding(
      db,
      {
        owner: target,
        installationId: hint.installationId,
        epoch: hint.epoch,
        revision: hint.revision,
      },
      now(),
    );
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
