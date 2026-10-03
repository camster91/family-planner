// New households start simple (O-38, owner decision 2026-10-03).
//
// Route-level, on the two-household harness: POST /api/family stores an
// explicit blob with only chores, calendar, lists, family, meals and
// emergency on; an existing household whose stored blob is empty or partial
// still reads every section that was on by default before O-38 (GET), and a
// parent's toggle (PATCH) keeps them on while writing them out explicitly.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);

import * as features from "../features/route";
import { POST as createFamily } from "../route";
import { FEATURES, effectiveFeatures } from "@/lib/features";
import { db, req, writesTo, bodyOf, FAMILY_A } from "@/__tests__/helpers/two-household";

const LEAN_ON = ["calendar", "chores", "emergency", "family", "lists", "meals"];
const FORMERLY_ON = ["notes", "anniversaries", "rewards", "budget", "projects", "messages", "analytics"];

const onKeys = (f: Record<string, boolean>) =>
  Object.entries(f)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();

describe("new households start simple (O-38)", () => {
  beforeEach(() => db.reset());

  it("POST /api/family stores an explicit blob with only the six sections on", async () => {
    const res = await createFamily(req({ as: "loner", body: { name: "Brand new" } }));
    expect(res.status).toBe(200);
    const created = writesTo("family").find((w) => w.op === "create")!;
    const stored = created.args.data.features as Record<string, boolean>;
    // Every key is written, so the household never relies on legacyDefault.
    expect(Object.keys(stored).sort()).toEqual(FEATURES.map((f) => f.key).sort());
    expect(onKeys(stored)).toEqual(LEAN_ON);
    for (const key of FORMERLY_ON) expect(stored[key]).toBe(false);
    expect(stored.gamification).toBe(false);
  });

  it("GET for that new household reports only the six on", async () => {
    db.find("family", FAMILY_A)!.features = Object.fromEntries(
      FEATURES.map((f) => [f.key, LEAN_ON.includes(f.key)]),
    );
    req({ as: "parentA" });
    const body = await bodyOf(await features.GET());
    expect(onKeys(effectiveFeatures(body.features))).toEqual(LEAN_ON);
  });

  it.each([
    ["an empty blob", {}],
    ["the fixture/#248 blob", { gamification: true }],
    ["a partial blob", { meals: true, wishlist: true }],
  ])("an existing household with %s keeps every formerly-on section", async (_label, blob) => {
    db.find("family", FAMILY_A)!.features = blob;
    req({ as: "parentA" });
    const body = await bodyOf(await features.GET());
    const effective = effectiveFeatures(body.features);
    for (const key of [...LEAN_ON, ...FORMERLY_ON]) expect(effective[key as keyof typeof effective]).toBe(true);
  });

  it("an existing household's toggle writes the old sections out as ON, not the new defaults", async () => {
    db.find("family", FAMILY_A)!.features = {};
    const res = await features.PATCH(req({ as: "parentA", body: { key: "wishlist", enabled: true } }));
    expect(res.status).toBe(200);
    const stored = db.find("family", FAMILY_A)!.features as Record<string, boolean>;
    for (const key of FORMERLY_ON) expect(stored[key]).toBe(true);
    expect(stored.wishlist).toBe(true);
    expect(stored.gamification).toBe(true);
  });

  it("the Turn on more request (bulk PATCH) turns Rewards and Points & streaks on for a new household", async () => {
    db.find("family", FAMILY_A)!.features = Object.fromEntries(
      FEATURES.map((f) => [f.key, LEAN_ON.includes(f.key)]),
    );
    const res = await features.PATCH(
      req({ as: "parentA", body: { features: { gamification: true, rewards: true } } }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    const effective = effectiveFeatures(body.features);
    expect(effective.rewards).toBe(true);
    expect(effective.analytics).toBe(false); // its own flag is still off
    expect(onKeys(effective)).toEqual([...LEAN_ON, "gamification", "rewards"].sort());
  });

  it.each(["teenA", "childA"] as const)("a %s cannot turn sections on", async (who) => {
    db.find("family", FAMILY_A)!.features = {};
    const res = await features.PATCH(req({ as: who, body: { features: { budget: true } } }));
    expect(res.status).toBe(403);
  });
});
