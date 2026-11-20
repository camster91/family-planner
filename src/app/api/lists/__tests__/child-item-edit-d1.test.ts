// A child may add and tick list items but not change one. The refusal sits in
// the route, before the storage branch, so the D1 path refuses exactly like
// the Postgres path (covered in edit-version, sections and provenance tests).
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
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: jest.fn(async () => null),
}));
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
// Person auth itself is covered elsewhere; here it yields the caller's role.
jest.mock("@/lib/api-auth", () => ({
  ...jest.requireActual("@/lib/api-auth"),
  authenticateWithFamily: jest.fn(async (request: Request) => {
    const role = request.headers.get("x-test-role") ?? "parent";
    return [
      {
        user: { id: `${role}-a`, family_id: "family-a", role },
        payload: { tv: 0 },
      },
      null,
    ];
  }),
}));
jest.mock("@/lib/device-route", () => ({
  refusePairedDevice: jest.fn(async () => null),
}));
jest.mock("@/lib/cloudflare/list-write", () => ({
  updateD1ListItem: jest.fn(async () => ({
    status: 200,
    body: { item: { id: "item-a" } },
    replayed: false,
  })),
}));
jest.mock("@/lib/cloudflare/list-sections", () => ({
  moveD1ListItemSection: jest.fn(async () => ({
    status: 200,
    body: { nameKey: "milk", override: "household", sections: {} },
  })),
}));

import { PATCH as editRoute } from "../items/edit/route";
import { PATCH as updateRoute } from "../items/update/route";
import { PATCH as sectionRoute } from "../items/section/route";
import { req as householdReq } from "@/__tests__/helpers/two-household";
import { updateD1ListItem } from "@/lib/cloudflare/list-write";
import { moveD1ListItemSection } from "@/lib/cloudflare/list-sections";

type UserKey = "childA" | "teenA";
const req = ({
  as,
  headers = {},
  ...rest
}: {
  as: UserKey;
  method: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}) =>
  householdReq({
    as,
    ...rest,
    headers: { ...headers, "x-test-role": as === "childA" ? "child" : "teen" },
  });
const KEY = "33333333-3333-4333-8333-333333333333";
const editBody = {
  itemId: "item-a",
  expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  content: "Oat milk",
  quantity: 2,
};
const call = (
  route: typeof editRoute,
  as: UserKey,
  body: Record<string, unknown>,
) =>
  route(
    req({
      as,
      method: "PATCH",
      body,
      headers: { "Idempotency-Key": KEY },
    }),
  );

beforeEach(() => jest.clearAllMocks());

it("D1: a child's edit, field update and move are refused before any write", async () => {
  const edit = await call(editRoute, "childA", editBody);
  expect(edit.status).toBe(403);
  expect((await edit.json()).code).toBe("LIST_ITEM_EDIT_FORBIDDEN");
  const update = await call(updateRoute, "childA", {
    itemId: "item-a",
    content: "Chocolate",
  });
  expect(update.status).toBe(403);
  const move = await sectionRoute(
    req({
      as: "childA",
      method: "PATCH",
      body: { itemId: "item-a", section: "household" },
    }),
  );
  expect(move.status).toBe(403);
  expect((await move.json()).error.code).toBe("LIST_ITEM_EDIT_FORBIDDEN");
  expect(updateD1ListItem).not.toHaveBeenCalled();
  expect(moveD1ListItemSection).not.toHaveBeenCalled();
});

it("D1: a child's tick and a teen's edit and move still reach the D1 writer", async () => {
  const tick = await updateRoute(
    req({
      as: "childA",
      method: "PATCH",
      body: { itemId: "item-a", checked: true },
    }),
  );
  expect(tick.status).toBe(200);
  expect((await call(editRoute, "teenA", editBody)).status).toBe(200);
  const move = await sectionRoute(
    req({
      as: "teenA",
      method: "PATCH",
      body: { itemId: "item-a", section: "household" },
    }),
  );
  expect(move.status).toBe(200);
  expect(updateD1ListItem).toHaveBeenCalledTimes(2);
  expect(moveD1ListItemSection).toHaveBeenCalledTimes(1);
});
