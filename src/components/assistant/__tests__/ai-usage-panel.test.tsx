/** @jest-environment jsdom */
/** Authored/unrun. Identity/unknown-save cases, not rendered-device acceptance. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiUsagePanel } from "../AiUsagePanel";
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  defaultAiUsagePolicy,
  type AiUsageReport,
} from "@/lib/ai-usage-contract";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const identity = { userId: "parent-a", familyId: "family-a" };
const report: AiUsageReport = {
  owner: { ...identity, generation: 3 },
  ready: true,
  providerPaused: false,
  providerLabel: null,
  suggestionFeedback: null,
  revision: 1,
  configVersion: null,
  policy: defaultAiUsagePolicy,
  pricingCurrent: false,
  days: [],
  month: "2026-10",
  today: "2026-10-22",
};
const reply = (body: unknown) => ({
  kind: "reply" as const,
  response: { ok: true, status: 200 } as Response,
  body,
});
beforeEach(() => {
  jest.resetAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
it("blocks unknown settings replay until an explicit fresh read", async () => {
  jest
    .mocked(requestOwnedJson)
    .mockResolvedValueOnce(reply(report))
    .mockResolvedValueOnce({ kind: "unknown" });
  render(<AiUsagePanel identity={identity} />);
  const save = await screen.findByRole("button", { name: "Save AI limits" });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(save).toBeDisabled());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not confirm usage or settings",
  );
  expect(requestOwnedJson).toHaveBeenCalledTimes(2);
  const body = JSON.parse(
    jest.mocked(requestOwnedJson).mock.calls[1][1].body as string,
  );
  expect(body.owner).toEqual(report.owner);
  expect(body.expectedRevision).toBe(1);
});
it("does not adopt replacement account/generation data after backgrounding", async () => {
  jest
    .mocked(requestOwnedJson)
    .mockResolvedValueOnce(reply(report))
    .mockResolvedValueOnce(
      reply({ ...report, owner: { ...report.owner, generation: 4 } }),
    );
  render(<AiUsagePanel identity={identity} />);
  await screen.findByRole("button", { name: "Save AI limits" });
  fireEvent(window, new Event("blur"));
  expect(screen.queryByRole("button", { name: "Save AI limits" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh usage and limits" }),
  );
  await screen.findByText("Your session changed. Reload Settings.");
  expect(screen.queryByRole("button", { name: "Save AI limits" })).toBeNull();
});
