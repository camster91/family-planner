/** @jest-environment jsdom */
// Authored UNRUN. Shared handler/retirement source, not API/PG/browser proof.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import ChoresContent from "../ChoresContent";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { setChoreDone } from "@/lib/chore-tick-client";
const mockToast = jest.fn(); const mockUndo = jest.fn();
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/components/providers/features-provider", () => ({ useFeatureEnabled: () => false }));
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ addToast: mockToast }), useUndoToast: () => mockUndo }));
jest.mock("@/components/layout/pending-form-navigation", () => ({ usePendingFormNavigationController: () => ({ releaseBeforeNavigation: async () => true }) }));
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn(), runOwnedForeground: jest.fn((work: () => Promise<unknown>) => work()) }));
jest.mock("@/lib/chore-tick-client", () => ({ setChoreDone: jest.fn(), checkChore: jest.fn() }));
const request = jest.mocked(requestOwnedJson);
const target = { id: "focus-only", title: "Task outside loaded page", description: null, dueDate: "2026-10-25T00:00:00.000Z", status: "pending" as const, canComplete: true };
const props = { chores: [], familyMembers: [], currentUserId: "fixture-child", userRole: "child", familyId: "fixture-family", notificationFocus: { target } };
function view(overrides = {}) { return <I18nProvider locale="en"><ChoresContent {...props} {...overrides} /></I18nProvider>; }
beforeEach(() => { request.mockReset(); mockUndo.mockClear(); mockToast.mockClear(); mockRouter.refresh.mockClear(); jest.mocked(setChoreDone).mockResolvedValue({ ok: true }); });
it("uses the existing completion and Undo paths for an unloaded focus row with one same-tick send", async () => {
  request.mockResolvedValue({ kind: "reply", response: { ok: true }, body: { success: true, choreId: target.id } } as any);
  render(view());
  const button = screen.getByRole("button", { name: "Mark complete" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(mockUndo).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/api/chores/complete", expect.objectContaining({ body: JSON.stringify({ choreId: target.id }), signal: expect.any(AbortSignal) }), 32 * 1024);
  expect(screen.getByText(/Waiting for review/)).toBeInTheDocument();
  await act(async () => { await mockUndo.mock.calls[0][0].onUndo(); });
  expect(setChoreDone).toHaveBeenCalledWith(target.id, false);
  expect(screen.getByRole("button", { name: "Mark complete" })).toBeEnabled();
});
it("retires a late completion reply when the owner changes", async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }) as any);
  const mounted = render(view()); fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
  const signal = request.mock.calls[0][1].signal!;
  mounted.rerender(view({ currentUserId: "other-account" }));
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ kind: "reply", response: { ok: true }, body: { success: true, choreId: target.id } }); });
  expect(mockUndo).not.toHaveBeenCalled(); expect(mockToast).not.toHaveBeenCalled();
  expect(screen.queryByText(/Waiting for review/)).not.toBeInTheDocument();
});
it("refreshes an already-terminal chore without manufacturing a completed state or Undo", async () => {
  request.mockResolvedValue({ kind: "reply", response: { ok: true }, body: { success: true, alreadyCompleted: true } } as any);
  render(view()); fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
  await waitFor(() => expect(mockRouter.refresh).toHaveBeenCalledTimes(1));
  expect(mockUndo).not.toHaveBeenCalled(); expect(screen.queryByText(/Waiting for review/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check current chore" })).toBeEnabled();
});
it("holds an uncertain focused action for explicit current-state read instead of another write", async () => {
  request.mockResolvedValue({ kind: "unknown" });
  render(view()); fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Check current chore" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check current chore" }));
  expect(mockRouter.refresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1); expect(mockUndo).not.toHaveBeenCalled();
});
