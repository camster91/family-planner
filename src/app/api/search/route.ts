import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_RESULTS_PER_TYPE = 8;

export function searchResultHref(role: string, parentHref: string) {
  return role === "child" || role === "teen" ? "/dashboard" : parentHref;
}

export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json(
      { error: "Search requires at least 2 characters" },
      { status: 400 },
    );
  }
  if (query.length > 100) {
    return NextResponse.json(
      { error: "Search is limited to 100 characters" },
      { status: 400 },
    );
  }

  const familyId = auth.user.family_id;
  const accessibleHref = (parentHref: string) =>
    searchResultHref(auth.user.role, parentHref);
  const [chores, events, lists, members] = await Promise.all([
    prisma!.chore.findMany({
      where: {
        family_id: familyId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, description: true, status: true },
      orderBy: { created_at: "desc" },
      take: MAX_RESULTS_PER_TYPE,
    }),
    prisma!.event.findMany({
      where: {
        family_id: familyId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { location: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, description: true, start_time: true },
      orderBy: { start_time: "desc" },
      take: MAX_RESULTS_PER_TYPE,
    }),
    prisma!.list.findMany({
      where: {
        family_id: familyId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, description: true, type: true },
      orderBy: { updated_at: "desc" },
      take: MAX_RESULTS_PER_TYPE,
    }),
    prisma!.user.findMany({
      where: {
        family_id: familyId,
        name: { contains: query, mode: "insensitive" },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
      take: MAX_RESULTS_PER_TYPE,
    }),
  ]);

  return NextResponse.json({
    query,
    results: [
      ...chores.map((item) => ({
        id: item.id,
        type: "chore" as const,
        title: item.title,
        detail: item.description || item.status,
        href: accessibleHref("/dashboard/chores"),
      })),
      ...events.map((item) => ({
        id: item.id,
        type: "event" as const,
        title: item.title,
        detail: item.description || item.start_time.toISOString(),
        href: accessibleHref("/dashboard/calendar"),
      })),
      ...lists.map((item) => ({
        id: item.id,
        type: "list" as const,
        title: item.name,
        detail: item.description || item.type,
        href: accessibleHref(`/dashboard/lists/${item.id}`),
      })),
      ...members.map((item) => ({
        id: item.id,
        type: "person" as const,
        title: item.name,
        detail: item.role,
        href: accessibleHref("/dashboard/family"),
      })),
    ],
  });
}
