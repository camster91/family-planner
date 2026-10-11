/** @jest-environment jsdom */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateChorePage from "../create/page";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));

const calls: Array<{ url: string; init?: RequestInit }> = [];
const profile = {
  id: "profile-jamie",
  name: "Jamie",
  role: "child",
  age: null,
  archived_at: null,
  revision: 0,
};

describe("profile target in the create chore form", () => {
  beforeEach(() => {
    calls.length = 0;
    push.mockClear();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return { ok: true, status: 200, json: async () => ({ members: [{ id: "account-1", name: "Parent", role: "parent" }] }) };
      }
      if (url === "/api/family/profiles") {
        return { ok: true, status: 200, json: async () => ({ profiles: [profile] }) };
      }
      return { ok: true, status: 200, json: async () => ({ chore: { id: "chore-1" } }) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("uses protocol 2 selection for a profile and excludes account/recurrence fields", async () => {
    const user = userEvent.setup();
    render(<CreateChorePage />);
    const profileOption = await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(screen.getByLabelText("Assign To"), profileOption);
    expect(screen.getByText("Profiles support one-off chores only.")).toBeTruthy();
    expect(screen.queryByText("Pictures & routine")).toBeNull();
    expect((screen.getByRole("button", { name: "Daily" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2099-10-05" } });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));

    await waitFor(() => expect(calls.find((call) => call.url === "/api/chores/create")).toBeTruthy());
    const createCall = calls.find((call) => call.url === "/api/chores/create")!;
    const body = JSON.parse(String(createCall.init?.body));
    expect(body).toEqual({
      protocol: 2,
      selection: { memberId: "profile-jamie" },
      title: "Pack a bag",
      description: null,
      points: 10,
      due_date: "2099-10-05",
      difficulty: "medium",
      frequency: "once",
      photo_url: null,
    });
    expect(body.assigned_to).toBeUndefined();
    expect(body.rotation).toBeUndefined();
    expect(body.routine).toBeUndefined();
    expect(createCall.init?.headers).toEqual(expect.objectContaining({ "Idempotency-Key": expect.any(String) }));
  });

  it("explains an unavailable profile chore protocol without falling back to an account", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") return { ok: true, status: 200, json: async () => ({ members: [] }) };
      if (url === "/api/family/profiles") return { ok: true, status: 200, json: async () => ({ profiles: [profile] }) };
      return { ok: false, status: 409, json: async () => ({ error: "MEMBER_PROTOCOL_UNAVAILABLE" }) };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(screen.getByLabelText("Assign To"), "profile:profile-jamie");
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2099-10-05" } });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    expect(await screen.findByText(/cannot create a profile chore yet/i)).toBeTruthy();
    expect(calls.filter((call) => call.url === "/api/chores/create")).toHaveLength(1);
  });
});
