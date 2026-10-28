/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import type { MealPrepSummary } from "@/lib/meal-batches";
import { MealPrepActionSheet } from "../MealPrepActionSheet";
import { MealPrepEditor } from "../MealPrepEditor";

jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => undefined,
  }),
}));

const context = { familyId: "family-1", userId: "user-1" };
const session: MealPrepSummary = {
  id: "prep-1",
  prepared_on: "2026-01-05T00:00:00.000Z",
  next_prep_on: null,
  prepared_at: null,
  batches: [
    {
      id: "batch-1",
      name: "Chili",
      total_servings: 4,
      reserve_storage: "freezer",
      recipe_id: null,
      cook_id: null,
      meals: [],
      consumption: [],
    },
  ],
};

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("mounted bulk cooking write guards", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/family/members")
        return Promise.resolve(reply(200, { members: [] }));
      if (url.startsWith("/api/recipes"))
        return Promise.resolve(reply(200, { recipes: [], nextOffset: null }));
      return Promise.resolve(reply(200, { sessionId: "unexpected" }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const postCalls = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

  it("keeps the mounted editor reviewable but blocks a fresh save after reload failure", async () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <MealPrepEditor
          defaultDay="2026-01-05"
          context={context}
          freshWritesBlocked={false}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("Dish name"), {
      target: { value: "Chili" },
    });

    rerender(
      <I18nProvider locale="en">
        <MealPrepEditor
          defaultDay="2026-01-05"
          context={context}
          freshWritesBlocked
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Chili" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save prep session" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeVisible();

    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(postCalls()).toHaveLength(0);
  });

  it("blocks a mounted allocation save while retaining the read-only reload path", () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="allocate"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked={false}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a meal" }));
    rerender(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="allocate"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Save meals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeVisible();

    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(postCalls()).toHaveLength(0);
  });

  it("keeps one reload action when a prior mutation error meets a refresh block", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST")
        return Promise.resolve(
          reply(409, { error: { code: "BATCH_FULL" } }),
        );
      return Promise.resolve(reply(200, { members: [] }));
    });
    const { rerender } = render(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="allocate"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked={false}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a meal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save meals" }));
    await screen.findByRole("alert");

    rerender(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="allocate"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </I18nProvider>,
    );
    expect(
      screen.getAllByRole("button", { name: "Reload latest" }),
    ).toHaveLength(1);
  });

  it("disables eaten submission when reload finds no portions left", async () => {
    const consumedSession: MealPrepSummary = {
      ...session,
      batches: [
        {
          ...session.batches[0],
          consumption: [
            {
              id: "consumption-1",
              meal_id: null,
              servings: 4,
              consumed_at: "2026-01-06T12:00:00.000Z",
            },
          ],
        },
      ],
    };
    const { rerender } = render(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="eaten"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [consumedSession]}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Portions eaten")).toBeDisabled(),
    );
    expect(
      screen.getByText("This dish has no unplanned portions. No meals were changed."),
    ).toBeVisible();

    // The parent normally clears the fresh-write hold after this reload. The
    // local availability guard must still prevent the stale eaten mutation.
    rerender(
      <I18nProvider locale="en">
        <MealPrepActionSheet
          kind="eaten"
          session={session}
          batch={session.batches[0]}
          context={context}
          freshWritesBlocked={false}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [consumedSession]}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Save eaten portions" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Portions eaten")).toBeDisabled();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(postCalls()).toHaveLength(0);
  });
});
