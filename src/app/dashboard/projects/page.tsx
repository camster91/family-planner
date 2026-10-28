import { Suspense } from "react";
import { readProjectOverview } from "@/lib/project-overview";
import { parseProjectPaging, PROJECT_OVERVIEW_PAGE_SIZE } from "@/lib/project-paging";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { canRoleAccessPath } from "@/lib/kid-access";
import type { ProjectCardData } from "@/components/projects/ProjectCard";
import { FeatureOffState } from "@/components/ui/feature-gate";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  ProjectNoFamilyState,
  ProjectsEmptyState,
  ProjectsHeader,
  ProjectOverviewSection,
  ProjectPageNavigation,
  ProjectPageState,
} from "./ProjectOverviewCopy";

export const dynamic = "force-dynamic";

function canReadProjectRoute(role?: string) {
  return (role === "parent" || role === "teen" || role === "child") &&
    canRoleAccessPath(role, "/dashboard/projects");
}


async function ProjectsContent({
  familyId,
  cursor,
}: {
  familyId: string;
  cursor?: string | string[];
}) {
  const sessionUser = await getServerUser();
  if (!sessionUser || !canReadProjectRoute(sessionUser.role)) return null;
  // Streaming can begin after the outer auth/gate read. Recheck its household
  // before any project data is read; an old cursor cannot choose a household.
  const current = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, family: { select: { features: true } } },
  });
  if (current?.family_id !== familyId) return null;
  if (!isFeatureEnabled(normalizeFeatures(current.family?.features), "projects")) {
    return <FeatureOffState featureKey="projects" canManage={sessionUser.role === "parent"} />;
  }
  const params = new URLSearchParams({ limit: String(PROJECT_OVERVIEW_PAGE_SIZE) });
  if (Array.isArray(cursor)) return <ProjectPageState invalid />;
  if (cursor !== undefined) params.set("cursor", cursor);
  const paging = parseProjectPaging(params, { familyId, status: null });
  if (!paging.ok) return <ProjectPageState invalid />;
  const result = await readProjectOverview(prisma!, { familyId, status: null }, paging);
  const projectCards: ProjectCardData[] = result.projects.map(project => ({
    ...project,
    status: project.status as ProjectCardData["status"],
  }));

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
      {projectCards.length === 0 && (cursor === undefined
        ? <ProjectsEmptyState />
        : <ProjectPageState invalid={false} />)}
      <ProjectPageNavigation nextCursor={result.nextCursor ?? null} hasEarlierPage={cursor !== undefined} />
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

export default async function ProjectsPage({ searchParams }: {
  searchParams?: Promise<{ cursor?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionUser = await getServerUser();
  if (!sessionUser || !canReadProjectRoute(sessionUser.role)) return null;

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
            <ProjectsContent key={Array.isArray(params?.cursor) ? "invalid" : params?.cursor ?? "first"} familyId={familyId} cursor={params?.cursor} />
          </Suspense>
        ) : (
          <ProjectNoFamilyState />
        )}
      </div>
    </div>
  );
}
