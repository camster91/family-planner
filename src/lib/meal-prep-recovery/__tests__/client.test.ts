/** Authored/unrun. Every nonmatching save reply remains uncertain. */
jest.mock("../../owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
import { requestOwnedJson } from "../../owned-request-http";
import { sendPrepIntent, makePrepIntent, makePrepDraft } from "../client";
import { context, command, entry, receipt, now } from "./fixture";
const reply = (status: number, body: unknown) => ({
  kind: "reply" as const,
  response: { status, ok: status >= 200 && status < 300 } as Response,
  body,
});
afterEach(() => jest.clearAllMocks());
it("never replaces the frozen body/key and only confirms its exact action receipt", async () => {
  const saved = entry();
  jest.mocked(requestOwnedJson).mockResolvedValueOnce(reply(201, receipt()));
  expect((await sendPrepIntent(saved, context())).kind).toBe("confirmed");
  expect(requestOwnedJson).toHaveBeenCalledWith(
    "/api/meals/bulk/recovery/apply",
    expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": saved.key }),
      body: JSON.stringify({ contract: context().contract, entry: saved }),
    }),
    16384,
  );
  for (const value of [
    reply(200, receipt()),
    reply(201, { sessionId: "different-action" }),
    reply(409, { error: { code: "STATE_CHANGED" } }),
    { kind: "unknown" as const },
  ]) {
    jest.mocked(requestOwnedJson).mockResolvedValueOnce(value);
    expect((await sendPrepIntent(saved, context())).kind).toBe("unknown");
  }
});
it("binds newly frozen commands to original context and refuses drafts at send boundaries", async () => {
  const saved = makePrepIntent(
    command().input,
    context(),
    entry().key,
    now.toISOString(),
  );
  expect(saved).toEqual(entry());
  expect(() =>
    makePrepIntent(command().input, {
      ...context(),
      familyId: "foreign-family",
    }),
  ).toThrow();
  const local = makePrepDraft(
    {
      kind: "create",
      day: "",
      nextDay: "",
      dishes: [
        {
          name: "",
          portions: "",
          recipe: null,
          cookId: "",
          storage: "freezer",
          meals: [],
        },
      ],
      step: 0,
      selectedDish: 0,
    },
    context(),
  );
  await expect(sendPrepIntent(local as never, context())).rejects.toThrow();
  expect(requestOwnedJson).not.toHaveBeenCalled();
});
