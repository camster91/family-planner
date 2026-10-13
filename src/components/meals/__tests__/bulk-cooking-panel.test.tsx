/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { BulkCookingPanel } from "../BulkCookingPanel";

jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const session = {
  id: "prep-1",
  prepared_on: "2026-01-05T00:00:00.000Z",
  next_prep_on: null,
  prepared_at: null,
  batches: [
    {
      id: "batch-1",
      name: "Chili",
      total_servings: 4,
      reserve_storage: "freezer" as const,
      recipe_id: null,
      cook_id: null,
      meals: [],
      consumption: [],
    },
  ],
};

function payload(nextCursor: string | null) {
  return {
    context: { familyId: "family-1", userId: "user-1" },
    sessions: [session],
    nextCursor,
  };
}

describe("bulk cooking refresh recovery", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("blocks fresh actions after a refresh error and unlocks them after reload", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, payload("cursor-1")))
      .mockResolvedValueOnce(reply(500, { error: "temporary" }))
      .mockResolvedValueOnce(reply(200, payload(null)));

    render(
      <I18nProvider locale="en">
        <BulkCookingPanel
          defaultDay="2026-01-05"
          refreshKey="initial"
          onMealsChanged={jest.fn()}
          onContext={jest.fn()}
        />
      </I18nProvider>,
    );

    const plan = await screen.findByRole("button", {
      name: "Plan a prep session",
    });
    const portions = await screen.findByRole("button", {
      name: "Plan portions",
    });
    await waitFor(() => {
      expect(plan).toBeEnabled();
      expect(portions).toBeEnabled();
    });
    expect(screen.getByText("Chili")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Load more prep sessions" }),
    );
    await screen.findByRole("alert");
    expect(plan).toBeDisabled();
    expect(portions).toBeDisabled();
    expect(screen.getByText("Chili")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => {
      expect(plan).toBeEnabled();
      expect(portions).toBeEnabled();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
