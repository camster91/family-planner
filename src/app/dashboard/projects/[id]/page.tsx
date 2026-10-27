import { PROJECT_TASK_PAGE_SIZE, parseProjectTaskPaging, afterProjectTaskCursor, encodeProjectTaskCursor, projectTaskPageOrder } from "@/lib/project-task-paging";
import { ProjectTaskPageNav } from "./ProjectTaskPageNav";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { LargeHeader } from "@/components/ui/large-header";
import { ProgressRing } from "@/components/ui/progress-ring";
import { FeatureOffState } from "@/components/ui/feature-gate";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  ProjectCalendarCopy,
  ProjectDetailBackLink,
  ProjectProgressSummary,
  ProjectTasksHeading,
  ProjectTasksEmpty,
} from "../ProjectOverviewCopy";
import { ProjectDetailActions } from "./ProjectDetailActions";
import {
  ProjectTaskChecklist,
  type ChecklistTask,
} from "./ProjectTaskChecklist";
import { SendToCalendarButton } from "./SendToCalendarButton";
import { AddProjectTaskForm } from "@/components/projects/AddProjectTaskForm";

export const dynamic = "force-dynamic";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

async function ProjectDetailContent({ id, taskCursors = [] }: { id: string; taskCursors?: string[] }) {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      family_id: true,
      role: true,
      family: { select: { features: true } },
    },
  });

  const familyId = user?.family_id;
  if (!familyId) return null;

  // Same server-side gate as the projects list (route inventory F-2).
  if (
    !isFeatureEnabled(normalizeFeatures(user?.family?.features), "projects")
  ) {
    return (
      <FeatureOffState
        featureKey="projects"
        canManage={sessionUser.role !== "teen" && sessionUser.role !== "child"}
      />
    );
  }

  const project = await prisma!.project.findFirst({
    where: { id, family_id: familyId },
    include: {
      creator: {
        select: { id: true, name: true, avatar_url: true },
      },
    },
  });

  if (!project || project.family_id !== familyId) {
    notFound();
  }

  const taskScope = { familyId, projectId: id, completed: null };
  const taskParams = new URLSearchParams({ limit: String(PROJECT_TASK_PAGE_SIZE) });
  for (const cursor of taskCursors) taskParams.append("cursor", cursor);
  const taskPaging = parseProjectTaskPaging(taskParams, taskScope);
  const [taskRows, counts] = await Promise.all([
    taskPaging.ok && taskPaging.paged
      ? prisma!.projectTask.findMany({
          where: { project_id: id, project: { family_id: familyId },
            ...(taskPaging.cursor ? afterProjectTaskCursor(taskPaging.cursor) : {}) },
          include: { assignee: { select: { id: true, name: true, avatar_url: true } } },
          orderBy: projectTaskPageOrder, take: PROJECT_TASK_PAGE_SIZE + 1,
        })
      : Promise.resolve([]),
    prisma!.projectTask.groupBy({
      by: ["completed"], where: { project_id: id, project: { family_id: familyId } },
      _count: { _all: true },
    }),
  ]);
  const tasks = taskRows.slice(0, PROJECT_TASK_PAGE_SIZE);
  const nextTaskCursor = taskRows.length > PROJECT_TASK_PAGE_SIZE
    ? encodeProjectTaskCursor(taskScope, tasks[tasks.length - 1]) : null;
  const totalTasks = counts.reduce((total, row) => total + row._count._all, 0);
  const completedTasks = counts.filter((row) => row.completed).reduce((total, row) => total + row._count._all, 0);
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Get family members for assignment dropdown
  const familyMembers = await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Plain data only: this is a server component, so nothing it passes to the
  // client components below may be a function.
  const taskData: ChecklistTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    completed: t.completed,
    assigneeName: t.assignee?.name ?? null,
    due_date: t.due_date ? t.due_date.toISOString() : null,
  }));

  const isParent = user.role === "parent";
  const isComplete = project.status === "completed" || progress === 100;

  return (
    <div className="pb-20">
      {/* Back link + LargeHeader */}
      <div className="px-4 pt-4">
        <ProjectDetailBackLink />
        <LargeHeader
          title={project.name}
          subtitle={project.description || undefined}
          trailing={
            <ProjectDetailActions
              projectId={project.id}
              projectName={project.name}
              projectStatus={
                project.status as "active" | "completed" | "archived"
              }
              isParent={isParent}
            />
          }
        />
      </div>

      <div className="px-4 space-y-6 mt-6">
        {/* Progress card */}
        <div className="card-apple p-5 flex items-center gap-5">
          <ProgressRing
            progress={totalTasks > 0 ? completedTasks / totalTasks : 0}
            size={80}
            strokeWidth={8}
          >
            <span className="text-[28px] font-bold leading-none">
              {progress}%
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <ProjectProgressSummary
              completed={completedTasks}
              total={totalTasks}
              progress={progress}
            />
          </div>
          {/* Color accent dot */}
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: project.color || "#3B82F6" }}
          />
        </div>

        {/* Tasks section */}
        <section>
          <ProjectTasksHeading />
          <ProjectTaskPageNav projectId={id} loaded={tasks.length} total={totalTasks}
            nextCursor={nextTaskCursor} paged={taskCursors.length > 0} invalid={!taskPaging.ok} />
          {taskData.length === 0 && totalTasks === 0 ? (
            <ProjectTasksEmpty active={project.status === "active"} />
          ) : (
            <ProjectTaskChecklist
              projectId={project.id}
              tasks={taskData}
              canToggle={isParent && project.status === "active"}
            />
          )}
          {/* Route inventory F-5 (#289): add a task to this project. The API
              takes tasks only while the project is active. */}
          {project.status === "active" && (
            <div className="mt-3">
              <AddProjectTaskForm
                projectId={project.id}
                familyMembers={familyMembers}
              />
            </div>
          )}
        </section>

        {/* Send to Calendar CTA */}
        {project.status === "active" &&
          totalTasks > 0 &&
          completedTasks < totalTasks && (
            <div className="card-apple p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <ProjectCalendarCopy />
              </div>
              <SendToCalendarButton projectId={project.id} />
            </div>
          )}
      </div>
    </div>
  );
}

// --- Skeleton ---

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse px-4">
      <div className="flex justify-between">
        <div className="h-4 w-28 bg-muted rounded" />
        <div className="h-8 w-32 bg-muted rounded-xl" />
      </div>
      <div className="card-apple p-5 h-32" />
      <div className="space-y-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// --- Page export ---

export default function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  return (
    <Suspense fallback={<ProjectDetailSkeleton />}>
      <AsyncProjectDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AsyncProjectDetail({
  params, searchParams,
}: ProjectDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const value = (query as Record<string, string | string[] | undefined>).tasksCursor;
  const taskCursors = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return <ProjectDetailContent id={id} taskCursors={taskCursors} />;
}
