/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, useTranslation } from "@/i18n";
import FamilyPage from "../page";

jest.mock("@/components/providers/features-provider", () => ({
  useFeatures: () => ({ features: { emergency: true } }),
}));

const rawName = "Private {name} 李";
const members = [
  {
    id: "me",
    name: "Parent raw",
    role: "parent",
    email: "parent@example.test",
  },
  {
    id: "member/child",
    name: rawName,
    role: "child",
    email: "child@example.test",
  },
  { id: "teen", name: "Taylor raw", role: "teen", email: "teen@example.test" },
];
const json = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
const deferred = () => {
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function Language() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Change language</button>;
}
function setup({
  roster = () => json(200, { members }),
  remove = async () => json(200, { success: true }),
  me = "me",
}: {
  roster?: () => Response;
  remove?: () => Promise<Response>;
  me?: string;
} = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  global.fetch = jest.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/auth/me")
      return json(200, {
        user: {
          id: me,
          role: "parent",
          family_id: "family-a",
          family: { name: "Private {family} 李" },
        },
      });
    if (url === "/api/family/members") return roster();
    if (method === "DELETE") return remove();
    return json(404, {});
  }) as typeof fetch;
  render(
    <I18nProvider locale="en">
      <Language />
      <FamilyPage />
    </I18nProvider>,
  );
  return calls;
}

it("renders account-backed cards, preserves private text and hides self removal", async () => {
  const calls = setup();
  await screen.findByRole("heading", { name: rawName });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Private {family} 李",
  );
  expect(screen.getAllByTestId("family-member")).toHaveLength(3);
  expect(screen.getAllByText("Account member")).toHaveLength(3);
  expect(screen.getByText("You")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Remove Parent raw from household" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Invite member" })).toHaveAttribute(
    "href",
    "/dashboard/family/invite",
  );
  expect(calls).toEqual([
    { url: "/api/auth/me", method: "GET" },
    { url: "/api/family/members", method: "GET" },
  ]);
});

it("keeps the selected member, dialog, focus and fetch count through locale changes", async () => {
  const user = userEvent.setup();
  const calls = setup();
  const opener = await screen.findByRole("button", {
    name: `Remove ${rawName} from household`,
  });
  await user.click(opener);
  const dialog = screen.getByRole("dialog");
  const count = calls.length;
  await user.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog).toHaveAccessibleName(`¿Quitar a ${rawName}?`);
  expect(screen.getAllByText("Miembro con cuenta")).toHaveLength(3);
  expect(screen.getByText("Niño o niña")).toBeVisible();
  expect(screen.getByText("child@example.test")).toBeVisible();
  expect(calls).toHaveLength(count);
  await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("retains the pending confirmation and raw refusal, retries the exact id and focuses the roster after removal", async () => {
  const user = userEvent.setup();
  const pending = deferred();
  let attempts = 0;
  const calls = setup({
    remove: () =>
      attempts++ === 0
        ? pending.promise
        : Promise.resolve(json(200, { success: true, tabletsRevoked: 2 })),
  });
  await user.click(
    await screen.findByRole("button", {
      name: `Remove ${rawName} from household`,
    }),
  );
  await user.dblClick(
    screen.getByRole("button", { name: "Remove from household", exact: true }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Removing…" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(calls.filter((call) => call.method === "DELETE")).toEqual([
    { url: "/api/family/members/member%2Fchild", method: "DELETE" },
  ]);
  await act(async () =>
    pending.resolve(json(409, { error: "Private raw refusal {error}" })),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Private raw refusal {error}",
  );
  await user.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Private raw refusal {error}",
  );
  await user.click(
    within(dialog).getByRole("button", {
      name: "Quitar del hogar",
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("heading", { name: rawName }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    `Se quitó a ${rawName} del hogar.`,
  );
  expect(screen.getByRole("status")).toHaveTextContent("tabletas");
  expect(
    screen.getByRole("heading", { name: "Personas de tu hogar" }),
  ).toHaveFocus();
  expect(calls.filter((call) => call.method === "DELETE")).toEqual(
    Array(2).fill({
      url: "/api/family/members/member%2Fchild",
      method: "DELETE",
    }),
  );
});

it.each(["fallback", "network"] as const)(
  "late %s feedback follows the current language without replaying removal",
  async (mode) => {
    const user = userEvent.setup();
    const pending = deferred();
    const calls = setup({ remove: () => pending.promise });
    await user.click(
      await screen.findByRole("button", {
        name: `Remove ${rawName} from household`,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Remove from household",
        exact: true,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Change language" }));
    await act(async () =>
      mode === "network"
        ? pending.reject(new Error("offline"))
        : pending.resolve(json(500, {})),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      mode === "network" ? "Comprueba la conexión" : "Inténtalo de nuevo",
    );
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: rawName })).toBeVisible();
  },
);

it.each([
  { members: {} },
  { members: [{ id: "bad", name: "Malformed", role: {} }] },
])(
  "malformed roster is an error, and Retry recovers without a fake empty state",
  async (invalid) => {
    const user = userEvent.setup();
    let attempt = 0;
    const calls = setup({
      roster: () => json(200, attempt++ === 0 ? invalid : { members }),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your family",
    );
    expect(screen.queryByText("No family members yet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: rawName })).toBeVisible();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  },
);

it("does not offer removal of the last parent and keeps unknown role labels raw", async () => {
  setup({
    me: "other-id",
    roster: () =>
      json(200, {
        members: [
          { id: "only-parent", name: "Only parent", role: "parent" },
          { id: "legacy", name: "Legacy", role: "custom {role}" },
        ],
      }),
  });
  await screen.findByRole("heading", { name: "Only parent" });
  expect(
    screen.queryByRole("button", { name: "Remove Only parent from household" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("custom {role}")).toBeVisible();
});

it("shows a real empty state with the existing invite route", async () => {
  setup({ roster: () => json(200, { members: [] }) });
  const invite = await screen.findByRole("link", { name: "Invite members" });
  expect(invite).toHaveAttribute("href", "/dashboard/family/invite");
  expect(screen.queryByTestId("family-member")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
