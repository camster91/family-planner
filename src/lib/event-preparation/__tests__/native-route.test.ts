jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/prisma", () => ({ prisma: null }));
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/cloudflare/database", () => ({
  getD1Database: jest.fn(async () => ({})),
}));
jest.mock("@/lib/cloudflare/chore-read-policy", () => ({
  d1EventPreparationStorageAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/cloudflare/preparation-source", () => ({
  authorizeD1PreparationActor: jest.fn(async () => ({ domainsEnabled: true })),
  validatedD1PreparationRead: jest.fn((fn) => fn({})),
  readD1PreparationSource: jest.fn(),
}));
jest.mock("@/lib/cloudflare/preparation-write", () => ({
  writeD1EventPreparation: jest.fn(),
}));
jest.mock("@/lib/cloudflare/preparation-picker", () => ({
  readD1PreparationPicker: jest.fn(),
}));
jest.mock("@/lib/cloudflare/preparation-recovery", () => ({
  reviewD1PreparationRequest: jest.fn(),
}));
jest.mock("../owner", () => ({
  eventPreparationReady: jest.fn(() => true),
  eventPreparationWritingEnabled: jest.fn(() => true),
  eventPreparationOwner: jest.fn(),
}));
import { handlePreparationHttp } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  authorizeD1PreparationActor,
  readD1PreparationSource,
} from "@/lib/cloudflare/preparation-source";
import { writeD1EventPreparation } from "@/lib/cloudflare/preparation-write";
import { readD1PreparationPicker } from "@/lib/cloudflare/preparation-picker";
import { reviewD1PreparationRequest } from "@/lib/cloudflare/preparation-recovery";
import { eventPreparationOwner, eventPreparationReady } from "../owner";
import { preparationRecoveryFixture } from "./recovery-fixture";
import { PREPARATION_OWNER_HEADER, PREPARATION_RECOVERY } from "../recovery";
import { EventPreparationError } from "../contract";
import { actor, now } from "./test-fixture";
const request = (
  body: unknown = {},
  query = "",
  headers: Record<string, string> = {},
) =>
  ({
    headers: new Headers(headers),
    nextUrl: new URL("https://fixture.test/api?" + query),
    text: async () => JSON.stringify(body),
  }) as never;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(now);
  const fixture = preparationRecoveryFixture();
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([
      {
        user: { id: actor.userId, family_id: actor.familyId, role: "parent" },
        payload: { tv: actor.tokenVersion },
      },
      null,
    ] as never);
  jest
    .mocked(authorizeD1PreparationActor)
    .mockResolvedValue({ domainsEnabled: true } as never);
  jest.mocked(eventPreparationOwner).mockReturnValue(fixture.recovery.owner);
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(readD1PreparationSource).mockResolvedValue(fixture.prepared);
  jest
    .mocked(writeD1EventPreparation)
    .mockResolvedValue({ status: 200, body: fixture.receipt, replayed: false });
});
afterEach(() => jest.useRealTimers());
it("admits native context without a PostgreSQL connection and binds fresh actor generation", async () => {
  const response = await handlePreparationHttp(request(), "context");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    enabled: true,
    role: "parent",
    userId: actor.userId,
  });
  expect(authorizeD1PreparationActor).toHaveBeenCalledWith({}, actor);
});
it("routes native previews through the canonical view and planner", async () => {
  const fixture = preparationRecoveryFixture();
  const response = await handlePreparationHttp(
    request({ kind: "preview", command: fixture.command }),
    "preview",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(fixture.preview);
  expect(readD1PreparationSource).toHaveBeenCalled();
});
it("requires the current owner header before native writes", async () => {
  const fixture = preparationRecoveryFixture();
  let response = await handlePreparationHttp(
    request(fixture.command, "", { "Idempotency-Key": fixture.entry.key }),
    "write",
  );
  expect(response.status).toBe(403);
  expect(writeD1EventPreparation).not.toHaveBeenCalled();
  response = await handlePreparationHttp(
    request(fixture.command, "", {
      "Idempotency-Key": fixture.entry.key,
      [PREPARATION_OWNER_HEADER]: fixture.recovery.owner!.scope,
    }),
    "write",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(fixture.receipt);
  expect(writeD1EventPreparation).toHaveBeenCalledWith(
    actor,
    fixture.command,
    fixture.entry.key,
  );
});
it("allows owned saved-request inspection while the feature is paused", async () => {
  const fixture = preparationRecoveryFixture();
  jest.mocked(eventPreparationReady).mockReturnValue(false);
  jest
    .mocked(reviewD1PreparationRequest)
    .mockResolvedValue({ state: "committed" } as never);
  const response = await handlePreparationHttp(
    request({ contract: PREPARATION_RECOVERY, entry: fixture.entry }, "", {
      [PREPARATION_OWNER_HEADER]: fixture.recovery.owner!.scope,
    }),
    "inspect",
  );
  expect(response.status).toBe(200);
  expect(reviewD1PreparationRequest).toHaveBeenCalledWith(
    actor,
    fixture.entry,
    fixture.recovery.owner!.scope,
  );
});
it("routes picker queries and refuses stale actor authority before private reads", async () => {
  jest
    .mocked(readD1PreparationPicker)
    .mockResolvedValue({ items: [] } as never);
  let response = await handlePreparationHttp(
    request({}, "eventId=event-a&timeZone=UTC&memberProtocol=2&kind=tasks"),
    "picker",
  );
  expect(response.status).toBe(200);
  jest.mocked(readD1PreparationPicker).mockClear();
  jest
    .mocked(authorizeD1PreparationActor)
    .mockRejectedValue(new EventPreparationError("UNAUTHORIZED"));
  response = await handlePreparationHttp(
    request({}, "eventId=event-a&timeZone=UTC&memberProtocol=2&kind=tasks"),
    "picker",
  );
  expect(response.status).toBe(401);
  expect(readD1PreparationPicker).not.toHaveBeenCalled();
});
