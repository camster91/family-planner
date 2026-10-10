import {
  readNativeClientDetails,
  type NativeClientDetails,
} from "./native-app";
import type { BuildInfo } from "./build-info";

export type AppDiagnosticsReport = {
  format: 1;
  client: NativeClientDetails;
  server: BuildInfo | null;
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
export async function readAppDiagnostics(): Promise<AppDiagnosticsReport> {
  const client = await readNativeClientDetails();
  let server: BuildInfo | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/version", {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) server = publicServerBuild(await response.json());
  } catch {
    /* Offline and older servers may not provide this optional endpoint. */
  } finally {
    clearTimeout(timer);
  }
  return { format: 1, client, server };
}
