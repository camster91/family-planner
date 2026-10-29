const DAY_MS = 24 * 60 * 60 * 1000;
export const CURSOR_MAX_AGE_MS = 7 * DAY_MS;
const CURSOR_RE = /^c1\.(\d{1,15})\.([\s\S]+)$/;
export function packCursor(
  cursor: string | null,
  issuedAt: Date,
): string | null {
  return cursor ? `c1.${issuedAt.getTime()}.${cursor}` : null;
}
export function usableCursor(
  stored: string | null | undefined,
  now: Date,
): string | null {
  if (!stored) return null;
  const match = CURSOR_RE.exec(stored);
  if (!match) return null;
  const age = now.getTime() - Number(match[1]);
  return age < 0 || age > CURSOR_MAX_AGE_MS ? null : match[2];
}
export function cursorIssuedAt(stored: string | null | undefined): Date | null {
  const match = stored ? CURSOR_RE.exec(stored) : null;
  return match ? new Date(Number(match[1])) : null;
}
