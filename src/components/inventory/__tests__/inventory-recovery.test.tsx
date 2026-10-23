/** @jest-environment jsdom */
/** Authored only; consolidated browser/keyboard/real storage acceptance remains open. */
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import {
  InventoryRecoveryProvider,
  InventoryRecoveryPanel,
  useInventoryWrites,
} from "../InventoryRecovery";
import { browserInventoryRecovery } from "@/lib/inventory-recovery-browser";
import { postInventoryIntake } from "@/lib/inventory-intake-client";
import {
  postInventoryRestock,
  makeRestockIntent,
} from "@/lib/inventory-restock-client";
import type { InventoryRecoveryEntry } from "@/lib/inventory-recovery-contract";
jest.mock("@/lib/inventory-recovery-browser", () => ({
  browserInventoryRecovery: jest.fn(),
}));
jest.mock("@/lib/inventory-intake-client", () => ({
  ...jest.requireActual("@/lib/inventory-intake-client"),
  postInventoryIntake: jest.fn(),
}));
jest.mock("@/lib/inventory-restock-client", () => ({
  ...jest.requireActual("@/lib/inventory-restock-client"),
  postInventoryRestock: jest.fn(),
}));
const original = { userId: "fixture-parent", familyId: "fixture-family" };
const entry: InventoryRecoveryEntry = {
  kind: "intake",
  key: "original_fixture_key_001",
  body: JSON.stringify({
    protocol: "herewoven.inventory-intake.v1",
    expected_user_id: original.userId,
    expected_family_id: original.familyId,
    issued_at: "2026-10-20T12:00:00.000Z",
    item: {
      name: "Private fixture beans",
      amount: 2,
      unit: "cans",
      location: "pantry",
    },
  }),
};
const reviewed = {
  contract: "herewoven.inventory-recovery-review.v1",
  ownerScope: "a".repeat(64),
  entry,
  state: "ready",
  canRetry: true,
  name: "Canonical fixture beans",
  current: null,
  receipt: null,
};
let controller: ReturnType<typeof browserInventoryRecovery>;
const changed = jest.fn();
const restock = {
  kind: "restock" as const,
  ...makeRestockIntent(
    {
      item_id: "fixture-stock",
      expected_version: "2026-10-20T12:00:00.000Z",
      list_id: "fixture-list",
      content: "Fixture replacement",
      amount: 3,
      unit: "cans",
      allow_similar: false,
    },
    original,
    "original_restock_key_01",
  ),
};
function WriteButtons() {
  const writes = useInventoryWrites(),
    [outcome, setOutcome] = React.useState("");
  return (
    <>
      <button
        onClick={() =>
          void writes.restock(restock).then((result) => setOutcome(result.kind))
        }
      >
        Send restock
      </button>
      <button
        onClick={() =>
          void writes.intake(entry).then((result) => setOutcome(result.kind))
        }
      >
        Send original
      </button>
      <button
        onClick={() =>
          void writes
            .intake({ ...entry, key: "different_fixture_key_002" })
            .then((result) => setOutcome(result.kind))
        }
      >
        Send different
      </button>
      <output>{outcome}</output>
    </>
  );
}
function mount(required = true, locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <InventoryRecoveryProvider required={required} original={original}>
        <WriteButtons />
        <InventoryRecoveryPanel suspended={false} onChanged={changed} />
      </InventoryRecoveryProvider>
    </I18nProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  const mock = {
    writesAvailable: jest.fn(() => true),
    hasUncertainStorage: jest.fn(() => false),
    initialize: jest.fn(async () => []),
    recoverStorage: jest.fn(async () => []),
    stage: jest.fn(async () => undefined),
    inspect: jest.fn(async () => reviewed),
    dismiss: jest.fn(async () => undefined),
    send: jest.fn(async (_key, _review, send) => send(entry, "a".repeat(64))),
  };
  controller = mock as unknown as ReturnType<typeof browserInventoryRecovery>;
  jest.mocked(browserInventoryRecovery).mockReturnValue(controller);
  jest
    .mocked(postInventoryIntake)
    .mockResolvedValue({ kind: "confirmed", itemId: "fixture-stock" });
});
it("keeps the unadopted path free of storage negotiation", async () => {
  mount(false);
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("confirmed");
  expect(browserInventoryRecovery).not.toHaveBeenCalled();
  expect(postInventoryIntake).toHaveBeenCalledWith(entry, undefined);
});
it("stages exact bytes before sending proof and waits for confirmed local dismissal", async () => {
  mount();
  await waitFor(() => expect(controller.initialize).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("confirmed");
  expect(controller.stage).toHaveBeenCalledWith(entry);
  expect(postInventoryIntake).toHaveBeenCalledWith(entry, "a".repeat(64));
  expect(controller.dismiss).toHaveBeenCalledWith(entry.key);
  expect(
    jest.mocked(controller.stage).mock.invocationCallOrder[0],
  ).toBeLessThan(jest.mocked(controller.send).mock.invocationCallOrder[0]);
});
it("does not show saved private content or automatically send recovered work before canonical review", async () => {
  jest
    .mocked(controller.initialize)
    .mockResolvedValue([{ ...entry, reviewRequired: true }]);
  mount();
  await screen.findByRole("button", { name: "Review: Saved change 1" });
  expect(screen.queryByText("Private fixture beans")).toBeNull();
  expect(postInventoryIntake).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review: Saved change 1" }),
  );
  await screen.findByText("Canonical fixture beans");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry original change" }),
  );
  await waitFor(() =>
    expect(controller.dismiss).toHaveBeenCalledWith(entry.key),
  );
  expect(controller.send).toHaveBeenCalledWith(
    entry.key,
    true,
    expect.any(Function),
  );
  expect(changed).toHaveBeenCalledTimes(1);
});
it("retains an unknown write, blocks another key and allows the original retry", async () => {
  jest.mocked(postInventoryIntake).mockResolvedValueOnce({ kind: "unknown" });
  mount();
  await waitFor(() => expect(controller.initialize).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("unknown");
  expect(controller.dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Send different"));
  await screen.findByText("refused");
  expect(controller.stage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("confirmed");
  expect(controller.stage).toHaveBeenNthCalledWith(2, entry);
});
it("keeps the request unknown if confirmed server work cannot be dismissed durably", async () => {
  jest
    .mocked(controller.dismiss)
    .mockRejectedValue(new Error("uncertain storage"));
  mount();
  await waitFor(() => expect(controller.initialize).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("unknown");
  await screen.findByText(
    "The outcome or local storage is still uncertain. Keep the original request and check again.",
  );
});
it("keeps a never-staged fresh draft editable instead of claiming its stock save is unknown", async () => {
  jest
    .mocked(controller.stage)
    .mockRejectedValue(new Error("invalid draft before any storage write"));
  mount();
  await waitFor(() => expect(controller.initialize).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Send original"));
  await screen.findByText("refused");
  expect(controller.send).not.toHaveBeenCalled();
  expect(postInventoryIntake).not.toHaveBeenCalled();
});
it("local dismissal requires confirmation and never sends a stock mutation", async () => {
  jest
    .mocked(controller.initialize)
    .mockResolvedValue([{ ...entry, reviewRequired: true }]);
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Review: Saved change 1" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Dismiss saved recovery" }),
  );
  expect(controller.dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss entry" }));
  await waitFor(() =>
    expect(controller.dismiss).toHaveBeenCalledWith(entry.key),
  );
  expect(postInventoryIntake).not.toHaveBeenCalled();
});
it("stages restocking in the same owned journal and sends only its fixed restock route", async () => {
  jest
    .mocked(controller.send)
    .mockImplementationOnce(async (_key, _review, send) =>
      send(restock, "a".repeat(64)),
    );
  jest
    .mocked(postInventoryRestock)
    .mockResolvedValue({
      kind: "confirmed",
      receipt: {
        itemId: "fixture-grocery-row",
        listId: "fixture-list",
        requestId: "fixture-receipt",
        created: true,
        undoExpiresAt: "2026-10-20T12:10:00.000Z",
      },
    });
  mount();
  await waitFor(() => expect(controller.initialize).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Send restock"));
  await screen.findByText("confirmed");
  expect(controller.stage).toHaveBeenCalledWith(restock);
  expect(postInventoryRestock).toHaveBeenCalledWith(restock, "a".repeat(64));
  expect(controller.dismiss).toHaveBeenCalledWith(restock.key);
  expect(postInventoryIntake).not.toHaveBeenCalled();
});
it("allows private review and confirmed local dismissal while new writes are paused", async () => {
  jest
    .mocked(controller.initialize)
    .mockResolvedValue([{ ...entry, reviewRequired: true }]);
  jest.mocked(controller.writesAvailable).mockReturnValue(false);
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Review: Saved change 1" }),
  );
  await screen.findByText("Canonical fixture beans");
  expect(
    screen.queryByRole("button", { name: "Retry original change" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss saved recovery" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss entry" }));
  await waitFor(() =>
    expect(controller.dismiss).toHaveBeenCalledWith(entry.key),
  );
  expect(postInventoryIntake).not.toHaveBeenCalled();
});
it("shows Spanish recovery copy without revealing saved names before review", async () => {
  jest
    .mocked(controller.initialize)
    .mockResolvedValue([{ ...entry, reviewRequired: true }]);
  mount(true, "es");
  await screen.findByRole("button", { name: "Revisar: Cambio guardado 1" });
  expect(screen.queryByText("Private fixture beans")).toBeNull();
  expect(
    screen.getByRole("dialog", { name: "Cambios de alimentos guardados" }),
  ).toBeInTheDocument();
});
