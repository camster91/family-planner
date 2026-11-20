// App-held AI budget on real SQLite (#144): the D1 reservation SQL, the
// household switch, the monthly cap, daily limits, role/session re-checks,
// settle, the parent-only switch write and two-household isolation. Runs the
// actual 0024 migration on node:sqlite through a minimal D1 adapter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
type SqliteStatement = {
  get: (...values: unknown[]) => unknown;
  all: (...values: unknown[]) => unknown[];
  run: (...values: unknown[]) => { changes: number | bigint };
};
type Sqlite = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};
// node:sqlite (Node 22) has no types in this repo's @types/node.
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => Sqlite;
};
import type { D1Store, SqlValue } from "@/lib/cloudflare/database";
import { AiUsageError } from "@/lib/ai-usage-errors";
import {
  reservationMicrousd,
  reserveManagedAi,
  settleManagedAi,
  settledMicrousd,
} from "../meter";
import {
  HouseholdAiSettingError,
  readHouseholdAiSetting,
  readManagedAiMonthSpend,
  writeHouseholdAiSetting,
} from "../household-setting";

function d1(db: Sqlite): D1Store {
  const prepare = (sql: string) => {
    let values: SqlValue[] = [];
    const statement = {
      bind: (...v: SqlValue[]) => {
        values = v;
        return statement;
      },
      first: async <T>() =>
        (db.prepare(sql).get(...values) as T | undefined) ?? null,
      all: async <T>() => ({
        results: db.prepare(sql).all(...values) as T[],
        success: true,
        meta: { changes: 0 },
      }),
      run: async () => ({
        success: true,
        meta: { changes: Number(db.prepare(sql).run(...values).changes) },
      }),
    };
    return statement;
  };
  const store = {
    prepare,
    batch: async () => {
      throw new Error("unused");
    },
    withSession: () => store,
  } as unknown as D1Store;
  return store;
}

const MODEL = "claude-haiku-5-5";
const env = process.env;
let sqlite: Sqlite;
let db: D1Store;
const parentA = {
  userId: "parent-a",
  familyId: "family-A",
  role: "parent",
  generation: 0,
};
const teenA = {
  userId: "teen-a",
  familyId: "family-A",
  role: "teen",
  generation: 0,
};
const childA = {
  userId: "child-a",
  familyId: "family-A",
  role: "child",
  generation: 0,
};
const parentB = {
  userId: "parent-b",
  familyId: "family-B",
  role: "parent",
  generation: 0,
};
const input = { inputBytes: 3000, maxOutputTokens: 4096 };

beforeEach(() => {
  process.env = {
    ...env,
    FAMILY_AI_USAGE_READY: "1",
    FAMILY_AI_USAGE_ROLLBACK_READY: "1",
  };
  delete process.env.FAMILY_AI_PROVIDER_DISABLED;
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE "Family" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "family_id" TEXT, "role" TEXT, "token_version" INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE "AiUsagePolicy" ("family_id" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 0, "enabled" INTEGER NOT NULL DEFAULT 1,
      "daily_limit" INTEGER NOT NULL DEFAULT 120, "user_daily_limit" INTEGER NOT NULL DEFAULT 40, "monthly_budget_microusd" INTEGER,
      "input_rate" INTEGER, "output_rate" INTEGER, "priced_config_hash" TEXT, "updated_at" INTEGER);
    CREATE TABLE "AiUsageRequest" ("id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "user_id" TEXT, "job" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL, "finished_at" INTEGER, "outcome" TEXT NOT NULL DEFAULT 'pending',
      "provider_status" TEXT NOT NULL DEFAULT 'unconfirmed', "latency_ms" INTEGER, "input_tokens" INTEGER, "output_tokens" INTEGER,
      "input_rate" INTEGER, "output_rate" INTEGER, "reserved_microusd" INTEGER, "estimated_microusd" INTEGER);
    INSERT INTO "Family" VALUES ('family-A'),('family-B');
    INSERT INTO "User" VALUES ('parent-a','family-A','parent',0),('teen-a','family-A','teen',0),('child-a','family-A','child',0),('parent-b','family-B','parent',0);
  `);
  sqlite.exec(
    readFileSync(
      join(process.cwd(), "database/cloudflare/0024_household_ai_setting.sql"),
      "utf8",
    ),
  );
  db = d1(sqlite);
});
afterAll(() => {
  process.env = env;
});

it("prices Claude Haiku 5.5 conservatively before the call and from usage after", () => {
  // (3000 + 2048) input tokens at $0.10/M + 4096 output tokens at $0.50/M, rounded up.
  expect(reservationMicrousd(MODEL, 3000, 4096)).toBe("2553");
  expect(settledMicrousd(MODEL, { inputTokens: 1200, outputTokens: 300 })).toBe(
    "270",
  );
  expect(
    settledMicrousd(MODEL, { inputTokens: null, outputTokens: 300 }),
  ).toBeNull();
  expect(() => reservationMicrousd("unknown-model", 1, 1)).toThrow(
    AiUsageError,
  );
});

it("is off by default and only a current parent can switch it, with lost-update protection", async () => {
  expect(await readHouseholdAiSetting(db, "family-A")).toEqual({
    enabled: false,
    monthlyCapMicrousd: "2000000",
    revision: 0,
  });
  await expect(
    writeHouseholdAiSetting(db, teenA, true, 0),
  ).rejects.toMatchObject({ code: "AI_SETTING_FORBIDDEN" });
  await expect(
    writeHouseholdAiSetting(db, { ...parentA, generation: 7 }, true, 0),
  ).rejects.toBeInstanceOf(HouseholdAiSettingError);
  expect(await writeHouseholdAiSetting(db, parentA, true, 0)).toEqual({
    enabled: true,
    monthlyCapMicrousd: "2000000",
    revision: 1,
  });
  await expect(
    writeHouseholdAiSetting(db, parentA, false, 0),
  ).rejects.toMatchObject({ code: "AI_SETTING_CONFLICT" });
  // A parent of another household cannot touch this one.
  await expect(
    writeHouseholdAiSetting(db, { ...parentB, familyId: "family-A" }, false, 1),
  ).rejects.toMatchObject({ code: "AI_SETTING_FORBIDDEN" });
  expect((await readHouseholdAiSetting(db, "family-B")).enabled).toBe(false);
});

it("reserves only for an opted-in household and a current parent or teen", async () => {
  await expect(
    reserveManagedAi(db, parentA, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_PAUSED" });
  await writeHouseholdAiSetting(db, parentA, true, 0);
  const reservation = await reserveManagedAi(
    db,
    teenA,
    "smart_add",
    MODEL,
    input,
  );
  expect(reservation.reservedMicrousd).toBe("2553");
  await expect(
    reserveManagedAi(db, childA, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_SOURCE_CHANGED" });
  await expect(
    reserveManagedAi(
      db,
      { ...teenA, generation: 3 },
      "smart_add",
      MODEL,
      input,
    ),
  ).rejects.toMatchObject({ code: "AI_SOURCE_CHANGED" });
  await expect(
    reserveManagedAi(db, parentB, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_PAUSED" });
  const rows = sqlite
    .prepare(
      `SELECT family_id,user_id,job,outcome,reserved_microusd FROM "AiUsageRequest"`,
    )
    .all();
  expect(rows).toEqual([
    {
      family_id: "family-A",
      user_id: "teen-a",
      job: "smart_add",
      outcome: "pending",
      reserved_microusd: 2553,
    },
  ]);
});

it("stops at the monthly cap, counting settled cost and open reservations, per household", async () => {
  await writeHouseholdAiSetting(db, parentA, true, 0);
  await writeHouseholdAiSetting(db, parentB, true, 0);
  sqlite
    .prepare(
      `UPDATE "HouseholdAiSetting" SET monthly_cap_microusd=6000 WHERE family_id='family-A'`,
    )
    .run();
  const first = await reserveManagedAi(db, parentA, "smart_add", MODEL, input);
  await settleManagedAi(db, parentA, MODEL, first, {
    status: 200,
    providerStatus: "response",
    usage: { inputTokens: 1200, outputTokens: 300 },
  });
  expect(
    sqlite
      .prepare(
        `SELECT outcome,estimated_microusd,input_tokens FROM "AiUsageRequest" WHERE id=?`,
      )
      .get(first.id),
  ).toEqual({
    outcome: "accepted",
    estimated_microusd: 270,
    input_tokens: 1200,
  });
  await reserveManagedAi(db, parentA, "smart_add", MODEL, input); // 270 + 2553 = 2823
  await expect(
    reserveManagedAi(db, teenA, "smart_add", MODEL, input),
  ).resolves.toBeTruthy(); // 5376
  await expect(
    reserveManagedAi(db, parentA, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_QUOTA_REACHED", status: 429 });
  expect(await readManagedAiMonthSpend(db, "family-A")).toBe("5376");
  // Family B's budget is untouched.
  await expect(
    reserveManagedAi(db, parentB, "smart_add", MODEL, input),
  ).resolves.toBeTruthy();
  expect(await readManagedAiMonthSpend(db, "family-B")).toBe("2553");
});

it("honours the existing household AI pause and daily limits, and the kill switch", async () => {
  await writeHouseholdAiSetting(db, parentA, true, 0);
  sqlite
    .prepare(
      `INSERT INTO "AiUsagePolicy"(family_id,enabled,daily_limit,user_daily_limit) VALUES ('family-A',1,120,1)`,
    )
    .run();
  await reserveManagedAi(db, parentA, "smart_add", MODEL, input);
  await expect(
    reserveManagedAi(db, parentA, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_QUOTA_REACHED" });
  sqlite
    .prepare(`UPDATE "AiUsagePolicy" SET enabled=0 WHERE family_id='family-A'`)
    .run();
  await expect(
    reserveManagedAi(db, teenA, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_PAUSED" });
  process.env.FAMILY_AI_PROVIDER_DISABLED = "1";
  await expect(
    reserveManagedAi(db, parentB, "smart_add", MODEL, input),
  ).rejects.toMatchObject({ code: "AI_PAUSED" });
});
