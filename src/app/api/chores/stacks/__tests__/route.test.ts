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
jest.mock("@/lib/idempotency", () => ({
  readIdempotencyKey: jest.fn(),
  idempotencyError: jest.fn((code: string) => ({
    status: code === "IDEMPOTENCY_KEY_REQUIRED" ? 400 : 422,
    headers: new Headers(),
    json: async () => ({ error: { code } }),
  })),
}));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/routine-stack-api", () => ({
  readParentRoutineStack: jest.fn(),
  saveParentRoutineStack: jest.fn(),
}));

import { GET, POST } from "../route";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { idempotencyError, readIdempotencyKey } from "@/lib/idempotency";
import {
  readParentRoutineStack,
  saveParentRoutineStack,
} from "@/lib/routine-stack-api";
import { RoutineStackValidationError } from "@/lib/routine-stack-mutation";

const user = {
  id: "parent-a",
  family_id: "family-a",
  role: "parent",
  name: "Parent A",
};
const stack = {
  stack: { id: "stack-a", family_id: "family-a", label: "Morning", version: 2 },
  occurrence_date: "2026-10-11",
  fingerprint: "fingerprint-a",
  steps: [],
  members: [
    {
      id: "parent-a",
      displayName: "Parent A",
      role: "parent",
      subjectState: "eligible",
    },
  ],
  compact: {
    stack_id: "stack-a",
    version: 2,
    fingerprint: "fingerprint-a",
    steps: [],
    members: [],
  },
};

function request(
  url: string,
  body?: unknown,
  idempotencyKey?: string,
  memberProtocol?: 2,
) {
  const headers = new Headers({ "x-request-id": "request-a" });
  if (idempotencyKey !== undefined)
    headers.set("Idempotency-Key", idempotencyKey);
  if (memberProtocol) headers.set("X-Member-Protocol", String(memberProtocol));
  return {
    url,
    headers,
    json: async () => body,
  } as any;
}

async function responseBody(response: { json(): Promise<unknown> }) {
  return response.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([{ user, payload: { tv: 0 } } as any, null]);
  jest
    .mocked(requireParent)
    .mockImplementation((role: string) =>
      role === "parent" ? null : ({ status: 403 } as any),
    );
  jest.mocked(featureGate).mockResolvedValue(null);
  jest
    .mocked(readIdempotencyKey)
    .mockReturnValue({ key: "key-a", error: null });
  jest.mocked(readParentRoutineStack).mockResolvedValue(stack as any);
  jest.mocked(saveParentRoutineStack).mockResolvedValue({
    status: 200,
    body: { ok: true, stack_id: "stack-a", replayed: false },
  });
});

describe("/api/chores/stacks authorization and scope", () => {
  it("reads a parent occurrence with the authenticated family and date", async () => {
    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-a&occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(200);
    expect(readParentRoutineStack).toHaveBeenCalledWith(
      expect.anything(),
      { familyId: "family-a", userId: "parent-a", role: "parent" },
      "stack-a",
      "2026-10-11",
    );
    expect(await responseBody(response as any)).toEqual(stack);
  });

  it("does not expose a child or teen editor", async () => {
    jest
      .mocked(authenticateWithFamily)
      .mockResolvedValueOnce([
        { user: { ...user, role: "child" } } as any,
        null,
      ]);
    jest.mocked(requireParent).mockReturnValueOnce({ status: 403 } as any);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-a&occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(403);
    expect(readParentRoutineStack).not.toHaveBeenCalled();
  });

  it("stops paired-device refusal before family or routine reads", async () => {
    const refusal = { status: 403, json: async () => ({ error: "paired" }) };
    jest
      .mocked(authenticateWithFamily)
      .mockResolvedValueOnce([null, refusal as any]);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-a&occurrence_date=2026-10-11",
      ),
    );

    expect(response).toBe(refusal);
    expect(readParentRoutineStack).not.toHaveBeenCalled();
    expect(featureGate).not.toHaveBeenCalled();
  });

  it("returns a generic not-found response for a stack absent from the authenticated family", async () => {
    jest.mocked(readParentRoutineStack).mockResolvedValueOnce(null);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-from-b&occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(404);
    expect(await responseBody(response as any)).toMatchObject({
      error: { code: "ROUTINE_STACK_NOT_FOUND" },
    });
    expect(readParentRoutineStack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ familyId: "family-a" }),
      "stack-from-b",
      "2026-10-11",
    );
  });

  it("keeps a second household parent scoped to that household", async () => {
    const otherUser = { ...user, id: "parent-b", family_id: "family-b" };
    jest
      .mocked(authenticateWithFamily)
      .mockResolvedValueOnce([{ user: otherUser } as any, null]);
    jest.mocked(readParentRoutineStack).mockResolvedValueOnce(null);

    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-a&occurrence_date=2026-10-11",
      ),
    );

    expect(response.status).toBe(404);
    expect(readParentRoutineStack).toHaveBeenCalledWith(
      expect.anything(),
      { familyId: "family-b", userId: "parent-b", role: "parent" },
      "stack-a",
      "2026-10-11",
    );
  });

  it("rejects invalid query dates before reading storage", async () => {
    const response = await GET(
      request(
        "https://family.test/api/chores/stacks?stack_id=stack-a&occurrence_date=2026-02-30",
      ),
    );

    expect(response.status).toBe(400);
    expect(readParentRoutineStack).not.toHaveBeenCalled();
  });
});

describe("POST /api/chores/stacks", () => {
  const draft = {
    scope: "occurrence",
    family_id: "family-a",
    stack_id: "stack-a",
    occurrence_date: "2026-10-11",
    label: "Morning",
    steps: [],
    remove_chore_ids: [],
    expected_fingerprint: "fingerprint-a",
  };

  it("requires a keyed parent mutation", async () => {
    jest.mocked(readIdempotencyKey).mockReturnValueOnce({
      key: null,
      error: null,
    });

    const response = await POST(
      request("https://family.test/api/chores/stacks", draft),
    );

    expect(response.status).toBe(400);
    expect(idempotencyError).toHaveBeenCalledWith("IDEMPOTENCY_KEY_REQUIRED");
    expect(saveParentRoutineStack).not.toHaveBeenCalled();
  });

  it("passes the family-scoped actor and body to the atomic coordinator", async () => {
    const response = await POST(
      request("https://family.test/api/chores/stacks", draft, "key-a"),
    );

    expect(response.status).toBe(200);
    expect(saveParentRoutineStack).toHaveBeenCalledWith(
      expect.anything(),
      draft,
      { familyId: "family-a", userId: "parent-a", role: "parent", tokenVersion: 0 },
      "key-a",
    );
    expect(await responseBody(response as any)).toEqual({
      ok: true,
      stack_id: "stack-a",
      replayed: false,
    });
  });

  it("forwards protocol 2 for a profile-capable write", async () => {
    const response = await POST(
      request("https://family.test/api/chores/stacks", draft, "key-a", 2),
    );

    expect(response.status).toBe(200);
    expect(saveParentRoutineStack).toHaveBeenCalledWith(
      expect.anything(),
      draft,
      {
        familyId: "family-a",
        userId: "parent-a",
        role: "parent",
        memberProtocol: 2,
        tokenVersion: 0,
      },
      "key-a",
    );
  });

  it("preserves coordinator conflict status and retry semantics", async () => {
    jest.mocked(saveParentRoutineStack).mockResolvedValueOnce({
      status: 409,
      body: { error: { code: "ROUTINE_STACK_CONFLICT", retryable: true } },
    });

    const response = await POST(
      request("https://family.test/api/chores/stacks", draft, "key-a"),
    );

    expect(response.status).toBe(409);
    expect(await responseBody(response as any)).toEqual({
      error: { code: "ROUTINE_STACK_CONFLICT", retryable: true },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects future-series scope without opening a mutation", async () => {
    jest
      .mocked(saveParentRoutineStack)
      .mockRejectedValueOnce(
        new RoutineStackValidationError(
          "ROUTINE_STACK_FUTURE_UNSUPPORTED",
          "Future-series routine editing is not available yet.",
        ),
      );

    const response = await POST(
      request(
        "https://family.test/api/chores/stacks",
        { ...draft, scope: "future-series" },
        "key-a",
      ),
    );

    expect(response.status).toBe(400);
    expect(await responseBody(response as any)).toMatchObject({
      error: { code: "ROUTINE_STACK_FUTURE_UNSUPPORTED" },
    });
  });

  it("enforces the chores feature gate before reading or mutating", async () => {
    const disabled = { status: 403, json: async () => ({ error: "disabled" }) };
    jest.mocked(featureGate).mockResolvedValueOnce(disabled as any);

    const response = await POST(
      request("https://family.test/api/chores/stacks", draft, "key-a"),
    );

    expect(response).toBe(disabled);
    expect(readIdempotencyKey).not.toHaveBeenCalled();
    expect(saveParentRoutineStack).not.toHaveBeenCalled();
  });
});

// Authored UNRUN: generation comes from authentication, never body fields.
it('carries a nonzero original session generation to routine persistence', async () => {
  jest.mocked(authenticateWithFamily).mockResolvedValueOnce([{ user, payload: { tv: 7 } } as any, null]);
  await POST(request('https://family.test/api/chores/stacks', draft, 'key-a'));
  expect(saveParentRoutineStack).toHaveBeenCalledWith(expect.anything(), draft,
    expect.objectContaining({ tokenVersion: 7, userId: 'parent-a', familyId: 'family-a' }), 'key-a');
});
