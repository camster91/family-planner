// Native D1 personal Today summary (owner decision 2026-11-19): still-open
// chores due before the window are added, oldest first, so the summary agrees
// with the kid home and the board. Every query binds the caller's household.

jest.mock("../chore-read-policy", () => ({
  hiddenD1RoutineOccurrenceIds: async () => [],
}));
jest.mock("../database", () => ({ getD1Database: jest.fn() }));

import { readD1HomeSummary } from "../today-home";

const NOW = new Date("2026-01-05T12:00:00.000Z");
const at = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

function store(rows: { window: any[]; overdue: any[] }) {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const entry = { sql, binds: [] as unknown[] };
      statements.push(entry);
      const bound = {
        bind(...binds: unknown[]) {
          entry.binds = binds;
          return bound;
        },
        async all() {
          if (sql.includes('FROM "User"'))
            return { results: [{ id: "u_teen", name: "Taylor" }] };
          return {
            results: sql.includes("c.due_date<?2") ? rows.overdue : rows.window,
          };
        },
        async first() {
          return { total: 0 };
        },
      };
      return bound;
    },
  };
  return { statements, store: { withSession: () => db } as any };
}

const row = (id: string, day: string, status: string) => ({
  id,
  title: id,
  due_date: at(day),
  status,
  assigned_to: "u_teen",
  assigned_member_id: null,
  member_subject_erased: 0,
});

describe("readD1HomeSummary", () => {
  it.each(["fam_a", "fam_b"])(
    "adds open overdue chores for household %s, bound to that household only",
    async (familyId) => {
      const { statements, store: database } = store({
        window: [row("today", "2026-01-05", "pending")],
        overdue: [
          row("late", "2026-01-03", "pending"),
          row("mow", "2026-01-02", "overdue"),
        ],
      });
      const data = await readD1HomeSummary(familyId, "teen", NOW, 2, database);
      expect(data.chores.map((c) => [c.id, c.dueDay])).toEqual([
        ["mow", "2026-01-02"],
        ["late", "2026-01-03"],
        ["today", "2026-01-05"],
      ]);
      const overdue = statements.find((s) => s.sql.includes("c.due_date<?2"))!;
      expect(overdue.sql).toContain(
        "c.status IN ('pending','in_progress','overdue')",
      );
      expect(overdue.sql).toContain("ORDER BY c.due_date DESC");
      expect(overdue.binds).toEqual([
        familyId,
        Date.parse("2026-01-04T00:00:00.000Z"),
        80,
      ]);
      for (const s of statements) expect(s.binds[0]).toBe(familyId);
    },
  );
});
