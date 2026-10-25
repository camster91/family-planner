/** Authored source only: mounted exact-request recovery, not persistent queue proof. */
import { makeNoteCreateIntent, postNoteCreate, noteCreateContext } from "../note-create-client";
const context = { userId: "account-a", familyId: "family-a" };
const key = "note-create-fixture-key-0001";
const draft = { title: " Fixture ", body: " Body ", color: "yellow" };
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
afterEach(() => jest.useRealTimers());
it("binds exact normalized request bytes and owner for every retry", async () => {
  const intent = makeNoteCreateIntent(draft, context, key);
  global.fetch = jest.fn().mockRejectedValueOnce(new Error("fixture lost reply"))
    .mockResolvedValueOnce(reply(201, { note: { id: "note-a", family_id: context.familyId, created_by: context.userId } }));
  expect(await postNoteCreate(intent)).toEqual({ kind: "unknown" });
  expect(await postNoteCreate(intent)).toEqual({ kind: "confirmed", noteId: "note-a" });
  const calls = jest.mocked(fetch).mock.calls;
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(new Headers(calls[0][1]?.headers).get("Idempotency-Key")).toBe(key);
  expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe(key);
  expect(JSON.parse(intent.body)).toEqual({ title: "Fixture", body: "Body", color: "yellow", expected_user_id: "account-a", expected_family_id: "family-a" });
});
it.each([
  reply(200, { success: true }),
  reply(201, { note: { id: "note-a", family_id: "family-b", created_by: "account-a" } }),
  reply(500, { error: "fixture failure" }),
  reply(409, { error: { code: "IDEMPOTENCY_IN_PROGRESS" } }),
])("never confirms malformed/foreign or uncertain replies", async response => {
  global.fetch = jest.fn(async () => response);
  expect(await postNoteCreate(makeNoteCreateIntent(draft, context, key))).toEqual({ kind: "unknown" });
});
it("holds a request outside its safe retry window without sending", async () => {
  const intent = makeNoteCreateIntent(draft, context, key);
  intent.issuedAt -= 2 * 24 * 60 * 60 * 1000;
  global.fetch = jest.fn();
  expect(await postNoteCreate(intent)).toEqual({ kind: "refused", code: "NOTE_RECOVERY_EXPIRED" });
  expect(fetch).not.toHaveBeenCalled();
});
it("settles an ignored-abort write wait without confirming failure or success", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
  const pending = postNoteCreate(makeNoteCreateIntent(draft, context, key));
  await jest.advanceTimersByTimeAsync(15_000);
  expect(await pending).toEqual({ kind: "unknown" });
});
it("requires real owner context and valid bounded drafts", () => {
  expect(noteCreateContext({ familyId: "family-a" })).toBeNull();
  expect(() => makeNoteCreateIntent({ ...draft, body: "x".repeat(10001) }, context, key)).toThrow();
});

it.each(["present", "removed"])("settles a %s receipt without issuing another create", async state => {
  const intent = makeNoteCreateIntent(draft, context, key);
  global.fetch = jest.fn(async () => reply(200, { state, noteId: "note-a" }));
  expect(await postNoteCreate(intent, { recovery: true })).toEqual({ kind: state === "present" ? "confirmed" : "removed", noteId: "note-a" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.mocked(fetch).mock.calls[0][0]).toBe("/api/notes/create/receipt");
});
it("uses the same create bytes/key only after an unissued receipt", async () => {
  const intent = makeNoteCreateIntent(draft, context, key);
  global.fetch = jest.fn().mockResolvedValueOnce(reply(200, { state: "unissued" }))
    .mockResolvedValueOnce(reply(201, { note: { id: "note-a", family_id: context.familyId, created_by: context.userId } }));
  expect(await postNoteCreate(intent, { recovery: true })).toEqual({ kind: "confirmed", noteId: "note-a" });
  const calls = jest.mocked(fetch).mock.calls;
  expect(calls.map(call => call[0])).toEqual(["/api/notes/create/receipt", "/api/notes"]);
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(new Headers(calls[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(calls[1][1]?.headers).get("Idempotency-Key"));
});
it.each(["pending", "expired", "unavailable", "unknown-mode"])("never recreates from %s inspection", async state => {
  global.fetch = jest.fn(async () => reply(200, { state }));
  expect(await postNoteCreate(makeNoteCreateIntent(draft, context, key), { recovery: true })).toEqual({ kind: "unknown" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
