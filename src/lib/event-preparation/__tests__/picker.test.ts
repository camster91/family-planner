/** Authored/unrun selected-source paging/isolation cases. No real DB locking. */
import type { PrismaClient } from "@prisma/client";
import { readPreparationPicker } from "../picker";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
} from "../runtime";
import { actor } from "./test-fixture";
import { preparationPickerReply } from "../picker-contract";
jest.mock("../runtime", () => ({
  openPreparationActorInTx: jest.fn(),
  prepareEventPreparationInTx: jest.fn(),
}));
jest.mock("@/lib/chore-profile", () => ({
  isProfileChoreEnabled: jest.fn(() => false),
}));
function fixture() {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: `chore-${String(index).padStart(2, "0")}`,
  }));
  const tx = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  const prepared = { tasks: [], subjects: [] } as unknown as Awaited<
    ReturnType<typeof prepareEventPreparationInTx>
  >;
  jest.mocked(prepareEventPreparationInTx).mockResolvedValue(prepared);
  return { rows, tx, db, prepared };
}
const query = {
  eventId: "event-a",
  timeZone: "America/Toronto",
  memberProtocol: "2" as const,
  kind: "tasks" as const,
  search: "milk%_",
};
beforeEach(() => jest.clearAllMocks());
it("keeps a raw bounded page cursor even when canonical visibility filters every candidate", async () => {
  const { db, tx } = fixture();
  const page = await readPreparationPicker(db, actor, query);
  expect(page).toMatchObject({ items: [], next: "chore-19", after: null });
  expect(prepareEventPreparationInTx).toHaveBeenCalledWith(
    tx,
    actor,
    expect.objectContaining({
      choreIds: expect.arrayContaining(["chore-00", "chore-19"]),
      eventId: "event-a",
    }),
  );
  expect(
    jest.mocked(prepareEventPreparationInTx).mock.calls[0][2].choreIds,
  ).not.toContain("chore-20");
  const [strings, ...values] = tx.$queryRaw.mock.calls[0];
  expect(strings.join("")).not.toContain(query.search);
  expect(values).toContain(actor.familyId);
  expect(values).toContain("%milk\\%\\_%");
});
it("refuses actor or profile capability failures before private candidate reads", async () => {
  const f = fixture();
  jest
    .mocked(openPreparationActorInTx)
    .mockRejectedValueOnce(new Error("forbidden"));
  await expect(readPreparationPicker(f.db, actor, query)).rejects.toThrow();
  expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  await expect(
    readPreparationPicker(f.db, actor, { ...query, kind: "profiles" }),
  ).rejects.toThrow();
  expect(f.tx.$queryRaw).not.toHaveBeenCalled();
});
it("rejects crossed person IDs/types, looping cursors and private DTO extensions", () => {
  const base = {
    owner: { userId: actor.userId, familyId: actor.familyId },
    eventId: "event-a",
    kind: "accounts",
    search: "",
    after: null,
    next: null,
    items: [
      {
        kind: "person",
        id: "person-a",
        name: "Fixture person",
        subject: { kind: "profile", memberId: "person-a" },
      },
    ],
  };
  expect(preparationPickerReply.safeParse(base).success).toBe(false);
  expect(
    preparationPickerReply.safeParse({
      ...base,
      kind: "profiles",
      after: "person-a",
      next: "person-a",
    }).success,
  ).toBe(false);
  expect(
    preparationPickerReply.safeParse({
      ...base,
      kind: "profiles",
      items: [{ ...base.items[0], email: "private@example.invalid" }],
    }).success,
  ).toBe(false);
});
