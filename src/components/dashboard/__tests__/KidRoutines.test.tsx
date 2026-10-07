/**
 * @jest-environment jsdom
 */
// Picture routines on the kid home (#272): today's routine steps as big
// picture cards in order, one highlighted next step, one tap to complete with
// Undo, done steps ticked with text, and an unchanged kid home without routines.
import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KidHome from "../KidHome";
import { ToastProvider } from "@/components/ui/toast";
import { FeaturesProvider } from "@/components/providers/features-provider";
import { defaultFeatures } from "@/lib/features";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
}));

type Reply = { status: number; body?: unknown } | "network";
let replies: Record<string, Reply[]> = {};
let calls: { url: string; body: any }[] = [];

// jsdom has no media playback; keep the real chore UI and mock only that platform gap.
beforeAll(() => {
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());
afterEach(() => jest.useRealTimers());

beforeEach(() => {
  jest
    .useFakeTimers({ advanceTimers: true })
    .setSystemTime(new Date(2026, 9, 6, 12));
  replies = {};
  calls = [];
  refresh.mockClear();
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = replies[url]?.shift() ?? {
        status: 200,
        body: { success: true },
      };
      if (next === "network") throw new TypeError("Failed to fetch");
      return {
        ok: next.status < 300,
        status: next.status,
        json: async () => next.body ?? {},
      } as Response;
    },
  ) as unknown as typeof fetch;
});

// Date-only values are stored at UTC midnight of the local calendar day.
const now = new Date(2026, 9, 6, 12);
const pad = (n: number) => String(n).padStart(2, "0");
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00.000Z`;
const TOMORROW = (() => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`;
})();

type C = {
  verified_notes?: string | null;
  id: string;
  title: string;
  status?: string;
  icon?: string | null;
  routine?: string | null;
  routine_order?: number | null;
  due_date?: string;
};
const chore = (c: C) => ({
  status: "pending",
  due_date: TODAY,
  icon: null,
  routine: null,
  routine_order: null,
  ...c,
});

const user = { name: "Casey", role: "child" as const };

function renderHome(chores: C[]) {
  return render(
    <ToastProvider>
      <KidHome
        user={user}
        chores={chores.map(chore)}
        events={[]}
        rewards={[]}
      />
    </ToastProvider>,
  );
}

const steps = (routine: HTMLElement) =>
  within(routine).getAllByTestId("routine-step");
const routineByName = (name: string) =>
  screen.getByRole("region", { name }) as HTMLElement;

const MORNING: C[] = [
  // Deliberately out of order: the view sorts by step.
  {
    id: "shoes",
    title: "Shoes on",
    icon: "shoes",
    routine: "Morning",
    routine_order: 3,
  },
  {
    id: "teeth",
    title: "Brush teeth",
    icon: "brush-teeth",
    routine: "Morning",
    routine_order: 1,
  },
  {
    id: "dress",
    title: "Get dressed",
    icon: "get-dressed",
    routine: "Morning",
    routine_order: 2,
  },
];

describe("KidHome picture routines", () => {
  it("reopens a step after refreshed completed props arrive while Undo remains", async () => {
    const original = chore({
      ...MORNING[1],
      verified_notes: "Brush the back teeth",
    });
    const view = renderHome([original]);
    await userEvent.click(steps(routineByName("Morning"))[0]);
    view.rerender(
      <ToastProvider>
        <KidHome
          user={user}
          chores={[{ ...original, status: "completed" }]}
          events={[]}
          rewards={[]}
        />
      </ToastProvider>,
    );
    expect(
      (steps(routineByName("Morning"))[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    const step = steps(routineByName("Morning"))[0] as HTMLButtonElement;
    await waitFor(() => expect(step.disabled).toBe(false));
    expect(step.getAttribute("aria-current")).toBe("step");
    expect(within(step).getByText("Brush the back teeth")).toBeTruthy();
    expect(
      (
        screen.getByRole("progressbar", {
          name: "Morning progress",
        }) as HTMLProgressElement
      ).value,
    ).toBe(0);
    expect(calls).toEqual([
      { url: "/api/chores/complete", body: { choreId: "teeth" } },
      { url: "/api/chores/uncomplete", body: { choreId: "teeth" } },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // A subsequent authoritative server check must win over the Undo overlay.
    view.rerender(
      <ToastProvider>
        <KidHome
          user={user}
          chores={[{ ...original, status: "verified" }]}
          events={[]}
          rewards={[]}
        />
      </ToastProvider>,
    );
    expect(
      (steps(routineByName("Morning"))[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Checked by a parent")).toBeTruthy();
  });
  it.each([false, true])(
    "restores overdue catch-up after refreshed props (completed row retained=%s)",
    async (retained) => {
      const oldDay = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1),
      ).toISOString();
      const old = chore({
        id: "old",
        title: "Earlier teeth",
        routine: "Morning",
        status: "overdue",
        due_date: oldDay,
        verified_notes: "Try again",
      });
      const view = renderHome([old, ...MORNING]);
      await userEvent.click(
        within(
          screen.getByRole("region", { name: "Routine catch-up" }),
        ).getByRole("button", { name: /Earlier teeth/ }),
      );
      view.rerender(
        <ToastProvider>
          <KidHome
            user={user}
            chores={[
              ...MORNING.map(chore),
              ...(retained ? [{ ...old, status: "completed" }] : []),
            ]}
            events={[]}
            rewards={[]}
          />
        </ToastProvider>,
      );
      expect(
        screen.queryByRole("region", { name: "Routine catch-up" }),
      ).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      const group = await screen.findByRole("region", {
        name: "Routine catch-up",
      });
      const restored = within(group).getByRole("button", {
        name: /Earlier teeth/,
      }) as HTMLButtonElement;
      expect(restored.disabled).toBe(false);
      expect(
        within(restored).getByText("Morning · Was due yesterday"),
      ).toBeTruthy();
      expect(within(restored).getByText("Try again")).toBeTruthy();
      expect(screen.getAllByText("Next")).toHaveLength(1);
      expect(calls[1]).toEqual({
        url: "/api/chores/uncomplete",
        body: { choreId: "old" },
      });
      await userEvent.click(restored);
      expect(calls[2]).toEqual({
        url: "/api/chores/complete",
        body: { choreId: "old" },
      });
    },
  );
  it.each([200, 500])(
    "preserves a deferred completion across refreshed props then handles HTTP %s",
    async (status) => {
      let resolve!: (response: Response) => void;
      const deferred = new Promise<Response>((done) => {
        resolve = done;
      });
      (global.fetch as jest.Mock).mockImplementationOnce(
        (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)),
          });
          return deferred;
        },
      );
      const original = chore({ ...MORNING[1], verified_notes: "Brush again" });
      const view = renderHome([original]);
      await userEvent.click(steps(routineByName("Morning"))[0]);
      view.rerender(
        <ToastProvider>
          <KidHome
            user={user}
            chores={[{ ...original }]}
            events={[]}
            rewards={[]}
          />
        </ToastProvider>,
      );
      const step = steps(routineByName("Morning"))[0] as HTMLButtonElement;
      expect(step.disabled).toBe(true);
      expect(step.getAttribute("data-state")).toBe("waiting");
      expect(within(step).queryByText("Brush again")).toBeNull();
      await userEvent.click(step);
      expect(calls).toHaveLength(1);
      await act(async () => {
        resolve({
          ok: status === 200,
          status,
          json: async () => ({ error: "Try later" }),
        } as Response);
      });
      if (status === 200) {
        expect(step.disabled).toBe(true);
        expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
        await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      } else {
        expect(screen.getByText("Couldn't mark it done")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
      }
      expect(step.disabled).toBe(false);
      expect(step.getAttribute("aria-current")).toBe("step");
      expect(within(step).getByText("Brush again")).toBeTruthy();
    },
  );
  it.each([
    [
      409,
      "verified",
      "A parent has already checked this chore, so it stays done.",
    ],
    [403, "completed", "Only parents or the assignee can undo this chore"],
    [
      500,
      "completed",
      "Something went wrong on our side. Try again in a moment.",
    ],
  ])(
    "keeps refreshed %s refusal authoritative during Undo",
    async (status, state, message) => {
      const original = chore({ ...MORNING[1], verified_notes: "Old reason" });
      const view = renderHome([original]);
      await userEvent.click(steps(routineByName("Morning"))[0]);
      view.rerender(
        <ToastProvider>
          <KidHome
            user={user}
            chores={[{ ...original, status: String(state) }]}
            events={[]}
            rewards={[]}
          />
        </ToastProvider>,
      );
      replies["/api/chores/uncomplete"] = [
        {
          status: Number(status),
          body: { error: message, code: "CHORE_ALREADY_VERIFIED" },
        },
      ];
      await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      const step = steps(routineByName("Morning"))[0] as HTMLButtonElement;
      expect(step.disabled).toBe(true);
      expect(step.getAttribute("data-state")).toBe(
        state === "verified" ? "checked" : "waiting",
      );
      expect(screen.queryByText("Next")).toBeNull();
      expect(within(step).queryByText("Old reason")).toBeNull();
      expect(screen.getByText(String(message))).toBeTruthy();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
  it("lets a fresh server send-back replace a locally ticked step", async () => {
    const view = renderHome([{ ...MORNING[1] }]);
    await userEvent.click(steps(routineByName("Morning"))[0]);
    expect(
      (steps(routineByName("Morning"))[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    view.rerender(
      <ToastProvider>
        <KidHome
          user={user}
          chores={[
            chore({
              ...MORNING[1],
              verified_notes: "Try the back teeth again",
            }),
          ]}
          events={[]}
          rewards={[]}
        />
      </ToastProvider>,
    );
    const step = steps(routineByName("Morning"))[0] as HTMLButtonElement;
    await waitFor(() => expect(step.disabled).toBe(false));
    expect(within(step).getByText("Try the back teeth again")).toBeTruthy();
  });
  it("restores the rejection reason when resubmission is refused", async () => {
    replies["/api/chores/complete"] = [
      { status: 409, body: { error: "Chore changed" } },
    ];
    renderHome([{ ...MORNING[1], verified_notes: "Brush again" }]);
    const step = steps(routineByName("Morning"))[0];
    await userEvent.click(step);
    await waitFor(() =>
      expect(within(step).getByText("Brush again")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("keeps completed and verified steps read-only without stale rejection notes", async () => {
    renderHome(
      MORNING.slice(0, 2).map((c, i) => ({
        ...c,
        status: i ? "verified" : "completed",
        verified_notes: "Old reason",
      })),
    );
    const rows = steps(routineByName("Morning"));
    for (const row of rows) {
      expect((row as HTMLButtonElement).disabled).toBe(true);
      await userEvent.click(row);
    }
    expect(screen.queryByText("Old reason")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    "does not offer rewards without both opt-ins (gamification=%s, rewards=%s)",
    (gamification, rewards) => {
      render(
        <FeaturesProvider
          initial={{ ...defaultFeatures(), gamification, rewards }}
        >
          <ToastProvider>
            <KidHome
              user={{ ...user, role: "teen", xp: 100 }}
              chores={MORNING.map(chore)}
              events={[]}
              rewards={[
                {
                  id: "r1",
                  name: "Movie night",
                  cost: 10,
                  status: "available",
                },
              ]}
            />
          </ToastProvider>
        </FeaturesProvider>,
      );
      expect(screen.queryByRole("button", { name: "Claim" })).toBeNull();
      expect(screen.queryByText("Movie night")).toBeNull();
      expect(screen.getByRole("region", { name: "Morning" })).toBeTruthy();
    },
  );
  it("offers older open routine work in a separate catch-up group without competing with today’s next step", async () => {
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    const oldDay = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T00:00:00.000Z`;
    renderHome([
      ...MORNING,
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `old${i}`,
        title: `Earlier step ${i + 1}`,
        routine: "Morning",
        routine_order: i + 1,
        due_date: oldDay,
      })),
      {
        id: "done",
        title: "Earlier checked",
        routine: "Morning",
        status: "verified",
        due_date: oldDay,
      },
      {
        id: "waiting",
        title: "Earlier waiting",
        routine: "Morning",
        status: "completed",
        due_date: oldDay,
      },
      {
        id: "future",
        title: "Future routine",
        routine: "Morning",
        due_date: TOMORROW,
      },
    ]);
    const catchup = screen.getByRole("region", { name: "Routine catch-up" });
    expect(
      within(catchup).getAllByText("Morning · Was due yesterday"),
    ).toHaveLength(3);
    expect(within(catchup).queryByText("Earlier step 4")).toBeNull();
    await userEvent.click(
      within(catchup).getByRole("button", { name: "Show more (1)" }),
    );
    await userEvent.click(
      within(catchup).getByRole("button", { name: /Earlier step 4/ }),
    );
    expect(calls).toContainEqual({
      url: "/api/chores/complete",
      body: { choreId: "old3" },
    });
    expect(screen.getAllByText("Next")).toHaveLength(1);
    expect(screen.queryByText("Earlier checked")).toBeNull();
    expect(screen.queryByText("Earlier waiting")).toBeNull();
    expect(screen.queryByText("Future routine")).toBeNull();
  });

  it("does not call the day done while only older routine work remains", () => {
    const oldDay = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    ).toISOString();
    renderHome([
      {
        id: "old",
        title: "Earlier teeth",
        routine: "Morning",
        due_date: oldDay,
      },
    ]);
    expect(screen.queryByText("All done for today!")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Routine catch-up" }),
    ).toBeTruthy();
  });
  it("shows a rejected step’s reason until it is resubmitted, including after Undo", async () => {
    renderHome([
      { ...MORNING[1], verified_notes: "Please brush the back teeth too" },
    ]);
    const step = steps(routineByName("Morning"))[0];
    expect(within(step).getByText("Have another go")).toBeTruthy();
    expect(
      within(step).getByText("Please brush the back teeth too"),
    ).toBeTruthy();
    expect(step.getAttribute("aria-label")).toContain(
      "Please brush the back teeth too",
    );
    await userEvent.click(step);
    await waitFor(() =>
      expect(within(step).queryByText("Have another go")).toBeNull(),
    );
    expect(within(step).getByText("Waiting for a parent")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(within(step).getByText("Have another go")).toBeTruthy(),
    );
  });
  it("exposes routine progress without points and updates it after a step is done", async () => {
    renderHome(MORNING);
    const progress = screen.getByRole("progressbar", {
      name: "Morning progress",
    }) as HTMLProgressElement;
    expect(progress.value).toBe(0);
    expect(progress.max).toBe(3);
    await userEvent.click(steps(routineByName("Morning"))[0]);
    await waitFor(() => expect(progress.value).toBe(1));
    expect(screen.getByText("Waiting for a parent")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(progress.value).toBe(0));
  });
  it("gives routines whose names differ only in punctuation or script their own headings", () => {
    renderHome([
      {
        id: "a",
        title: "Snack",
        icon: null,
        routine: "After school",
        routine_order: 1,
      },
      {
        id: "b",
        title: "Homework",
        icon: null,
        routine: "After-school",
        routine_order: 1,
      },
      {
        id: "c",
        title: "Teeth",
        icon: null,
        routine: "ночь",
        routine_order: 1,
      },
      { id: "d", title: "Bath", icon: null, routine: "夜", routine_order: 1 },
    ]);
    const ids = screen
      .getAllByTestId("kid-routine")
      .map((section) => section.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(4);
    for (const name of ["After school", "After-school", "ночь", "夜"]) {
      expect(within(routineByName(name)).getByRole("heading").textContent).toBe(
        name,
      );
    }
  });

  it("shows today’s routine steps in order as picture cards with the first open step marked next", () => {
    renderHome([
      ...MORNING,
      {
        id: "pj",
        title: "Pyjamas",
        icon: "pyjamas",
        routine: "Bedtime",
        routine_order: 1,
      },
      // Not today: not shown.
      {
        id: "later",
        title: "Tomorrow thing",
        icon: "hat",
        routine: "Morning",
        routine_order: 4,
        due_date: TOMORROW,
      },
    ]);
    const regions = screen.getAllByTestId("kid-routine");
    expect(
      regions.map((r) => within(r).getByRole("heading").textContent),
    ).toEqual(["Morning", "Bedtime"]);

    const morning = routineByName("Morning");
    expect(steps(morning).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Brush teeth, step 1 of 3, next step",
      "Get dressed, step 2 of 3",
      "Shoes on, step 3 of 3",
    ]);
    // Big pictures (h-24 = 96px >= 88px), label visible under them.
    const firstIcon = steps(morning)[0].querySelector(
      'svg[data-icon="brush-teeth"]',
    )!;
    expect(firstIcon.getAttribute("class")).toMatch(/h-24 w-24/);
    expect(within(steps(morning)[0]).getByText("Brush teeth")).toBeTruthy();
    // One next step across all routines, shown with the word "Next" too.
    expect(screen.getAllByText("Next")).toHaveLength(1);
    expect(steps(morning)[0].getAttribute("aria-current")).toBe("step");
    expect(
      steps(routineByName("Bedtime"))[0].getAttribute("aria-current"),
    ).toBeNull();
    expect(within(morning).getByTestId("routine-progress").textContent).toBe(
      "0 of 3 done",
    );
    expect(screen.queryByText("Tomorrow thing")).toBeNull();
  });

  it('a tap completes the step, ticks it with text, moves "next", and Undo puts it back', async () => {
    renderHome(MORNING);
    const morning = routineByName("Morning");
    await userEvent.click(steps(morning)[0]);

    expect(calls).toEqual([
      { url: "/api/chores/complete", body: { choreId: "teeth" } },
    ]);
    await waitFor(() =>
      expect(steps(morning)[0].getAttribute("data-state")).toBe("waiting"),
    );
    expect(steps(morning)[0].getAttribute("aria-label")).toBe(
      "Brush teeth, step 1 of 3, done, waiting for a parent to check",
    );
    expect(within(steps(morning)[0]).getByText("Done")).toBeTruthy();
    expect((steps(morning)[0] as HTMLButtonElement).disabled).toBe(true);
    expect(steps(morning)[1].getAttribute("aria-current")).toBe("step");
    expect(within(morning).getByTestId("routine-progress").textContent).toBe(
      "1 of 3 done",
    );
    // The existing approval copy.
    expect(screen.getByText("A parent will check it.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(calls[1]).toEqual({
      url: "/api/chores/uncomplete",
      body: { choreId: "teeth" },
    });
    await waitFor(() =>
      expect(steps(morning)[0].getAttribute("aria-current")).toBe("step"),
    );
    expect(within(morning).getByTestId("routine-progress").textContent).toBe(
      "0 of 3 done",
    );
  });

  it("rolls back a refused tap", async () => {
    replies["/api/chores/complete"] = [
      { status: 500, body: { error: "nope" } },
    ];
    renderHome(MORNING);
    const morning = routineByName("Morning");
    await userEvent.click(steps(morning)[0]);
    await waitFor(() =>
      expect(steps(morning)[0].getAttribute("data-state")).toBe("next"),
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    // The child is told, instead of the tick silently disappearing.
    expect(await screen.findByText("Couldn't mark it done")).toBeTruthy();
    expect(screen.getByText("nope")).toBeTruthy();
  });

  it("says so when the tap cannot reach the server", async () => {
    replies["/api/chores/complete"] = ["network"];
    renderHome(MORNING);
    await userEvent.click(steps(routineByName("Morning"))[0]);
    expect(
      await screen.findByText("Check your connection and try again."),
    ).toBeTruthy();
  });

  it("a failed reward claim shows an error instead of an unhandled rejection", async () => {
    replies["/api/rewards/claim"] = ["network"];
    render(
      <FeaturesProvider
        initial={{ ...defaultFeatures(), gamification: true, rewards: true }}
      >
        <ToastProvider>
          <KidHome
            user={{ ...user, xp: 20 }}
            chores={[]}
            events={[]}
            rewards={[
              { id: "r1", name: "Movie night", cost: 10, status: "available" },
            ]}
          />
        </ToastProvider>
      </FeaturesProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(await screen.findByText("Couldn't claim that")).toBeTruthy();
  });

  it('shows done and checked steps from the server, and "All done" when the routine is finished', () => {
    renderHome([
      {
        id: "teeth",
        title: "Brush teeth",
        icon: "brush-teeth",
        routine: "Morning",
        routine_order: 1,
        status: "verified",
      },
      {
        id: "dress",
        title: "Get dressed",
        icon: "get-dressed",
        routine: "Morning",
        routine_order: 2,
        status: "completed",
      },
    ]);
    const morning = routineByName("Morning");
    expect(steps(morning).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Brush teeth, step 1 of 2, done, checked by a parent",
      "Get dressed, step 2 of 2, done, waiting for a parent to check",
    ]);
    expect(within(morning).getByTestId("routine-progress").textContent).toBe(
      "All done",
    );
    expect(screen.queryByText("Next")).toBeNull();
    // No "All done for today" card competing with the routine.
    expect(screen.queryByText("All done for today!")).toBeNull();
  });

  it("a step with no picture gets the neutral picture and still its name", () => {
    renderHome([
      { id: "x", title: "Feed fish", routine: "Morning", routine_order: 1 },
    ]);
    const step = steps(routineByName("Morning"))[0];
    expect(step.querySelector('svg[data-icon="none"]')).toBeTruthy();
    expect(within(step).getByText("Feed fish")).toBeTruthy();
  });

  it("routine steps are not repeated in Today’s Missions; other chores still are", () => {
    renderHome([...MORNING, { id: "room", title: "Tidy room" }]);
    const missions = screen
      .getByText("Today’s Missions".replace("’", "'"))
      .closest("section")!;
    expect(within(missions).getByText("Tidy room")).toBeTruthy();
    expect(within(missions).queryByText("Brush teeth")).toBeNull();
  });

  it("a child without routines sees the kid home exactly as before", () => {
    renderHome([
      { id: "room", title: "Tidy room" },
      { id: "bins", title: "Bins", icon: "trash" },
    ]);
    expect(screen.queryByTestId("kid-routines")).toBeNull();
    expect(screen.getByText("Today's Missions")).toBeTruthy();
    expect(screen.getByText("Tidy room")).toBeTruthy();
    expect(screen.getByText("Bins")).toBeTruthy();
  });

  it("with nothing at all, the usual all-done card", () => {
    renderHome([]);
    expect(screen.getByText("All done for today!")).toBeTruthy();
  });
});
