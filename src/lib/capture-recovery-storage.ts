/**
 * Synchronous, browser-only capture-recovery storage controls.
 *
 * Keep this module free of envelope validation, hashing and other recovery
 * dependencies so logout can purge private capture data before loading any
 * larger offline/recovery code.
 */

export const CAPTURE_RECOVERY_STORAGE_PREFIX =
  "family-planner:capture-recovery:v1:";
export const CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY = `${CAPTURE_RECOVERY_STORAGE_PREFIX}active`;

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(storage?: RecoveryStorage | null): RecoveryStorage | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function captureRecoveryStorageKey(
  userId: string,
  familyId: string,
): string {
  return `${CAPTURE_RECOVERY_STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(familyId)}`;
}

/**
 * Drop the active capture-recovery namespace when a session ends. Capture
 * envelopes contain normalized household content, so logout must remove both
 * the active-account marker and its namespace before other cleanup work.
 */
export function clearCaptureRecoveryStorage(
  storage: RecoveryStorage | null | undefined,
  userId?: string,
  familyId?: string,
): void {
  const target = safeStorage(storage);
  if (!target) return;
  try {
    const active = target.getItem(CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY);
    const keys = new Set<string>();
    if (userId && familyId)
      keys.add(captureRecoveryStorageKey(userId, familyId));
    if (
      active &&
      active.startsWith(CAPTURE_RECOVERY_STORAGE_PREFIX) &&
      active !== CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY
    )
      keys.add(active);
    for (const key of keys) target.removeItem(key);
    target.removeItem(CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY);
  } catch {
    // Storage is optional; logout should continue even if private mode denies removal.
  }
}
