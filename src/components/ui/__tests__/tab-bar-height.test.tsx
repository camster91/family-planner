/** @jest-environment jsdom */
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { TabBar } from "../tab-bar";

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard/today" }));

// Geometry/reflow is covered in the real-browser test. Here, exercise the
// observer lifecycle, updates, and cleanup without pretending jsdom lays out CSS.
describe("TabBar content reservation", () => {
  const originalObserver = global.ResizeObserver;
  let callback: ResizeObserverCallback;
  let observe: jest.Mock;
  let disconnect: jest.Mock;
  let height: number;

  beforeEach(() => {
    height = 66;
    observe = jest.fn();
    disconnect = jest.fn();
    global.ResizeObserver = jest.fn((cb: ResizeObserverCallback) => {
      callback = cb;
      return { observe, disconnect, unobserve: jest.fn() };
    }) as unknown as typeof ResizeObserver;
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return { height: this.tagName === "NAV" ? height : 0 } as DOMRect;
      });
  });

  afterEach(() => {
    global.ResizeObserver = originalObserver;
    jest.restoreAllMocks();
  });

  it("measures the fixed bar including its border, and tracks text and viewport changes", () => {
    render(
      <div data-dashboard-shell data-testid="shell">
        <main id="main-content" />
        <TabBar user={null} />
      </div>,
    );
    const main = screen.getByRole("main");
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("66px");
    expect(
      screen
        .getByTestId("shell")
        .style.getPropertyValue("--phone-tab-bar-height"),
    ).toBe("66px");
    expect(observe).toHaveBeenCalledWith(
      screen.getByRole("navigation", { name: "Tabs" }),
    );
    height = 143;
    act(() => callback([], {} as ResizeObserver));
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("143px");
    expect(
      screen
        .getByTestId("shell")
        .style.getPropertyValue("--phone-tab-bar-height"),
    ).toBe("143px");
    // Desktop md:hidden has zero geometry, not stale enlarged phone padding.
    height = 0;
    act(() => callback([], {} as ResizeObserver));
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("0px");
  });

  it("disconnects and removes its scoped measurement when unmounted", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);
    const { unmount } = render(<TabBar user={null} />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("");
    main.remove();
  });

  it("restores a pre-existing scoped measurement instead of leaking its own", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.style.setProperty("--phone-tab-bar-height", "90px");
    document.body.append(main);
    const { unmount } = render(<TabBar user={null} />);
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("66px");
    unmount();
    expect(main.style.getPropertyValue("--phone-tab-bar-height")).toBe("90px");
    main.remove();
  });
});
