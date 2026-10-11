import { FEATURES, type FamilyFeatures } from "../../src/lib/features";

/**
 * The dashboard has both a raw JSON script seed and an escaped copy in the
 * React Server Component payload. Keep the escaping explicit so the harness
 * replaces either representation without corrupting the RSC string.
 */
export function escapeFeatureSeedForRsc(serialized: string) {
  return serialized.replaceAll('"', (quote) => `\\${quote}`);
}

function featureMapPattern() {
  // Next serializes the layout's client props into an escaped RSC string, so
  // accept either a raw or one-backslash-escaped JSON key while preserving the
  // source order established by defaultFeatures().
  const quoted = (key: string) => `[\\\\]?["']${key}[\\\\]?["']`;
  const fields = FEATURES.map(
    (feature) => `${quoted(feature.key)}\\s*:\\s*(?:true|false)`,
  ).join(",\\s*");
  return new RegExp(`\\{\\s*${fields}\\s*\\}`, "g");
}

/** Replace the full feature seed in both raw HTML and escaped RSC payloads. */
export function replaceFeatureSeed(body: string, features: FamilyFeatures) {
  const serialized = JSON.stringify(features);
  const script = /(<script id="family-features"[^>]*>)[\s\S]*?(<\/script>)/;
  let result = body.replace(
    script,
    (_whole: string, open: string, close: string) =>
      `${open}${serialized}${close}`,
  );
  const mapPattern = featureMapPattern();
  let replacements = 0;
  result = result.replace(mapPattern, (match: string) => {
    replacements += 1;
    return /\\["']/.test(match)
      ? escapeFeatureSeedForRsc(serialized)
      : serialized;
  });
  if (replacements === 0) {
    throw new Error(
      "The dashboard document did not expose the expected family feature seed.",
    );
  }
  return result;
}
