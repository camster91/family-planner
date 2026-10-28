"use client";

import Link from "next/link";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { LargeHeader } from "@/components/ui/large-header";
import ProjectCard, {
  type ProjectCardData,
} from "@/components/projects/ProjectCard";
import { useProjectOverviewText } from "@/i18n/project-overview";
import { useTranslation } from "@/i18n";
import { formatDateOnly } from "@/lib/dates";

type ProjectStatus = "active" | "completed" | "archived";

export function ProjectsHeader({ isParent }: { isParent: boolean }) {
  const text = useProjectOverviewText();

  return (
    <LargeHeader
      title={text("pageTitle")}
      subtitle={text("pageSubtitle")}
      className="w-full px-4 sm:px-6 lg:px-8"
      trailing={
        isParent ? (
          <Link
            href="/dashboard/projects/create"
            className="btn-tinted min-h-[44px] bg-tint-projects px-4 py-2 text-sm font-medium text-white"
          >
            {text("newProject")}
          </Link>
        ) : undefined
      }
    />
  );
}

export function ProjectOverviewSection({
  status,
  projects,
}: {
  status: ProjectStatus;
  projects: ProjectCardData[];
}) {
  const text = useProjectOverviewText();
  const heading =
    status === "active"
      ? "active"
      : status === "completed"
        ? "completed"
        : "archived";

  if (projects.length === 0) return null;

  return (
    <section aria-labelledby={`projects-${status}-heading`}>
      <p id={`projects-${status}-heading`} className="section-header">
        {text(heading)}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}

export function ProjectsEmptyState() {
  const text = useProjectOverviewText();

  return (
    <div className="card-apple p-8 text-center">
      <EmptyState
        icon={FolderKanban}
        glyphColor="projects"
        title={text("noProjectsTitle")}
        description={text("noProjectsDescription")}

      />
    </div>
  );
}

export function ProjectNoFamilyState() {
  const text = useProjectOverviewText();

  return (
    <EmptyState
      icon={FolderKanban}
      glyphColor="projects"
      title={text("noFamilyTitle")}
      description={text("noFamilyDescription")}
    />
  );
}

export function ProjectDetailBackLink() {
  const text = useProjectOverviewText();

  return (
    <Link
      href="/dashboard/projects"
      className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-secondary transition-colors hover:text-label-primary"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {text("backToProjects")}
    </Link>
  );
}

export function ProjectProgressSummary({
  completed,
  total,
  progress,
}: {
  completed: number;
  total: number;
  progress: number;
}) {
  const text = useProjectOverviewText();

  return (
    <div>
      <p className="text-title-3 leading-tight text-label-primary">
        {total > 0
          ? text("progressTasks", { done: completed, total })
          : text("noTasks")}
      </p>
      {total > 0 && progress < 100 && (
        <p className="mt-1 text-subhead text-label-secondary">
          {text("progressRemaining", { count: total - completed })}
        </p>
      )}
      {progress === 100 && total > 0 && (
        <p className="mt-1 text-subhead font-medium text-success-text">
          {text("allDone")}
        </p>
      )}
    </div>
  );
}

export function ProjectTasksEmpty({ active }: { active: boolean }) {
  const text = useProjectOverviewText();

  return (
    <EmptyState
      icon={FolderKanban}
      glyphColor="projects"
      title={text("noTasks")}
      description={
        active ? text("noTasksDescription") : text("noTasksForClosed")
      }
    />
  );
}

export function ProjectTasksHeading() {
  const text = useProjectOverviewText();
  return <p className="section-header">{text("tasksHeading")}</p>;
}

export function ProjectCalendarCopy() {
  const text = useProjectOverviewText();

  return (
    <>
      <h3 className="mb-1 text-subhead font-semibold text-label-primary">
        {text("calendarTitle")}
      </h3>
      <p className="text-footnote text-label-secondary">
        {text("calendarDescription")}
      </p>
    </>
  );
}

export function ProjectTaskDetails({
  assigneeName,
  dueDate,
  description,
}: {
  assigneeName?: string | null;
  dueDate?: string | null;
  description?: string | null;
}) {
  const text = useProjectOverviewText();
  const { locale } = useTranslation();
  const details: string[] = [];

  if (assigneeName)
    details.push(text("taskAssignedTo", { name: assigneeName }));
  if (dueDate) {
    const formatted =
      formatDateOnly(
        dueDate,
        { weekday: "short", month: "short", day: "numeric" },
        locale === "es" ? "es-ES" : "en-US",
      ) || dueDate;
    details.push(text("taskDue", { date: formatted }));
  }
  if (description?.trim()) details.push(description.trim());

  if (details.length === 0) return null;
  return <span>{text("taskDetails", { details: details.join(" · ") })}</span>;
}

/** Explicit next-page navigation; no false whole-household empty state. */
export function ProjectPageState({ invalid }: { invalid: boolean }) {
  const text = useProjectOverviewText();
  return (
    <div className="space-y-3 rounded-2xl bg-surface-fill p-4">
      <p role={invalid ? "alert" : "status"}>{text(invalid ? "invalidPage" : "emptyPage")}</p>
      {invalid && <Link href="/dashboard/projects" prefetch={false} className="btn-tinted min-h-[44px] inline-flex items-center">{text("newestProjects")}</Link>}
    </div>
  );
}
export function ProjectPageNavigation({ nextCursor, hasEarlierPage }: {
  nextCursor: string | null;
  hasEarlierPage: boolean;
}) {
  const text = useProjectOverviewText();
  if (!nextCursor && !hasEarlierPage) return null;
  return (
    <nav aria-label={text("pageNavigation")} className="space-y-3">
      <p className="text-footnote text-label-secondary">{text("pageHint")}</p>
      <div className="flex flex-wrap gap-2">
        {hasEarlierPage && <Link href="/dashboard/projects" prefetch={false} className="btn-tinted min-h-[44px] inline-flex items-center">{text("newestProjects")}</Link>}
        {nextCursor && <Link href={`/dashboard/projects?${new URLSearchParams({ cursor: nextCursor })}`} prefetch={false} className="btn-tinted min-h-[44px] inline-flex items-center">{text("olderProjects")}</Link>}
      </div>
    </nav>
  );
}
