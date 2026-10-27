/** @jest-environment jsdom */
// These assertions exercise the rendered owned-review recovery surface. They
// keep the command client mocked so the tests do not grant or bypass any
// profile/owner authorization.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OwnedChoreReview } from "../OwnedChoreReview";
import { choreVerificationEnglish } from "@/i18n/chore-verification";
import { readOwnedChoreCheck, sendOwnedChoreCheck } from "@/lib/chore-check-command-client";
jest.mock("@/i18n/chore-verification", () => {
  const actual = jest.requireActual("@/i18n/chore-verification");
  return { ...actual, useChoreVerificationText: () => (key: string) => actual.choreVerificationEnglish[key] };
});
jest.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, footer }: any) => <div>{children}{footer}</div> }));
jest.mock("@/components/layout/pending-form-navigation", () => ({ usePendingFormNavigationController: () => ({ releaseBeforeNavigation: async () => true }) }));
jest.mock("@/components/layout/owned-draft-navigation", () => ({ useOwnedDraftExit: jest.fn() }));
jest.mock("@/lib/chore-check-command-client", () => ({ ...jest.requireActual("@/lib/chore-check-command-client"), readOwnedChoreCheck: jest.fn(), sendOwnedChoreCheck: jest.fn() }));
const read = jest.mocked(readOwnedChoreCheck); const send = jest.mocked(sendOwnedChoreCheck);
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent" as const, generation: 2 };
const version = { generation: "5b58743a-1f01-40fe-adb1-4628148495cb", materialEpoch: 2, completionEpoch: 7 };
const chore = { id: "fixture-chore", family_id: owner.familyId, title: "Private chore fixture", status: "completed" };
const props = { owner, choreId: chore.id, initialDecision: "reject" as const, onSaved: jest.fn(), onClose: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); read.mockResolvedValue({ kind: "current", chore, version }); send.mockResolvedValue({ kind: "unknown" }); });
async function submitOriginal() {
  await screen.findByText(chore.title);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Original note" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Send back" }).at(-1)!);
  await screen.findByText(choreVerificationEnglish.reviewUnknown);
}
it("freezes the first request and notes across an uncertain retry", async () => {
  render(<OwnedChoreReview {...props} />); await submitOriginal();
  expect(screen.getByRole("textbox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry original request" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][0]).toBe(send.mock.calls[0][0]);
  expect(JSON.parse(send.mock.calls[1][0].body)).toMatchObject({ expected: version, verificationNotes: "Original note" });
});
it("requires explicit adoption of a different completion before a new request", async () => {
  render(<OwnedChoreReview {...props} />); await submitOriginal();
  read.mockResolvedValue({ kind: "current", chore: { ...chore, title: "Changed fixture" }, version: { ...version, completionEpoch: 9 } });
  fireEvent.click(screen.getByRole("button", { name: "Check current chore" }));
  await screen.findByText("Changed fixture");
  expect(send).toHaveBeenCalledTimes(1); expect(screen.getByRole("textbox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review latest version" }));
  expect(screen.getByRole("textbox")).not.toBeDisabled();
  fireEvent.click(screen.getAllByRole("button", { name: "Send back" }).at(-1)!);
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(JSON.parse(send.mock.calls[1][0].body).expected.completionEpoch).toBe(9);
});
it("masks already-read content after an owner refusal", async () => {
  render(<OwnedChoreReview {...props} />); await screen.findByText(chore.title);
  read.mockResolvedValue({ kind: "held", code: "CHORE_CHECK_OWNER_CHANGED" });
  fireEvent.click(screen.getByRole("button", { name: "Check current chore" }));
  await screen.findByText(choreVerificationEnglish.reviewOwnerChanged);
  expect(screen.queryByText(chore.title)).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
