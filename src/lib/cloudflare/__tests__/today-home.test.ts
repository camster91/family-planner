// Native D1 personal Today summary (owner decision 2026-11-19): still-open
// chores due before the window are added, oldest first, so the summary agrees
// with the kid home and the board. Every query binds the caller's household.
// The summary shares the board's paged reader, so hidden routine occurrences
// can never use up its cap.

jest.mock("../chore-read-policy", () => ({
  ...jest.requireActual("../chore-read-policy"),
  hiddenD1RoutineOccurrenceIds: async (
    _familyId: string,
    scope: { ids?: string[] },
  ) => (scope.ids ?? []).filter((id) => id.startsWith("hidden")),
}));
jest.mock("../database", () => ({ getD1Database: jest.fn() }));

import { readD1HomeSummary } from "../today-home";

const NOW = new Date("2026-01-05T12:00:00.000Z");
const at = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const OVERDUE_SQL = "c.status IN ('pending','in_progress','overdue')";

type Pages = any[][];
function store(rows: { window: Pages; overdue: Pages }) {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const served = { window: 0, overdue: 0 };
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
          const which = sql.includes(OVERDUE_SQL) ? "overdue" : "window";
          return { results: rows[which][served[which]++] ?? [] };
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

let created = 0;
const row = (
  id: string,
  day: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  created_at: ++created,
  title: id,
  due_date: at(day),
  status,
  assigned_to: "u_teen",
  assigned_member_id: null,
  member_subject_erased: 0,
  ...extra,
});

describe("readD1HomeSummary", () => {
  it.each(["fam_a", "fam_b"])(
    "adds open overdue chores for household %s, bound to that household only",
    async (familyId) => {
      const { statements, store: database } = store({
        window: [[row("today", "2026-01-05", "pending")]],
        overdue: [
          [
            row("late", "2026-01-03", "pending"),
            row("mow", "2026-01-02", "overdue"),
          ],
        ],
      });
      const data = await readD1HomeSummary(familyId, "teen", NOW, 2, database);
      expect(data.chores.map((c) => [c.id, c.dueDay])).toEqual([
        ["mow", "2026-01-02"],
        ["late", "2026-01-03"],
        ["today", "2026-01-05"],
      ]);
      const overdue = statements.find((s) => s.sql.includes(OVERDUE_SQL))!;
      expect(overdue.sql).toContain("ORDER BY c.due_date DESC");
      expect(overdue.binds[2]).toBe(Date.parse("2026-01-04T00:00:00.000Z"));
      for (const s of statements) expect(s.binds[0]).toBe(familyId);
    },
  );

  it("pages past hidden routine occurrences instead of letting them fill the cap", async () => {
    // A full first page of paused/unsupported routine occurrences, then the
    // real chore on the next page. The board shows it, so the summary must too.
    const hidden = Array.from({ length: 120 }, (_, i) =>
      row(`hidden-${i}`, "2026-01-05", "pending"),
    );
    const { statements, store: database } = store({
      window: [hidden, [row("visible", "2026-01-05", "pending")]],
      overdue: [],
    });
    const data = await readD1HomeSummary("fam_a", "teen", NOW, 2, database);
    expect(data.chores.map((c) => c.id)).toEqual(["visible"]);
    const windowReads = statements.filter(
      (s) => s.sql.includes('FROM "Chore" c') && !s.sql.includes(OVERDUE_SQL),
    );
    expect(windowReads).toHaveLength(2);
    // The second page continues after the last row of the first.
    expect(windowReads[1].binds.slice(3)).toEqual([
      hidden[119].due_date,
      hidden[119].created_at,
      "hidden-119",
    ]);
  });

  it("refuses a protocol-1 client only for a visible, active profile chore", async () => {
    const profileRow = (id: string, extra: Record<string, unknown> = {}) =>
      row(id, "2026-01-05", "pending", {
        assigned_to: null,
        assigned_member_id: "m1",
        profile_id: "m1",
        profile_family_id: "fam_a",
        profile_role: "child",
        profile_age: 8,
        profile_archived_at: null,
        profile_erasure_user_id: null,
        profile_legacy_user: null,
        profile_linked_user: null,
        ...extra,
      });
    const active = store({ window: [[profileRow("p1")]], overdue: [] });
    const refused = await readD1HomeSummary(
      "fam_a",
      "teen",
      NOW,
      1,
      active.store,
    );
    expect(refused.chores).toEqual([]);
    expect(refused.protocolError?.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");

    const hiddenProfile = store({
      window: [[profileRow("hidden-p1")]],
      overdue: [],
    });
    const quiet = await readD1HomeSummary(
      "fam_a",
      "teen",
      NOW,
      1,
      hiddenProfile.store,
    );
    expect(quiet.protocolError).toBeUndefined();
  });
});
