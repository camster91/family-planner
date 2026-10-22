/** @jest-environment jsdom */
/** Authored navigation/privacy cases; not executed. */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResponsibilityProvider, {
  ResponsibilityButton,
} from "../ResponsibilityProvider";
const mockPush = jest.fn(),
  mockReplace = jest.fn(),
  mockBack = jest.fn();
let mockQuery = "";
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/today",
  useSearchParams: () => new URLSearchParams(mockQuery),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));
jest.mock("@/i18n/responsibility", () => ({
  useResponsibilityText: () => ({ open: "Responsibility", loading: "Loading" }),
}));
jest.mock("../ResponsibilitySheet", () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close test sheet</button>
  ),
}));
function tree(
  role = "parent",
  enabled = true,
  kind: "chore" | "handoff" = "chore",
) {
  return (
    <ResponsibilityProvider role={role} enabled={enabled}>
      <ResponsibilityButton target={{ kind, id: "target-a" }} />
    </ResponsibilityProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = "";
});
it.each([
  "mode=fridge",
  "mode=fridge&responsibilityKind=chore&responsibilityId=target-a",
])(
  "does not open personal controls or target content on a shared surface: %s",
  (query) => {
    mockQuery = query;
    render(tree());
    expect(
      screen.queryByRole("button", { name: "Responsibility" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close test sheet" }),
    ).not.toBeInTheDocument();
  },
);
it("keeps other review/navigation fields while opening, then uses Back for its own opening", async () => {
  mockQuery = "weeklyReview=1&view=week";
  const rendered = render(tree());
  fireEvent.click(screen.getByRole("button", { name: "Responsibility" }));
  const destination = mockPush.mock.calls[0][0] as string;
  expect(
    new URL(destination, "http://test").searchParams.get("weeklyReview"),
  ).toBe("1");
  expect(
    new URL(destination, "http://test").searchParams.get("responsibilityId"),
  ).toBe("target-a");
  mockQuery = destination.split("?")[1];
  rendered.rerender(tree());
  fireEvent.click(
    await screen.findByRole("button", { name: "Close test sheet" }),
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});
it("removes only its own fields when closing a direct URL", async () => {
  mockQuery =
    "weeklyReview=1&responsibilityKind=chore&responsibilityId=target-a";
  render(tree());
  fireEvent.click(
    await screen.findByRole("button", { name: "Close test sheet" }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      "/dashboard/today?weeklyReview=1",
      { scroll: false },
    ),
  );
  expect(mockBack).not.toHaveBeenCalled();
});
it("hides handoff coordination for children and all controls while the capability is off", () => {
  const rendered = render(tree("child", true, "handoff"));
  expect(
    screen.queryByRole("button", { name: "Responsibility" }),
  ).not.toBeInTheDocument();
  rendered.rerender(tree("parent", false));
  expect(
    screen.queryByRole("button", { name: "Responsibility" }),
  ).not.toBeInTheDocument();
});

// Authored for deferred QA: pause hides new controls but must retain recovery.
it("mounts an owned recovery URL while new responsibility changes are paused", async () => {
  mockQuery = "responsibilityKind=chore&responsibilityId=target-a";
  render(tree("parent", false));
  expect(
    await screen.findByRole("button", { name: "Close test sheet" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Responsibility" }),
  ).not.toBeInTheDocument();
});
it("does not mount a child's restricted handoff recovery URL while paused", () => {
  mockQuery = "responsibilityKind=handoff&responsibilityId=target-a";
  render(tree("child", false, "handoff"));
  expect(
    screen.queryByRole("button", { name: "Close test sheet" }),
  ).not.toBeInTheDocument();
});
