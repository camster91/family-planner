/** @jest-environment jsdom */
import * as React from "react";
import { CalendarPlanner } from "../CalendarPlanner";
import {
  serverRenderThenHydrate,
  type Hydrated,
} from "@/components/ui/__tests__/ssr-hydration";
jest.mock("../calendar-planner.module.css", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));
let hydrated: Hydrated | null = null;
beforeEach(() => {
  jest.useFakeTimers();
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
});
afterEach(() => {
  hydrated?.unmount();
  hydrated = null;
  jest.useRealTimers();
});
it("renders a deterministic UTC loading shell and hydrates on a phone without mismatch", () => {
  hydrated = serverRenderThenHydrate(
    <CalendarPlanner initialDate="2026-10-01" />,
    {
      serverNow: new Date("2026-10-01T23:59:30Z"),
      clientNow: new Date("2026-10-02T00:00:30Z"),
    },
  );
  expect(hydrated.html.replace(/<!--.*?-->/g, "")).toContain(
    "Loading this week",
  );
  expect(hydrated.html).toContain("UTC (loading viewer time)");
  expect(hydrated.recoverable).toEqual([]);
  expect(hydrated.errors).toEqual([]);
});
