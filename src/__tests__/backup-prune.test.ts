/**
 * Retention of scripts/backup-prune.sh (#145), run for real on a temp dir.
 */
import { runBash } from './helpers/run-bash';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../scripts/backup-prune.sh");
// 2026-09-30T12:00:00Z, a Wednesday.
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const DAY = 86_400_000;

function backupName(msAgo: number) {
  const d = new Date(NOW - msAgo).toISOString(); // 2026-09-30T12:00:00.000Z
  const stamp = d.slice(0, 19).replace(/[-:]/g, "");
  return `familyplanner-${stamp}Z.sql.gz`;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-prune-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function touch(name: string, where = dir) {
  fs.writeFileSync(path.join(where, name), "x");
}

function run(args: string[], env: Record<string, string> = {}) {
  const result = runBash(SCRIPT, args, {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      BACKUP_PRUNE_NOW: String(NOW / 1000),
      ...env,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const files = () => fs.readdirSync(dir).sort();

describe("backup retention", () => {
  it("keeps 14 daily, then the newest per ISO week, and nothing older than 35 days", () => {
    // One backup a day at 03:00 UTC for 60 days.
    const names = Array.from({ length: 60 }, (_, i) =>
      backupName(i * DAY + 9 * 3_600_000),
    );
    names.forEach((n) => touch(n));

    const { status } = run([dir]);
    expect(status).toBe(0);
    const left = files();

    // Every backup of the last 14 days stays.
    for (let i = 0; i < 14; i++) expect(left).toContain(names[i]);
    // Nothing older than 35 days.
    for (let i = 36; i < 60; i++) expect(left).not.toContain(names[i]);
    // Between 14 and 35 days: one per ISO week.
    const weekly = left.filter((n) => !names.slice(0, 14).includes(n));
    expect(weekly.length).toBeGreaterThanOrEqual(3);
    expect(weekly.length).toBeLessThanOrEqual(4);
    expect(left.length).toBe(14 + weekly.length);
  });

  it("dry run deletes nothing", () => {
    const old = backupName(90 * DAY);
    touch(backupName(0));
    touch(old);
    const { status, output } = run([dir], { BACKUP_PRUNE_DRY_RUN: "1" });
    expect(status).toBe(0);
    expect(output).toContain(`would delete ${old}`);
    expect(files()).toContain(old);
  });

  it("never deletes the newest backup, however old", () => {
    const only = backupName(400 * DAY);
    touch(only);
    expect(run([dir]).status).toBe(0);
    expect(files()).toEqual([only]);
  });

  it("leaves other files, symlinks and subdirectories alone", () => {
    const old = backupName(90 * DAY);
    touch(backupName(0));
    touch(old);
    touch("familyplanner-notes.sql.gz");
    touch("other.sql.gz");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fp-prune-out-"));
    try {
      touch(old, outside);
      fs.symlinkSync(
        path.join(outside, old),
        path.join(dir, backupName(80 * DAY)),
      );
      fs.mkdirSync(path.join(dir, "nested"));
      touch(backupName(70 * DAY), path.join(dir, "nested"));

      expect(run([dir]).status).toBe(0);
      expect(files()).toEqual(
        [
          backupName(0),
          backupName(80 * DAY),
          "familyplanner-notes.sql.gz",
          "nested",
          "other.sql.gz",
        ].sort(),
      );
      expect(fs.readdirSync(path.join(dir, "nested"))).toEqual([
        backupName(70 * DAY),
      ]);
      expect(fs.existsSync(path.join(outside, old))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    ["no directory", []],
    ["a relative path", ["backups"]],
    ["the root directory", ["/"]],
    ["a missing directory", ["/nonexistent/fp-prune"]],
  ])("refuses %s", (_label, args) => {
    const { status, output } = run(args as string[]);
    expect(status).toBe(2);
    expect(output).toContain("REFUSED");
  });

  it("refuses bad settings", () => {
    touch(backupName(0));
    expect(run([dir], { BACKUP_MAX_AGE_DAYS: "7" }).status).toBe(2);
    expect(run([dir], { BACKUP_KEEP_DAILY_DAYS: "-1" }).status).toBe(2);
    expect(run([dir], { BACKUP_PRUNE_DRY_RUN: "yes" }).status).toBe(2);
  });
});
