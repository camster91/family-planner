/** Opt-in disposable PostgreSQL source; authored/unrun in the no-QA pass. */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
const withDatabase = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
withDatabase("grouped chore streak projection", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let lib: typeof import("@/lib/chore-streak-read");
  const families = ["streakint-family-a", "streakint-family-b"];
  const users = ["streakint-user-a", "streakint-user-b"];
  const now = new Date("2026-10-24T12:00:00.000Z");
  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: families } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Disposable database unavailable");
    prisma = mod.prisma;
    lib = await import("@/lib/chore-streak-read");
    await cleanup();
    await prisma.family.createMany({ data: families.map((id, i) => ({ id, name: `Streak fixture ${i}`, invite_code: `streakint-invite-${i}` })) });
    await prisma.user.createMany({ data: users.map((id, i) => ({ id, family_id: families[i], role: "parent", name: "Fixture", email: `streak-${i}@example.test` })) });
    const days = lib.choreStreakDays(now);
    await prisma.chore.createMany({ data: users.flatMap((id, index) => days.slice(0, index ? 7 : 3).flatMap((day, d) =>
      Array.from({ length: 30 }, (_, n) => ({ id: `streakint-${index}-${d}-${n}`, family_id: families[index],
        title: "Fixture content excluded from projection", assigned_to: id, created_by: id,
        due_date: new Date(`${day}T12:00:00Z`), completed_at: new Date(`${day}T12:00:00Z`), status: n % 2 ? "completed" : "verified" })))) });
    await prisma.chore.create({ data: { id: "streakint-pending", family_id: families[0], title: "Pending must not extend streak",
      assigned_to: users[0], created_by: users[0], due_date: new Date(`${days[3]}T12:00:00Z`),
      completed_at: new Date(`${days[3]}T12:00:00Z`), status: "pending" } });
  });
  afterAll(async () => { if (prisma) { await cleanup(); await prisma.$disconnect(); } });
  it("deduplicates dense day completions and refuses foreign account history", async () => {
    expect(await lib.readChoreStreaks(prisma, families[0], users, now)).toEqual({ [users[0]]: 3, [users[1]]: 0 });
    expect(await lib.readChoreStreaks(prisma, families[1], [users[1]], now)).toEqual({ [users[1]]: 7 });
  });
});
