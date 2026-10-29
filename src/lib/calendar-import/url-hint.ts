/** Display hint for a stored feed URL: host only, never the path or query (they often hold a secret token). */
export function feedUrlHint(url: string | null): string {
  if (!url) return "Unavailable";
  try {
    return `${new URL(url).hostname}/…`;
  } catch {
    return "Unavailable";
  }
}

