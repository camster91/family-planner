/** Authored/unrun. Admission/projection cases; real isolation is separate DB work. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock("@/lib/household-lock", () => ({
  lockUser: jest.fn(),
  lockHousehold: jest.fn(),
}));
jest.mock("@/lib/event-preparation/owner", () => ({
  eventPreparationReady: jest.fn(() => true),
}));
jest.mock("@/lib/event-preparation/storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/event-preparation/discovery", () => ({
  readPreparationBacklinks: jest.fn(async () => ({})),
  readOwnPreparationContext: jest.fn(async () => ({})),
}));
jest.mock("@/lib/event-preparation/origin", () => ({
  readPreparationRoutineOrigins: jest.fn(async () => ({})),
}));
import { POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  readOwnPreparationContext,
  readPreparationBacklinks,
} from "@/lib/event-preparation/discovery";
import { readPreparationRoutineOrigins } from "@/lib/event-preparation/origin";
const tx = {
  user: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
};
function actor(role: "parent" | "child" | "teen" = "parent") {
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: { id: "person-a", family_id: "family-a", role },
      payload: { tv: 3 },
    },
    null,
  ] as never);
  tx.user.findUnique.mockResolvedValue({
    family_id: "family-a",
    role,
    token_version: 3,
  });
}
function request(body: unknown = { ids: ["task-a"] }) {
  return {
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as never;
}
beforeEach(() => {
  jest.clearAllMocks();
  actor();
  tx.$queryRaw.mockResolvedValue([{ ready: true }]);
  (prisma!.$transaction as jest.Mock).mockImplementation((run) => run(tx));
  jest
    .mocked(readPreparationBacklinks)
    .mockResolvedValue({ "task-a": "event-a" });
  jest.mocked(readPreparationRoutineOrigins).mockResolvedValue({});
  jest
    .mocked(readOwnPreparationContext)
    .mockResolvedValue({ "task-a": { eventTitle: "Shared event" } });
});
it("keeps parent links separate from child/teen own-task title context", async () => {
  let response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    backlinks: { "task-a": "event-a" },
    ownContext: {},
  });
  expect(readOwnPreparationContext).not.toHaveBeenCalled();
  for (const role of ["child", "teen"] as const) {
    jest.mocked(readPreparationBacklinks).mockClear();
    jest.mocked(readPreparationRoutineOrigins).mockClear();
    actor(role);
    response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      owner: { userId: "person-a", familyId: "family-a", generation: 3 },
      state: "available",
      backlinks: {},
      origins: {},
      ownContext: { "task-a": { eventTitle: "Shared event" } },
    });
    expect(readPreparationBacklinks).not.toHaveBeenCalled();
    expect(readPreparationRoutineOrigins).not.toHaveBeenCalled();
    expect(readOwnPreparationContext).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({
        userId: "person-a",
        familyId: "family-a",
        tokenVersion: 3,
        role,
        choreIds: ["task-a"],
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
});
it.each([
  { ids: [] },
  { ids: ["task-a", "task-a"] },
  { ids: Array.from({ length: 151 }, (_, i) => `task-${i}`) },
  { ids: ["task-a"], familyId: "foreign-family" },
  { ids: ["task-a"], owner: { userId: "other-parent" } },
])("rejects invalid windows and supplied authority", async (body) => {
  const response = await POST(request(body));
  expect(response.status).toBe(400);
  expect(prisma!.$transaction).not.toHaveBeenCalled();
});
it.each([
  { family_id: "family-a", role: "parent", token_version: 4, status: 401 },
  {
    family_id: "foreign-family",
    role: "parent",
    token_version: 3,
    status: 403,
  },
])(
  "renews current session and household before projections",
  async ({ status, ...current }) => {
    tx.user.findUnique.mockResolvedValue(current);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(readPreparationBacklinks).not.toHaveBeenCalled();
    expect(readOwnPreparationContext).not.toHaveBeenCalled();
  },
);
