/** @jest-environment jsdom */
/** Authored/unrun parent/fridge/navigation privacy source cases. */
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PreparationProvider, { PreparationButton } from "../PreparationProvider";
let mockPath = "/dashboard/calendar",
  mockParams = new URLSearchParams();
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
};
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));
jest.mock("@/i18n/event-preparation-shell", () => ({
  usePreparationShellText: () => ({
    open: "Prepare",
    error: "Failed",
    close: "Close",
    loading: "Loading",
  }),
}));
jest.mock("../PreparationSheet", () => ({
  __esModule: true,
  default: () => <div>Owned preparation sheet</div>,
}));
function app(role: string, enabled = true) {
  return (
    <PreparationProvider role={role} enabled={enabled}>
      <PreparationButton location={{ eventId: "event-a", timeZone: "UTC" }} />
    </PreparationProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/dashboard/calendar";
  mockParams = new URLSearchParams();
});
it("omits controls and the personal journal host for child and signed-in fridge surfaces even with a direct URL", () => {
  mockParams = new URLSearchParams("prepareEvent=event-a&prepareZone=UTC");
  const child = render(app("child"));
  expect(screen.queryByText("Prepare")).toBeNull();
  expect(screen.queryByText("Owned preparation sheet")).toBeNull();
  child.unmount();
  mockParams.set("mode", "fridge");
  const fridge = render(app("parent"));
  expect(fridge.container.textContent).not.toContain("Owned preparation");
  expect(screen.queryByText("Prepare")).toBeNull();
});
it("uses normal query navigation, clearing sibling overlays without serializing owner identity", () => {
  mockParams = new URLSearchParams(
    "reviewEvent=other-event&reviewZone=UTC&reviewStart=old&reviewEnd=old&responsibilityKind=chore&responsibilityId=chore-a",
  );
  render(app("parent"));
  fireEvent.click(screen.getByText("Prepare"));
  const href = mockRouter.push.mock.calls[0][0] as string;
  expect(href).toContain("prepareEvent=event-a");
  expect(href).toContain("prepareZone=UTC");
  expect(href).not.toMatch(/reviewEvent|responsibility|userId|familyId|owner/);
});
