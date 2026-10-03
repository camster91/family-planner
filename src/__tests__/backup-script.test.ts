/**
 * scripts/backup.sh, run for real with a fake `docker` on PATH that prints a
 * canned pg_dump. A failed or truncated dump must never be published under a
 * familyplanner-*.sql.gz name (backup-prune.sh keeps the newest one and
 * restore.sh restores it by default).
 */
import { runBash } from './helpers/run-bash';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../scripts/backup.sh");
const TRAILER = "--\n-- PostgreSQL database dump complete\n--\n\n";

let work: string;
let backups: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "fp-backup-"));
  backups = path.join(work, "backups");
  fs.mkdirSync(path.join(work, "bin"));
  // Fake docker: `docker exec <container> pg_dump ...` prints $FAKE_DUMP and
  // exits with $FAKE_EXIT.
  fs.writeFileSync(
    path.join(work, "bin", "docker"),
    '#!/usr/bin/env bash\n[ "$1" = exec ] || exit 64\ncat "$FAKE_DUMP"\nexit "${FAKE_EXIT:-0}"\n',
    { mode: 0o755 },
  );
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function dump(tables: number, trailer = true) {
  const body = Array.from(
    { length: tables },
    (_, i) => `CREATE TABLE public.t${i} (id integer);\n`,
  ).join("");
  return `--\n-- PostgreSQL database dump\n--\n\n${body}\n${trailer ? TRAILER : ""}`;
}

function run(content: string, exitCode = 0) {
  const dumpFile = path.join(work, "dump.sql");
  fs.writeFileSync(dumpFile, content);
  const result = runBash(SCRIPT, [backups], {
      NODE_ENV: "test",
      PATH: `${path.join(work, "bin")}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      DB_CONTAINER: "fake-db",
      DB_USER: "fake",
      DB_NAME: "fake",
      FAKE_DUMP: dumpFile,
      FAKE_EXIT: String(exitCode),
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const files = () => (fs.existsSync(backups) ? fs.readdirSync(backups) : []);

describe("backup.sh", () => {
  it("publishes a complete, verified dump under its final name", () => {
    const { status, output } = run(dump(6));
    expect(status).toBe(0);
    const left = files();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^familyplanner-\d{8}T\d{6}Z\.sql\.gz$/);
    expect(output).toContain("Backup integrity OK (6 tables)");
    expect(output).toContain("Backup done.");
  });

  it("writes nothing when pg_dump fails midway", () => {
    const { status, output } = run(dump(6, false), 1);
    expect(status).not.toBe(0);
    expect(output).toContain("pg_dump of fake failed");
    expect(files()).toEqual([]);
  });

  it("writes nothing when the dump has no completion trailer", () => {
    const { status, output } = run(dump(6, false));
    expect(status).not.toBe(0);
    expect(output).toContain("truncated");
    expect(files()).toEqual([]);
  });

  it("warns, rather than silently exiting, when the dump has no tables", () => {
    const { status, output } = run(dump(0));
    expect(status).toBe(0);
    expect(output).toContain("only 0 CREATE TABLE statements");
    expect(output).toContain("Backup done.");
    expect(files()).toHaveLength(1);
  });
});
