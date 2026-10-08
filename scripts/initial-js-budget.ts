import { gzipSync } from "node:zlib";

export const CORE_JS_BUDGETS = {
  today: 250_000,
  calendar: 300_000,
  chores: 300_000,
  lists: 300_000,
  meals: 300_000,
  settings: 300_000,
} as const;

export type ScriptAsset = { url: string; body: Uint8Array };

/** Measure decoded response bodies with deterministic gzip, independent of HTTP encoding. */
export function measureInitialJavaScript(
  origin: string,
  assets: ScriptAsset[],
) {
  const expected = new URL(origin).origin;
  if (!assets.length) throw new Error("No initial JavaScript was measured.");
  const unique = new Map<string, Buffer>();
  for (const asset of assets) {
    const url = new URL(asset.url);
    if (
      url.origin !== expected ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/_next\/static\/[A-Za-z0-9_./-]+\.js$/.test(url.pathname) ||
      url.pathname.split("/").some((part) => part === "." || part === "..") ||
      /(?:%|\/\.\.?\/)/i.test(asset.url.split("?")[0])
    ) {
      throw new Error("Unexpected initial script location.");
    }
    const body = Buffer.from(asset.body);
    if (!body.length)
      throw new Error("An initial script has no response body.");
    const previous = unique.get(url.pathname);
    if (previous && !previous.equals(body))
      throw new Error("An initial script changed during measurement.");
    unique.set(url.pathname, body);
  }
  const files = [...unique]
    .map(([path, body]) => ({
      path,
      bytes: body.length,
      gzipBytes: gzipSync(body).length,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    files,
  };
}

export function enforceJavaScriptBudget(
  measurement: ReturnType<typeof measureInitialJavaScript>,
  budget: number,
) {
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new Error("Invalid JavaScript budget.");
  if (measurement.gzipBytes > budget)
    throw new Error(
      `Initial JavaScript ${measurement.gzipBytes} gzip bytes exceeds ${budget}.`,
    );
}
