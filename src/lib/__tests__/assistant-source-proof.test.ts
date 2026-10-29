/** Authored/unrun. Mocked row locks are not PostgreSQL isolation evidence. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("../auth", () => ({
  getJwtSecret: () => "fabricated-source-proof-key",
}));
jest.mock("../assistant-today-capability", () => ({
  isAssistantTodayEnabled: () => true,
}));
jest.mock("../assistant-references", () => ({
  ...jest.requireActual("../assistant-references"),
  isAssistantReferencesEnabled: () => true,
  loadReferencedAssistantToday: jest.fn(),
}));
import {
  issueAssistantSourceProof,
  readAssistantSourceProof,
  assistantSourceGuard,
  AssistantSourceRefused,
  assistantSourceLeaseEnd,
} from "../assistant-source-proof";
import { loadReferencedAssistantToday } from "../assistant-references";
import { defaultFeatures } from "../features";
import type { AssistantTodayTransportContext } from "../assistant-context-schema";
const owner = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 3,
};
const context: AssistantTodayTransportContext = {
  protocol: "herewoven.assistant-today.v1",
  generatedAt: "2026-10-22T12:00:00.000Z",
  expiresAt: "2026-10-22T12:01:00.000Z",
  viewer: { role: "parent", localDate: "2026-10-22", timeZone: "UTC" },
  today: {
    events: [],
    chores: [],
    dinner: null,
    groceries: [],
    useSoon: [],
    weather: null,
    unavailable: ["weather"],
  },
};
const features = defaultFeatures();
const token = () =>
  issueAssistantSourceProof(owner, "event_create", context, [], features);
const request = (value: string) => ({
  headers: new Headers({ "X-Assistant-Source-Proof": value }),
});
const previous = process.env.FAMILY_ASSISTANT_CONFIRMATION_READY;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "1";
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-22T12:00:20Z"));
});
afterEach(() => {
  jest.restoreAllMocks();
  if (previous === undefined)
    delete process.env.FAMILY_ASSISTANT_CONFIRMATION_READY;
  else process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = previous;
});
it("binds the signed source basis to identity, household, generation, role and operation", () => {
  const value = token();
  expect(readAssistantSourceProof(value, owner, "event_create").kind).toBe(
    "event_create",
  );
  for (const changed of [
    { ...owner, userId: "other" },
    { ...owner, familyId: "foreign" },
    { ...owner, generation: 4 },
    { ...owner, role: "teen" },
  ])
    expect(() =>
      readAssistantSourceProof(value, changed, "event_create"),
    ).toThrow(AssistantSourceRefused);
  expect(() =>
    readAssistantSourceProof(value, owner, "chore_create"),
  ).toThrow();
  expect(() =>
    readAssistantSourceProof(
      value.slice(0, -1) + (value.endsWith("a") ? "b" : "a"),
      owner,
      "event_create",
    ),
  ).toThrow();
  expect(
    JSON.stringify(readAssistantSourceProof(value, owner, "event_create")),
  ).not.toMatch(/apiKey|reply|href|title/);
});
it("keeps decoding distinct from new-effect expiry so canonical completed receipts can replay", async () => {
  const value = token();
  jest.mocked(Date.now).mockReturnValue(Date.parse("2026-10-22T12:01:00Z"));
  expect(readAssistantSourceProof(value, owner, "event_create")).toBeDefined();
  const guard = assistantSourceGuard(request(value), owner, "event_create")!;
  await expect(guard.verify({} as never)).rejects.toBeInstanceOf(
    AssistantSourceRefused,
  );
  expect(loadReferencedAssistantToday).not.toHaveBeenCalled();
});
it("rereads the protected source basis without materializing recurring tasks and rejects changed features or catalogs", async () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        role: "parent",
        family_id: owner.familyId,
        token_version: 3,
      }),
    },
    family: { findUnique: jest.fn().mockResolvedValue({ features }) },
  };
  const snapshot = { context, catalog: [], sources: [] };
  jest.mocked(loadReferencedAssistantToday).mockResolvedValue(snapshot);
  const guard = assistantSourceGuard(request(token()), owner, "event_create")!;
  await guard.authorize(tx as never);
  await guard.verify(tx as never);
  expect(loadReferencedAssistantToday).toHaveBeenCalledTimes(2);
  expect(loadReferencedAssistantToday).toHaveBeenLastCalledWith(
    tx,
    expect.objectContaining({
      materializeSeries: false,
      userId: owner.userId,
      familyId: owner.familyId,
    }),
  );
  tx.family.findUnique.mockResolvedValue({
    features: { ...features, calendar: false },
  });
  await expect(guard.verify(tx as never)).rejects.toBeInstanceOf(
    AssistantSourceRefused,
  );
  tx.family.findUnique.mockResolvedValue({ features });
  jest
    .mocked(loadReferencedAssistantToday)
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({
      ...snapshot,
      context: {
        ...context,
        today: {
          ...context.today,
          groceries: [{ item: "Changed", quantity: 1, list: "Groceries" }],
        },
      },
    });
  await expect(guard.verify(tx as never)).rejects.toBeInstanceOf(
    AssistantSourceRefused,
  );
});

it("bounds native batch admission at the first expired millisecond or local midnight", () => {
  const regular = readAssistantSourceProof(token(), owner, "event_create");
  expect(assistantSourceLeaseEnd(regular)).toBe(Date.parse(context.expiresAt));
  const midnightContext = {
    ...context,
    generatedAt: "2026-10-23T03:59:40.000Z",
    expiresAt: "2026-10-23T04:00:40.000Z",
    viewer: { role: "parent" as const, localDate: "2026-10-22", timeZone: "America/Toronto" },
  };
  const midnight = readAssistantSourceProof(
    issueAssistantSourceProof(owner, "event_create", midnightContext, [], features), owner, "event_create",
  );
  expect(assistantSourceLeaseEnd(midnight)).toBe(Date.parse("2026-10-23T04:00:00Z"));
  expect(() => assistantSourceLeaseEnd({ ...midnight, localDate: "2026-10-21" })).toThrow(AssistantSourceRefused);
});
