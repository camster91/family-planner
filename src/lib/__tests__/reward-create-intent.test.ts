/** @jest-environment jsdom */

import {
  REWARD_CREATE_INTENT_MAX_INTENTS,
  REWARD_CREATE_INTENT_STORAGE_PREFIX,
  clearRewardCreateIntents,
  forgetLatestRewardCreateDraft,
  latestRewardCreateDraft,
  rememberRewardCreateDraft,
  rememberRewardCreateIntent,
  rewardCreateIntent,
  rewardCreateSignature,
  rewardCreateStorageKey,
  type RewardCreateDraft,
  type RewardCreateOwner,
} from "../reward-create-intent";

const parent: RewardCreateOwner = { userId: "user-a", familyId: "family-a" };
const otherOwner: RewardCreateOwner = {
  userId: "user-b",
  familyId: "family-b",
};
const draft: RewardCreateDraft = {
  name: "Movie night",
  description: "Choose the film",
  cost: 50,
  icon: "🎬",
};
const key = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  clearRewardCreateIntents();
  window.localStorage.clear();
});

it("rehydrates a valid owner-scoped draft and key after memory is gone", () => {
  const signature = rewardCreateSignature(draft);
  // A reload creates a new module store. Seed the durable envelope directly
  // to model that boundary without relying on this test module's Map.
  window.localStorage.setItem(
    rewardCreateStorageKey(parent),
    JSON.stringify({
      version: 1,
      owner: parent,
      latestDraft: draft,
      intents: { [signature]: { key, draft } },
    }),
  );

  expect(latestRewardCreateDraft(parent)).toEqual(draft);
  expect(rewardCreateIntent(parent, signature)).toEqual({ key, draft });
});

it("does not cross owner namespaces and clears only the requested owner", () => {
  const signature = rewardCreateSignature(draft);
  rememberRewardCreateDraft(parent, draft);
  rememberRewardCreateIntent(parent, signature, draft, key);
  rememberRewardCreateDraft(otherOwner, { ...draft, name: "Other home" });

  expect(latestRewardCreateDraft(otherOwner)?.name).toBe("Other home");
  expect(clearRewardCreateIntents(parent)).toBe(true);
  expect(latestRewardCreateDraft(parent)).toBeNull();
  expect(latestRewardCreateDraft(otherOwner)?.name).toBe("Other home");
  expect(
    window.localStorage.getItem(rewardCreateStorageKey(parent)),
  ).toBeNull();
  expect(
    window.localStorage.getItem(rewardCreateStorageKey(otherOwner)),
  ).not.toBeNull();
});

it("removes a validated draft and intent from durable storage", () => {
  const signature = rewardCreateSignature(draft);
  rememberRewardCreateDraft(parent, draft);
  rememberRewardCreateIntent(parent, signature, draft, key);

  forgetLatestRewardCreateDraft(parent, signature);
  expect(latestRewardCreateDraft(parent)).toBeNull();
  expect(rewardCreateIntent(parent, signature)).toEqual({ key, draft });

  clearRewardCreateIntents(parent);
  expect(rewardCreateIntent(parent, signature)).toBeNull();
});

it("rejects malformed, mismatched-owner and stale-key envelopes", () => {
  const storageKey = rewardCreateStorageKey(parent);
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 999,
      owner: parent,
      latestDraft: draft,
      intents: {},
    }),
  );
  expect(latestRewardCreateDraft(parent)).toBeNull();
  expect(window.localStorage.getItem(storageKey)).toBeNull();

  clearRewardCreateIntents();
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      owner: otherOwner,
      latestDraft: draft,
      intents: {},
    }),
  );
  expect(latestRewardCreateDraft(parent)).toBeNull();
  expect(window.localStorage.getItem(storageKey)).toBeNull();
});

it("keeps live in-memory recovery when browser storage writes fail", () => {
  const setItem = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("private browsing");
    });
  const signature = rewardCreateSignature(draft);

  rememberRewardCreateDraft(parent, draft);
  rememberRewardCreateIntent(parent, signature, draft, key);

  expect(latestRewardCreateDraft(parent)).toEqual(draft);
  expect(rewardCreateIntent(parent, signature)).toEqual({ key, draft });
  setItem.mockRestore();
});

it("fails closed when browser storage reads are unavailable", () => {
  const getItem = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("storage unavailable");
    });

  expect(latestRewardCreateDraft(parent)).toBeNull();
  expect(
    rewardCreateIntent(parent, rewardCreateSignature(draft)),
  ).toBeNull();
  getItem.mockRestore();
});

it("does not dispatch a new intent beyond the durable capacity", () => {
  for (let index = 0; index < REWARD_CREATE_INTENT_MAX_INTENTS; index += 1) {
    const item = { ...draft, name: `Reward ${index}` };
    const signature = rewardCreateSignature(item);
    expect(
      rememberRewardCreateIntent(
        parent,
        signature,
        item,
        `reward-key-${String(index).padStart(2, "0")}-12345678`,
      ),
    ).toBe(true);
  }

  const overflow = { ...draft, name: "Overflow reward" };
  const overflowSignature = rewardCreateSignature(overflow);
  expect(
    rememberRewardCreateIntent(
      parent,
      overflowSignature,
      overflow,
      "reward-key-overflow-123456",
    ),
  ).toBe(false);
  expect(rewardCreateIntent(parent, overflowSignature)).toBeNull();
  const persisted = JSON.parse(
    window.localStorage.getItem(rewardCreateStorageKey(parent)) ?? "null",
  ) as { intents?: Record<string, unknown> };
  expect(Object.keys(persisted.intents ?? {})).toHaveLength(
    REWARD_CREATE_INTENT_MAX_INTENTS,
  );
});

it("purges only its own versioned storage namespace on global cleanup", () => {
  rememberRewardCreateDraft(parent, draft);
  window.localStorage.setItem(
    `${REWARD_CREATE_INTENT_STORAGE_PREFIX}unrelated`,
    "keep",
  );

  expect(clearRewardCreateIntents()).toBe(true);
  expect(
    window.localStorage.getItem(
      `${REWARD_CREATE_INTENT_STORAGE_PREFIX}unrelated`,
    ),
  ).toBeNull();
  expect(
    window.localStorage.getItem(rewardCreateStorageKey(parent)),
  ).toBeNull();
});
