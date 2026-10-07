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
    jest.spyOn(window, "prompt").mockReturnValue("  Toys still out ");
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
  });

  it("cancelling the reason prompt sends nothing", async () => {
    jest.spyOn(window, "prompt").mockReturnValue(null);
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", { name: "Send back “Tidy room”" }),
    );
    expect(calls).toHaveLength(0);
    expect(within(queue()!).getByText("Tidy room")).toBeTruthy();
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
    jest.spyOn(window, "prompt").mockReturnValue("");
    replies.push("network");
    renderPage();
    await userEvent.click(
      within(queue()!).getByRole("button", {
        name: "Send back “Feed the cat”",
      }),
    );
    expect(calls[0].body).toEqual({ choreId: "c1", decision: "reject" });
    await screen.findByText("Couldn't send it back");
    expect(within(queue()!).getByText("Feed the cat")).toBeTruthy();
  });
});
