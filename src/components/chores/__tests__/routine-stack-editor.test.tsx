/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
import { toDateOnlyLocal } from "@/lib/dates";
import RoutineStackEditor from "../RoutineStackEditor";

const back = jest.fn();
const push = jest.fn();
const refresh = jest.fn();
let searchParams = new URLSearchParams();
const fetchMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back, push, refresh }),
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
      expected_fingerprint: "candidate-fingerprint",
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

it("uses the local calendar day when occurrence_date is omitted", async () => {
  const now = new Date("2026-10-12T01:30:00.000Z");
  jest.useFakeTimers().setSystemTime(now);
  try {
    searchParams = new URLSearchParams();
    const localDate = toDateOnlyLocal(now);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      expect(String(input)).toContain(
        `occurrence_date=${encodeURIComponent(localDate)}`,
      );
      return response({
        ...candidates,
        occurrence_date: localDate,
        candidates: [],
      });
    });

    renderEditor();
    expect(await screen.findByLabelText("Routine name")).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it("contains long chore titles and fallback assignee IDs in mobile step controls", async () => {
  const longTitle = "A very long chore title ".repeat(12).trim();
  const longAssignee = `account-${"x".repeat(160)}`;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) {
      return response({
        ...candidates,
        assignmentOptions: [],
        candidates: [
          {
            ...candidates.candidates[0],
            title: longTitle,
            assigned_to: longAssignee,
          },
        ],
      });
    }
    return response(saveResponse);
  });

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText(longTitle);
  await user.click(screen.getByRole("button", { name: "Add" }));

  const remove = screen.getByRole("button", {
    name: `Remove ${longTitle} from routine`,
  });
  expect(remove.textContent).toContain(`Remove ${longTitle} from routine`);
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  const option = screen.getByRole("option", { name: longAssignee });
  expect(option.textContent).toContain(longAssignee);
  const assignee = screen.getByRole("combobox", {
    name: `Assigned to: ${longTitle}`,
  });
  expect(screen.getByLabelText(`Assigned to: ${longTitle}`)).toBe(assignee);
  expect((assignee as HTMLSelectElement).disabled).toBe(false);
  expect((assignee as HTMLSelectElement).value).toBe(`account:${longAssignee}`);
});

beforeEach(() => {
  // Candidate responses have a fixed occurrence date; keep the requested
  // date equally explicit so midnight on the runner cannot invalidate them.
  searchParams = new URLSearchParams("occurrence_date=2026-10-11");
  back.mockReset();
  push.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  jest.restoreAllMocks();
});

it("intercepts browser Back for a dirty draft and preserves it behind discard", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });
  const user = userEvent.setup();
  window.history.replaceState(
    { routineTest: "base" },
    "",
    "/dashboard/chores/routines",
  );
  renderEditor();
  await screen.findByText("Pack lunches");
  const label = screen.getByLabelText("Routine name");
  await user.clear(label);
  await user.type(label, "Keep this draft");

  window.history.back();
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  expect(screen.getByDisplayValue("Keep this draft")).toBeTruthy();
  expect(back).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByDisplayValue("Keep this draft")).toBeTruthy();
});

it("retires an owned sentinel on dirty editor unmount and restores the captured Next state", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });
  const user = userEvent.setup();
  const baseState = { routineTest: "base-for-unmount" };
  window.history.replaceState(baseState, "", "/dashboard/chores/routines");
  const view = renderEditor();
  await screen.findByText("Pack lunches");
  await user.type(screen.getByLabelText("Routine name"), "Keep this draft");

  expect(window.history.state).toEqual(
    expect.objectContaining({
      __familyPlannerRoutineStackEditor: expect.any(String),
    }),
  );
  view.unmount();
  expect(window.location.pathname).toBe("/dashboard/chores/routines");
  expect(window.history.state).toEqual(baseState);
  expect(back).not.toHaveBeenCalled();
});

it("cancels a pending sentinel release when an unrelated SPA destination wins", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });
  const user = userEvent.setup();
  window.history.replaceState(
    { routineTest: "base-for-release" },
    "",
    "/dashboard/chores/routines",
  );
  const view = renderEditor();
  await screen.findByText("Pack lunches");
  await user.type(screen.getByLabelText("Routine name"), "Keep this draft");
  const nativeBack = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(nativeBack).toHaveBeenCalledTimes(1);

  window.history.pushState(
    { nextRoute: "unrelated" },
    "",
    "/dashboard/chores/calendar",
  );
  view.unmount();
  nativeBack.mockRestore();

  expect(window.location.pathname).toBe("/dashboard/chores/calendar");
  expect(window.history.state).toEqual({ nextRoute: "unrelated" });
  expect(back).not.toHaveBeenCalled();
});

it("resets stale history ownership when the same editor instance loads a new occurrence", async () => {
  const nextCandidates = {
    ...candidates,
    occurrence_date: "2026-10-12",
    candidates: candidates.candidates.map((candidate) => ({
      ...candidate,
      due_date: "2026-10-12T00:00:00.000Z",
    })),
  };
  let candidateCalls = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) {
      candidateCalls += 1;
      return response(url.includes("2026-10-12") ? nextCandidates : candidates);
    }
    return response(saveResponse);
  });
  const user = userEvent.setup();
  window.history.replaceState(
    { routineTest: "old-occurrence" },
    "",
    "/dashboard/chores/routines?occurrence_date=2026-10-11",
  );
  const view = renderEditor();
  await screen.findByText("Pack lunches");
  await user.type(screen.getByLabelText("Routine name"), "Old draft");
  expect(window.history.state).toEqual(
    expect.objectContaining({
      __familyPlannerRoutineStackEditor: expect.any(String),
    }),
  );

  searchParams = new URLSearchParams("occurrence_date=2026-10-12");
  window.history.pushState(
    { routineTest: "new-occurrence" },
    "",
    "/dashboard/chores/routines?occurrence_date=2026-10-12",
  );
  view.rerender(
    <I18nProvider>
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
  await waitFor(() => expect(candidateCalls).toBe(2));
  await waitFor(() =>
    expect(window.history.state).toEqual({ routineTest: "new-occurrence" }),
  );

  const freshLabel = screen.getByLabelText("Routine name");
  await user.clear(freshLabel);
  await user.type(freshLabel, "Fresh draft");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
  view.unmount();
});

it("keeps browser Back blocked while a save is pending", async () => {
  let releaseSave!: (value: unknown) => void;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return new Promise((resolve) => {
      releaseSave = resolve;
    });
  });
  const user = userEvent.setup();
  window.history.replaceState(
    { routineTest: "pending" },
    "",
    "/dashboard/chores/routines",
  );
  renderEditor();
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Routine name") as HTMLInputElement).disabled,
    ).toBe(true),
  );

  window.history.back();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText(/saving/i)).toBeTruthy();

  releaseSave(await response(saveResponse));
  await waitFor(() => expect(screen.queryByText("Saving routine…")).toBeNull());
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
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
});

it("sends protocol 2 on routine candidates, reads, and saves", async () => {
  searchParams = new URLSearchParams(
    "stack_id=stack-a&occurrence_date=2026-10-11",
  );
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      if (url.includes("/api/chores/stacks?") && !init?.method)
        return response(existing);
      return response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Brush teeth");
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  await waitFor(() =>
    expect(calls.some((call) => call.init?.method === "POST")).toBe(true),
  );

  const routineRequests = calls.filter((call) =>
    call.url.includes("/api/chores/stacks"),
  );
  expect(routineRequests).toHaveLength(3);
  expect(
    routineRequests.every(
      (call) =>
        new Headers(call.init?.headers).get("X-Member-Protocol") === "2",
    ),
  ).toBe(true);
});

it("keeps a name-only profile in the profile namespace when editing a routine", async () => {
  const profileCandidates = {
    ...candidates,
    candidates: [
      {
        ...candidates.candidates[0],
        id: "profile-chore",
        title: "Pack toys",
        assigned_to: null,
        assigned_member_id: "member-jamie",
      },
    ],
    assignmentOptions: [
      ...candidates.assignmentOptions,
      {
        memberId: "member-jamie",
        name: "Jamie",
        role: "child",
      },
    ],
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(profileCandidates);
      return response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await user.click(await screen.findByRole("button", { name: "Add" }));

  const assignee = screen.getByRole("combobox", {
    name: "Assigned to: Pack toys",
  });
  expect((assignee as HTMLSelectElement).value).toBe("profile:member-jamie");
  expect(
    within(assignee).getByRole("option", { name: "Jamie · child" }),
  ).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Save routine" }));
  await waitFor(() =>
    expect(calls.some((call) => call.init?.method === "POST")).toBe(true),
  );
  const post = calls.find((call) => call.init?.method === "POST");
  const body = JSON.parse(String(post?.init?.body));
  expect(body.steps[0]).toMatchObject({
    assigned_to: null,
    assigned_member_id: "member-jamie",
  });
});

it("creates a new profile step without manufacturing an account ID", async () => {
  const profileOptions = {
    ...candidates,
    candidates: [],
    assignmentOptions: [
      ...candidates.assignmentOptions,
      {
        memberId: "member-jamie",
        name: "Jamie",
        role: "child",
      },
    ],
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(profileOptions);
      return response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByLabelText("Routine name");
  await user.type(screen.getByLabelText("Chore title"), "Put away toys");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Assigned to" }),
    "profile:member-jamie",
  );
  await user.click(screen.getByRole("button", { name: "Add step" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  await waitFor(() =>
    expect(calls.some((call) => call.init?.method === "POST")).toBe(true),
  );
  const post = calls.find((call) => call.init?.method === "POST");
  const body = JSON.parse(String(post?.init?.body));
  expect(body.steps[0]).toMatchObject({
    title: "Put away toys",
    assigned_to: null,
    assigned_member_id: "member-jamie",
  });
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
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
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
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
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
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
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

it("treats protocol-unavailable as a definitive refusal and keeps the draft retryable", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let postCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? response({ error: { code: "MEMBER_PROTOCOL_UNAVAILABLE" } }, 409)
          : response(saveResponse);
      }
      return response(saveResponse);
    },
  );

  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("Pack lunches");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "Save routine" }));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "We couldn't load the routine choices. Try again.",
  );
  expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
  expect(
    (screen.getByLabelText("Routine name") as HTMLInputElement).disabled,
  ).toBe(false);

  await user.click(screen.getByRole("button", { name: "Save routine" }));
  await waitFor(() => expect(postCount).toBe(2));
  const posts = calls.filter((call) => call.init?.method === "POST");
  expect(new Headers(posts[0].init?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(posts[1].init?.headers).get("Idempotency-Key"),
  );
  expect(refresh).toHaveBeenCalled();
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

it("uses page-level section semantics for the direct editor", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });

  renderEditor();
  await screen.findByText("Pack lunches");
  expect(screen.queryByRole("main")).toBeNull();
  expect(screen.getByRole("region", { name: "New routine" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Steps", level: 2 })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Steps", level: 3 })).toBeNull();
});

it("keeps sheet content below the dialog title heading", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response(saveResponse);
  });

  render(
    <I18nProvider>
      <RoutineStackEditor familyId="family-a" mode="sheet" />
    </I18nProvider>,
  );
  await screen.findByText("Pack lunches");
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("heading", { name: "New routine", level: 2 }),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole("heading", { name: "Steps", level: 3 }),
  ).toBeTruthy();
  expect(
    within(dialog).queryByRole("heading", { name: "Steps", level: 2 }),
  ).toBeNull();
});

// Bounded request recovery source cases authored UNRUN.
describe('routine editor bounded transport', () => {
  afterEach(() => jest.useRealTimers());
  it('releases stalled initial loading and ignores a late retired response', async () => {
    let late!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { late = resolve; }));
    jest.useFakeTimers();
    renderEditor();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(15001); });
    expect(screen.getByText("We couldn't load the routine choices. Try again.")).toBeTruthy();
    await act(async () => { late(await response(candidates)); });
    expect(screen.queryByText('Pack lunches')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('releases a stalled save into unknown recovery, ignores late success and retries exact bytes/key', async () => {
    let late!: (value: unknown) => void;
    const posts: RequestInit[] = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/candidates')) return response(candidates);
      posts.push(init!);
      return posts.length === 1 ? new Promise(resolve => { late = resolve; }) : response(saveResponse);
    });
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Pack lunches');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    jest.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(45001); });
    expect(screen.getByText(/could not confirm whether/i)).toBeTruthy();
    expect(screen.getByLabelText('Routine name')).toHaveProperty('disabled', true);
    expect(posts).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { late(await response(saveResponse)); });
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    jest.useRealTimers();
    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toBe(posts[0].body);
    expect(posts[1].headers).toEqual(posts[0].headers);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it('refuses an oversized declared save response before decoding and keeps unknown recovery', async () => {
    const decode = jest.fn(async () => saveResponse);
    fetchMock.mockImplementation((input: RequestInfo | URL) => String(input).includes('/candidates') ? response(candidates) : Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-length': String(64 * 1024 + 1) }), json: decode }));
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Pack lunches');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(await screen.findByText(/could not confirm whether/i)).toBeTruthy();
    expect(decode).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy();
  });
});

// Catalog ownership/recovery source cases authored UNRUN.
it.each(['wrong-day', 'duplicate-id', 'cursor-loop', 'inconsistent-cursor'])('keeps the draft/loaded choices and retries the exact page after %s', async failure => {
  const requested: string[] = [];
  const second = { ...candidates.candidates[0], id: 'chore-second', title: 'Vacuum rug' };
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const cursor = new URL(String(input), 'https://family.test').searchParams.get('cursor');
    if (!cursor) return response({ ...candidates, hasMore: true, nextCursor: 'page-two' });
    requested.push(cursor);
    if (requested.length > 1) return response({ ...candidates, candidates: [second] });
    const invalid = { ...candidates, candidates: [second],
      ...(failure === 'wrong-day' ? { occurrence_date: '2026-10-12' } : {}),
      ...(failure === 'duplicate-id' ? { candidates: candidates.candidates } : {}),
      ...(failure === 'cursor-loop' ? { hasMore: true, nextCursor: 'page-two' } : {}),
      ...(failure === 'inconsistent-cursor' ? { hasMore: false, nextCursor: 'page-three' } : {}),
    };
    return response(invalid);
  });
  const user = userEvent.setup();
  renderEditor();
  await screen.findByText('Pack lunches');
  await user.clear(screen.getByLabelText('Routine name'));
  await user.type(screen.getByLabelText('Routine name'), 'My draft stack');
  await user.click(screen.getByRole('button', { name: 'Load more chores' }));
  await screen.findByText("We couldn't load the routine choices. Try again.");
  expect((screen.getByLabelText('Routine name') as HTMLInputElement).value).toBe('My draft stack');
  expect(screen.getAllByText('Pack lunches')).toHaveLength(1);
  expect(screen.queryByText('Vacuum rug')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Load more chores' }));
  await screen.findByText('Vacuum rug');
  expect(requested).toEqual(['page-two', 'page-two']);
  expect(screen.queryByRole('button', { name: 'Load more chores' })).toBeNull();
});
it('retires a pending catalog page on a selected-day change without appending late rows', async () => {
  let late!: (value: unknown) => void;
  let oldSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://family.test');
    if (url.searchParams.get('occurrence_date') === '2026-10-12')
      return response({ ...candidates, occurrence_date: '2026-10-12', candidates: [{ ...candidates.candidates[0], id: 'next-day', title: 'Next-day choice', due_date: '2026-10-12T00:00:00.000Z' }] });
    if (url.searchParams.has('cursor')) {
      oldSignal = init?.signal ?? undefined;
      return new Promise(resolve => { late = resolve; });
    }
    return response({ ...candidates, hasMore: true, nextCursor: 'old-page' });
  });
  const user = userEvent.setup();
  const view = render(<I18nProvider><RoutineStackEditor familyId='family-a' mode='page' /></I18nProvider>);
  await screen.findByText('Pack lunches');
  await user.click(screen.getByRole('button', { name: 'Load more chores' }));
  searchParams = new URLSearchParams('occurrence_date=2026-10-12');
  view.rerender(<I18nProvider><RoutineStackEditor familyId='family-a' mode='page' /></I18nProvider>);
  await screen.findByText('Next-day choice');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { late(await response({ ...candidates, candidates: [{ ...candidates.candidates[0], id: 'late-old', title: 'Late old-day choice' }] })); });
  expect(screen.queryByText('Late old-day choice')).toBeNull();
  expect(screen.getByText('Next-day choice')).toBeTruthy();
});

// Authored UNRUN: subsequent rejection is not evidence about an earlier attempt.
it.each([
  [401, 'SESSION_CHANGED'], [403, 'FORBIDDEN'], [400, 'INVALID_JSON'],
  [409, 'IDENTITY_CONFLICT'], [409, 'MEMBER_PROTOCOL_UNAVAILABLE'],
  [422, 'IDEMPOTENCY_KEY_REUSED'],
])('keeps the original uncertain packet after retry refusal %s/%s', async (status, code) => {
  const posts: RequestInit[] = [];
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/candidates')) return response(candidates);
    posts.push(init!);
    if (posts.length === 1) return response({ stack_id: 'incomplete-response' });
    if (posts.length === 2) return response({ error: { code } }, Number(status));
    return response(saveResponse);
  });
  const user = userEvent.setup();
  renderEditor();
  await screen.findByText('Pack lunches');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await user.click(screen.getByRole('button', { name: 'Save routine' }));
  await screen.findByText(/could not confirm whether/i);
  await user.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  await screen.findByRole('button', { name: 'Retry save' });
  expect(screen.getByLabelText('Routine name')).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Reload latest routine' })).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(posts).toHaveLength(3));
  expect(posts[1].body).toBe(posts[0].body);
  expect(posts[2].body).toBe(posts[0].body);
  expect(posts[1].headers).toEqual(posts[0].headers);
  expect(posts[2].headers).toEqual(posts[0].headers);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
