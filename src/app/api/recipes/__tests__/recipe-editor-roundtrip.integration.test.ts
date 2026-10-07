// Real Prisma/Postgres and canonical POST/PATCH/GET. Only session and Next
// transport are mocked. Guarded, opt-in, unique rows; never seed/reset fixtures.
import { randomUUID } from "node:crypto";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/session", () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith("session:")) return null;
    const { prisma } = require("@/lib/prisma");
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } });
    return u
      ? {
          userId: u.id,
          email: u.email,
          role: u.role,
          family_id: u.family_id,
          tv: u.token_version,
        }
      : null;
  },
  getTokenVersion: async () => 0,
}));
const db = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

db("guarded recipe editor persistence/readback", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let collection: typeof import("../route");
  let detail: typeof import("../[id]/route");
  const familyId = `editor-${randomUUID()}`;
  const userId = `editor-${randomUUID()}`;
  const request = (body?: unknown): any => ({
    url: "http://localhost/api/recipes",
    headers: new Headers(),
    cookies: {
      get: (key: string) =>
        key === "session_token" ? { value: `session:${userId}` } : undefined,
    },
    json: async () => body,
  });
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database not configured");
    prisma = mod.prisma;
    collection = await import("../route");
    detail = await import("../[id]/route");
    await prisma.$transaction(async (tx) => {
      await tx.family.create({
        data: {
          id: familyId,
          name: "Isolated editor check",
          invite_code: familyId,
        },
      });
      await tx.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          name: "Editor",
          role: "parent",
          family_id: familyId,
        },
      });
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    // Delete only the exact unique namespace created by this invocation.
    await prisma.$transaction(async (tx) => {
      await tx.family.deleteMany({ where: { id: familyId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
    expect(await prisma.family.count({ where: { id: familyId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
    await prisma.$disconnect();
  });

  it("metadata-only PATCH retains legacy text and join rows, deliberate line replacement uses canonical normalization", async () => {
    const res = await collection.POST(
      request({
        title: "Legacy",
        ingredients: [
          { name: "Carrot", amount: 1.125 },
          { name: "Onion", amount: 0.375 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { recipe } = await res.json();
    const context = { params: Promise.resolve({ id: recipe.id }) };
    const raw = {
      description: "  Keep description  ",
      instructions: " Chop.\n\nSimmer.  ",
    };
    await prisma.recipe.update({ where: { id: recipe.id }, data: raw });
    await prisma.recipeIngredient.update({
      where: { id: recipe.ingredients[1].id },
      data: { unit: "  pcs  ", note: "  keep note  " },
    });
    const before = (await (await detail.GET(request(), context)).json()).recipe;
    expect(
      (await detail.PATCH(request({ title: "Legacy renamed" }), context))
        .status,
    ).toBe(200);
    const metadata = (await (await detail.GET(request(), context)).json())
      .recipe;
    expect(metadata).toMatchObject(raw);
    expect(metadata.ingredients).toEqual(before.ingredients);
    const lines = metadata.ingredients.map((line: any, index: number) => ({
      ingredient_id: line.ingredient.id,
      amount: index === 0 ? 2.625 : Number(line.amount),
      unit: line.unit,
      note: line.note,
    }));
    expect(
      (await detail.PATCH(request({ ingredients: lines }), context)).status,
    ).toBe(200);
    const changed = (await (await detail.GET(request(), context)).json())
      .recipe;
    expect(changed).toMatchObject(raw);
    expect(Number(changed.ingredients[0].amount)).toBe(2.625);
    expect(Number(changed.ingredients[1].amount)).toBe(0.375);
    expect(changed.ingredients[1]).toMatchObject({
      unit: "pcs",
      note: "keep note",
    });
    // Renaming a line resolves another Ingredient; it does not rename the shared row.
    expect(
      (
        await detail.PATCH(
          request({
            ingredients: [
              { name: "Aubergine", amount: 0.875, note: " diced " },
              {
                ingredient_id: metadata.ingredients[1].ingredient.id,
                amount: 0.375,
              },
            ],
          }),
          context,
        )
      ).status,
    ).toBe(200);
    const renamed = (await (await detail.GET(request(), context)).json())
      .recipe;
    expect(
      renamed.ingredients.map((line: any) => line.ingredient.name),
    ).toEqual(["Aubergine", "Onion"]);
    expect(Number(renamed.ingredients[0].amount)).toBe(0.875);
    expect(renamed.ingredients[0].note).toBe("diced");
    expect(
      await prisma.ingredient.findUnique({
        where: { id: metadata.ingredients[0].ingredient.id },
      }),
    ).toMatchObject({ name: "Carrot" });
    expect(
      (await detail.PATCH(request({ ingredients: [] }), context)).status,
    ).toBe(200);
    expect(
      (await (await detail.GET(request(), context)).json()).recipe.ingredients,
    ).toEqual([]);
    expect(
      await prisma.recipeIngredient.count({ where: { recipe_id: recipe.id } }),
    ).toBe(0);
  });

  it("reads canonical name order rather than submitted array order after fresh joins", async () => {
    const created = await collection.POST(
      request({
        title: "Roundtrip",
        ingredients: [
          { name: "Zucchini", amount: 1.25, note: " sliced " },
          { name: "Apple", amount: 0.375 },
        ],
      }),
    );
    expect(created.status).toBe(201);
    const { recipe } = await created.json();
    const context = { params: Promise.resolve({ id: recipe.id }) };
    const read = async () => {
      const res = await detail.GET(request(), context);
      expect(res.status).toBe(200);
      return (await res.json()).recipe;
    };
    let saved = await read();
    expect(saved.ingredients.map((line: any) => line.ingredient.name)).toEqual([
      "Apple",
      "Zucchini",
    ]);
    expect(saved.ingredients.map((line: any) => Number(line.amount))).toEqual([
      0.375, 1.25,
    ]);
    const ids = saved.ingredients.map((line: any) => line.id);
    const patched = await detail.PATCH(
      request({
        ingredients: [...saved.ingredients].reverse().map((line: any) => ({
          ingredient_id: line.ingredient.id,
          amount: Number(line.amount),
          unit: line.unit,
          note: line.note,
        })),
      }),
      context,
    );
    expect(patched.status).toBe(200);
    saved = await read();
    expect(saved.ingredients.map((line: any) => line.ingredient.name)).toEqual([
      "Apple",
      "Zucchini",
    ]);
    expect(saved.ingredients.map((line: any) => line.id)).not.toEqual(ids);
    expect(saved.ingredients[1].note).toBe("sliced");
  });
});
