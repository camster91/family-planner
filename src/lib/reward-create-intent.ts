"use client";

import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import {
  REWARD_CREATE_INTENT_MAX_INTENTS,
  REWARD_CREATE_INTENT_STORAGE_VERSION,
  rewardCreateOwnerScope,
  rewardCreateStorage,
  rewardCreateStorageKey,
  rewardCreateStores,
  type RewardCreateDraft,
  type RewardCreateIntent,
  type RewardCreateOwner,
  type RewardCreateOwnerStore,
  type RewardCreateStorage,
} from "@/lib/reward-create-intent-store";

export {
  REWARD_CREATE_INTENT_MAX_INTENTS,
  REWARD_CREATE_INTENT_STORAGE_PREFIX,
  REWARD_CREATE_INTENT_STORAGE_VERSION,
  clearRewardCreateIntents,
  rewardCreateStorageKey,
  type RewardCreateDraft,
  type RewardCreateIntent,
  type RewardCreateOwner,
} from "@/lib/reward-create-intent-store";

type PersistedRewardCreateState = {
  version: typeof REWARD_CREATE_INTENT_STORAGE_VERSION;
  owner: RewardCreateOwner;
  latestDraft: RewardCreateDraft | null;
  intents: Record<string, RewardCreateIntent>;
};

// Keep the envelope bounded without silently evicting an unresolved key. A
// normal household can have several abandoned tabs, while 32 x the form's
// bounded fields remains a small local-only cache.
const MAX_INTENTS = REWARD_CREATE_INTENT_MAX_INTENTS;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ICON_LENGTH = 32;

/**
 * A deterministic key for the mounted form boundary. It is safe to compute
 * during SSR because it does not inspect browser storage.
 */
export function rewardCreateOwnerKey(owner?: RewardCreateOwner): string {
  return owner?.userId && owner.familyId
    ? JSON.stringify([owner.userId, owner.familyId])
    : "anonymous";
}

function cloneDraft(draft: RewardCreateDraft): RewardCreateDraft {
  return { ...draft };
}

function cloneIntent(intent: RewardCreateIntent): RewardCreateIntent {
  return { key: intent.key, draft: cloneDraft(intent.draft) };
}

function validDraft(
  value: unknown,
  allowBlankName: boolean,
): value is RewardCreateDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RewardCreateDraft>;
  return (
    typeof draft.name === "string" &&
    (allowBlankName || draft.name.trim().length > 0) &&
    draft.name.length <= MAX_NAME_LENGTH &&
    typeof draft.description === "string" &&
    draft.description.length <= MAX_DESCRIPTION_LENGTH &&
    typeof draft.cost === "number" &&
    Number.isSafeInteger(draft.cost) &&
    draft.cost >= 1 &&
    draft.cost <= 100_000 &&
    typeof draft.icon === "string" &&
    draft.icon.length > 0 &&
    draft.icon.length <= MAX_ICON_LENGTH
  );
}

function validOwner(value: unknown, owner: RewardCreateOwner): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RewardCreateOwner>;
  return (
    candidate.userId === owner.userId && candidate.familyId === owner.familyId
  );
}

function parsePersistedState(
  raw: string | null,
  owner: RewardCreateOwner,
): PersistedRewardCreateState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PersistedRewardCreateState>;
    if (
      value.version !== REWARD_CREATE_INTENT_STORAGE_VERSION ||
      !validOwner(value.owner, owner) ||
      (value.latestDraft !== null && !validDraft(value.latestDraft, true)) ||
      !value.intents ||
      typeof value.intents !== "object" ||
      Array.isArray(value.intents)
    )
      return null;

    const intents = new Map<string, RewardCreateIntent>();
    for (const [signature, candidate] of Object.entries(value.intents)) {
      if (
        intents.size >= MAX_INTENTS ||
        !candidate ||
        typeof candidate !== "object" ||
        !isValidIdempotencyKey(candidate.key) ||
        !validDraft(candidate.draft, false) ||
        rewardCreateSignature(candidate.draft) !== signature
      )
        return null;
      intents.set(signature, cloneIntent(candidate));
    }
    return {
      version: REWARD_CREATE_INTENT_STORAGE_VERSION,
      owner,
      latestDraft:
        value.latestDraft === null ? null : cloneDraft(value.latestDraft),
      intents: Object.fromEntries(intents),
    };
  } catch {
    return null;
  }
}

function persist(
  owner: RewardCreateOwner,
  store: RewardCreateOwnerStore,
): void {
  const target = rewardCreateStorage();
  if (!target) return;
  const intents: Record<string, RewardCreateIntent> = {};
  for (const [signature, intent] of store.intents) {
    intents[signature] = cloneIntent(intent);
  }
  const envelope: PersistedRewardCreateState = {
    version: REWARD_CREATE_INTENT_STORAGE_VERSION,
    owner: { ...owner },
    latestDraft: store.latestDraft ? cloneDraft(store.latestDraft) : null,
    intents,
  };
  try {
    target.setItem(rewardCreateStorageKey(owner), JSON.stringify(envelope));
  } catch {
    // Do not discard a live request key just because durable browser storage
    // is unavailable. The form still has its existing in-memory recovery.
  }
}

function getStore(owner?: RewardCreateOwner): RewardCreateOwnerStore | null {
  const scope = rewardCreateOwnerScope(owner);
  if (!scope || !owner) return null;
  let store = rewardCreateStores.get(scope);
  if (store) return store;

  store = { owner: { ...owner }, latestDraft: null, intents: new Map() };
  const target = rewardCreateStorage();
  if (target) {
    let raw: string | null = null;
    try {
      raw = target.getItem(rewardCreateStorageKey(owner));
    } catch {
      raw = null;
    }
    const persisted = parsePersistedState(raw, owner);
    if (persisted) {
      store.latestDraft = persisted.latestDraft;
      store.intents = new Map(
        Object.entries(persisted.intents).map(([signature, intent]) => [
          signature,
          cloneIntent(intent),
        ]),
      );
    } else if (raw !== null) {
      try {
        target.removeItem(rewardCreateStorageKey(owner));
      } catch {
        // Browser storage can be blocked or quota-limited.
      }
    }
  }
  rewardCreateStores.set(scope, store);
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
  if (!store || !validDraft(draft, true)) return;
  store.latestDraft = cloneDraft(draft);
  persist(store.owner, store);
}

export function latestRewardCreateDraft(
  owner: RewardCreateOwner | undefined,
): RewardCreateDraft | null {
  const store = getStore(owner);
  return store?.latestDraft ? cloneDraft(store.latestDraft) : null;
}

export function rewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
): RewardCreateIntent | null {
  const store = getStore(owner);
  const intent = store?.intents.get(signature);
  return intent ? cloneIntent(intent) : null;
}

export function rememberRewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
  draft: RewardCreateDraft,
  key: string,
): boolean {
  const store = getStore(owner);
  if (
    !store ||
    !isValidIdempotencyKey(key) ||
    !validDraft(draft, false) ||
    rewardCreateSignature(draft) !== signature ||
    (store.intents.size >= MAX_INTENTS && !store.intents.has(signature))
  )
    return false;
  store.intents.set(signature, { key, draft: cloneDraft(draft) });
  persist(store.owner, store);
  return true;
}

export function forgetRewardCreateIntent(
  owner: RewardCreateOwner | undefined,
  signature: string,
): void {
  const store = getStore(owner);
  if (!store) return;
  store.intents.delete(signature);
  persist(store.owner, store);
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
  if (!store || !store.latestDraft) return;
  if (rewardCreateSignature(store.latestDraft) === signature) {
    store.latestDraft = null;
    persist(store.owner, store);
  }
}
