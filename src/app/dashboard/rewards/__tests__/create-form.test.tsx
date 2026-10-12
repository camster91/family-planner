/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import CreateRewardForm from "../create/CreateRewardForm";
import { RewardCreateSheet } from "@/components/rewards/RewardCreateSheet";

const push = jest.fn();
const refresh = jest.fn();
const back = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back }),
}));

// The shared feature provider and its effective dependency behavior are tested
// by the feature-gate suite. These form tests keep the reward journey focused.
jest.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => children,
}));

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  back.mockReset();
  global.fetch = jest.fn();
});

it("preserves the rewards payload, selected icon semantics, and destination", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(response(201, { reward: { id: "reward-1" } }));

  render(<CreateRewardForm />);

  await user.type(screen.getByLabelText("Name"), "Extra game time");
  await user.type(screen.getByLabelText(/Description/), "Thirty minutes");
  const cost = screen.getByLabelText("Cost in points");
  fireEvent.change(cost, { target: { value: "75" } });
  await user.click(
    screen.getByRole("button", { name: "Choose reward icon 🎮" }),
  );
  expect(
    screen.getByRole("button", { name: "Choose reward icon 🎮" }),
  ).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Create Reward" }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/rewards",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Extra game time",
        description: "Thirty minutes",
        cost: 75,
        icon: "🎮",
      }),
    }),
  );
});

it("keeps the draft and uses localized safe refusal feedback", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response(403, { error: "Only parents can create rewards" }),
    );

  render(
    <I18nProvider locale="es">
      <CreateRewardForm />
    </I18nProvider>,
  );

  const name = screen.getByLabelText("Nombre");
  const description = screen.getByLabelText(/Descripción/);
  await user.type(name, "Tiempo de juego");
  await user.type(description, "Conservar mientras reintento");
  await user.click(screen.getByRole("button", { name: "Crear recompensa" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Solo un padre o madre puede crear recompensas.",
    ),
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "Only parents can create rewards",
  );
  expect(name).toHaveValue("Tiempo de juego");
  expect(description).toHaveValue("Conservar mientras reintento");
  expect(push).not.toHaveBeenCalled();
});

it("does not render a child or teen create form", () => {
  render(
    <I18nProvider locale="es">
      <CreateRewardForm canCreate={false} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("reward-create-refused")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Solo un padre o madre puede crear recompensas",
    }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Volver a Recompensas" }),
  ).toHaveAttribute("href", "/dashboard/rewards");
});

it.each([
  [
    "en",
    "Name",
    "Create Reward",
    "Close and return",
    "Please wait for saving to finish.",
  ],
  [
    "es",
    "Nombre",
    "Crear recompensa",
    "Cerrar y volver",
    "Espera a que termine de guardarse.",
  ],
] as const)(
  "blocks %s sheet dismissal while the reward request is pending",
  async (locale, nameLabel, submitLabel, closeLabel, pendingDescription) => {
    const user = userEvent.setup();
    let finish!: (result: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );

    render(
      <I18nProvider locale={locale}>
        <div data-dashboard-background>
          <button type="button">Rewards</button>
        </div>
        <RewardCreateSheet canCreate />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText(nameLabel), "Pending reward");
    const submit = screen.getByRole("button", { name: submitLabel });
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByText(pendingDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: closeLabel }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(back).not.toHaveBeenCalled();

    await act(async () =>
      finish(response(201, { reward: { id: "reward-2" } })),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/dashboard/rewards"),
    );
  },
);
