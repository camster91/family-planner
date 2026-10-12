/**
 * @jest-environment jsdom
 */
// Parent check on the chores page: Verify and Reject go through
// POST /api/chores/verify (PATCH /api/chores drops status fields, so the old
// PATCH silently did nothing). The row shows the server's state afterwards and
// rolls back with the reason when the server refuses.
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChoresContent from "../ChoresContent";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n";
import { format } from "date-fns";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

type Reply = { status: number; body?: unknown } | "network";
let replies: Reply[] = [];
let calls: { url: string; method?: string; body: any }[] = [];

beforeEach(() => {
  // jsdom does not implement media playback.
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  replies = [];
  calls = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = replies.shift() ?? { status: 200, body: { success: true } };
      if (next === "network") throw new TypeError("Failed to fetch");
      return {
        ok: next.status < 300,
        status: next.status,
        json: async () => next.body ?? {},
      } as Response;
    },
  ) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

function completedChore(id: string, title: string) {
  // These are today's calendar-date chores, not the current UTC day's chores.
  const today = format(new Date(), "yyyy-MM-dd") + "T00:00:00.000Z";
  return {
    id,
    family_id: "fam",
    title,
    points: 10,
    assigned_to: "kid",
    due_date: today,
    status: "completed" as const,
    frequency: "once" as const,
    difficulty: "easy" as const,
    photo_verified: false,
    completed_at: new Date().toISOString(),
    created_at: today,
    assignee: { name: "Casey" },
    creator: { name: "Pat" },
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <ChoresContent
        chores={[
          completedChore("c1", "Feed the cat"),
          completedChore("c2", "Tidy room"),
        ]}
        familyMembers={[{ id: "kid", name: "Casey", role: "child" }]}
        currentUserId="parent"
        userRole="parent"
      />
    </ToastProvider>,
  );
}

const queue = () =>
  screen.queryByText("To check")?.closest("section") as HTMLElement | null;

describe("ChoresContent parent check", () => {
  it("names the routine owner and the parent’s next action without pretending the assignee ticked it", () => {
    render(
      <ToastProvider>
        <ChoresContent
          chores={[
            {
              ...completedChore("c1", "Feed the cat"),
              routine: "Morning",
              routine_order: 1,
            },
          ]}
          familyMembers={[]}
          currentUserId="parent"
          userRole="parent"
        />
      </ToastProvider>,
    );
    expect(
      within(queue()!).getByText(
        "Assigned to Casey · Morning, step 1 · Waiting for your check",
      ),
    ).toBeTruthy();
    expect(within(queue()!).queryByText("Done by Casey")).toBeNull();
    expect(
      within(queue()!).getByRole("button", { name: "Verify “Feed the cat”" }),
    ).toBeTruthy();
    expect(
      within(queue()!).getByRole("button", {
        name: "Send back “Feed the cat”",
      }),
    ).toBeTruthy();
  });
  it('shows the chores to check before the empty "All clear!" state', () => {
    renderPage();
    const check = screen.getByText("To check");
    const clear = screen.getByText("All clear!");
    expect(
      check.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Verify posts to /api/chores/verify and the row leaves the queue", async () => {
    replies.push({
      status: 200,
      body: {
        success: true,
        chore: {
          id: "c1",
          status: "verified",
          photo_verified: false,
          verified_at: "2026-01-05T12:00:00Z",
          verified_notes: null,
          completed_at: "2026-01-05T11:00:00Z",
        },
      },
    });
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", { name: "Verify “Feed the cat”" }),
    );

    expect(calls).toEqual([
      {
        url: "/api/chores/verify",
        method: "POST",
        body: { choreId: "c1", decision: "approve" },
      },
    ]);
    expect(
      calls.some((c) => c.url === "/api/chores" && c.method === "PATCH"),
    ).toBe(false);
    await screen.findByText("Chore verified");
    expect(within(queue()!).queryByText("Feed the cat")).toBeNull();
    expect(within(queue()!).getByText("Tidy room")).toBeTruthy();
  });

  it("Reject asks for a reason, posts decision reject with the note, and the chore is open again", async () => {
    replies.push({
      status: 200,
      body: {
        success: true,
        rejected: true,
        chore: {
          id: "c2",
          status: "pending",
          photo_verified: false,
          verified_at: null,
          verified_notes: "Toys still out",
          completed_at: null,
        },
      },
    });
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", { name: "Send back “Tidy room”" }),
    );
    expect(calls).toHaveLength(0);
    const dialog = screen.getByRole("dialog", {
      name: "Send “Tidy room” back",
    });
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Reason (optional)" }),
      "  Toys still out ",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send back" }),
    );

    expect(calls).toEqual([
      {
        url: "/api/chores/verify",
        method: "POST",
        body: {
          choreId: "c2",
          decision: "reject",
          verificationNotes: "Toys still out",
        },
      },
    ]);
    await screen.findByText("Sent back");
    expect(within(queue()!).queryByText("Tidy room")).toBeNull();
    // Back in the open list for today, tickable again.
    expect(screen.getByRole("checkbox", { name: /Tidy room/ })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Today" }),
      ),
    );

    const secondTrigger = within(queue()!).getByRole("button", {
      name: "Send back “Feed the cat”",
    });
    await userEvent.click(secondTrigger);
    expect(
      screen.getByRole("dialog", { name: "Send “Feed the cat” back" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(secondTrigger);

    await userEvent.click(secondTrigger);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(secondTrigger);
  });

  it("cancelling the reason dialog sends nothing and restores focus", async () => {
    renderPage();
    const trigger = within(queue()!).getByRole("button", {
      name: "Send back “Tidy room”",
    });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toHaveLength(0);
    expect(within(queue()!).getByText("Tidy room")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it("a refused verify rolls the row back and shows the reason", async () => {
    replies.push({
      status: 400,
      body: { error: "Only completed chores can be verified" },
    });
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", { name: "Verify “Feed the cat”" }),
    );

    await screen.findByText("Couldn't verify");
    expect(
      screen.getByText("Only completed chores can be verified"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(within(queue()!).getByText("Feed the cat")).toBeTruthy(),
    );
  });

  it("a verify that loses to another parent's send-back shows the chore as open, not verified", async () => {
    replies.push({
      status: 409,
      body: {
        error:
          "This chore changed while you were checking it and is no longer waiting to be checked.",
        code: "CHORE_NOT_COMPLETED",
        chore: {
          id: "c1",
          status: "pending",
          photo_verified: false,
          verified_at: null,
          verified_notes: "Try again",
          completed_at: null,
        },
      },
    });
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", { name: "Verify “Feed the cat”" }),
    );
    await screen.findByText("Couldn't verify");
    expect(screen.queryByText("Chore verified")).toBeNull();
    await waitFor(() =>
      expect(within(queue()!).queryByText("Feed the cat")).toBeNull(),
    );
    expect(screen.getByRole("checkbox", { name: /Feed the cat/ })).toBeTruthy();
  });

  it("a network failure on reject rolls back too", async () => {
    replies.push("network");
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", {
        name: "Send back “Feed the cat”",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Send “Feed the cat” back",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send back" }),
    );
    expect(calls[0].body).toEqual({ choreId: "c1", decision: "reject" });
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Try again" }),
    );
    expect(
      (within(dialog).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(within(queue()!).getByText("Feed the cat")).toBeTruthy();
  });

  it("keeps an unavailable profile chore out of parent verification actions", async () => {
    const unavailableProfileChore = {
      ...completedChore("profile-erased", "Erased profile chore"),
      assigned_to: null as never,
      assigned_member_id: "profile-erased",
      member_subject_erased: true,
      assignee: null,
    };
    render(
      <ToastProvider>
        <ChoresContent
          chores={[unavailableProfileChore]}
          familyMembers={[]}
          currentUserId="parent"
          userRole="parent"
        />
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(
        within(queue()!).getByText(/That profile is no longer available/),
      ).toBeTruthy(),
    );
    expect(
      within(queue()!).queryByRole("button", {
        name: 'Verify “Erased profile chore”',
      }),
    ).toBeNull();
    expect(
      within(queue()!).queryByRole("button", {
        name: 'Send back “Erased profile chore”',
      }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("keeps rejection notes when a conflict can be retried", async () => {
    replies.push({
      status: 409,
      body: {
        error: "This chore changed while you were checking it.",
        code: "CHORE_NOT_COMPLETED",
        chore: {
          id: "c2",
          status: "pending",
          photo_verified: false,
          verified_at: null,
          verified_notes: "Try the routine again",
          completed_at: null,
        },
      },
    });
    replies.push({
      status: 200,
      body: {
        chore: {
          id: "c2",
          status: "pending",
          photo_verified: false,
          verified_at: null,
          verified_notes: "Try the routine again",
          completed_at: null,
        },
      },
    });
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", {
        name: "Send back “Tidy room”",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Send “Tidy room” back",
    });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Reason (optional)" }),
      "Try the routine again",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send back" }),
    );
    await screen.findByRole("alert");
    expect(
      (within(dialog).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("Try the routine again");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Try again" }),
    );
    await screen.findByText("Sent back");
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual(calls[1].body);
  });

  it("does not send duplicate verification requests while a decision is pending", async () => {
    let release!: (response: Response) => void;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as unknown as typeof fetch;
    renderPage();
    const reject = within(queue()!).getByRole("button", {
      name: "Send back “Tidy room”",
    });
    await userEvent.click(reject);
    const dialog = screen.getByRole("dialog", {
      name: "Send “Tidy room” back",
    });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Reason (optional)" }),
      "Try the routine again",
    );
    const submit = within(dialog).getByRole("button", { name: "Send back" });
    await Promise.all([userEvent.click(submit), userEvent.click(submit)]);
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(calls).toHaveLength(1);
    release({
      ok: true,
      status: 200,
      json: async () => ({
        chore: {
          id: "c2",
          status: "pending",
          photo_verified: false,
          verified_at: null,
          verified_notes: "Try the routine again",
          completed_at: null,
        },
      }),
    } as Response);
    await screen.findByText("Sent back");
  });

  it("uses the Spanish verification dialog copy", async () => {
    render(
      <I18nProvider locale="es">
        <ToastProvider>
          <ChoresContent
            chores={[completedChore("c1", "Feed the cat")]}
            familyMembers={[{ id: "kid", name: "Casey", role: "child" }]}
            currentUserId="parent"
            userRole="parent"
          />
        </ToastProvider>
      </I18nProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Devolver “Feed the cat”" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Devolver “Feed the cat”",
    });
    expect(within(dialog).getByText("Motivo (opcional)")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Devolver" }),
    ).toBeTruthy();
  });
});
