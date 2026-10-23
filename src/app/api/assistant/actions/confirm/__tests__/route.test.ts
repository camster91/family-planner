/** Authored/unrun: versioned manual-profile delegation, not domain authority evidence. */
jest.mock("next/server", () => ({
  NextResponse: require("@/__tests__/helpers/two-household").nextServerMock
    .NextResponse,
  NextRequest: class {
    headers: Headers;
    url: string;
    method: string;
    private content: string;
    constructor(
      url: URL,
      init: { headers: Headers; method: string; body: string },
    ) {
      this.url = String(url);
      this.headers = init.headers;
      this.method = init.method;
      this.content = init.body;
    }
    async json() {
      return JSON.parse(this.content);
    }
  },
}));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/assistant-source-proof", () => ({
  readAssistantSourceProof: jest.fn(),
  AssistantSourceRefused: class extends Error {
    response() {
      return require("next/server").NextResponse.json(
        { code: "ASSISTANT_SOURCE_REFUSED" },
        { status: 409 },
      );
    }
  },
}));
jest.mock("@/app/api/events/route", () => ({
  POST: jest.fn(),
  DELETE: jest.fn(),
}));
jest.mock("@/app/api/chores/route", () => ({ DELETE: jest.fn() }));
jest.mock("@/app/api/lists/route", () => ({ DELETE: jest.fn() }));
jest.mock("@/app/api/chores/create/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/lists/create/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/notes/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/lists/items/create/route", () => ({ POST: jest.fn() }));
import { NextResponse } from "next/server";
import { POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { readAssistantSourceProof } from "@/lib/assistant-source-proof";
import { POST as createChore } from "@/app/api/chores/create/route";
import { POST as createEvent } from "@/app/api/events/route";
const body = {
  protocol: 2,
  selection: { memberId: "profile-a" },
  title: "Shoes",
  due_date: "2026-10-22",
  frequency: "once",
};
const request = (command: unknown) => ({
  url: "https://synthetic.example.test/api/assistant/actions/confirm",
  headers: new Headers({
    "Idempotency-Key": "synthetic-profile-confirm-key",
    "X-Assistant-Source-Proof": "untrusted-incoming",
    "X-Assistant-Profile-Revision": "99",
  }),
  text: async () => JSON.stringify(command),
});
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([
      {
        user: { id: "parent-a", family_id: "family-a", role: "parent" },
        payload: { tv: 0 },
      },
      null,
    ] as never);
  jest
    .mocked(createChore)
    .mockResolvedValue(NextResponse.json({ choreId: "created-a" }));
});
it("permits only an explicit revision-bound profile chore without a contextual proof, stripping untrusted forwarded metadata", async () => {
  const result = await POST(
    request({ kind: "chore_create", body, profileRevision: 4 }) as never,
  );
  expect(result.status).toBe(200);
  const canonical = jest.mocked(createChore).mock.calls[0][0];
  expect(canonical.method).toBe("POST");
  expect(canonical.url).toBe(
    "https://synthetic.example.test/api/chores/create",
  );
  expect(canonical.headers.get("X-Assistant-Profile-Revision")).toBe("4");
  expect(canonical.headers.get("X-Assistant-Source-Proof")).toBeNull();
  expect(await canonical.json()).toEqual(body);
  expect(readAssistantSourceProof).not.toHaveBeenCalled();
});
it("does not let the manual profile exception bypass proof requirements for account or other domain actions", async () => {
  for (const command of [
    { kind: "chore_create", body },
    {
      kind: "chore_create",
      profileRevision: 4,
      body: { title: "Shoes", assigned_to: "profile-a" },
    },
    { kind: "event_create", profileRevision: 4, body: { protocol: 2 } },
  ])
    expect((await POST(request(command) as never)).status).toBe(409);
  expect(createChore).not.toHaveBeenCalled();
  expect(createEvent).not.toHaveBeenCalled();
});
it("validates a supplied contextual proof even for a profile assignment", async () => {
  await POST(
    request({
      kind: "chore_create",
      body,
      profileRevision: 4,
      sourceProof: "signed-source",
    }) as never,
  );
  expect(readAssistantSourceProof).toHaveBeenCalledWith(
    "signed-source",
    { userId: "parent-a", familyId: "family-a", role: "parent", generation: 0 },
    "chore_create",
  );
  expect(
    jest
      .mocked(createChore)
      .mock.calls[0][0].headers.get("X-Assistant-Source-Proof"),
  ).toBe("signed-source");
});
