/** Authored/unrun. Existing forms must delegate owned saves, not legacy POSTs. */
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { MealPrepActionSheet } from "../../MealPrepActionSheet";
import { BulkRecoveryProvider } from "../BulkRecoveryContext";
import type { BulkRecovery } from "../useBulkRecovery";
import { context } from "@/lib/meal-prep-recovery/__tests__/fixture";
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => true,
  }),
}));
const batch = {
  id: "batch-a",
  name: "Synthetic rice",
  total_servings: 4,
  reserve_storage: "fridge" as const,
  recipe_id: null,
  cook_id: null,
  meals: [],
  consumption: [],
  portions_complete: true,
};
const session = {
  id: "prep-a",
  prepared_on: "2026-10-22T00:00:00.000Z",
  prepared_at: "2026-10-22T12:00:00.000Z",
  next_prep_on: null,
  batches: [batch],
};
function state() {
  return {
    mode: "owned",
    context: context(),
    rows: [],
    draft: null,
    active: true,
    dirty: false,
    formKey: "draft_fixture_1234",
    busy: false,
    held: false,
    issue: null,
    confirmed: {},
    inspections: {},
    save: jest.fn(async () => undefined),
    attach: jest.fn(),
    detach: jest.fn(),
    changed: jest.fn(),
    isBusy: () => false,
    storageUncertain: () => false,
    clearError: jest.fn(),
  } as unknown as BulkRecovery;
}
it("does not mutate on mount and submits prepared-only allocation through the shared controller", () => {
  const driver = state(),
    fetchMock = jest.fn();
  global.fetch = fetchMock;
  render(
    <I18nProvider locale="en">
      <BulkRecoveryProvider value={driver}>
        <MealPrepActionSheet
          kind="allocate"
          requirePrepared
          session={session}
          batch={batch}
          context={{ userId: context().userId, familyId: context().familyId }}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </BulkRecoveryProvider>
    </I18nProvider>,
  );
  expect(driver.save).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add a meal" }));
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  expect(driver.save).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "allocate",
      require_prepared: true,
      batch_id: "batch-a",
      expected_user_id: "parent-a",
      expected_family_id: "family-a",
      meals: [expect.objectContaining({ servings: 4 })],
    }),
    "/api/meals/bulk/actions",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps a confirmed receipt distinct from a fresh editable form", () => {
  const driver = state();
  driver.confirmed = {
    draft_fixture_1234: { batchId: "batch-a", mealIds: ["meal-a"] },
  };
  driver.rows = [
    {
      kind: "meal-prep",
      key: "draft_fixture_1234",
      body: "unused receipt fixture",
    },
  ];
  render(
    <I18nProvider locale="en">
      <BulkRecoveryProvider value={driver}>
        <MealPrepActionSheet
          kind="allocate"
          session={session}
          batch={batch}
          context={{ userId: context().userId, familyId: context().familyId }}
          onClose={jest.fn()}
          onSaved={jest.fn()}
          onReload={async () => [session]}
        />
      </BulkRecoveryProvider>
    </I18nProvider>,
  );
  expect(screen.getByText(/Save confirmed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save meals" })).toBeDisabled();
  expect(
    screen
      .getAllByRole("button", { name: "Close bulk cooking" })
      .every((button) => !button.hasAttribute("disabled")),
  ).toBe(true);
});
