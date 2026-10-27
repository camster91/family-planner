/** @jest-environment node */
// Server role/secret projection cases run with Node APIs, separately from
// rendered client tab behavior. No provider or live database is invoked.
import type * as React from "react";
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
// Server-page dependencies.
let mockSession: {
  id: string;
  email: string;
  role?: string;
  family_id?: string | null;
} | null = null;
let mockDbRole = "teen";
const mockPinFind = jest.fn(async () => ({ user_id: "u1" }));
let mockFamilyRow: {
  beta_metrics_enabled: boolean;
  capture_ai_key_enc: string | null;
} = {
  beta_metrics_enabled: true,
  capture_ai_key_enc: null,
};
const mockFamilyFind = jest.fn(async () => mockFamilyRow);
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => mockSession,
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => ({ role: mockDbRole, family_id: "fam-1" }),
    },
    parentElevationPin: {
      findFirst: (...a: unknown[]) => mockPinFind(...(a as [])),
    },
    family: { findUnique: (...a: unknown[]) => mockFamilyFind(...(a as [])) },
  },
}));
jest.mock("@/lib/device-http", () => ({ isSharedDeviceEnabled: () => true }));
jest.mock("@/lib/calendar-sync/config", () => ({
  isCalendarSyncEnabled: () => true,
}));

describe("Settings server page", () => {
  // Imported lazily so the mocks above apply.
  async function renderProps() {
    const { default: SettingsPage } = await import("../page");
    const element = (await SettingsPage({})) as React.ReactElement<
      Record<string, unknown>
    >;
    return element.props;
  }

  beforeEach(() => {
    mockPinFind.mockClear();
    mockFamilyFind.mockClear();
    mockFamilyRow = { beta_metrics_enabled: true, capture_ai_key_enc: null };
    delete process.env.CAPTURE_AI_SETTINGS_ENABLED;
    // The JWT says parent; the database role must win.
    mockSession = {
      id: "u1",
      email: "u1@example.test",
      role: "parent",
      family_id: "fam-1",
    };
  });

  it("gives a teen the personal view and reads no household-admin data", async () => {
    mockDbRole = "teen";
    process.env.CAPTURE_AI_SETTINGS_ENABLED = "true";
    const props = await renderProps();
    expect(props).toEqual({
      viewerRole: "teen",
      sharedDevice: null,
      betaMetrics: null,
      calendarSync: false,
      aiCaptureSettings: false,
    });
    expect(mockPinFind).not.toHaveBeenCalled();
    expect(mockFamilyFind).not.toHaveBeenCalled();
  });

  it("gives a parent the tablet PIN state, beta switch and calendar sync", async () => {
    mockDbRole = "parent";
    const props = await renderProps();
    expect(props).toEqual({
      viewerRole: "parent",
      sharedDevice: { hasPin: true },
      betaMetrics: { enabled: true },
      calendarSync: true,
      aiCaptureSettings: false,
      aiUsage: undefined,
      calendarFeedReviewScope: "fam-1",
    });
  });

  it("shows the AI capture form only with CAPTURE_AI_SETTINGS_ENABLED", async () => {
    mockDbRole = "parent";
    process.env.CAPTURE_AI_SETTINGS_ENABLED = "no";
    expect((await renderProps()).aiCaptureSettings).toBe(false);
    process.env.CAPTURE_AI_SETTINGS_ENABLED = "1";
    expect((await renderProps()).aiCaptureSettings).toBe(true);
    process.env.CAPTURE_AI_SETTINGS_ENABLED = "TRUE";
    expect((await renderProps()).aiCaptureSettings).toBe(true);
  });

  it("still shows the AI capture form when the household already saved a key, so it can be removed", async () => {
    mockDbRole = "parent";
    mockFamilyRow = {
      beta_metrics_enabled: false,
      capture_ai_key_enc: "v1:encrypted",
    };
    const props = await renderProps();
    expect(props.aiCaptureSettings).toBe(true);
    // Only the fact that a key exists reaches the page, never the key.
    expect(JSON.stringify(props)).not.toContain("encrypted");
  });

  it("sends a child home before anything is read", async () => {
    mockDbRole = "child";
    await expect(renderProps()).rejects.toThrow("REDIRECT /dashboard");
    expect(mockPinFind).not.toHaveBeenCalled();
    expect(mockFamilyFind).not.toHaveBeenCalled();
  });
});
