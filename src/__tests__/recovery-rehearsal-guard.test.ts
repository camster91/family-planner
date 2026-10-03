/**
 * Target guard of scripts/recovery-rehearsal.sh (#288).
 *
 * The rehearsal creates and DROPS databases, so it must refuse anything that
 * is not a throwaway fp_rehearsal_* database on loopback (or the GitHub
 * Actions service container) BEFORE it opens a connection. These tests run the
 * real script. The refused cases run the full rehearsal mode (not
 * --guard-only) against port 1, where nothing listens: a refusal with the
 * guard's exit code proves no step ran.
 */
import { runBash } from './helpers/run-bash';
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../scripts/recovery-rehearsal.sh");
const GUARD_EXIT = 3;

function run(env: Record<string, string>, args: string[] = []) {
  const result = runBash(SCRIPT, args, {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      NODE_ENV: "test",
      PGHOST: "localhost",
      PGPORT: "1",
      GITHUB_ACTIONS: "",
      REHEARSAL_RUN_ID: "unit",
      ...env,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("recovery rehearsal target guard", () => {
  it.each([
    [
      "the default application database",
      { REHEARSAL_SOURCE_DB: "family_planner" },
    ],
    [
      "a production-like restore target",
      { REHEARSAL_RESTORE_DB: "familyplanner" },
    ],
    [
      "a name that only contains the prefix",
      { REHEARSAL_SOURCE_DB: "x_fp_rehearsal_a" },
    ],
    [
      "a quoted or injected name",
      { REHEARSAL_RESTORE_DB: 'fp_rehearsal_a"; DROP' },
    ],
    ["a production marker", { REHEARSAL_SOURCE_DB: "fp_rehearsal_prod_copy" }],
    [
      "the same source and restore database",
      {
        REHEARSAL_SOURCE_DB: "fp_rehearsal_a",
        REHEARSAL_RESTORE_DB: "fp_rehearsal_a",
      },
    ],
    ["a remote host", { PGHOST: "db.example.com" }],
    ["a non-loopback IP", { PGHOST: "10.0.0.5" }],
    ["the service name outside GitHub Actions", { PGHOST: "postgres" }],
    ["NODE_ENV=production", { NODE_ENV: "production" }],
    ["NODE_ENV=Production (any case)", { NODE_ENV: "Production" }],
    ["NODE_ENV with surrounding spaces", { NODE_ENV: " production " }],
  ])("refuses %s before connecting", (_label, env) => {
    const { status, output } = run(env);
    expect(status).toBe(GUARD_EXIT);
    expect(output).toContain("REFUSED");
    expect(output).not.toContain("step 1-");
  });

  it("allows the default throwaway names on localhost (guard only)", () => {
    const { status, output } = run({}, ["--guard-only"]);
    expect(status).toBe(0);
    expect(output).toContain(
      "guard: allowed host=localhost port=1 source=fp_rehearsal_unit_src restore=fp_rehearsal_unit_dst",
    );
  });

  it("allows the postgres service host only inside GitHub Actions", () => {
    const { status } = run({ PGHOST: "postgres", GITHUB_ACTIONS: "true" }, [
      "--guard-only",
    ]);
    expect(status).toBe(0);
  });

  it("ignores an inherited DATABASE_URL", () => {
    const { status, output } = run(
      { DATABASE_URL: "postgresql://u@prod.example.com/family_planner" },
      ["--guard-only"],
    );
    expect(status).toBe(0);
    expect(output).not.toContain("prod.example.com");
  });
});
