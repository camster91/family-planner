/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
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
    members: [],
  },
};

function renderEditor() {
  return render(
    <I18nProvider>
      <RoutineStackEditor familyId="family-a" mode="page" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  searchParams = new URLSearchParams();
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
      return response({ stack_id: "stack-new" });
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

it("retains an existing draft after conflict and retries with the same key and fingerprint", async () => {
  searchParams = new URLSearchParams(
    "stack_id=stack-a&occurrence_date=2026-10-11",
  );
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let postCount = 0;
  fetchMock.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/candidates")) return response(candidates);
      if (url.includes("/api/chores/stacks?") && !init?.method)
        return response(existing);
      postCount += 1;
      return response(
        { error: { message: "The routine changed." } },
        postCount === 1 ? 409 : 200,
      );
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
  await user.click(screen.getByRole("button", { name: "Save routine" }));

  await waitFor(() => expect(postCount).toBe(2));
  const posts = calls.filter((call) => call.init?.method === "POST");
  expect(posts[0].init?.headers).toEqual(posts[1].init?.headers);
  expect(JSON.parse(String(posts[0].init?.body))).toEqual(
    JSON.parse(String(posts[1].init?.body)),
  );
  expect(JSON.parse(String(posts[0].init?.body))).toMatchObject({
    expected_fingerprint: "opaque-fingerprint",
  });
});

it("uses the scoped Spanish editor labels without translating chore data", async () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/candidates")) return response(candidates);
    return response({ stack_id: "stack-new" });
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
