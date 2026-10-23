import { redirect } from "next/navigation";
import { getServerActor } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { inboxQuery, readReviewInbox } from "@/lib/review-inbox/read";
import ReviewInbox from "@/components/review/ReviewInbox";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerActor();
  if (!session) return null;
  if (session.role !== "parent" || !session.family_id) redirect("/dashboard");
  const params = await searchParams;
  if (
    params.mode === "fridge" ||
    (Array.isArray(params.mode) && params.mode.includes("fridge"))
  )
    redirect("/dashboard/today?mode=fridge");
  // Overlay navigation adds its own params; only this page's query is parsed.
  const query = inboxQuery.safeParse({
    source: params.source,
    after: params.after,
  });
  if (!query.success) redirect("/dashboard/review");
  const page = await readReviewInbox(
    prisma!,
    {
      userId: session.id,
      familyId: session.family_id,
      role: session.role,
      tokenVersion: session.tokenVersion,
    },
    query.data,
  );
  // Renewed authority can change while search params/storage resolve. Do not
  // serialize the former owner's page/identity or leave a blank review screen.
  if (page.state === "forbidden") redirect("/dashboard");
  return (
    <ReviewInbox
      page={page}
      identity={{ userId: session.id, familyId: session.family_id }}
    />
  );
}
