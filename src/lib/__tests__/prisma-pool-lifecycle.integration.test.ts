/** Real PostgreSQL connection lifecycle; guarded disposable target only. */
import pg from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(20000);
suite("application Prisma pool ownership", () => {
  let admin: pg.Client | undefined;
  let db: NonNullable<typeof import("@/lib/prisma").prisma> | undefined;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    db = (await import("@/lib/prisma")).prisma!;
  });
  afterAll(async () => {
    await db?.$disconnect();
    await admin?.end();
  });
  it("releases its backend on disconnect and reconnects for a later query", async () => {
    const rows = await db!.$queryRaw<
      Array<{ pid: number }>
    >`SELECT pg_backend_pid() AS pid`;
    const pid = rows[0].pid;
    const count = async () =>
      Number(
        (
          await admin!.query(
            "SELECT count(*) FROM pg_stat_activity WHERE pid = $1",
            [pid],
          )
        ).rows[0].count,
      );
    expect(await count()).toBe(1);
    await db!.$disconnect();
    const deadline = Date.now() + 5000;
    while (await count()) {
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await count()).toBe(0);
    expect(
      await db!.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`,
    ).toEqual([{ value: 1 }]);
  });
});
