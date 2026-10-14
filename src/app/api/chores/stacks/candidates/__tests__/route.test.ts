jest.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: jest.fn(),
  requireParent: jest.fn((role: string) =>
    role === "parent"
      ? null
      : {
          status: 403,
          headers: new Headers(),
          json: async () => ({ error: "Only parents can perform this action" }),
        },
  ),
}));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/routine-stack-api", () => ({
  readParentRoutineStackCandidates: jest.fn(),
}));

import { GET } from "../route";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { readParentRoutineStackCandidates } from "@/lib/routine-stack-api";

const user = {
  id: "parent-a",
  family_id: "family-a",
  role: "parent",
};
const candidates = {
  occurrence_date: "2026-10-11",
  candidates: [],
  assignmentOptions: [
    { accountId: "parent-a", name: "Parent A", role: "parent" },
  ],
  hasMore: false,
  nextCursor: null,
};

function request(url: string, memberProtocol?: 2) {
  const headers = new Headers({ "x-request-id": "request-a" });
  if (memberProtocol) headers.set("X-Member-Protocol", String(memberProtocol));
  return {
    url,
    headers,
  } as any;
}

async function responseBody(response: { json(): Promise<unknown> }) {
  return response.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([{ user } as any, null]);
  jest
    .mocked(requireParent)
    .mockImplementation((role: string) =>
      role === "parent" ? null : ({ status: 403 } as any),
    );
  jest.mocked(featureGate).mockResolvedValue(null);
  jest.mocked(readParentRoutineStackCandidates).mockResolvedValue(candidates);
});

describe("GET /api/chores/stacks/candidates", () => {
  it("reads the strict occurrence catalog with default bounded paging", async () => {
    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(200);
    expect(featureGate).toHaveBeenCalledWith("family-a", "chores");
    expect(readParentRoutineStackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      "2026-10-11",
      { limit: 200, cursor: null },
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await responseBody(response as any)).toEqual(candidates);
  });

  it("passes an explicit limit and opaque cursor without changing the date scope", async () => {
    const cursor = Buffer.from("2026-10-11T00:00:00.000Z|chore-a").toString(
      "base64url",
    );
    const response = await GET(
      request(
        `https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11&limit=20&cursor=${cursor}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(readParentRoutineStackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2026-10-11",
      {
        limit: 20,
        cursor: {
          dueDate: new Date("2026-10-11T00:00:00.000Z"),
          id: "chore-a",
        },
      },
    );
  });

  it("forwards an explicit protocol-2 request without changing the legacy default", async () => {
    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11",
        2,
      ),
    );

    expect(response.status).toBe(200);
    expect(readParentRoutineStackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      {
        familyId: "family-a",
        userId: "parent-a",
        role: "parent",
        memberProtocol: 2,
      },
      "2026-10-11",
      { limit: 200, cursor: null },
    );
  });

  it.each(["", "2026-02-30", "2026-10-11T00:00:00.000Z"])(
    "rejects non-date occurrence_date %s before storage",
    async (date) => {
      const response = await GET(
        request(
          `https://family.test/api/chores/stacks/candidates?occurrence_date=${encodeURIComponent(date)}`,
        ),
      );

      expect(response.status).toBe(400);
      expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "201", "abc", "1.5"])(
    "rejects invalid candidate limit %s",
    async (limit) => {
      const response = await GET(
        request(
          `https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11&limit=${limit}`,
        ),
      );

      expect(response.status).toBe(400);
      expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed cursors before reading storage", async () => {
    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11&cursor=bad",
      ),
    );

    expect(response.status).toBe(400);
    expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
  });

  it("does not expose the catalog to child or teen sessions", async () => {
    jest
      .mocked(authenticateWithFamily)
      .mockResolvedValueOnce([
        { user: { ...user, role: "child" } } as any,
        null,
      ]);
    jest.mocked(requireParent).mockReturnValueOnce({ status: 403 } as any);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(403);
    expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
  });

  it("stops paired-device refusal before feature or catalog reads", async () => {
    const refusal = { status: 403, json: async () => ({ error: "paired" }) };
    jest
      .mocked(authenticateWithFamily)
      .mockResolvedValueOnce([null, refusal as any]);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11",
      ),
    );

    expect(response).toBe(refusal);
    expect(featureGate).not.toHaveBeenCalled();
    expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
  });

  it("stops a disabled chores feature before the catalog read", async () => {
    const disabled = { status: 403, json: async () => ({ error: "disabled" }) };
    jest.mocked(featureGate).mockResolvedValueOnce(disabled as any);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks/candidates?occurrence_date=2026-10-11",
      ),
    );

    expect(response).toBe(disabled);
    expect(readParentRoutineStackCandidates).not.toHaveBeenCalled();
  });
});
