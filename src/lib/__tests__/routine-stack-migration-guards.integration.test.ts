/**
 * Real-Postgres negative checks for the routine-stack migration's retry guard.
 *
 * This suite is opt-in and uses unique public relation names. It never touches
 * the production-named RoutineStack table; each case runs the actual migration
 * SQL against a disposable, renamed copy and leaves the malformed relation in
 * place only until the case teardown.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function looksLikeDisposableDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const localHost = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return (
      localHost.has(url.hostname) &&
      /(?:^|[-_])(ci|e2e|test|integration|routine)(?:[-_]|$)/i.test(
        databaseName,
      )
    );
  } catch {
    return false;
  }
}

const databaseSuiteEnabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.FIXTURES_ALLOW === "1" &&
  process.env.NODE_ENV !== "production" &&
  looksLikeDisposableDatabase(process.env.DATABASE_URL);
const describeWithDatabase = databaseSuiteEnabled ? describe : describe.skip;

jest.setTimeout(120_000);

const ROOT = path.resolve(__dirname, "../../..");
const sourceMigration = fs.readFileSync(
  path.join(ROOT, "database/migration-routine-stacks.sql"),
  "utf8",
);

type Names = {
  stack: string;
  chore: string;
  family: string;
  user: string;
  wrongTable: string;
};

function makeNames(): Names {
  const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    stack: `RoutineStackGuard_${suffix}`,
    chore: `ChoreGuard_${suffix}`,
    family: `FamilyGuard_${suffix}`,
    user: `UserGuard_${suffix}`,
    wrongTable: `WrongIndexTableGuard_${suffix}`,
  };
}

function renamedMigration(names: Names): string {
  // The migration is intentionally run as written apart from unique relation
  // names. All catalog checks, constraints, and transaction boundaries remain
  // the production SQL under test.
  return sourceMigration
    .replaceAll("RoutineStack", names.stack)
    .replaceAll("Chore", names.chore)
    .replaceAll("Family", names.family)
    .replaceAll("User", names.user);
}

function stackDefinition(names: Names): string {
  return `
    CREATE TABLE "${names.stack}" (
      "id" TEXT PRIMARY KEY,
      "family_id" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 1,
      "fingerprint" TEXT NOT NULL,
      "created_by" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
}

type Scenario = {
  name: string;
  setup: (names: Names, relationName: string) => string;
};

const scenarios: Scenario[] = [
  {
    name: "a same-named index owned by another table",
    setup: (names, relationName) => `
      CREATE TABLE "${names.wrongTable}" (
        "id" TEXT NOT NULL,
        "family_id" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "${relationName}"
        ON "${names.wrongTable}" ("id", "family_id");
    `,
  },
  {
    name: "a partial unique index",
    setup: (names, relationName) => `
      CREATE UNIQUE INDEX "${relationName}"
        ON "${names.stack}" ("id", "family_id")
        WHERE "family_id" <> '';
    `,
  },
  {
    name: "an expression unique index",
    setup: (names, relationName) => `
      CREATE UNIQUE INDEX "${relationName}"
        ON "${names.stack}" ((lower("id")), "family_id");
    `,
  },
  {
    name: "a deferred unique constraint",
    setup: (names, relationName) => `
      ALTER TABLE "${names.stack}"
        ADD CONSTRAINT "${relationName}"
        UNIQUE ("id", "family_id") DEFERRABLE INITIALLY DEFERRED;
    `,
  },
  {
    name: "a unique constraint with reversed columns",
    setup: (names, relationName) => `
      ALTER TABLE "${names.stack}"
        ADD CONSTRAINT "${relationName}"
        UNIQUE ("family_id", "id");
    `,
  },
];

describeWithDatabase("routine stack migration catalog guards", () => {
  let db: pg.Client;
  const names = makeNames();

  async function dropRelations(): Promise<void> {
    await db.query(`
      DROP TABLE IF EXISTS
        "${names.chore}",
        "${names.stack}",
        "${names.wrongTable}",
        "${names.user}",
        "${names.family}"
      CASCADE;
    `);
  }

  async function prepare(scenario: Scenario): Promise<string> {
    const relationName = `${names.stack}_id_family_id_key`;
    await dropRelations();
    await db.query(`CREATE TABLE "${names.family}" ("id" TEXT PRIMARY KEY);`);
    await db.query(`CREATE TABLE "${names.user}" ("id" TEXT PRIMARY KEY);`);
    await db.query(`
      CREATE TABLE "${names.chore}" (
        "id" TEXT PRIMARY KEY,
        "family_id" TEXT NOT NULL,
        "routine_stack_id" TEXT
      );
    `);
    await db.query(stackDefinition(names));
    await db.query(scenario.setup(names, relationName));
    return renamedMigration(names);
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  });

  afterEach(async () => {
    await dropRelations();
  });

  afterAll(async () => {
    await db.end();
  });

  it.each(scenarios)(
    "rejects $name instead of accepting a false retry equivalent",
    async (scenario) => {
      const migration = await prepare(scenario);
      let failure: unknown;
      try {
        await db.query(migration);
      } catch (error) {
        failure = error;
      } finally {
        // The migration owns its BEGIN/COMMIT. A rejected DO block leaves the
        // client in an aborted transaction until this explicit rollback.
        await db.query("ROLLBACK");
      }

      expect(failure).toMatchObject({
        message: expect.stringMatching(
          /wrong (unique constraint|relation) shape/,
        ),
      });
    },
  );
});

describe("routine stack migration source parity", () => {
  it("keeps startup catalog guard checks in sync with the source migration", () => {
    const startupMigration = fs.readFileSync(
      path.join(ROOT, "scripts/migrate.js"),
      "utf8",
    );
    for (const clause of [
      "existing_index_relid oid",
      "i.indrelid",
      "i.indisvalid",
      "i.indisready",
      "i.indpred",
      "i.indexprs",
      "condeferrable",
      "condeferred",
    ]) {
      expect(sourceMigration).toContain(clause);
      expect(startupMigration).toContain(clause);
    }
  });
});
