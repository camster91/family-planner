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

type OwnerStore = {
  latestDraft: RewardCreateDraft | null;
  intents: Map<string, RewardCreateIntent>;
};

/**
 * A deterministic key for the mounted form boundary. It is safe to compute
 * during SSR because it does not inspect the browser cache. The cache itself
 * remains browser-only below.
 */
export function rewardCreateOwnerKey(owner?: RewardCreateOwner): string {
  return owner?.userId && owner.familyId
    ? JSON.stringify([owner.userId, owner.familyId])
    : "anonymous";
}

// This module is intentionally browser-only and memory-only. A missing owner
// is never given a shared fallback scope, so SSR and anonymous/test renders
// cannot reuse another household's private draft or request key.
const stores = new Map<string, OwnerStore>();

function ownerScope(owner?: RewardCreateOwner): string | null {
  if (typeof window === "undefined" || !owner?.userId || !owner.familyId) return null;
  return JSON.stringify([owner.userId, owner.familyId]);
}

function getStore(owner?: RewardCreateOwner): OwnerStore | null {
  const scope = ownerScope(owner);
  if (!scope) return null;
  let store = stores.get(scope);
  if (!store) {
    store = { latestDraft: null, intents: new Map() };
    stores.set(scope, store);
  }
  return store;
}

export function rewardCreateSignature(draft: RewardCreateDraft): string {
  return JSON.stringify({
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    cost: draft.cost,
    icon: draft.icon,
  });
}

export function rememberRewardCreateDraft(
  owner: RewardCreateOwner | undefined,
  draft: RewardCreateDraft,
): void {
  const store = getStore(owner);
  if (store) store.latestDraft = { ...draft };
}

export function latestRewardCreateDraft(
  owner: RewardCreateOwner | undefined,
): RewardCreateDraft | null {
  const store = getStore(owner);
  return store?.latestDraft ? { ...store.latestDraft } : null;
}

export function rewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
): RewardCreateIntent | null {
  const store = getStore(owner);
  const intent = store?.intents.get(signature);
  return intent ? { key: intent.key, draft: { ...intent.draft } } : null;
}

export function rememberRewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
  draft: RewardCreateDraft,
  key: string,
): void {
  const store = getStore(owner);
  if (store) store.intents.set(signature, { key, draft: { ...draft } });
}

export function forgetRewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
): void {
  getStore(owner)?.intents.delete(signature);
}

/**
 * Clear only the draft that was just validated by the server. A later edit,
 * another unresolved intent, or another household must remain recoverable.
 */
export function forgetLatestRewardCreateDraft(
  owner: RewardCreateOwner | undefined,
  signature: string,
): void {
  const store = getStore(owner);
  if (store?.latestDraft && rewardCreateSignature(store.latestDraft) === signature) {
    store.latestDraft = null;
  }
}
