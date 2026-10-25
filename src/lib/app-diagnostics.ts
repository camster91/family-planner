import {
  readNativeClientDetails,
  type NativeClientDetails,
} from "./native-app";
import { readApiCapabilities, type ApiCapabilities } from "./api-capabilities";
import { runOwnedForeground } from "./owned-request-http";
import { readBoundedJsonResponse } from "./bounded-json-response";
import type { BuildInfo } from "./build-info";

export type AppDiagnosticsReport = {
  format: 1;
  client: NativeClientDetails;
  server: BuildInfo | null;
  /** Optional additive metadata; older reports retain format1 without this field. */
  capabilities?: ApiCapabilities | null;
};

/** Reject unexpected metadata; never copy raw response/plugin objects into reports. */
export function publicServerBuild(value: unknown): BuildInfo | null {
  if (!value || typeof value !== "object") return null;
  const { version, commit, builtAt } = value as Partial<BuildInfo>;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version) ||
    version.length > 100
  )
    return null;
  if (
    typeof commit !== "string" ||
    !/^(?:[a-fA-F0-9]{7,40}|unknown)$/.test(commit)
  )
    return null;
  if (
    typeof builtAt !== "string" ||
    (builtAt !== "unknown" &&
      (!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(builtAt) ||
        !Number.isFinite(Date.parse(builtAt))))
  )
    return null;
  return { version, commit, builtAt };
}

/** Called by Help only after a tap. No account data, client report export or persistence. */
export async function readAppDiagnostics(options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<AppDiagnosticsReport> {
  const fetcher = options.fetcher ?? fetch;
  const [native, website, capabilities] = await Promise.all([
    runOwnedForeground(async () => ({ kind: "reply" as const, client: await readNativeClientDetails() }),
      { signal: options.signal, timeoutMs: 3500 }),
    runOwnedForeground(async signal => {
      const response = await fetcher("/api/version", { credentials: "omit", cache: "no-store", signal });
      if (!response.ok) return { kind: "reply" as const, server: null };
      const body = await readBoundedJsonResponse(response, signal, 16 * 1024);
      return { kind: "reply" as const, server: publicServerBuild(body) };
    }, { signal: options.signal, timeoutMs: 3000 }),
    readApiCapabilities(fetcher, { signal: options.signal, credentials: "omit", timeoutMs: 3000 }),
  ]);
  const unknown: NativeClientDetails = { platform: "unknown", installed: "unavailable", version: "unknown", build: "unknown", id: "unknown",
    plugins: { App: false, Network: false, Share: false } };
  return { format: 1, client: native.kind === "reply" ? native.client : unknown,
    server: website.kind === "reply" ? website.server : null, capabilities };
}
