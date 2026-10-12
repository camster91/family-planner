/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
import RoutineStackEditor from "../RoutineStackEditor";

const back = jest.fn();
const refresh = jest.fn();
let searchParams = new URLSearchParams();
const fetchMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back, refresh }),
  useSearchParams: () => searchParams,
}));

function response(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const candidates = {
  occurrence_date: "2026-10-11",
  candidates: [
    {
      id: "chore-unstacked",
      title: "Pack lunches",
      description: null,
      assigned_to: "parent-a",
      assigned_member_id: "member-parent",
      due_date: "2026-10-11T00:00:00.000Z",
      recurrence_id: null,
      is_template: false,
      routine: null,
      routine_order: null,
      status: "pending",
      frequency: "once",
      weekly_days: [],
      difficulty: "easy",
      icon: null,
    },
  ],
  assignmentOptions: [
    { accountId: "parent-a", name: "Alex", role: "parent" },
    { accountId: "child-a", name: "Sam", role: "child" },
  ],
  hasMore: false,
  nextCursor: null,
};

const existing = {
  stack: {
    id: "stack-a",
    family_id: "family-a",
    label: "Morning reset",
    version: 2,
  },
  occurrence_date: "2026-10-11",
  fingerprint: "opaque-fingerprint",
  steps: [
    {
      id: "chore-existing",
      title: "Brush teeth",
      description: "Use the timer",
      assigned_to: "child-a",
      assigned_member_id: "member-child",
      member_subject_erased: false,
      due_date: "2026-10-11T00:00:00.000Z",
      recurrence_id: null,
      is_template: false,
      routine: "Morning reset",
      routine_order: 1,
      status: "pending",
      frequency: "once",
      weekly_days: [],
      difficulty: "easy",
      icon: null,
      points: 10,
      photo_url: null,
      photo_verified: false,
      verified_at: null,
      verified_notes: null,
      completed_at: null,
    },
  ],
  members: [],
  compact: {
    stack_id: "stack-a",
    version: 2,
    fingerprint: "opaque-fingerprint",
    steps: [],
    assignments: [],
    members: [],
  },
};

const saveResponse = {
  stack_id: "stack-new",
  version: 1,
  steps: [],
  assignments: [],
  members: [],
  fingerprint: "saved-fingerprint",
};

function renderEditor() {
  return render(
    <I18nProvider>
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
}

it("uses the canonical routine-name limit in the editor", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });

  renderEditor();
  const label = await screen.findByLabelText("Routine name");
  expect(label).toHaveProperty("maxLength", ROUTINE_NAME_MAX);
});

beforeEach(() => {
  // Candidate responses have a fixed occurrence date; keep the requested
  // date equally explicit so midnight on the runner cannot invalidate them.
  searchParams = new URLSearchParams("occurrence_date=2026-10-11");
  back.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  jest.restoreAllMocks();
});

it("stages an existing chore and a new step, then sends one atomic draft", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      return response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.type(screen.getByLabelText("Chore title"), "Set the table");
  await user.click(screen.getByRole("button", { name: "Add step" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));

  await waitFor(() =>
    expect(calls.some((call) => call.init?.method === "POST")).toBe(true),
  );
  const post = calls.find((call) => call.init?.method === "POST");
  expect(post?.init?.headers).toEqual(
    expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
  );
  const body = JSON.parse(String(post?.init?.body));
  expect(body).toMatchObject({
    family_id: "family-a",
    occurrence_date: "2026-10-11",
    expected_fingerprint: "",
    steps: [
      expect.objectContaining({
        chore_id: "chore-unstacked",
        assigned_to: "parent-a",
      }),
      expect.objectContaining({
        title: "Set the table",
        assigned_to: "parent-a",
        frequency: "once",
      }),
    ],
  });
  expect(refresh).toHaveBeenCalled();
  expect(back).toHaveBeenCalled();
});

it("requires a discard confirmation before reloading after a definitive conflict", async () => {
  searchParams = new URLSearchParams(
    "stack_id=stack-a&occurrence_date=2026-10-11",
  );
  let postCount = 0;
  let readCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/candidates")) return response(candidates);
      if (url.includes("/api/chores/stacks?") && !init?.method) {
        readCount += 1;
        return response(existing);
      }
      postCount += 1;
      return response({ error: { code: "ROUTINE_STACK_CONFLICT" } }, 409);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Brush teeth");
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /changed elsewhere/,
  );
  expect(screen.getByText("Brush teeth")).toBeTruthy();
  expect(postCount).toBe(1);
  await user.click(
    screen.getByRole("button", { name: "Reload latest routine" }),
  );
  const discard = screen.getByRole("alertdialog");
  expect(discard).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(
    within(discard).getByRole("button", {
      name: "Reload latest routine",
    }),
  );
  await waitFor(() => expect(readCount).toBe(2));
  expect(screen.getByText("Brush teeth")).toBeTruthy();
  expect(postCount).toBe(1);
});

it("treats an identity conflict as a localized definitive reload", async () => {
  searchParams = new URLSearchParams(
    "stack_id=stack-a&occurrence_date=2026-10-11",
  );
  let postCount = 0;
  let readCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/candidates")) return response(candidates);
      if (url.includes("/api/chores/stacks?") && !init?.method) {
        readCount += 1;
        return response(existing);
      }
      postCount += 1;
      return response(
        {
          error: {
            code: "IDENTITY_CONFLICT",
            message:
              "Household member identity needs review before this change.",
          },
        },
        409,
      );
    },
  );

  const user = userEvent.setup();
  render(
    <I18nProvider locale="es">
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
  await screen.findByText("Brush teeth");
  const label = screen.getByLabelText("Nombre de la rutina");
  await user.clear(label);
  await user.type(label, "Borrador de identidad");
  await user.click(screen.getByRole("button", { name: "Guardar rutina" }));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "cambió en otro lugar",
  );
  expect(
    screen.queryByRole("button", { name: "Reintentar guardado" }),
  ).toBeNull();
  const reload = screen.getByRole("button", {
    name: "Cargar la rutina más reciente",
  });
  await user.click(reload);
  const discard = screen.getByRole("alertdialog");
  expect(discard).toBeTruthy();
  const reloadConfirm = within(discard).getByRole("button", {
    name: "Cargar la rutina más reciente",
  });
  expect(reloadConfirm.className).toEqual(expect.stringContaining("w-full"));
  expect(reloadConfirm.className).toEqual(expect.stringContaining("sm:w-auto"));
  expect(reloadConfirm.className).toEqual(expect.stringContaining("min-w-0"));
  expect(reloadConfirm.className).toEqual(
    expect.stringContaining("whitespace-normal"),
  );
  expect(reloadConfirm.className).toEqual(
    expect.stringContaining("break-words"),
  );
  expect(reloadConfirm.parentElement?.className).toEqual(
    expect.stringContaining("flex-col"),
  );
  await user.click(
    within(discard).getByRole("button", { name: "Seguir editando" }),
  );
  expect(screen.getByDisplayValue("Borrador de identidad")).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();

  const restoredReload = screen.getByRole("button", {
    name: "Cargar la rutina más reciente",
  });
  await user.click(restoredReload);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Cargar la rutina más reciente",
    }),
  );
  await waitFor(() => expect(readCount).toBe(2));
  expect(screen.queryByDisplayValue("Borrador de identidad")).toBeNull();
  expect(postCount).toBe(1);
});

it("retries malformed success with the same immutable bytes and key", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let postCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      postCount += 1;
      return response(
        postCount === 1 ? { stack_id: "incomplete" } : saveResponse,
      );
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  expect(await screen.findByText(/could not confirm whether/i)).toBeTruthy();
  expect(screen.getByLabelText("Routine name")).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("button", { name: "Retry save" }));

  await waitFor(() => expect(postCount).toBe(2));
  const posts = calls.filter((call) => call.init?.method === "POST");
  expect(posts[0].init?.headers).toEqual(posts[1].init?.headers);
  expect(posts[0].init?.body).toBe(posts[1].init?.body);
  expect(refresh).toHaveBeenCalled();
  expect(back).toHaveBeenCalled();
});

it("treats an in-flight idempotency 409 as uncertain and retries the same packet", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let postCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      postCount += 1;
      return postCount === 1
        ? response({ error: { code: "IDEMPOTENCY_IN_PROGRESS" } }, 409)
        : response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));

  expect(await screen.findByText(/could not confirm whether/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
  expect(screen.getByLabelText("Routine name")).toHaveProperty(
    "disabled",
    true,
  );

  await user.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(postCount).toBe(2));
  const posts = calls.filter((call) => call.init?.method === "POST");
  expect(posts[0].init?.headers).toEqual(posts[1].init?.headers);
  expect(posts[0].init?.body).toBe(posts[1].init?.body);
  expect(refresh).toHaveBeenCalled();
  expect(back).toHaveBeenCalled();
});

it("asks before discarding dirty edits and restores the draft when kept", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });
  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Pack lunches");
  const label = screen.getByLabelText("Routine name");
  await user.clear(label);
  await user.type(label, "Family reset");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(back).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByDisplayValue("Family reset")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(back).toHaveBeenCalled();
});

it("treats malformed candidate responses as load errors instead of an empty draft", async () => {
  fetchMock.mockImplementation(() => response({ candidates: [] }));
  renderEditor();
  expect(
    await screen.findByRole("heading", { name: "Routine could not load" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Routine name")).toBeNull();
});

it("treats malformed existing-stack responses as load errors", async () => {
  searchParams = new URLSearchParams(
    "stack_id=stack-a&occurrence_date=2026-10-11",
  );
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response({ stack: existing.stack, steps: existing.steps });
  });
  renderEditor();
  expect(
    await screen.findByRole("heading", { name: "Routine could not load" }),
  ).toBeTruthy();
  expect(screen.queryByText("Brush teeth")).toBeNull();
});

it("maps a known server code to localized copy without rendering its raw message", async () => {
  let post = false;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    post = true;
    return response(
      { error: { code: "FORBIDDEN", message: "Parent access is required." } },
      403,
    );
  });
  const user = userEvent.setup();
  render(
    <I18nProvider locale="es">
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Añadir" }));
  await user.click(screen.getByRole("button", { name: "Guardar rutina" }));
  await waitFor(() => expect(post).toBe(true));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No tienes permiso para editar esta rutina.",
  );
  expect(screen.queryByText("Parent access is required.")).toBeNull();
});

it("uses the scoped Spanish editor labels without translating chore data", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });
  render(
    <I18nProvider locale="es">
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Nueva rutina" }),
  ).toBeTruthy();
  expect(await screen.findByText("Pack lunches")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar rutina" })).toBeTruthy();
});
