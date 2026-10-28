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
  profiles = () => json(409, { error: { code: "PROFILE_SETUP_UNSUPPORTED" } }),
  profileCreate = () => json(201, { success: true }),
  remove = async () => json(200, { success: true }),
  me = "me",
  household = true,
}: {
  roster?: () => Response | Promise<Response>;
  profiles?: () => Response | Promise<Response>;
  profileCreate?: () => Response | Promise<Response>;
  remove?: () => Promise<Response>;
  me?: string;
  household?: boolean | (() => boolean);
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
          family_id: (typeof household === "function" ? household() : household)
            ? "family-a"
            : null,
          family: { name: "Private {family} 李" },
        },
      });
    if (url === "/api/family/members") return roster();
    if (url === "/api/family/profiles") {
      return method === "POST" ? profileCreate() : profiles();
    }
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
    { url: "/api/family/profiles", method: "GET" },
    { url: "/api/family/members", method: "GET" },
    { url: "/api/family/profile-links", method: "GET" },
  ]);
});

it("shows active email-free profiles separately from account members", async () => {
  setup({
    profiles: () =>
      json(200, {
        profiles: [
          {
            id: "profile-preschool",
            family_id: "family-a",
            name: "Little one",
            role: "child",
            age: 3,
            archived_at: null,
            revision: 0,
          },
          {
            id: "profile-archived",
            family_id: "family-a",
            name: "Former profile",
            role: "child",
            age: null,
            archived_at: "2026-10-01T00:00:00.000Z",
            revision: 1,
          },
        ],
        profileChoreSupported: false,
      }),
  });

  await screen.findByRole("heading", { name: "Little one" });
  expect(screen.getByRole("heading", { name: "Household profiles" })).toBeVisible();
  expect(screen.getByText("No login account")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Former profile" })).not.toBeInTheDocument();
  expect(screen.getByText("3 account members · 1 household profile")).toBeVisible();
});

it("ignores a late profile response after a newer roster load starts", async () => {
  const pendingProfiles = deferred();
  const pendingMembers = deferred();
  let profileAttempt = 0;
  let memberAttempt = 0;
  setup({
    roster: () =>
      memberAttempt++ === 0
        ? pendingMembers.promise
        : json(200, { members }),
    profiles: () =>
      profileAttempt++ === 0
        ? pendingProfiles.promise
        : json(409, { error: { code: "PROFILE_SETUP_UNSUPPORTED" } }),
  });

  await act(async () => pendingMembers.resolve(json(503, {})));
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: rawName });

  await act(async () =>
    pendingProfiles.resolve(
      json(200, {
        profiles: [
          {
            id: "late-profile",
            family_id: "family-a",
            name: "Late profile",
            role: "child",
            age: 3,
            archived_at: null,
            revision: 0,
          },
        ],
        profileChoreSupported: false,
      }),
    ),
  );
  expect(screen.queryByRole("heading", { name: "Late profile" })).not.toBeInTheDocument();
});

it("keeps the newest profile refresh when an earlier read resolves late", async () => {
  const pendingInitial = deferred();
  let profileRead = 0;
  const createdProfile = {
    id: "created-profile",
    family_id: "family-a",
    name: "Created profile",
    role: "child",
    age: null,
    archived_at: null,
    revision: 0,
  };
  setup({
    profiles: () => {
      profileRead += 1;
      if (profileRead === 1) return pendingInitial.promise;
      if (profileRead === 2) return json(200, { profiles: [], profileChoreSupported: false });
      return json(200, { profiles: [createdProfile], profileChoreSupported: false });
    },
    profileCreate: () => json(201, { profile: createdProfile }),
  });

  await screen.findByRole("heading", { name: rawName });
  await userEvent.click(screen.getByRole("button", { name: "Add a household profile" }));
  await screen.findByRole("dialog");
  await userEvent.type(screen.getByLabelText("Name"), "Created profile");
  await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByRole("heading", { name: "Created profile" });

  await act(async () =>
    pendingInitial.resolve(
      json(200, {
        profiles: [
          {
            ...createdProfile,
            id: "stale-profile",
            name: "Stale profile",
          },
        ],
        profileChoreSupported: false,
      }),
    ),
  );
  expect(screen.getByRole("heading", { name: "Created profile" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Stale profile" })).not.toBeInTheDocument();
});

it("hides saved profiles when a refresh loses parent authorization", async () => {
  let profileRead = 0;
  const initialProfile = {
    id: "initial-profile",
    family_id: "family-a",
    name: "Initial profile",
    role: "child",
    age: 3,
    archived_at: null,
    revision: 0,
  };
  const createdProfile = { ...initialProfile, id: "created-profile", name: "Created profile" };
  setup({
    profiles: () => {
      profileRead += 1;
      if (profileRead === 1) return json(200, { profiles: [initialProfile], profileChoreSupported: false });
      if (profileRead === 2) return json(200, { profiles: [], profileChoreSupported: false });
      return json(403, { error: { code: "PARENT_REQUIRED" } });
    },
    profileCreate: () => json(201, { profile: createdProfile }),
  });

  await screen.findByRole("heading", { name: "Initial profile" });
  await userEvent.click(screen.getByRole("button", { name: "Add a household profile" }));
  await screen.findByRole("dialog");
  await userEvent.type(screen.getByLabelText("Name"), "Created profile");
  await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved.");
  expect(screen.queryByTestId("family-profile")).not.toBeInTheDocument();
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
    screen.getByRole("button", { name: "Remove from household" }),
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
  { members: [members[0], members[0]] },
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

it("offers create and join when membership is absent without exposing cached family details or fetching members", async () => {
  const calls = setup({ household: false });
  await screen.findByText("Choose your household");
  expect(
    screen.getByRole("link", { name: "Create household" }),
  ).toHaveAttribute("href", "/dashboard/family/create");
  expect(screen.getByRole("link", { name: "Join household" })).toHaveAttribute(
    "href",
    "/join",
  );
  expect(
    screen.queryByRole("link", { name: "Invite member" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Your family",
  );
  expect(screen.queryByText("Private {family} 李")).not.toBeInTheDocument();
  expect(calls).toEqual([{ url: "/api/auth/me", method: "GET" }]);
});

it("clears the earlier household name when Retry discovers membership loss", async () => {
  const user = userEvent.setup();
  let attempt = 0;
  const calls = setup({
    household: () => attempt++ === 0,
    roster: () => json(503, {}),
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Private {family} 李",
  );
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Choose your household");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Your family",
  );
  expect(
    screen.queryByRole("link", { name: "Invite member" }),
  ).not.toBeInTheDocument();
  expect(
    calls.filter((call) => call.url === "/api/family/members"),
  ).toHaveLength(1);
});
