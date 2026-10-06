// Read-only route contract on the two-household fake, not Postgres runtime evidence.
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
const mockGate = jest.fn(
  async (_familyId: string, key: string): Promise<unknown> =>
    key === "inventory" ? { status: 403 } : null,
);
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: (f: string, k: string) => mockGate(f, k),
}));
import { hashDeviceToken } from "@/lib/device-session";
import { GET } from "../items/from-recipe/review/route";
import {
  db,
  req,
  FAMILY_A,
  FAMILY_B,
  nextServerMock,
} from "@/__tests__/helpers/two-household";

beforeEach(() => {
  db.reset();
  mockGate
    .mockReset()
    .mockImplementation(async (_f, k) =>
      k === "inventory" ? { status: 403 } : null,
    );
});

it("refuses paired-device review even when a person cookie is also present", async () => {
  process.env.SHARED_DEVICE_ENABLED = "1";
  try {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    db.rows("householdDevice").push({
      id: "dev-a",
      family_id: FAMILY_A,
      revoked_at: null,
    });
    db.rows("deviceSession").push({
      id: "ds-a",
      device_id: "dev-a",
      family_id: FAMILY_A,
      access_token_hash: hashDeviceToken("tablet-token"),
      refresh_token_hash: "x",
      access_expires_at: future,
      refresh_expires_at: future,
      revoked_at: null,
      rotated_at: null,
    });
    const request = req({ as: "parentA", query: { recipeId: "recipe-a" } });
    const personCookie = request.cookies.get;
    request.cookies.get = (name: string) =>
      name === "fp_device" ? { value: "tablet-token" } : personCookie(name);
    expect((await GET(request)).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  } finally {
    delete process.env.SHARED_DEVICE_ENABLED;
  }
});

it("bounds destination choices and reports truncation while keeping grocery-first default ordering", async () => {
  db.rows("list").splice(0);
  for (let i = 0; i < 101; i++)
    db.rows("list").push({
      id: `list-${String(i).padStart(3, "0")}`,
      family_id: FAMILY_A,
      name: `List ${i}`,
      type: i === 100 ? "grocery" : "shopping",
      updated_at: new Date("2026-01-01"),
    });
  const body = await (
    await GET(req({ as: "parentA", query: { recipeId: "recipe-a" } }))
  ).json();
  expect(body.lists).toHaveLength(100);
  expect(body.listsTruncated).toBe(true);
  expect(body.defaultListId).toBe("list-100");
  expect(db.writes).toHaveLength(0);
});

it("marks household review data private and no-store", async () => {
  const response = await GET(
    req({ as: "parentA", query: { recipeId: "recipe-a" } }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(db.writes).toHaveLength(0);
});

it("excludes a foreign ingredient linked to an owned recipe from both review and inventory hints", async () => {
  mockGate.mockImplementation(async () => null);
  db.rows("recipeIngredient").push({
    id: "foreign-link",
    recipe_id: "recipe-a",
    ingredient_id: "ingredient-b",
    amount: 10,
    unit: "g",
  });
  db.rows("inventoryItem").push({
    id: "home-foreign-link",
    family_id: FAMILY_A,
    ingredient_id: "ingredient-b",
    name: "FOREIGN Tomato",
    status: "active",
    expires_on: null,
  });
  const response = await GET(
    req({ as: "parentA", query: { recipeId: "recipe-a" } }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(
    body.ingredients.map((i: { ingredientId: string }) => i.ingredientId),
  ).toEqual(["ingredient-a"]);
  expect(body.inventory.state).toBe("available");
  expect(body.inventory.haveIngredientIds).not.toContain("ingredient-b");
  expect(JSON.stringify(body)).not.toContain("FOREIGN");
  expect(db.writes).toHaveLength(0);
});

it("does not create a default list during an empty-list review", async () => {
  db.rows("list").splice(0);
  const response = await GET(
    req({ as: "parentA", query: { recipeId: "recipe-a" } }),
  );
  expect(await response.json()).toMatchObject({
    lists: [],
    defaultListId: null,
  });
  expect(db.writes).toHaveLength(0);
});

it("uses normalized unlinked presence only from this household and hides unavailable comparisons", async () => {
  mockGate.mockImplementation(async () => null);
  db.rows("inventoryItem").splice(0);
  db.rows("inventoryItem").push({
    id: "foreign",
    family_id: FAMILY_B,
    name: "Home Tomato",
    ingredient_id: "ingredient-a",
    status: "active",
    expires_on: null,
  });
  const read = async () =>
    (
      await (
        await GET(req({ as: "parentA", query: { recipeId: "recipe-a" } }))
      ).json()
    ).inventory;
  expect(await read()).toMatchObject({
    state: "available",
    haveIngredientIds: [],
  });
  db.rows("inventoryItem").push({
    id: "home",
    family_id: FAMILY_A,
    name: " home   TOMATO ",
    ingredient_id: null,
    status: "active",
    expires_on: null,
  });
  expect(await read()).toMatchObject({
    state: "available",
    haveIngredientIds: ["ingredient-a"],
  });
  mockGate.mockImplementation(async (_f, k) => {
    if (k === "inventory") throw new Error("unavailable");
    return null;
  });
  expect(await read()).toEqual({ state: "unavailable" });
  expect(db.writes).toHaveLength(0);
});

it("requires authentication and both mutation feature gates before reading review data", async () => {
  expect(
    (await GET(req({ as: null, query: { recipeId: "recipe-a" } }))).status,
  ).toBe(401);
  for (const key of ["meals", "lists"]) {
    mockGate.mockImplementation(async (_f, k) =>
      k === key
        ? nextServerMock.NextResponse.json(
            { error: "Disabled" },
            { status: 403 },
          )
        : null,
    );
    expect(
      (await GET(req({ as: "parentA", query: { recipeId: "recipe-a" } })))
        .status,
    ).toBe(403);
  }
  expect(db.writes).toHaveLength(0);
});

it("reviews canonical ingredients and destination without creating a list or any other record", async () => {
  const before = db.writes.length;
  const response = await GET(
    req({ as: "childA", query: { recipeId: "recipe-a" } }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    recipeId: "recipe-a",
    title: expect.any(String),
    inventory: { state: "unavailable" },
  });
  expect(body.ingredients).toEqual([
    expect.objectContaining({
      ingredientId: "ingredient-a",
      name: "Home Tomato",
      amount: 400,
      unit: "g",
    }),
  ]);
  expect(body.lists).toContainEqual(
    expect.objectContaining({ id: "list-a", name: "Home groceries" }),
  );
  expect(body.defaultListId).toBe("list-a");
  expect(db.writes).toHaveLength(before);
});

it("compares a directly requested zero-stock recipe using canonical presence matching", async () => {
  mockGate.mockImplementation(async () => null);
  db.rows("inventoryItem").splice(0);
  const response = await GET(
    req({ as: "parentA", query: { recipeId: "recipe-a" } }),
  );
  expect((await response.json()).inventory).toEqual({
    state: "available",
    haveIngredientIds: [],
    truncated: false,
  });
  expect(db.writes).toHaveLength(0);
});

it("uses saved meal servings including 100 without clamping and refuses foreign or mismatched meal ids", async () => {
  Object.assign(db.find("familyMeal", "meal-a")!, {
    recipe_id: "recipe-a",
    servings: 100,
  });
  const review = await GET(
    req({ as: "parentA", query: { recipeId: "recipe-a", mealId: "meal-a" } }),
  );
  expect((await review.json()).targetServings).toBe(100);
  for (const query of [
    { recipeId: "recipe-b" },
    { recipeId: "recipe-a", mealId: "meal-b" },
  ] as Record<string, string>[]) {
    expect((await GET(req({ as: "parentA", query }))).status).toBe(404);
  }
  db.find("familyMeal", "meal-a")!.recipe_id = null;
  expect(
    (
      await GET(
        req({
          as: "parentA",
          query: { recipeId: "recipe-a", mealId: "meal-a" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(db.writes).toHaveLength(0);
});
