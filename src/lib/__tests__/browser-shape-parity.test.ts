/**
 * #413: the cold dashboard shell checks a few contracts with Zod-free
 * validators so its startup JavaScript does not carry the shared Zod core.
 * Each validator must accept exactly what its canonical Zod schema accepts and
 * return the same data (same keys, key order and values).
 */
import fs from "node:fs";
import path from "node:path";
import { parseResponsibilityTarget } from "@/lib/responsibility-target-shape";
import { responsibilityTarget } from "@/lib/responsibility-target";
import { parsePreparationLocation } from "@/lib/preparation-location-shape";
import { preparationLocationSchema } from "@/lib/preparation-location-contract";
import { parseScheduleReviewScope } from "@/lib/calendar-planning/review-scope-shape";
import { scheduleReviewScope } from "@/lib/calendar-planning/review-scope";
import { parseDisplaySnapshot } from "@/lib/display-preferences-snapshot-shape";
import { displaySnapshotSchema } from "@/lib/display-preferences-snapshot-schema";
import {
  parseOwnedQueueEnvelope,
  parseQueueOwner,
  parseQueueOwnerResponse,
  parseQueueRetirement,
} from "@/lib/queue-owner-shape";
import {
  ownedQueueEnvelope,
  queueOwnerResponse,
  queueOwnerSchema,
  queueRetirementSchema,
} from "@/lib/queue-owner-contract";
import { isMemberIdentityId } from "@/lib/member-identity-id";
import { memberIdentityIdSchema } from "@/lib/member-identity-schema";

type SafeParse = (value: unknown) => { success: boolean; data?: unknown };

const HEX = "0123456789abcdef".repeat(4);
const OWNER = {
  kind: "person",
  ownerId: "user_1",
  scope: HEX,
  generation: 3,
  householdScope: "f".repeat(64),
};
const LAYOUT = {
  order: ["next", "dinner", "groceries", "coming", "usesoon"],
  hidden: ["usesoon"],
  density: "compact",
  includeChores: true,
  calendarView: "week",
};

/** Values substituted at every path of every valid fixture. */
const PALETTE: unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  1,
  2,
  -1,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  2 ** 53,
  Number.MAX_SAFE_INTEGER,
  "",
  "a",
  " ",
  "user_1",
  "-bad",
  "x".repeat(16),
  "x".repeat(128),
  "x".repeat(129),
  "z".repeat(101),
  HEX,
  HEX.toUpperCase(),
  `${HEX}\n`,
  "person",
  "device",
  "chore",
  "pickup",
  "handoff",
  "next",
  "usesoon",
  "comfortable",
  "agenda",
  "household",
  "generation",
  "active",
  "retired",
  "herewoven.queue-owner.v1",
  "herewoven.queue-store.v2",
  "America/Toronto",
  "UTC",
  "Not/AZone",
  "2026-01-05T12:00:00.000Z",
  "2026-01-04T12:00:00Z",
  "2026-02-30T12:00:00Z",
  "2026-01-05T12:00:00",
  "AAAAAAAAAAAAAAAAAAAAAA",
  [],
  [""],
  ["a", "a"],
  ["next", "next", "dinner", "groceries", "coming"],
  ["usesoon", "coming", "groceries", "dinner", "next"],
  ["next"],
  ["dinner", "dinner"],
  ["coming", "usesoon"],
  new Array(9).fill("x"),
  new Array(51).fill("AAAAAAAAAAAAAAAAAAAA"),
  [, "AAAAAAAAAAAAAAAAAAAA"],
  {},
  { ...OWNER },
  { ...OWNER, kind: "device" },
  { ...LAYOUT },
  new Date(0),
  new String("a"),
  new Boolean(true),
  new Number(1),
  () => undefined,
];

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object" && value.constructor === Object)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
    ) as T;
  return value;
}

function setPath(root: unknown, keys: string[], value: unknown) {
  const out = clone(root) as Record<string, unknown>;
  let cursor = out;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys[keys.length - 1]] = value;
  return out;
}

function deletePath(root: unknown, keys: string[]) {
  const out = clone(root) as Record<string, unknown>;
  let cursor = out;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  delete cursor[keys[keys.length - 1]];
  return out;
}

/** Every path (objects and array elements) of a fixture. */
function paths(value: unknown, prefix: string[] = []): string[][] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    [...prefix, key],
    ...paths(entry, [...prefix, key]),
  ]);
}

function corpus(valid: unknown[]): unknown[] {
  const out: unknown[] = [...PALETTE];
  for (const base of valid) {
    out.push(clone(base));
    if (!base || typeof base !== "object") continue;
    out.push({ ...base, extra: 1 });
    out.push({ ...base, extra: undefined });
    out.push(Object.assign(Object.create({ inherited: 1 }), clone(base)));
    out.push(Object.assign(Object.create(null), clone(base)));
    out.push(Object.assign([], clone(base)));
    out.push(Object.assign(new Date(0), clone(base)));
    out.push(
      Object.defineProperty(clone(base), "hidden_extra", {
        value: 1,
        enumerable: false,
      }),
    );
    out.push(Object.fromEntries(Object.entries(base).reverse()));
    for (const keys of paths(base)) {
      out.push(deletePath(base, keys));
      for (const value of PALETTE) out.push(setPath(base, keys, value));
      const parent = keys.slice(0, -1);
      if (parent.length) out.push(setPath(base, [...parent, "extra"], "x"));
    }
  }
  return out;
}

function expectParity(
  name: string,
  zod: { safeParse: SafeParse },
  shape: SafeParse,
  valid: unknown[],
) {
  let accepted = 0;
  const inputs = corpus(valid);
  for (const input of inputs) {
    const expected = zod.safeParse(input);
    const actual = shape(input);
    if (actual.success !== expected.success)
      throw new Error(
        `${name}: success ${String(actual.success)} for ${String(
          JSON.stringify(input),
        )}`,
      );
    if (expected.success) {
      accepted += 1;
      expect(actual.data).toStrictEqual(expected.data);
      expect(JSON.stringify(actual.data)).toBe(JSON.stringify(expected.data));
      expect(Object.keys(actual.data as object)).toEqual(
        Object.keys(expected.data as object),
      );
    }
  }
  // The corpus must exercise both outcomes.
  expect(accepted).toBeGreaterThanOrEqual(valid.length);
  expect(inputs.length - accepted).toBeGreaterThan(20);
}

describe("browser startup validators match their Zod contracts", () => {
  test("member identity id", () => {
    for (const value of PALETTE)
      expect(isMemberIdentityId(value)).toBe(
        memberIdentityIdSchema.safeParse(value).success,
      );
  });

  test("responsibility target", () => {
    expectParity(
      "responsibility",
      responsibilityTarget,
      parseResponsibilityTarget,
      [
        { kind: "chore", id: "c1" },
        { kind: "handoff", id: "A-b_c" },
      ],
    );
  });

  test("preparation location", () => {
    expectParity(
      "preparation",
      preparationLocationSchema,
      parsePreparationLocation,
      [
        { eventId: "evt_1", timeZone: "America/Toronto" },
        { eventId: "e", timeZone: "UTC" },
      ],
    );
  });

  test("schedule review scope", () => {
    expectParity("review", scheduleReviewScope, parseScheduleReviewScope, [
      {
        targetId: "evt_1",
        range: {
          start: "2026-01-04T12:00:00Z",
          end: "2026-01-05T12:00:00.000Z",
        },
        timeZone: "America/Toronto",
      },
      {
        targetId: "evt_2",
        range: {
          start: "2026-01-01T00:00:00+05:00",
          end: "2026-02-14T19:00:00Z",
        },
        timeZone: "UTC",
      },
    ]);
    // The 45-day comparison window and positive interval are both enforced.
    for (const [start, end] of [
      ["2026-01-01T00:00:00Z", "2026-02-15T00:00:00Z"],
      ["2026-01-01T00:00:00Z", "2026-02-15T00:00:00.001Z"],
      ["2026-01-05T12:00:00Z", "2026-01-05T12:00:00Z"],
      ["2026-01-05T12:00:00Z", "2026-01-05T11:59:59Z"],
    ]) {
      const input = {
        targetId: "evt_1",
        range: { start, end },
        timeZone: "UTC",
      };
      expect(parseScheduleReviewScope(input).success).toBe(
        scheduleReviewScope.safeParse(input).success,
      );
    }
  });

  test("display preference snapshot", () => {
    const snapshot = {
      version: 1,
      revision: 4,
      defaultsRevision: 0,
      layout: { today: LAYOUT, favorites: ["meals", "notes"] },
      quiet: false,
      defaultToday: { ...LAYOUT, hidden: [], density: "comfortable" },
      personalizedToday: true,
      canManageDefaults: false,
    };
    expectParity("snapshot", displaySnapshotSchema, parseDisplaySnapshot, [
      snapshot,
      {
        ...snapshot,
        layout: {
          today: {
            ...LAYOUT,
            order: ["usesoon", "coming", "groceries", "dinner", "next"],
            hidden: ["dinner", "groceries", "coming", "usesoon"],
          },
          favorites: [],
        },
      },
    ]);
  });

  test("queue owner", () => {
    expectParity("owner", queueOwnerSchema, parseQueueOwner, [
      OWNER,
      { ...OWNER, kind: "device", generation: 0, ownerId: "x".repeat(128) },
    ]);
  });

  test("queue owner response", () => {
    const contract = "herewoven.queue-owner.v1";
    expectParity(
      "owner response",
      queueOwnerResponse,
      parseQueueOwnerResponse,
      [
        { contract, enabled: true, owner: OWNER },
        { contract, enabled: false },
        { contract, enabled: false, owner: OWNER },
        { contract, enabled: false, owner: undefined },
      ],
    );
  });

  test("queue retirement", () => {
    expectParity("retirement", queueRetirementSchema, parseQueueRetirement, [
      { mode: "household", householdScope: HEX },
      { mode: "scope", owner: OWNER },
      {
        mode: "generation",
        ownerId: "user_1",
        throughGeneration: Number.MAX_SAFE_INTEGER,
      },
      { mode: "device", ownerId: "device:tablet" },
    ]);
  });

  test("owned queue envelope", () => {
    const active = {
      v: 2,
      envelope: "herewoven.queue-store.v2",
      state: "active",
      owner: OWNER,
      runtime: "r".repeat(16),
      queue: "[]",
    };
    expectParity("envelope", ownedQueueEnvelope, parseOwnedQueueEnvelope, [
      active,
      { ...active, reviewIds: ["AAAAAAAAAAAAAAAAAAAA", "b".repeat(128)] },
      { ...active, reviewIds: [] },
      { ...active, reviewIds: undefined },
      { v: 2, envelope: "herewoven.queue-store.v2", state: "retired" },
    ]);
  });
});

/** The startup graph must keep using the Zod-free modules. */
test("startup providers and browser queues do not import Zod schemas", () => {
  const root = path.join(__dirname, "../../..");
  const startup = [
    "src/lib/browser-shape.ts",
    "src/lib/member-identity-id.ts",
    "src/lib/responsibility-target-shape.ts",
    "src/lib/preparation-location-shape.ts",
    "src/lib/calendar-planning/review-scope-shape.ts",
    "src/lib/display-preferences-snapshot-shape.ts",
    "src/lib/queue-owner-shape.ts",
    "src/lib/queue-owner-store.ts",
    "src/lib/owned-queue-persistence.ts",
    "src/lib/person-queue-browser.ts",
    "src/lib/browser-queue-runtime.ts",
    "src/components/responsibility/ResponsibilityProvider.tsx",
    "src/components/calendar/preparation/PreparationProvider.tsx",
    "src/components/calendar/review/ScheduleReviewProvider.tsx",
    "src/components/providers/display-preferences-provider.tsx",
  ];
  const zodModules =
    /from\s+["'](?:zod(?:\/[^"']*)?|@\/lib\/(?:queue-owner-contract|responsibility-target|preparation-location-contract|calendar-planning\/review-scope|display-preferences-snapshot-schema|display-preferences-layout-schema|member-identity-schema))["']/;
  for (const file of startup) {
    const source = fs
      .readFileSync(path.join(root, file), "utf8")
      .replace(/^import type .*$/gm, "");
    expect({ file, imports: zodModules.test(source) }).toEqual({
      file,
      imports: false,
    });
  }
});
