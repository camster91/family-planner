// /dashboard/calendar?month=…&year=… with a hand-edited or truncated URL used
// to build an Invalid Date and fail the whole page. It now falls back to the
// current month. The query is the UTC month widened by a day each side, so
// the viewer's local month (O-31) is always covered.
const mockFindMany = jest.fn(async (_args: unknown) => [] as unknown[]);
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({
        family_id: "family-A",
        role: "parent",
      })),
    },
    event: { findMany: (args: unknown) => mockFindMany(args) },
  },
}));
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "parent-a" }),
}));
jest.mock("@/lib/calendar-import/source", () => ({
  attachEventSources: async (_p: unknown, _f: string, e: unknown[]) => e,
}));
jest.mock("@/lib/calendar-sync/config", () => ({
  isCalendarSyncEnabled: () => false,
}));
jest.mock("@/lib/calendar-sync/sync", () => ({
  refreshStaleConnections: jest.fn(),
}));
jest.mock("@/lib/event-import", () => ({
  canImportEvents: () => false,
  isEventImportConfigured: () => false,
}));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("../CalendarPageClient", () => ({
  __esModule: true,
  default: () => null,
}));

import CalendarPage from "../page";

beforeEach(() => mockFindMany.mockClear());

it("blocks child SSR even if the shell guard is bypassed", async () => {
  require("@/lib/prisma").prisma.user.findUnique.mockResolvedValueOnce({
    family_id: "family-A",
    role: "child",
  });
  expect(await CalendarPage({ searchParams: Promise.resolve({}) })).toBeNull();
});
describe("bounded planning handoff", () => {
  it("does not serialize an incomplete month query and preserves an explicit date/view", async () => {
    const element = await CalendarPage({
      searchParams: Promise.resolve({
        month: "1",
        year: "2026",
        date: "2026-01-05",
        view: "day",
      }),
    });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(element?.props).toMatchObject({
      initialDate: "2026-01-05",
      initialView: "day",
      events: [],
    });
  });
});
describe("calendar month/year parameters", () => {
  it.each([
    [{ month: "abc", year: "2026" }],
    [{ month: "13", year: "2026" }],
    [{ month: "0" }],
    [{ month: "5", year: "x" }],
  ])("%p queries a valid month", async (params) => {
    const element = (await CalendarPage({
      searchParams: Promise.resolve(params),
    })) as { props: { currentMonth: number; currentYear: number } };
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(element.props.currentMonth).toBeGreaterThanOrEqual(1);
    expect(element.props.currentMonth).toBeLessThanOrEqual(12);
    expect(Number.isInteger(element.props.currentYear)).toBe(true);
  });

  it("keeps a valid month", async () => {
    const element = (await CalendarPage({
      searchParams: Promise.resolve({ month: "2", year: "2027" }),
    })) as {
      props: { currentMonth: number; currentYear: number };
    };
    expect(element.props).toMatchObject({
      currentMonth: 2,
      currentYear: 2027,
      monthFromUrl: true,
    });
    expect(element.props).toMatchObject({ initialDate: "2027-02-01" });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("lets the client pick the local month when the URL names none", async () => {
    const element = (await CalendarPage({
      searchParams: Promise.resolve({}),
    })) as {
      props: { monthFromUrl: boolean };
    };
    expect(element.props.monthFromUrl).toBe(false);
  });
});

// O-37: a teen sees the calendar, but editing and deleting are parent-only
// (PATCH/DELETE /api/events), so the page does not link events to the editor.
describe("calendar edit links by role", () => {
  const findUnique = () =>
    require("@/lib/prisma").prisma.user.findUnique as jest.Mock;

  it.each([
    ["parent", true],
    ["teen", false],
  ])("%s: canEditEvents is %p", async (role, expected) => {
    findUnique().mockResolvedValueOnce({ family_id: "family-A", role });
    const element = (await CalendarPage({
      searchParams: Promise.resolve({}),
    })) as { props: { canEditEvents: boolean } };
    expect(element.props.canEditEvents).toBe(expected);
  });
});
