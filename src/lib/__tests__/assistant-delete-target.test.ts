/** Authored/unrun. Row-lock mocks do not establish PostgreSQL isolation. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("../auth", () => ({
  getJwtSecret: () => "fabricated-delete-target-key",
}));
jest.mock("../assistant-source-proof", () => ({
  ...jest.requireActual("../assistant-source-proof"),
  isAssistantConfirmationEnabled: () => true,
}));
import {
  issueDeleteTargetProof,
  readDeleteTargetProof,
  assistantDeleteTargetGuard,
} from "../assistant-delete-target";
import { AssistantSourceRefused } from "../assistant-source-proof";
const owner = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 0,
};
const target = {
  row: { id: "list-a", family_id: "family-a", name: "Private fixture label" },
  children: [[{ id: "item-a", content: "Private fixture content" }], []],
};
const at = Date.parse("2026-10-22T12:00:00Z");
it("binds the exact canonical target, action and original actor without placing content in the token", () => {
  const token = issueDeleteTargetProof(
    owner,
    "list_delete",
    "list-a",
    target,
    at,
  );
  expect(readDeleteTargetProof(token, owner, "list_delete", "list-a").id).toBe(
    "list-a",
  );
  for (const changed of [
    { ...owner, familyId: "family-b" },
    { ...owner, userId: "other" },
    { ...owner, role: "teen" },
    { ...owner, generation: 1 },
  ])
    expect(() =>
      readDeleteTargetProof(token, changed, "list_delete", "list-a"),
    ).toThrow(AssistantSourceRefused);
  expect(() =>
    readDeleteTargetProof(token, owner, "list_delete", "other"),
  ).toThrow();
  expect(() =>
    readDeleteTargetProof(token, owner, "event_delete", "list-a"),
  ).toThrow();
  expect(() =>
    readDeleteTargetProof(
      token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
      owner,
      "list_delete",
      "list-a",
    ),
  ).toThrow();
  const decoded = Buffer.from(token.split(".")[1], "base64url").toString(
    "utf8",
  );
  expect(decoded).not.toMatch(/Private fixture|item-a|content|name/);
});
it("refuses an expired new effect while preserving receipt decoding, and detects dependent item changes", async () => {
  const token = issueDeleteTargetProof(
    owner,
    "list_delete",
    "list-a",
    target,
    at,
  );
  const guard = assistantDeleteTargetGuard(
    { headers: new Headers({ "X-Assistant-Target-Proof": token }) },
    owner,
    "list_delete",
    "list-a",
    true,
  )!;
  const spy = jest.spyOn(Date, "now").mockReturnValue(at + 10000);
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ row: target.row }])
      .mockResolvedValueOnce([{ row: target.children[0][0] }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]),
  };
  try {
    await expect(guard.verify(tx as never)).resolves.toBeUndefined();
    tx.$queryRaw
      .mockResolvedValueOnce([{ row: target.row }])
      .mockResolvedValueOnce([
        { row: { ...target.children[0][0], content: "Changed" } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(guard.verify(tx as never)).rejects.toBeInstanceOf(
      AssistantSourceRefused,
    );
    spy.mockReturnValue(at + 60000);
    expect(
      readDeleteTargetProof(token, owner, "list_delete", "list-a"),
    ).toBeDefined();
    tx.$queryRaw.mockClear();
    await expect(guard.verify(tx as never)).rejects.toBeInstanceOf(
      AssistantSourceRefused,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
