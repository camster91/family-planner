import { Suspense } from "react";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { ProjectCardData } from "@/components/projects/ProjectCard";
import { FeatureOffState } from "@/components/ui/feature-gate";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  ProjectNoFamilyState,
  ProjectsEmptyState,
  ProjectsHeader,
  ProjectOverviewSection,
} from "./ProjectOverviewCopy";

export const dynamic = "force-dynamic";

async function ProjectsContent({
  familyId,
  isParent,
}: {
  familyId: string;
  isParent: boolean;
}) {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  // Fetch projects with task counts and completed counts
  const projects = await prisma!.project.findMany({
    where: { family_id: familyId },
    include: {
      creator: {
        select: { name: true, avatar_url: true },
      },
      _count: { select: { tasks: true } },
      tasks: {
        where: { completed: true },
        select: { id: true },
      },
    },
    orderBy: { created_at: "desc" },
  });

  // Transform to card-friendly shape
  const projectCards: ProjectCardData[] = projects.map((p) => {
    const { tasks, _count, ...rest } = p;
    return {
      ...rest,
      status: rest.status as "active" | "completed" | "archived",
      taskCount: _count.tasks,
      completedTaskCount: tasks.length,
    };
  });

  const activeProjects = projectCards.filter((p) => p.status === "active");
  const completedProjects = projectCards.filter(
    (p) => p.status === "completed",
  );
  const archivedProjects = projectCards.filter((p) => p.status === "archived");

  return (
    <div className="space-y-8">
      <ProjectOverviewSection status="active" projects={activeProjects} />
      <ProjectOverviewSection status="completed" projects={completedProjects} />
      <ProjectOverviewSection status="archived" projects={archivedProjects} />
      {projectCards.length === 0 && <ProjectsEmptyState isParent={isParent} />}
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-4 w-32 bg-muted rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card-apple p-5 h-40" />
        ))}
      </div>
    </div>
  );
}

export default async function ProjectsPage() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, family: { select: { features: true } } },
  });

  // Server-side gate (route inventory F-2): with Projects off, no project is
  // read, rendered or serialised. The APIs are gated the same way.
  const familyId = user?.family_id;
  const isParent = sessionUser.role === "parent";
  if (
    familyId &&
    !isFeatureEnabled(normalizeFeatures(user?.family?.features), "projects")
  ) {
    return (
      <FeatureOffState
        featureKey="projects"
        canManage={sessionUser.role !== "teen" && sessionUser.role !== "child"}
      />
    );
  }

  return (
    <div className="pb-20">
      <ProjectsHeader isParent={isParent} />
      <div className="px-4 mt-6">
        {familyId ? (
          <Suspense fallback={<ProjectsSkeleton />}>
            <ProjectsContent familyId={familyId} isParent={isParent} />
          </Suspense>
        ) : (
          <ProjectNoFamilyState />
        )}
      </div>
    </div>
  );
}
