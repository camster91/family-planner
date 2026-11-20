/**
 * @jest-environment jsdom
 */
// Owner review 2026-11-19 of the kid and teen home: statuses kids could not
// see (waiting for a parent's check, claimed rewards), chore details
// (instructions and the parent's reference photo), pictures guessed from the
// title, read-aloud, plain teen wording, and a child home with one main job.
import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KidHome from "../KidHome";
import { ToastProvider } from "@/components/ui/toast";
import { FeaturesProvider } from "@/components/providers/features-provider";
import { defaultFeatures } from "@/lib/features";
import { I18nProvider } from "@/i18n";
import { kidHomeMessages } from "@/i18n/kid-home";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

beforeAll(() => {
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  delete (window as any).speechSynthesis;
  delete (window as any).SpeechSynthesisUtterance;
});
beforeEach(() => {
  jest
    .useFakeTimers({ advanceTimers: true })
    .setSystemTime(new Date(2026, 9, 6, 12));
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  })) as unknown as typeof fetch;
});

const pad = (n: number) => String(n).padStart(2, "0");
function day(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`;
}

type C = {
  id: string;
  title: string;
  status?: string;
  due_date: string;
  points?: number;
  description?: string | null;
  photo_url?: string | null;
  icon?: string | null;
};

function renderHome(
  chores: C[],
  extra: Partial<React.ComponentProps<typeof KidHome>> = {},
  locale: "en" | "es" = "en",
) {
  const { user: extraUser, ...rest } = extra;
  return render(
    <I18nProvider locale={locale}>
      <FeaturesProvider
        initial={{ ...defaultFeatures(), gamification: true, rewards: true }}
      >
        <ToastProvider>
          <KidHome
            user={{
              id: "kid-1",
              family_id: "family-1",
              name: "Casey",
              role: "child",
              xp: 80,
              level: 1,
              ...extraUser,
            }}
            chores={chores.map((c) => ({
              status: "pending",
              icon: null,
              routine: null,
              routine_order: null,
              ...c,
            }))}
            events={[]}
            rewards={[]}
            {...rest}
          />
        </ToastProvider>
      </FeaturesProvider>
    </I18nProvider>,
  );
}

describe("statuses kids could not see", () => {
  it("shows a finished chore as waiting for a parent's check, with the points it will earn", () => {
    renderHome([
      { id: "a", title: "Feed the dog", due_date: day(0) },
      {
        id: "w1",
        title: "Empty the dishwasher",
        status: "completed",
        due_date: day(0),
        points: 15,
      },
      {
        id: "w2",
        title: "Rake leaves",
        status: "completed",
        due_date: day(-5),
        points: 20,
      },
    ]);
    const waiting = screen.getByTestId("kid-waiting");
    expect(within(waiting).getByRole("heading", { name: "Finished" })).toBeTruthy();
    const rows = within(waiting).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Rake leavesWaiting for a parent's check · 20 points when checked",
      "Empty the dishwasherWaiting for a parent's check · 15 points when checked",
    ]);
    // Not shown as an undone mission.
    const missions = screen.getByText("Today's Missions").closest("section")!;
    expect(within(missions).queryByText("Empty the dishwasher")).toBeNull();
  });

  it("keeps a claimed reward visible as claimed, without a Claim button", () => {
    renderHome([], {
      rewards: [
        { id: "r1", name: "Movie night", cost: 50, status: "available" },
        { id: "r2", name: "Pizza", cost: 40, status: "claimed" },
      ],
    });
    const claimed = screen.getByTestId("kid-claimed-rewards");
    expect(within(claimed).getByText("Pizza")).toBeTruthy();
    expect(
      within(claimed).getByText("Claimed — waiting for a parent"),
    ).toBeTruthy();
    expect(within(claimed).queryByRole("button")).toBeNull();
    // Only the available one is offered.
    expect(screen.getAllByRole("button", { name: "Claim" })).toHaveLength(1);
  });
});

describe("chore details and pictures", () => {
  it("shows the instructions and the parent's reference photo on an open mission", () => {
    renderHome([
      {
        id: "a",
        title: "Tidy the shoe rack",
        description: "Pairs together, boots at the back.",
        photo_url: "/api/files/rack.jpg",
        due_date: day(0),
      },
      {
        id: "b",
        title: "Old proof",
        description: "Done earlier",
        photo_url: "/api/files/proof.jpg",
        status: "verified",
        due_date: day(0),
      },
    ]);
    const mission = screen.getByRole("button", { name: /Tidy the shoe rack/ });
    expect(within(mission).getByTestId("mission-description").textContent).toBe(
      "Pairs together, boots at the back.",
    );
    const photo = within(mission).getByRole("img", {
      name: "Picture from a parent",
    });
    expect(photo.getAttribute("src")).toBe("/api/files/rack.jpg");
    // A done chore's photo may be the child's proof: not shown as a reference.
    expect(screen.getAllByTestId("mission-photo")).toHaveLength(1);
  });

  it("picks a picture from the title when a chore has none, and shows none when nothing fits", () => {
    renderHome([
      { id: "a", title: "Feed the dog", due_date: day(0) },
      { id: "b", title: "Mow the lawn", due_date: day(0) },
      { id: "c", title: "Anything", icon: "laundry", due_date: day(0) },
    ]);
    const icon = (title: RegExp) =>
      within(screen.getByRole("button", { name: title }))
        .queryByTestId("mission-picture")
        ?.getAttribute("data-icon") ?? null;
    expect(icon(/Feed the dog/)).toBe("feed-pet");
    expect(icon(/Mow the lawn/)).toBeNull();
    // A parent's own picture always wins.
    expect(icon(/Anything/)).toBe("laundry");
  });
});

describe("read aloud", () => {
  it("is hidden when the browser cannot speak", () => {
    renderHome([{ id: "a", title: "Feed the dog", due_date: day(0) }]);
    expect(screen.queryByRole("button", { name: "Read aloud" })).toBeNull();
  });

  it("reads the mission title and instructions with the browser's voice", async () => {
    const speak = jest.fn();
    const cancel = jest.fn();
    (window as any).speechSynthesis = { speak, cancel };
    (window as any).SpeechSynthesisUtterance = function (this: any, text: string) {
      this.text = text;
    };
    renderHome(
      [
        {
          id: "a",
          title: "Feed the dog",
          description: "One scoop",
          due_date: day(0),
        },
      ],
      {},
      "es",
    );
    const button = await screen.findByRole("button", {
      name: "Leer en voz alta",
    });
    expect(button.className).toContain("h-11");
    await userEvent.click(button);
    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toMatchObject({
      text: "Feed the dog. One scoop",
      lang: "es",
    });
    // Reading aloud never ticks the chore.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("teen tone", () => {
  // Built per test: the fake clock is set in beforeEach.
  const teenChores = (): C[] => [
    { id: "a", title: "Laundry", due_date: day(0), points: 20 },
    { id: "m", title: "Mow the lawn", status: "overdue", due_date: day(-3) },
  ];

  it("uses plain wording for a teen: To do, Overdue, pts, no sparkles", () => {
    const { container } = renderHome(teenChores(), {
      user: { name: "Taylor", role: "teen", xp: 340, level: 4 },
    });
    expect(screen.getByText("To do")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.queryByText("Today's Missions")).toBeNull();
    expect(screen.queryByText("Still to do")).toBeNull();
    expect(screen.getByText("20 pts")).toBeTruthy();
    expect(screen.getByText("Level 4 · 340 pts")).toBeTruthy();
    expect(screen.getByText("60 pts to the next level")).toBeTruthy();
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
    expect(container.textContent).not.toMatch(/mission|superstar/i);
  });

  it("keeps the child's tone", () => {
    const { container } = renderHome(teenChores());
    expect(screen.getByText("Today's Missions")).toBeTruthy();
    expect(screen.getByText("Still to do")).toBeTruthy();
    expect(screen.getByText("20 points")).toBeTruthy();
    expect(container.querySelector(".lucide-sparkles")).toBeTruthy();
  });

  it("has plain Spanish teen wording", () => {
    renderHome(teenChores(), { user: { role: "teen", xp: 340, level: 4 } }, "es");
    expect(screen.getByText("Por hacer")).toBeTruthy();
    expect(screen.getByText("Atrasadas")).toBeTruthy();
    expect(screen.queryByText("Misiones de hoy")).toBeNull();
  });

  it("keeps the teen and child dictionaries in lockstep", () => {
    expect(Object.keys(kidHomeMessages.es).sort()).toEqual(
      Object.keys(kidHomeMessages.en).sort(),
    );
    for (const value of Object.values(kidHomeMessages.en))
      expect(value).not.toMatch(/✨/);
    for (const key of Object.keys(kidHomeMessages.en).filter((k) =>
      k.startsWith("teen"),
    ) as (keyof typeof kidHomeMessages.en)[])
      expect(kidHomeMessages.en[key]).not.toMatch(/mission|superstar|!/i);
  });
});

describe("one main job first on a child's home", () => {
  it("has no Quiet view on a child's home; a teen keeps it", () => {
    renderHome([{ id: "a", title: "Feed the dog", due_date: day(0) }]);
    expect(screen.queryByText("Quiet view")).toBeNull();
    cleanup();
    renderHome([{ id: "a", title: "Feed the dog", due_date: day(0) }], {
      user: { role: "teen" },
    });
    expect(screen.getByText("Quiet view")).toBeTruthy();
  });
});
