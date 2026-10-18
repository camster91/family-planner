"use client";

export type RewardCreateOwner = {
  userId: string;
  familyId: string;
};

export type RewardCreateDraft = {
  name: string;
  description: string;
  cost: number;
  icon: string;
};

export type RewardCreateIntent = {
  key: string;
  draft: RewardCreateDraft;
};

export type RewardCreateStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
};

export type RewardCreateOwnerStore = {
  owner: RewardCreateOwner;
  latestDraft: RewardCreateDraft | null;
  intents: Map<string, RewardCreateIntent>;
};

export const REWARD_CREATE_INTENT_STORAGE_VERSION = 1;
export const REWARD_CREATE_INTENT_STORAGE_PREFIX =
  "family-planner:reward-create-intent:v1:";
export const REWARD_CREATE_INTENT_MAX_INTENTS = 32;

/** Shared mounted-page state so purge callers can clear form memory too. */
export const rewardCreateStores = new Map<string, RewardCreateOwnerStore>();

export function rewardCreateOwnerScope(
  owner?: RewardCreateOwner,
): string | null {
  if (typeof window === "undefined" || !owner?.userId || !owner.familyId)
    return null;
  return JSON.stringify([owner.userId, owner.familyId]);
}

export function rewardCreateStorage(): RewardCreateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function rewardCreateStorageKey(owner: RewardCreateOwner): string {
  return `${REWARD_CREATE_INTENT_STORAGE_PREFIX}${encodeURIComponent(owner.userId)}:${encodeURIComponent(owner.familyId)}`;
}

function removeStorageKey(target: RewardCreateStorage, key: string): void {
  try {
    target.removeItem(key);
  } catch {
    // Browser storage can be blocked or quota-limited. Memory cleanup still
    // remains available for the current mounted form.
  }
}

/**
 * Purge only reward-create recovery state. This module stays free of draft
 * validation and idempotency imports because logout and device surfaces use
 * it from their initial client bundles.
 */
export function clearRewardCreateIntents(owner?: RewardCreateOwner): boolean {
  if (owner) {
    const scope = rewardCreateOwnerScope(owner);
    if (scope) rewardCreateStores.delete(scope);
  } else {
    rewardCreateStores.clear();
  }

  const target = rewardCreateStorage();
  if (!target) return false;
  try {
    const doomed: string[] = [];
    const length = target.length ?? 0;
    for (let index = 0; index < length; index += 1) {
      const key = target.key?.(index);
      if (
        key?.startsWith(REWARD_CREATE_INTENT_STORAGE_PREFIX) &&
        (!owner || key === rewardCreateStorageKey(owner))
      )
        doomed.push(key);
    }
    if (owner && doomed.length === 0) {
      // A Storage mock may not implement enumeration; still attempt the
      // explicit key used by real browser storage.
      doomed.push(rewardCreateStorageKey(owner));
    }
    for (const key of doomed) removeStorageKey(target, key);
    return doomed.every((key) => {
      try {
        return target.getItem(key) === null;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
