/** In-memory UI coordination only: no draft content, identities or credentials.
 * Every active editor prepares before any history sentinel is released. A failed
 * or superseded preparation must never fall through to navigation.
 */
export type OwnedDraftExit = {
  active: () => boolean;
  prepare: () => Promise<boolean>;
  release: () => Promise<boolean>;
};
const owners = new Set<OwnedDraftExit>();
let revision = 0;
let pending = false;
let committingAt: number | null = null;
function commit(navigate: () => void) {
  committingAt = revision;
  try {
    navigate();
  } finally {
    committingAt = null;
  }
}
export function registerOwnedDraftExit(owner: OwnedDraftExit) {
  owners.add(owner);
  revision++;
  return () => {
    if (owners.delete(owner)) revision++;
  };
}
export function navigateAfterOwnedDrafts(
  navigate: () => void,
): Promise<boolean> {
  // An approved local close may synchronously call a host's guarded router.
  // Reuse this exact commit, without another save or a recursive preparation.
  if (committingAt === revision) {
    navigate();
    return Promise.resolve(true);
  }
  if (pending) return Promise.resolve(false);
  const selected = [...owners].reverse().filter((owner) => owner.active());
  // Preserve synchronous ordinary navigation when no owned editor is active.
  if (!selected.length) {
    navigate();
    return Promise.resolve(true);
  }
  pending = true;
  const baseline = revision;
  const current = () =>
    baseline === revision &&
    selected.every((owner) => owners.has(owner) && owner.active());
  return (async () => {
    try {
      for (const owner of selected) {
        if (!current() || !(await owner.prepare()) || !current()) return false;
      }
      for (const owner of selected) {
        if (!current() || !(await owner.release()) || !current()) return false;
      }
      commit(navigate);
      return true;
    } catch {
      // The editor owns its recovery message; never log its content here.
      return false;
    } finally {
      pending = false;
    }
  })();
}
