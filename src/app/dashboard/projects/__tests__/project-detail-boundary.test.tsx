/**
 * @jest-environment jsdom
 */
// The project detail page is a server component. React refuses to serialize a
// function prop from a server component to a client component, so the page
// used to throw as soon as a project had a task (an inline `onChange` on
// CheckboxRow and an inline `onClick` on "Send to Calendar"). Handlers now
// live in the client components the page renders.
import * as React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";

const mockPrisma = {
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  project: { findFirst: jest.fn() },
  projectTask: { findMany: jest.fn(), groupBy: jest.fn() },
};
let mockServerRole: "parent" | "child" = "parent";
jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({
    id: "u1",
    email: "parent@example.test",
    role: mockServerRole,
    family_id: "fam-a",
  }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ProjectDetailPage from "../[id]/page";
import { ProjectTaskChecklist } from "../[id]/ProjectTaskChecklist";
import { SendToCalendarButton } from "../[id]/SendToCalendarButton";
import { ToastProvider } from "@/components/ui/toast";
import { defaultFeatures } from "@/lib/features";

type AnyProps = Record<string, unknown>;
type AsyncComponent = (
  props: AnyProps,
) => Promise<React.ReactElement<AnyProps> | null>;

async function renderDetail(id: string) {
  const outer = ProjectDetailPage({
    params: Promise.resolve({ id }),
  }) as React.ReactElement<{
    children: React.ReactElement<AnyProps>;
  }>;
  const asyncChild = outer.props.children;
  const inner = await (asyncChild.type as AsyncComponent)(asyncChild.props);
  if (!inner) return null;
  return (inner.type as AsyncComponent)(inner.props);
}

/** Every element in the server-rendered tree, including ones passed as props (e.g. `trailing`). */
function elementsIn(
  node: unknown,
  out: React.ReactElement<AnyProps>[] = [],
): React.ReactElement<AnyProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsIn(child, out);
  } else if (React.isValidElement(node)) {
    const el = node as React.ReactElement<AnyProps>;
    out.push(el);
    for (const value of Object.values(el.props)) elementsIn(value, out);
  }
  return out;
}

const task = (id: string, title: string, completed: boolean) => ({
  id,
  title,
  description: null,
  completed,
  assigned_to: null,
  due_date: new Date("2026-10-15T00:00:00Z"),
  position: 0,
  assignee: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockServerRole = "parent";
  mockPrisma.user.findUnique.mockResolvedValue({
    family_id: "fam-a",
    role: "parent",
    family: { features: { ...defaultFeatures(), projects: true } },
  });
  mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", name: "Pat" }]);
  mockPrisma.projectTask.findMany.mockResolvedValue([
    { ...task("t1", "Sweep floor", false), created_at: new Date("2026-10-10T00:00:00Z") },
    { ...task("t2", "Hang shelves", true), created_at: new Date("2026-10-10T00:00:00Z") },
  ]);
  mockPrisma.projectTask.groupBy.mockResolvedValue([
    { completed: false, _count: { _all: 1 } }, { completed: true, _count: { _all: 1 } },
  ]);
  mockPrisma.project.findFirst.mockResolvedValue({
    id: "p1",
    family_id: "fam-a",
    name: "Garage",
    description: null,
    color: "#000",
    status: "active",
    creator: { id: "u1", name: "Pat", avatar_url: null },
    tasks: [task("t1", "Sweep floor", false), task("t2", "Hang shelves", true)],
  });
});

// Authored/unrun: progress is whole-project data, never just the visible page.
it("bounds task rendering while retaining full-project progress and continuation", async () => {
  mockPrisma.projectTask.findMany.mockResolvedValue(Array.from({ length: 41 }, (_, i) => ({
    ...task(`task-${i}`, `Synthetic task ${i}`, false), position: i,
    created_at: new Date("2026-10-10T00:00:00Z"),
  })));
  mockPrisma.projectTask.groupBy.mockResolvedValue([
    { completed: false, _count: { _all: 60 } }, { completed: true, _count: { _all: 40 } },
  ]);
  const elements = elementsIn(await renderDetail("p1"));
  const progress = elements.find((element) => (element.type as { name?: string }).name === "ProjectProgressSummary");
  const checklist = elements.find((element) => element.type === ProjectTaskChecklist);
  const navigation = elements.find((element) => (element.type as { name?: string }).name === "ProjectTaskPageNav");
  expect(progress?.props).toMatchObject({ total: 100, completed: 40, progress: 40 });
  expect(checklist?.props.tasks).toHaveLength(40);
  expect(navigation?.props).toMatchObject({ loaded: 40, total: 100, nextCursor: expect.any(String) });
  expect(mockPrisma.projectTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ project_id: "p1", project: { family_id: "fam-a" } }),
    take: 41,
  }));
});

it("passes no function props anywhere in the server-rendered tree of a project with tasks", async () => {
  const tree = await renderDetail("p1");
  const elements = elementsIn(tree);
  const offenders = elements.flatMap((el) =>
    Object.entries(el.props)
      .filter(([, value]) => typeof value === "function")
      .map(
        ([key]) =>
          `${typeof el.type === "string" ? el.type : (el.type as { name?: string }).name}.${key}`,
      ),
  );
  expect(offenders).toEqual([]);
  // The interactive parts are client components fed plain data.
  const checklist = elements.find((el) => el.type === ProjectTaskChecklist);
  expect(checklist?.props).toEqual({
    projectId: "p1",
    canToggle: true,
    tasks: [
      {
        id: "t1",
        title: "Sweep floor",
        description: null,
        completed: false,
        assigneeName: null,
        due_date: "2026-10-15T00:00:00.000Z",
      },
      {
        id: "t2",
        title: "Hang shelves",
        description: null,
        completed: true,
        assigneeName: null,
        due_date: "2026-10-15T00:00:00.000Z",
      },
    ],
  });
  expect(
    elements.find((el) => el.type === SendToCalendarButton)?.props,
  ).toEqual({ projectId: "p1" });
});

it("the page source has no inline event handlers", () => {
  const source = readFileSync(join(__dirname, "../[id]/page.tsx"), "utf8");
  expect(source).not.toMatch(/^\s*['"]use client['"]/m);
  expect(source).not.toMatch(/\son[A-Z][A-Za-z]*=\{/);
});

it("renders the tasks as tickable checkboxes and the Send to Calendar button", async () => {
  render(<ToastProvider>{await renderDetail("p1")}</ToastProvider>);
  expect(
    screen
      .getByRole("checkbox", { name: /Sweep floor/ })
      .getAttribute("aria-disabled"),
  ).toBeNull();
  expect(
    screen
      .getByRole("checkbox", { name: /Hang shelves/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "Send to Calendar" })).toBeTruthy();
});

it("a non-parent sees the tasks read-only (the task API is parent-only)", async () => {
  mockServerRole = "child";
  mockPrisma.user.findUnique.mockResolvedValue({
    family_id: "fam-a",
    role: "child",
    family: { features: { ...defaultFeatures(), projects: true } },
  });
  render(<ToastProvider>{await renderDetail("p1")}</ToastProvider>);
  expect(
    screen
      .getByRole("checkbox", { name: /Sweep floor/ })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});
