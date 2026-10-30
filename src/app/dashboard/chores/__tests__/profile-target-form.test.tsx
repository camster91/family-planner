/** @jest-environment jsdom */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateChorePage from "../create/CreateChoreForm";
import { profileSetupMessages } from "@/i18n/profile-setup";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));
// This suite exercises create-form payloads and retry recovery. The pending
// navigation sentinel owns browser history while a request is in flight; a
// JSDOM history traversal is not part of these form contracts and can leave a
// fake-timer retry waiting on a popstate that JSDOM never emits.
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => true,
  }),
  usePendingFormNavigation: () => null,
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

const validProfileCreateResponse = {
  chore: {
    id: "chore-1",
    title: "Pack a bag",
    description: null,
    due_date: "2099-10-05",
    status: "pending",
    frequency: "once",
    weekly_days: [],
    recurrence_id: null,
    is_template: false,
    difficulty: "medium",
    icon: null,
    routine: null,
    routine_order: null,
    subject: {
      kind: "profile",
      memberId: "profile-jamie",
      name: "Jamie",
      role: "child",
    },
    created_at: "2026-10-14T16:00:00.000Z",
  },
};

describe("profile target in the create chore form", () => {
  beforeEach(() => {
    calls.length = 0;
    push.mockClear();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ chore: { id: "chore-1" } }),
      };
    }) as unknown as typeof fetch;
  });

  it.each([
    [409, "PROFILE_SETUP_UNSUPPORTED", false],
    [409, "ANOTHER_CONFLICT", true],
    [500, "INTERNAL_ERROR", true],
  ])("distinguishes optional capability refusal from failure (%s %s)", async (status, code, failed) => {
    const read = global.fetch;
    global.fetch = jest.fn(async (url, init) => url === "/api/family/profiles"
      ? { ok: false, status, json: async () => ({ error: { code } }) }
      : read(url, init)) as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: "Parent" });
    await waitFor(() => expect(calls.some(call => call.url === "/api/family/members")).toBe(true));
    if (failed) await screen.findByText(/Email-free profiles could not be checked/);
    else expect(screen.queryByText(/Email-free profiles could not be checked/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Assign To")).toHaveValue("account-1");
  });

  it("does not expose profiles when setup is readable but the chore writer is off", async () => {
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: "Parent" });
    await waitFor(() =>
      expect(calls.some((call) => call.url === "/api/family/profiles")).toBe(
        true,
      ),
    );
    expect(screen.queryByRole("option", { name: /Jamie/ })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Household profiles" }),
    ).toBeNull();
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps the unsupported recurrence draft message localized", () => {
    expect(profileSetupMessages.en.profileTargetRecurrenceUnsupported).toContain(
      "Your schedule is still here",
    );
    expect(profileSetupMessages.es.profileTargetRecurrenceUnsupported).toContain(
      "Tu programación sigue aquí",
    );
  });

  it("uses protocol 2 selection for a profile without account or rotation fields", async () => {
    const user = userEvent.setup();
    render(<CreateChorePage />);
    const profileOption = await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(screen.getByLabelText("Assign To"), profileOption);
    expect(
      screen.getByText("Profiles support one-off chores only."),
    ).toBeTruthy();
    expect(screen.getByText("Pictures & routine")).toBeTruthy();
    await user.click(screen.getByText("Pictures & routine"));
    await user.type(screen.getByLabelText("Routine"), "Morning");
    await user.type(screen.getByLabelText("Step"), "2");
    expect(
      (screen.getByRole("button", { name: "Daily" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.url === "/api/chores/create"),
      ).toBeTruthy(),
    );
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
      weekly_days: [],
      photo_url: null,
      icon: null,
      routine: "Morning",
      routine_order: 2,
    });
    expect(body.assigned_to).toBeUndefined();
    expect(body.rotation).toBeUndefined();
    expect(body.recurrence_id).toBeUndefined();
    expect(createCall.init?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
  });

  it("retains the profile draft and idempotency key after malformed success", async () => {
    const user = userEvent.setup();
    let createAttempts = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
            profileChoreRecurrenceSupported: true,
          }),
        };
      }
      createAttempts += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          createAttempts === 1 ? {} : validProfileCreateResponse,
      };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));

    expect(
      await screen.findByText(
        "The server returned an unsupported profile response.",
      ),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    const firstCall = calls.find((call) => call.url === "/api/chores/create")!;
    const firstKey = new Headers(firstCall.init?.headers).get("Idempotency-Key");
    const firstBody = firstCall.init?.body;
    expect(firstKey).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
    const createCalls = calls.filter((call) => call.url === "/api/chores/create");
    expect(createCalls).toHaveLength(2);
    expect(new Headers(createCalls[1].init?.headers).get("Idempotency-Key")).toBe(
      firstKey,
    );
    expect(createCalls[1].init?.body).toBe(firstBody);
  });

  it("explains an unavailable profile chore protocol without falling back to an account", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members")
        return { ok: true, status: 200, json: async () => ({ members: [] }) };
      if (url === "/api/family/profiles")
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
          }),
        };
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: "MEMBER_PROTOCOL_UNAVAILABLE" }),
      };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    expect(
      await screen.findByText(/cannot create a profile chore yet/i),
    ).toBeTruthy();
    expect(
      calls.filter((call) => call.url === "/api/chores/create"),
    ).toHaveLength(1);
  });

  it("keeps a repeated draft when the server has no profile recurrence capability", async () => {
    const user = userEvent.setup();
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("checkbox", { name: "Monday" }));
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    await user.type(screen.getByLabelText("Title"), "Pack a bag");

    expect(
      screen.getByRole("button", { name: "Weekly" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Weekly" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Monday" }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    expect(
      await screen.findByText(/cannot repeat profile chores yet/i),
    ).toBeTruthy();
    expect(
      calls.filter((call) => call.url === "/api/chores/create"),
    ).toHaveLength(0);
  });

  it("sends the selected profile recurrence without account or rotation fields", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
            profileChoreRecurrenceSupported: true,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ chore: { id: "chore-1" } }),
      };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    expect(
      screen.getByText(
        "This profile chore can repeat. Points and taking turns stay off.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Starts on"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.url === "/api/chores/create"),
      ).toBeTruthy(),
    );
    const createCall = calls.find((call) => call.url === "/api/chores/create")!;
    const body = JSON.parse(String(createCall.init?.body));
    expect(body).toMatchObject({
      protocol: 2,
      selection: { memberId: "profile-jamie" },
      due_date: "2099-10-05",
      frequency: "daily",
      weekly_days: [],
      points: 10,
    });
    expect(body.assigned_to).toBeUndefined();
    expect(body.rotation).toBeUndefined();
    expect(createCall.init?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
  });

  it("uses the next selected UTC weekday for a weekly profile chore", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/family/members") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [{ id: "account-1", name: "Parent", role: "parent" }],
            }),
          };
        }
        if (url === "/api/family/profiles") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              profiles: [profile],
              profileChoreSupported: true,
              profileChoreRecurrenceSupported: true,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ chore: { id: "chore-1" } }),
        };
      }) as unknown as typeof fetch;
      render(<CreateChorePage />);
      await screen.findByRole("option", { name: /Jamie/ });
      await user.selectOptions(
        screen.getByLabelText("Assign To"),
        "profile:profile-jamie",
      );
      await user.click(screen.getByRole("button", { name: "Weekly" }));
      await user.click(screen.getByRole("checkbox", { name: "Monday" }));
      await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
      await user.type(screen.getByLabelText("Title"), "Pack a bag");
      await user.click(screen.getByRole("button", { name: "Create Chore" }));

      await waitFor(() =>
        expect(
          calls.find((call) => call.url === "/api/chores/create"),
        ).toBeTruthy(),
      );
      const createCall = calls.find(
        (call) => call.url === "/api/chores/create",
      )!;
      const body = JSON.parse(String(createCall.init?.body));
      expect(body).toMatchObject({
        protocol: 2,
        selection: { memberId: "profile-jamie" },
        due_date: "2026-10-15",
        frequency: "weekly",
        weekly_days: [1, 4],
      });
      expect(body.assigned_to).toBeUndefined();
      expect(body.rotation).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("reuses the frozen weekly body/key after edits, midnight and an old reviewed start", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      let createAttempts = 0;
      global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/family/members") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [{ id: "account-1", name: "Parent", role: "parent" }],
            }),
          };
        }
        if (url === "/api/family/profiles") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              profiles: [profile],
              profileChoreSupported: true,
              profileChoreRecurrenceSupported: true,
            }),
          };
        }
        createAttempts += 1;
        if (createAttempts === 1) throw new Error("response lost");
        return {
          ok: true,
          status: 200,
          json: async () => validProfileCreateResponse,
        };
      }) as unknown as typeof fetch;
      render(<CreateChorePage />);
      await screen.findByRole("option", { name: /Jamie/ });
      await user.selectOptions(
        screen.getByLabelText("Assign To"),
        "profile:profile-jamie",
      );
      await user.click(screen.getByRole("button", { name: "Weekly" }));
      await user.click(screen.getByRole("checkbox", { name: "Monday" }));
      fireEvent.change(screen.getByLabelText("Starts on or after"), { target: { value: "2026-10-12" } });
      await user.type(screen.getByLabelText("Title"), "Pack a bag");
      await user.click(screen.getByRole("button", { name: "Create Chore" }));
      expect(
        await screen.findByText(/The profile chore could not be created/),
      ).toBeTruthy();

      const firstCall = calls.find((call) => call.url === "/api/chores/create")!;
      const firstKey = new Headers(firstCall.init?.headers).get("Idempotency-Key");
      const firstBody = firstCall.init?.body;
      jest.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
      const title = screen.getByLabelText("Title");
      await user.clear(title); await user.type(title, "Temporary edit");
      await user.clear(title); await user.type(title, "Pack a bag");
      await user.click(screen.getByRole("button", { name: "Create Chore" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));

      const createCalls = calls.filter((call) => call.url === "/api/chores/create");
      expect(createCalls).toHaveLength(2);
      expect(new Headers(createCalls[1].init?.headers).get("Idempotency-Key")).toBe(
        firstKey,
      );
      expect(createCalls[1].init?.body).toBe(firstBody);
    } finally {
      jest.useRealTimers();
    }
  });

  it("creates a new profile request key after an explicit draft edit", async () => {
    const user = userEvent.setup();
    let createAttempts = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
            profileChoreRecurrenceSupported: true,
          }),
        };
      }
      createAttempts += 1;
      if (createAttempts === 1) throw new Error("response lost");
      return {
        ok: true,
        status: 200,
        json: async () => validProfileCreateResponse,
      };
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await screen.findByText(/The profile chore could not be created/);

    const firstCall = calls.find((call) => call.url === "/api/chores/create")!;
    const firstKey = new Headers(firstCall.init?.headers).get("Idempotency-Key");
    const firstBody = firstCall.init?.body;
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Pack a lunch");
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));

    const createCalls = calls.filter((call) => call.url === "/api/chores/create");
    expect(createCalls).toHaveLength(2);
    expect(new Headers(createCalls[1].init?.headers).get("Idempotency-Key")).not.toBe(
      firstKey,
    );
    expect(createCalls[1].init?.body).not.toBe(firstBody);

    // Returning to the unresolved canonical draft still reuses its receipt
    // key, so an ambiguous first write cannot become a second chore.
    await user.clear(title);
    await user.type(title, "Pack a bag");
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.url === "/api/chores/create"),
      ).toHaveLength(3),
    );
    const replayCall = calls.filter(
      (call) => call.url === "/api/chores/create",
    )[2];
    expect(new Headers(replayCall.init?.headers).get("Idempotency-Key")).toBe(
      firstKey,
    );
    expect(replayCall.init?.body).toBe(firstBody);
  });

  it("preserves a profile draft if an edit races an in-flight create", async () => {
    const user = userEvent.setup();
    const createGate: { release?: (response: Response) => void } = {};
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/family/members") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: "account-1", name: "Parent", role: "parent" }],
          }),
        };
      }
      if (url === "/api/family/profiles") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profiles: [profile],
            profileChoreSupported: true,
            profileChoreRecurrenceSupported: true,
          }),
        };
      }
      return new Promise<Response>((resolve) => {
        createGate.release = resolve;
      });
    }) as unknown as typeof fetch;
    render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(
      screen.getByLabelText("Assign To"),
      "profile:profile-jamie",
    );
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    await user.type(title, "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2099-10-05" },
    });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await waitFor(() => expect(createGate.release).toBeDefined());
    expect(title.closest("fieldset")?.disabled).toBe(true);
    expect(title.matches(":disabled")).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Once" }) as HTMLButtonElement)
        .matches(":disabled"),
    ).toBe(true);

    // A native event can still be dispatched by an automation layer even
    // though the profile controls are disabled for ordinary user input.
    fireEvent.change(title, { target: { value: "Edited while waiting" } });
    expect(title.value).toBe("Edited while waiting");
    createGate.release?.({
      ok: true,
      status: 200,
      json: async () => validProfileCreateResponse,
    } as Response);
    await waitFor(() => expect(title.matches(":disabled")).toBe(false));
    expect(title.value).toBe("Edited while waiting");
    expect(push).not.toHaveBeenCalled();
  });
  // Authored UNRUN: a later refusal cannot erase an earlier unknown profile save.
  it("keeps the original request after an unknown result and a capability refusal", async () => {
    const read = global.fetch; let attempts = 0;
    global.fetch = jest.fn(async (url, init) => {
      if (url !== "/api/chores/create") return read(url, init);
      calls.push({ url: String(url), init }); attempts++;
      if (attempts === 1) throw new Error("Fixture response lost");
      return attempts === 2
        ? { ok: false, status: 404, json: async () => ({ error: { code: "MEMBER_PROTOCOL_UNAVAILABLE" } }) }
        : { ok: true, status: 200, json: async () => validProfileCreateResponse };
    }) as typeof fetch;
    const user = userEvent.setup(); render(<CreateChorePage />);
    await screen.findByRole("option", { name: /Jamie/ });
    await user.selectOptions(screen.getByLabelText("Assign To"), "profile:profile-jamie");
    await user.type(screen.getByLabelText("Title"), "Pack a bag");
    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2099-10-05" } });
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await screen.findByText(profileSetupMessages.en.profileTargetError);
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await screen.findByText(profileSetupMessages.en.profileTargetUnsupported);
    await user.click(screen.getByRole("button", { name: "Create Chore" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
    const writes = calls.filter(call => call.url === "/api/chores/create");
    expect(writes).toHaveLength(3);
    for (const write of writes.slice(1)) {
      expect(write.init?.body).toBe(writes[0].init?.body);
      expect(new Headers(write.init?.headers).get("Idempotency-Key")).toBe(new Headers(writes[0].init?.headers).get("Idempotency-Key"));
    }
  });

});
