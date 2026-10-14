/**
 * @jest-environment jsdom
 */
// Board tiles act directly (#274): tap a chore to mark it done, tap a grocery
// item to tick it off, Undo in the toast, rollback when the server refuses,
// tile headings open their section, and on a paired tablet "Who's this?" first.
import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import TodayBoard from "../TodayBoard";
import { ToastProvider } from "@/components/ui/toast";
import type { BoardActions } from "../board-actions";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import { useDeviceBoardActions } from "@/components/device/use-device-board-actions";
import type { DeviceClient } from "@/lib/device-client";
import { QueueError } from "@/lib/offline-queue";
import { I18nProvider } from "@/i18n";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const setChoreDone = jest.fn();
jest.mock("@/lib/chore-tick-client", () => ({
  setChoreDone: (...args: unknown[]) => setChoreDone(...args),
}));

type Listener = (event: { type: string }) => void;
function fakeQueue() {
  const listeners = new Set<Listener>();
  let ops: any[] = [];
  let seq = 0;
  return {
    enqueue: jest.fn(async (action: string, payload: any) => {
      const op = { id: `op-${++seq}`, action, payload, state: "pending" };
      ops.push(op);
      return { ...op, durable: true };
    }),
    list: () => ops,
    discard: jest.fn(async (id: string) => {
      ops = ops.filter((o) => o.id !== id);
    }),
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fail(id: string) {
      ops.find((o) => o.id === id)!.state = "conflict";
      for (const l of Array.from(listeners)) l({ type: "change" });
    },
  };
}
let personQueue = fakeQueue();
let deviceQueue = fakeQueue();
jest.mock("@/lib/offline-queue-browser", () => ({
  getPersonQueue: () => personQueue,
  getDeviceQueue: () => deviceQueue,
}));

// Local noon on Monday 5 January 2026 in whatever zone the test runs in.
const NOW = new Date(2026, 0, 5, 12, 0, 0);
const TODAY = "2026-01-05";

function data(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    version: "v1",
    members: [
      { id: "p", name: "Avery Parent", color: "purple" },
      { id: "c", name: "Casey Child", color: "green" },
    ],
    events: [],
    chores: [
      {
        id: "c1",
        title: "Feed the cat",
        dueDay: TODAY,
        status: "pending",
        assigneeId: "c",
      },
      {
        id: "c2",
        title: "Water plants",
        dueDay: TODAY,
        status: "pending",
        assigneeId: "p",
      },
    ],
    dinners: [],
    shopping: {
      items: [
        {
          id: "i1",
          content: "Milk",
          quantity: 2,
          listId: "l1",
          listName: "Groceries",
        },
        {
          id: "i2",
          content: "Bread",
          quantity: 1,
          listId: "l1",
          listName: "Groceries",
        },
      ],
      total: 3,
    },
    links: {
      calendar: "/dashboard/calendar",
      chores: "/dashboard/chores",
      meals: "/dashboard/meals",
      lists: "/dashboard/lists",
      features: "/dashboard/features",
    },
    weather: null,
    display: { idleMinutes: 0, night: null },
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderBoard(
  props: Partial<React.ComponentProps<typeof TodayBoard>> = {},
) {
  const utils = render(
    <I18nProvider locale="en">
      <ToastProvider>
        <TodayBoard
          data={data()}
          fridgeMode={false}
          checkVersion={async () => "v1"}
          {...props}
        />
      </ToastProvider>
    </I18nProvider>,
  );
  await settle();
  return utils;
}

const chores = () => screen.getByTestId("region-chores");
const groceries = () => screen.getByTestId("region-groceries");

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  refresh.mockReset();
  setChoreDone.mockReset();
  personQueue = fakeQueue();
  deviceQueue = fakeQueue();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('tile headings open their section (no "Open …" buttons)', () => {
  it("links each heading, keeps a readable name, and drops the old buttons", async () => {
    await renderBoard();
    expect(
      screen.queryByRole("link", {
        name: /^Open (calendar|meals|chores|lists)$/,
      }),
    ).toBeNull();
    expect(
      within(chores()).getByRole("link", {
        name: /Chores today\s*, open chores/,
      }),
    ).toHaveAttribute("href", "/dashboard/chores");
    expect(
      within(groceries()).getByRole("link", {
        name: /Groceries\s*, open grocery lists/,
      }),
    ).toHaveAttribute("href", "/dashboard/lists/groceries");
    expect(
      within(groceries()).getByRole("link", { name: "All shared lists" }),
    ).toHaveAttribute("href", "/dashboard/lists");
    expect(
      within(screen.getByTestId("region-today")).getByRole("heading", {
        name: /Today/,
      }),
    ).toBeTruthy();
    expect(
      within(groceries()).getByRole("link", { name: "1 more to buy" }),
    ).toHaveAttribute("href", "/dashboard/lists/groceries");
  });

  it("a paired tablet (links null) gets plain headings", async () => {
    await renderBoard({
      data: data({
        links: {
          calendar: null,
          chores: null,
          meals: null,
          lists: null,
          features: null,
        },
      }),
    });
    expect(
      within(screen.getByTestId("board-grid")).queryAllByRole("link"),
    ).toHaveLength(0);
    expect(within(groceries()).getByText("1 more to buy")).toBeTruthy();
  });
});

describe("person board (#274)", () => {
  it("renders each personal-summary chore once while keeping other household work", async () => {
    await renderBoard({
      viewer: { id: "c", role: "child" },
      choresShownElsewhere: ["c1"],
    });
    expect(within(chores()).queryByText("Feed the cat")).toBeNull();
    expect(within(chores()).getByText("Water plants")).toBeTruthy();
  });

  it("keeps additional rows for the same member when the bounded summary did not load them", async () => {
    await renderBoard({
      viewer: { id: "c", role: "child" },
      choresShownElsewhere: ["c1"],
      data: data({
        chores: [
          {
            id: "c1",
            title: "Feed the cat",
            dueDay: TODAY,
            status: "pending",
            assigneeId: "c",
          },
          {
            id: "extra",
            title: "Pack school bag",
            dueDay: TODAY,
            status: "pending",
            assigneeId: "c",
          },
        ],
      }),
    });
    expect(within(chores()).queryByText("Feed the cat")).toBeNull();
    expect(
      within(chores()).getByRole("button", {
        name: /Mark Pack school bag done/,
      }),
    ).toBeTruthy();
  });

  it("omits an empty household tile when all its work is already in the personal summary", async () => {
    await renderBoard({
      viewer: { id: "c", role: "child" },
      choresShownElsewhere: ["c1", "c2"],
    });
    expect(screen.queryByTestId("region-chores")).toBeNull();
    expect(screen.queryByText("No chores due today.")).toBeNull();
    expect(screen.getByTestId("board-grid").className).toContain(
      "coming_coming_coming",
    );
    expect(screen.getByTestId("board-grid").className).not.toContain(
      "chores_coming",
    );
  });

  it("keeps the complete fridge board even when personal-summary IDs are supplied", async () => {
    await renderBoard({
      fridgeMode: true,
      viewer: { id: "c", role: "child" },
      choresShownElsewhere: ["c1", "c2"],
    });
    expect(within(chores()).getByText("Feed the cat")).toBeTruthy();
    expect(within(chores()).getByText("Water plants")).toBeTruthy();
  });

  it("explains retained-work recovery when a grocery tick needs a compatible client", async () => {
    personQueue.enqueue.mockRejectedValue(
      new QueueError("COMPATIBLE_CLIENT_REQUIRED"),
    );
    await renderBoard({ viewer: { id: "p", role: "parent" } });
    fireEvent.click(
      within(groceries()).getByRole("button", { name: /Tick off Milk/ }),
    );
    await settle();
    expect(
      screen.getByText(/Pending changes need a compatible app version/),
    ).toBeInTheDocument();
    expect(within(groceries()).getByText("Milk")).toBeInTheDocument();
    expect(personQueue.list()).toEqual([]);
  });
  it("a child can tick only their own chore; a parent any chore", async () => {
    const { unmount } = await renderBoard({
      viewer: { id: "c", role: "child" },
    });
    expect(
      within(chores()).getByRole("button", {
        name: "Mark Feed the cat done, Casey",
      }),
    ).toBeTruthy();
    expect(
      within(chores()).queryByRole("button", { name: /Water plants/ }),
    ).toBeNull();
    expect(within(chores()).getByText("Water plants")).toBeTruthy();
    unmount();
    await renderBoard({ viewer: { id: "p", role: "parent" } });
    expect(
      within(chores()).getAllByRole("button", { name: /^Mark .* done/ }),
    ).toHaveLength(2);
  });

  it("keeps profile-only chores read-only on the signed-in board", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    await renderBoard({
      viewer: { id: "p", role: "parent" },
      data: data({
        memberProtocol: 2,
        members: [profile],
        chores: [
          {
            id: "profile-chore",
            title: "Put away blocks",
            dueDay: TODAY,
            status: "pending",
            subject: profile.subject,
          },
        ],
      }),
    });
    expect(within(chores()).getByText("Put away blocks")).toBeInTheDocument();
    expect(
      within(chores()).queryByRole("button", {
        name: /Mark Put away blocks done/,
      }),
    ).toBeNull();
    expect(setChoreDone).not.toHaveBeenCalled();
  });

  it("keeps paused recurring profile chores visible without a completion control", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    await renderBoard({
      viewer: { id: "p", role: "parent" },
      data: data({
        memberProtocol: 2,
        members: [profile],
        chores: [
          {
            id: "profile-weekly",
            title: "Brush teeth",
            dueDay: TODAY,
            status: "pending",
            subject: profile.subject,
            actionAvailability: {
              state: "paused" as const,
              reason: "RECURRENCE_CAPABILITY_UNAVAILABLE" as const,
              recovery: "refresh-and-retain-pending" as const,
              requiresCompatibleClient: true as const,
              actions: { complete: false as const, undo: false as const, verify: false as const, reject: false as const },
            },
          },
        ],
      }),
    });
    expect(within(chores()).getByText("Brush teeth")).toBeInTheDocument();
    expect(
      within(chores()).getByText(/paused while compatibility is refreshed/),
    ).toBeInTheDocument();
    expect(
      within(chores()).queryByRole("button", {
        name: /Mark Brush teeth done/,
      }),
    ).toBeNull();
    expect(setChoreDone).not.toHaveBeenCalled();
  });

  it("without a viewer the board stays read-only", async () => {
    await renderBoard();
    expect(within(chores()).queryAllByRole("button")).toHaveLength(0);
    expect(within(groceries()).queryAllByRole("button")).toHaveLength(0);
  });

  it("tapping a chore completes it through the existing route, with Undo", async () => {
    setChoreDone.mockResolvedValue({ ok: true });
    await renderBoard({ viewer: { id: "c", role: "child" } });
    fireEvent.click(
      within(chores()).getByRole("button", {
        name: "Mark Feed the cat done, Casey",
      }),
    );
    await settle();
    expect(setChoreDone).toHaveBeenCalledWith("c1", true);
    expect(within(chores()).queryByText("Feed the cat")).toBeNull();
    expect(within(chores()).getByTestId("chore-done").textContent).toContain(
      "1 waiting for a parent's check",
    );
    const toast = screen.getByTestId("undo-toast");
    expect(toast.textContent).toContain("“Feed the cat” done");
    expect(toast.textContent).toContain("A parent will check it.");
    expect(refresh).toHaveBeenCalled();

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await settle();
    expect(setChoreDone).toHaveBeenLastCalledWith("c1", false);
    expect(within(chores()).getByText("Feed the cat")).toBeTruthy();
  });

  it("rolls a refused completion back and says why", async () => {
    setChoreDone.mockResolvedValue({ ok: false, message: "Chore not found" });
    await renderBoard({ viewer: { id: "p", role: "parent" } });
    fireEvent.click(
      within(chores()).getByRole("button", { name: /Mark Water plants done/ }),
    );
    await settle();
    expect(within(chores()).getByText("Water plants")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn’t mark “Water plants” done".replace("’", "'"),
    );
    expect(screen.queryByTestId("undo-toast")).toBeNull();
  });

  it("tapping a grocery item queues the tick (#162 queue), hides it, and Undo queues the untick", async () => {
    await renderBoard({ viewer: { id: "c", role: "child" } });
    expect(within(groceries()).getByText("3 to buy")).toBeTruthy();
    fireEvent.click(
      within(groceries()).getByRole("button", { name: "Tick off Milk, 2" }),
    );
    await settle();
    expect(personQueue.enqueue).toHaveBeenCalledWith("list-item.set-checked", {
      itemId: "i1",
      checked: true,
    });
    expect(within(groceries()).queryByText("Milk")).toBeNull();
    expect(within(groceries()).getByText("2 to buy")).toBeTruthy();

    const toast = screen.getByTestId("undo-toast");
    expect(toast.textContent).toContain("“Milk” ticked off");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await settle();
    expect(personQueue.enqueue).toHaveBeenLastCalledWith(
      "list-item.set-checked",
      { itemId: "i1", checked: false },
    );
    expect(within(groceries()).getByText("Milk")).toBeTruthy();
  });

  it("a queued tick the server refuses puts the item back with an error", async () => {
    await renderBoard({ viewer: { id: "c", role: "child" } });
    fireEvent.click(
      within(groceries()).getByRole("button", { name: "Tick off Bread" }),
    );
    await settle();
    expect(within(groceries()).queryByText("Bread")).toBeNull();
    act(() => personQueue.fail("op-1"));
    await settle();
    expect(within(groceries()).getByText("Bread")).toBeTruthy();
    expect(personQueue.discard).toHaveBeenCalledWith("op-1");
    expect(screen.getByRole("alert").textContent).toContain("“Bread”");
  });

  it("tile targets are at least 48px tall (44px minimum) and keep their names", async () => {
    await renderBoard({ viewer: { id: "p", role: "parent" } });
    for (const button of within(screen.getByTestId("board-grid")).getAllByRole(
      "button",
    )) {
      expect(button.className).toMatch(/min-h-\[52px\]/);
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

describe("explicit tile actions", () => {
  it("without undo support, the toast just says what happened", async () => {
    const actions: BoardActions = {
      canCompleteChore: () => true,
      canTickGroceries: false,
      completeChore: jest.fn(async () => ({ ok: true as const })),
      setGroceryChecked: jest.fn(async () => ({ ok: true as const })),
    };
    await renderBoard({ tileActions: actions });
    expect(within(groceries()).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(
      within(chores()).getByRole("button", { name: /Mark Feed the cat done/ }),
    );
    await settle();
    expect(screen.queryByTestId("undo-toast")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "“Feed the cat” done",
    );
  });
});

function fakeClient() {
  const request = jest.fn(async (_path: string, _options?: unknown) => ({}));
  return {
    client: {
      request,
      subscribe: () => () => undefined,
    } as unknown as DeviceClient,
    request,
  };
}

function DeviceBoard({
  client,
  enabled = true,
  board,
  memberProtocol = 1,
}: {
  client: DeviceClient;
  enabled?: boolean;
  board?: TodayBoardData;
  memberProtocol?: 1 | 2;
}) {
  const d =
    board ??
    data({
      links: {
        calendar: null,
        chores: null,
        meals: null,
        lists: null,
        features: null,
      },
    });
  const { actions, actor, picker } = useDeviceBoardActions({
    client,
    enabled,
    features: { chores: true, lists: true },
    members: d.members,
    memberProtocol,
    afterChange: () => undefined,
  });
  return (
    <>
      {actor && <p data-testid="device-actor">Ticking off as {actor.name}</p>}
      <TodayBoard
        data={d}
        fridgeMode
        checkVersion={async () => "v1"}
        onRefresh={() => undefined}
        tileActions={actions}
      />
      {picker}
    </>
  );
}

describe('paired tablet (#274): "Who\'s this?" and the device routes', () => {
  async function renderDevice(enabled = true) {
    const fc = fakeClient();
    render(
      <ToastProvider>
        <DeviceBoard client={fc.client} enabled={enabled} />
      </ToastProvider>,
    );
    await settle();
    return fc;
  }

  it("stays read-only while the household has tablet writes off", async () => {
    await renderDevice(false);
    expect(within(chores()).queryAllByRole("button")).toHaveLength(0);
    expect(within(groceries()).queryAllByRole("button")).toHaveLength(0);
  });

  it("asks who it is (names and colours only), then completes as that member with a fresh key", async () => {
    const { request } = await renderDevice();
    fireEvent.click(
      within(chores()).getByRole("button", { name: /Mark Feed the cat done/ }),
    );
    await settle();
    const dialog = screen.getByTestId("who-is-this");
    expect(
      within(dialog).getAllByRole("button", {
        name: /Avery Parent|Casey Child/,
      }),
    ).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Casey Child" }),
    );
    await settle();
    expect(request).toHaveBeenCalledWith("/api/device/chores/c1/complete", {
      method: "POST",
      body: { actingMemberId: "c" },
      headers: { "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/) },
    });
    expect(screen.getByTestId("device-actor").textContent).toBe(
      "Ticking off as Casey Child",
    );
    const toast = screen.getByTestId("undo-toast");
    expect(toast.textContent).toContain("“Feed the cat” done by Casey");

    // Undo uses the tablet's own short-window route.
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await settle();
    expect(request).toHaveBeenLastCalledWith(
      "/api/device/chores/c1/uncomplete",
      expect.objectContaining({ method: "POST" }),
    );

    // The member is remembered: the next tap does not ask again, and ticks go to the device queue.
    fireEvent.click(
      within(groceries()).getByRole("button", { name: "Tick off Bread" }),
    );
    await settle();
    expect(screen.queryByTestId("who-is-this")).toBeNull();
    expect(deviceQueue.enqueue).toHaveBeenCalledWith(
      "device.list-item.set-checked",
      {
        itemId: "i2",
        checked: true,
        actingMemberId: "c",
      },
    );
  });

  it('closing "Who\'s this?" cancels the tap with nothing changed', async () => {
    const { request } = await renderDevice();
    fireEvent.click(
      within(groceries()).getByRole("button", { name: "Tick off Bread" }),
    );
    await settle();
    fireEvent.click(
      within(screen.getByTestId("who-is-this")).getByRole("button", {
        name: "Close",
      }),
    );
    await settle();
    expect(deviceQueue.enqueue).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(within(groceries()).getByText("Bread")).toBeTruthy();
  });

  it("a refused chore (e.g. writes turned off meanwhile) rolls back with the server message", async () => {
    const { request } = await renderDevice();
    const { DeviceApiError } = jest.requireActual("@/lib/device-client");
    request.mockRejectedValueOnce(
      new DeviceApiError(
        403,
        "DEVICE_WRITES_OFF",
        "Ticking things off on this tablet is turned off.",
      ),
    );
    fireEvent.click(
      within(chores()).getByRole("button", { name: /Mark Water plants done/ }),
    );
    await settle();
    fireEvent.click(
      within(screen.getByTestId("who-is-this")).getByRole("button", {
        name: "Avery Parent",
      }),
    );
    await settle();
    expect(within(chores()).getByText("Water plants")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("turned off");
  });

  it("uses the explicit protocol-2 profile selection for a profile-only chore", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    const profileBoard = data({
      memberProtocol: 2,
      members: [profile],
      chores: [
        {
          id: "profile-chore",
          title: "Put away blocks",
          dueDay: TODAY,
          status: "pending",
          subject: profile.subject,
        },
      ],
    });
    const fc = fakeClient();
    render(
      <ToastProvider>
        <DeviceBoard
          client={fc.client}
          board={profileBoard}
          memberProtocol={2}
        />
      </ToastProvider>,
    );
    await settle();
    fireEvent.click(
      within(chores()).getByRole("button", {
        name: /Mark Put away blocks done/,
      }),
    );
    await settle();
    const dialog = screen.getByTestId("who-is-this");
    expect(
      within(dialog).getByRole("heading", { name: "Who is this chore for?" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Choose the family profile completing this chore.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Casey Child" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Casey Child" }),
    );
    await settle();
    expect(fc.request).toHaveBeenCalledWith(
      "/api/device/chores/profile-chore/complete",
      {
        method: "POST",
        body: { protocol: 2, selection: { memberId: "profile-casey" } },
        headers: {
          "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      },
    );
  });

  it("keeps a grocery tap on the account picker when a profile chore is visible", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    const fc = fakeClient();
    render(
      <ToastProvider>
        <DeviceBoard
          client={fc.client}
          memberProtocol={2}
          board={data({
            memberProtocol: 2,
            members: [profile, data().members[0]],
            chores: [
              {
                id: "profile-chore",
                title: "Put away blocks",
                dueDay: TODAY,
                status: "pending",
                subject: profile.subject,
              },
            ],
          })}
        />
      </ToastProvider>,
    );
    await settle();

    // Rendering the chore capability is expected to be pure. A grocery tap
    // must still ask for an account actor, even with a visible profile chore.
    fireEvent.click(
      within(groceries()).getByRole("button", { name: "Tick off Milk, 2" }),
    );
    await settle();
    const dialog = screen.getByTestId("who-is-this");
    expect(
      within(dialog).getByRole("heading", { name: "Who's this?" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Avery Parent" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Casey Child" }),
    ).toBeNull();
  });

  it("localizes the profile chooser without changing the account picker copy", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    const fc = fakeClient();
    render(
      <I18nProvider locale="es">
        <ToastProvider>
          <DeviceBoard
            client={fc.client}
            memberProtocol={2}
            board={data({
              memberProtocol: 2,
              members: [profile],
              chores: [
                {
                  id: "profile-chore",
                  title: "Put away blocks",
                  dueDay: TODAY,
                  status: "pending",
                  subject: profile.subject,
                },
              ],
            })}
          />
        </ToastProvider>
      </I18nProvider>,
    );
    await settle();
    fireEvent.click(
      within(chores()).getByRole("button", { name: /Marcar Put away blocks/ }),
    );
    await settle();
    const dialog = screen.getByTestId("who-is-this");
    expect(
      within(dialog).getByRole("heading", {
        name: "¿Para quién es esta tarea?",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Elige el perfil familiar que hará esta tarea."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Casey Child" }),
    ).toBeInTheDocument();
  });

  it("keeps profile-only chores read-only for a protocol-1 tablet", async () => {
    const profile = {
      id: "profile:casey",
      name: "Casey Child",
      color: "green" as const,
      subject: {
        kind: "profile" as const,
        memberId: "profile-casey",
        name: "Casey Child",
        color: "green" as const,
      },
    };
    const fc = fakeClient();
    render(
      <ToastProvider>
        <DeviceBoard
          client={fc.client}
          memberProtocol={1}
          board={data({
            members: [profile],
            chores: [
              {
                id: "profile-chore",
                title: "Put away blocks",
                dueDay: TODAY,
                status: "pending",
                subject: profile.subject,
              },
            ],
          })}
        />
      </ToastProvider>,
    );
    await settle();
    expect(within(chores()).getByText("Put away blocks")).toBeInTheDocument();
    expect(
      within(chores()).queryByRole("button", {
        name: /Mark Put away blocks done/,
      }),
    ).toBeNull();
    expect(fc.request).not.toHaveBeenCalled();
  });
});

describe("profile protocol compatibility", () => {
  it("shows a localized recovery surface without rendering partial board rows", async () => {
    const onRefresh = jest.fn();
    await renderBoard({
      data: data({
        members: [
          {
            id: "profile:casey",
            name: "Casey",
            subject: {
              kind: "profile",
              memberId: "casey",
              name: "Casey",
              color: "green",
            },
          },
        ],
        chores: [
          {
            id: "profile-chore",
            title: "Pack bag",
            dueDay: TODAY,
            status: "pending",
            subject: {
              kind: "profile",
              memberId: "casey",
              name: "Casey",
              color: "green",
            },
          },
        ],
        protocolError: {
          code: "MEMBER_PROTOCOL_UNAVAILABLE",
          recovery: "refresh-and-retain-pending",
          requiredProtocol: 2,
          receivedProtocol: 1,
        },
      }),
      onRefresh,
    });

    expect(screen.getByTestId("today-board-compatibility")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "This family plan needs a refresh" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pending work is kept.",
    );
    expect(screen.queryByTestId("board-grid")).toBeNull();
    expect(screen.queryByText("Pack bag")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh family plan" }),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
