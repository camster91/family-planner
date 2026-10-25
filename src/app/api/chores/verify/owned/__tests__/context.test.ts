// Authored UNRUN: explicit same-owner context and late authority withdrawal.
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/chore-check-owner", () => ({ renewChoreCheckOwner: jest.fn() }));
jest.mock("@/lib/chore-check-command", () => ({ ...jest.requireActual("@/lib/chore-check-command"), choreCheckCommandsEnabled: () => true }));
jest.mock("@/lib/chore-detail-read", () => ({ readCanonicalChoreDetail: jest.fn() }));
import { GET } from "../route";
import { db, req, FAMILY_A, nextServerMock } from "@/__tests__/helpers/two-household";
import { renewChoreCheckOwner } from "@/lib/chore-check-owner";
import { readCanonicalChoreDetail } from "@/lib/chore-detail-read";
import { CHORE_CHECK_OWNER_HEADER } from "@/lib/chore-check-command-shared";
const renew = jest.mocked(renewChoreCheckOwner); const read = jest.mocked(readCanonicalChoreDetail);
const owner = { userId: "parent-a", familyId: FAMILY_A, role: "parent", generation: 0 };
const request = () => req({ as: "parentA", query: { choreId: "chore-a" }, headers: { [CHORE_CHECK_OWNER_HEADER]: JSON.stringify(owner) } });
beforeEach(() => { db.reset(); renew.mockReset().mockResolvedValue(true); read.mockReset().mockResolvedValue(nextServerMock.NextResponse.json({ chore: { id: "chore-a", family_id: FAMILY_A, title: "Private fixture", status: "completed", responsibility_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", responsibility_epoch: 2, preparation_epoch: 7 } })); });
it("returns matching owner and original canonical version with a private response", async () => {
  const result = await GET(request()); expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ owner, version: { materialEpoch: 2, completionEpoch: 7 } });
  expect(result.headers.get("Cache-Control")).toBe("private, no-store"); expect(renew).toHaveBeenCalledTimes(2);
});
it("withholds the already-read private chore when authority changes during its read", async () => {
  renew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await GET(request()); expect(result.status).toBe(409);
  expect(JSON.stringify(await result.json())).not.toContain("Private fixture");
});
