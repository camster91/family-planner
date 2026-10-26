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
import { clearRewardCreateIntents, rewardCreateStorageKey, rewardCreateSignature } from "@/lib/reward-create-intent";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";

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

const CREATED_REWARD = {
  reward: {
    id: "reward-1",
    name: "Extra game time",
    description: "Thirty minutes",
    cost: 75,
    icon: "🎮",
    status: "available",
  },
};

const createdRewardFor = (name: string, cost = 50, icon = "🎁") => ({
  reward: {
    id: `reward-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    cost,
    icon,
    status: "available",
  },
});

const createdRewardForOwner = (
  owner: { userId: string; familyId: string },
  name: string,
  cost = 50,
  icon = "🎁",
) => {
  const created = createdRewardFor(name, cost, icon);
  return {
    reward: {
      ...created.reward,
      family_id: owner.familyId,
      created_by: owner.userId,
    },
  };
};

beforeEach(() => {
  clearRewardCreateIntents();
  push.mockReset();
  refresh.mockReset();
  back.mockReset();
  global.fetch = jest.fn();
});

it("preserves the rewards payload, selected icon semantics, and destination", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(response(201, CREATED_REWARD));

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
  const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
  expect(isValidIdempotencyKey((request.headers as Record<string, string>)["Idempotency-Key"])).toBe(true);
});

it("retries an uncertain create with the same idempotency key and keeps the draft", async () => {
  const user = userEvent.setup();
  const requests: RequestInit[] = [];
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    if (requests.length === 1) throw new TypeError("offline");
    return response(201, createdRewardFor("Extra game time"));
  }) as unknown as typeof fetch;

  render(<CreateRewardForm />);
  const name = screen.getByLabelText("Name");
  await user.type(name, "Extra game time");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(name).toHaveValue("Extra game time");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect((requests[0].headers as Record<string, string>)["Idempotency-Key"]).toBe(
    (requests[1].headers as Record<string, string>)["Idempotency-Key"],
  );
  expect(isValidIdempotencyKey((requests[0].headers as Record<string, string>)["Idempotency-Key"])).toBe(true);
});

it("restores an unresolved owner-scoped draft and key after the sheet remounts", async () => {
  const user = userEvent.setup();
  const requests: RequestInit[] = [];
  const owner = { userId: "owner-a", familyId: "family-a" };
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    if (requests.length === 1) throw new TypeError("offline");
    return response(201, createdRewardForOwner(owner, "Extra game time", 75, "🎮"));
  }) as unknown as typeof fetch;
  const first = render(<CreateRewardForm owner={owner} />);
  await user.type(screen.getByLabelText("Name"), "Extra game time");
  fireEvent.change(screen.getByLabelText("Cost in points"), { target: { value: "75" } });
  await user.click(screen.getByRole("button", { name: "Choose reward icon 🎮" }));
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  first.unmount();

  const other = render(<CreateRewardForm owner={{ userId: "owner-b", familyId: "family-b" }} />);
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  other.unmount();

  render(<CreateRewardForm owner={owner} />);
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Extra game time"));
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect((requests[0].headers as Record<string, string>)["Idempotency-Key"]).toBe(
    (requests[1].headers as Record<string, string>)["Idempotency-Key"],
  );
});

it("switches owner scopes while mounted without carrying the previous draft", async () => {
  const user = userEvent.setup();
  const ownerA = { userId: "mounted-owner-a", familyId: "mounted-family-a" };
  const ownerB = { userId: "mounted-owner-b", familyId: "mounted-family-b" };
  global.fetch = jest.fn().mockResolvedValue(response(201, createdRewardForOwner(ownerB, "B's reward", 40, "🍕")));
  const view = render(<CreateRewardForm owner={ownerA} />);

  await user.type(screen.getByLabelText("Name"), "A's private draft");
  view.rerender(<CreateRewardForm owner={ownerB} />);
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  await user.type(screen.getByLabelText("Name"), "B's reward");
  fireEvent.change(screen.getByLabelText("Cost in points"), { target: { value: "40" } });
  await user.click(screen.getByRole("button", { name: "Choose reward icon 🍕" }));
  await user.click(screen.getByRole("button", { name: "Create Reward" }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/rewards",
    expect.objectContaining({
      body: JSON.stringify({ name: "B's reward", cost: 40, icon: "🍕" }),
    }),
  );
  view.rerender(<CreateRewardForm owner={ownerA} />);
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("A's private draft"));
});

it("clears only a validated successful draft before a fresh reopen", async () => {
  const user = userEvent.setup();
  const owner = { userId: "success-owner", familyId: "success-family" };
  global.fetch = jest.fn().mockResolvedValue(response(201, createdRewardForOwner(owner, "Fresh reward")));
  const view = render(<CreateRewardForm owner={owner} />);
  await user.type(screen.getByLabelText("Name"), "Fresh reward");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  view.unmount();

  render(<CreateRewardForm owner={owner} />);
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  expect(screen.getByLabelText("Cost in points")).toHaveValue(50);
});

it.each([
  ["another owner", { family_id: "another-family", created_by: "another-user" }],
  ["missing owner fields", {}],
  ["null owner fields", { family_id: null, created_by: null }],
  ["camelCase aliases", { familyId: "dto-family", createdBy: "dto-owner" }],
] as const)("does not accept a successful DTO with %s", async (_label, ownerFields) => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockResolvedValue(response(201, {
    reward: {
      ...createdRewardFor("Private reward").reward,
      ...ownerFields,
    },
  }));
  const owner = { userId: "dto-owner", familyId: "dto-family" };
  render(<CreateRewardForm owner={owner} />);
  await user.type(screen.getByLabelText("Name"), "Private reward");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The reward may have been saved");
  expect(push).not.toHaveBeenCalled();
});

it("keeps the create key for an in-progress response", async () => {
  const user = userEvent.setup();
  const requests: RequestInit[] = [];
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return requests.length === 1
      ? response(409, { error: "A create is still in progress" })
      : response(201, createdRewardFor("Extra game time"));
  }) as unknown as typeof fetch;

  render(<CreateRewardForm />);
  const name = screen.getByLabelText("Name");
  await user.type(name, "Extra game time");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't create");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect((requests[0].headers as Record<string, string>)["Idempotency-Key"]).toBe(
    (requests[1].headers as Record<string, string>)["Idempotency-Key"],
  );
  expect(isValidIdempotencyKey((requests[0].headers as Record<string, string>)["Idempotency-Key"])).toBe(true);
});

it("keeps the direct Back control noninteractive while saving", async () => {
  const user = userEvent.setup();
  let finish!: (result: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );

  render(<CreateRewardForm />);
  await user.type(screen.getByLabelText("Name"), "Pending reward");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));

  expect(screen.getByTestId("reward-create-back-busy")).toHaveTextContent(
    "Back to Rewards",
  );
  expect(
    screen.queryByRole("link", { name: "Back to Rewards" }),
  ).not.toBeInTheDocument();

  await act(async () => finish(response(201, createdRewardFor("Pending reward"))));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/rewards"),
  );
});

it("masks private inputs and uses localized access-refusal feedback", async () => {
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
      "Tu acceso a recompensas cambió.",
    ),
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "Only parents can create rewards",
  );
  expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Descripción/)).not.toBeInTheDocument();
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
    expect(screen.getByLabelText(nameLabel)).toBeDisabled();
    expect(screen.getByLabelText(/Description|Descripción/)).toBeDisabled();
    expect(screen.getByLabelText(locale === "en" ? "Cost in points" : "Costo en puntos")).toBeDisabled();
    expect(screen.getByRole("button", { name: locale === "en" ? "Choose reward icon 🎁" : "Elegir icono de recompensa 🎁" })).toBeDisabled();
    expect(screen.getByText(pendingDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: closeLabel }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(back).not.toHaveBeenCalled();

    await act(async () => finish(response(201, createdRewardFor("Pending reward"))));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/dashboard/rewards"),
    );
  },
);

// Authored UNRUN: retry targets the original save even after draft edits.
it("retries original reward details after edits instead of creating the edited draft", async () => {
  const user = userEvent.setup(); const calls: RequestInit[] = [];
  global.fetch = jest.fn(async (_url, init) => { calls.push(init ?? {}); if (calls.length === 1) throw new TypeError("offline"); return response(201, createdRewardFor("Original reward")); }) as typeof fetch;
  render(<CreateRewardForm />);
  await user.type(screen.getByLabelText("Name"), "Original reward");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  await screen.findByRole("button", { name: "Try again" });
  await user.clear(screen.getByLabelText("Name")); await user.type(screen.getByLabelText("Name"), "Edited draft");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/rewards"));
  expect(calls[1].body).toBe(calls[0].body); expect(calls[1].headers).toEqual(calls[0].headers);
});
it("holds a legacy untimed save without replacing its key or posting again", async () => {
  const owner = { userId: "legacy-owner", familyId: "legacy-family" };
  const draft = { name: "Legacy reward", description: "", cost: 50, icon: "🎁" };
  const signature = rewardCreateSignature(draft); const key = "legacy-reward-key-12345678";
  window.localStorage.setItem(rewardCreateStorageKey(owner), JSON.stringify({ version: 1, owner, latestDraft: draft, intents: { [signature]: { key, draft } } }));
  const user = userEvent.setup(); render(<CreateRewardForm owner={owner} />);
  await screen.findByText("The original save is too old or its timing is unknown. Your draft and request are kept. Check Rewards before creating anything new.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  expect(global.fetch).not.toHaveBeenCalled();
  const saved = JSON.parse(window.localStorage.getItem(rewardCreateStorageKey(owner))!);
  expect(saved.intents[signature].key).toBe(key); expect(saved.intents[signature].issuedAt).toBeUndefined();
});
it("retires an unmounted save and keeps recovery after an abort-ignoring late success", async () => {
  const owner = { userId: "retired-owner", familyId: "retired-family" };
  let finish!: (value: Response) => void; let signal: AbortSignal | null | undefined;
  global.fetch = jest.fn(async (_url, init) => { signal = init?.signal; return new Promise<Response>(resolve => { finish = resolve }); }) as typeof fetch;
  const user = userEvent.setup(); const { unmount } = render(<CreateRewardForm owner={owner} />);
  await user.type(screen.getByLabelText("Name"), "Pending original");
  await user.click(screen.getByRole("button", { name: "Create Reward" }));
  unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => finish(response(201, createdRewardForOwner(owner, "Pending original"))));
  expect(push).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  const saved = JSON.parse(window.localStorage.getItem(rewardCreateStorageKey(owner))!); expect(Object.keys(saved.intents)).toHaveLength(1);
});
