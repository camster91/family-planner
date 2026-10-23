import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { refreshStaleSubscriptions } from "@/lib/calendar-import/sync";
import TodayBoard from "@/components/fridge/TodayBoard";
import HomeSummary from "@/components/dashboard/HomeSummary";
import TodaySetup from "@/components/dashboard/TodaySetup";
import { loadTodayBoard } from "./board-snapshot";
import { topUpHouseholdSeries } from "@/lib/recurringChores";
import { loadHomeSummary } from "./home-summary-data";
import { loadGetStarted } from "./get-started-data";
import { isDoneStatus, isOpenStatus } from "@/lib/home-summary";
import { isProfileChoreEnabled } from "@/lib/chore-profile";
import { Suspense } from "react";
import loadable from "next/dynamic";
// The existing server readiness/role gate decides whether this optional
// workspace is rendered. A dormant launcher need not enter the cold board.
const WeeklyResetLauncher = loadable(
  () => import("@/components/dashboard/WeeklyResetLauncher"),
);
import { weeklyResetReady } from "@/lib/weekly-reset";
import { readPreparationBacklinks } from "@/lib/event-preparation/discovery";

export const metadata: Metadata = { title: "Today" };

// Always render from current household data; the board re-requests this page
// when its version check sees a change (#271: client-side polling of
// /api/family/board-version, then router.refresh; not a server job).
export const dynamic = "force-dynamic";

/**
 * Today board (#119 / #159): the glanceable household view for the fridge or
 * wall tablet, also usable on a phone. `?mode=fridge` hides the app chrome for
 * a mounted tablet. Shared-surface data rules live in ./today-board-data.ts.
 *
 * One home (#269): this is the home for person sessions on every viewport;
 * /dashboard redirects parents here (children and teens keep their own kid
 * home at /dashboard). Outside fridge mode the page adds the viewer's summary
 * sentence and their own tickable chores above the board (#268,
 * ./home-summary-data.ts). Fridge mode is the shared surface, so it shows the
 * board alone. A parent of a household that is not set up yet also gets a
 * compact "Get started" steps below the plans (./get-started-data.ts); once that is done or
 * hidden, a "Turn on more" card suggests a few sections that are still off
 * (O-38, components/dashboard/FeatureSuggestions.tsx).
 */
export default async function TodayBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  // Role and household are read fresh from the database (D6, #102).
  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true, family_id: true },
  });

  const params = await searchParams;
  const fridgeMode = params.mode === "fridge";

  if (!user?.family_id) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-title-1 text-label-primary">Today</h1>
        <p className="mt-3 text-body text-label-secondary">
          Join or create a household to see today&apos;s plans here.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/dashboard" className="btn-filled">
            Create a household
          </Link>
          <Link href="/join" className="btn-plain">
            Join with a code
          </Link>
        </div>
      </div>
    );
  }

  const familyId = user.family_id;
  // Subscribed calendars (#232): refresh stale feeds after the response is sent,
  // exactly as the main dashboard does. Viewing drives it; there is no cron.
  after(() => refreshStaleSubscriptions(familyId));

  const now = new Date();
  // Recurring series are extended on read (no scheduler), before the board
  // reads today's chores. Bounded, idempotent, never throws.
  await topUpHouseholdSeries(familyId, now);
  // Weather (#262) is opt-in per household and never fails the page: null
  // hides the tile. The board carries its display settings and change
  // version (#271).
  const memberProtocol = isProfileChoreEnabled() ? 2 : 1;
  const [data, home, getStarted] = await Promise.all([
    loadTodayBoard(prisma!, {
      familyId,
      role: user.role,
      memberProtocol,
      now,
      withWeather: true,
    }),
    fridgeMode
      ? Promise.resolve(null)
      : loadHomeSummary(prisma!, { familyId, role: user.role, memberProtocol }),
    fridgeMode
      ? Promise.resolve(null)
      : loadGetStarted(prisma!, { familyId, role: user.role, now }),
  ]);

  // Tiles act directly for the signed-in person (#274): their chores (any for
  // a parent) and the groceries, with Undo. Only id and role reach the client.
  const viewer = { id: sessionUser.id, role: user.role };
  if (data.protocolError || home?.protocolError) {
    return (
      <TodayBoard
        data={{
          ...data,
          protocolError: data.protocolError ?? home?.protocolError,
        }}
        fridgeMode={fridgeMode}
        viewer={viewer}
      />
    );
  }
  if (!home)
    return <TodayBoard data={data} fridgeMode={fridgeMode} viewer={viewer} />;

  const preparationBacklinks =
    user.role === "parent" && data.links.calendar && data.links.chores
      ? await readPreparationBacklinks(prisma!, {
          userId: sessionUser.id,
          familyId,
          role: user.role,
          choreIds: [
            ...home.chores.map((c) => c.id),
            ...data.chores.map((c) => c.id),
          ],
        })
      : {};

  // Own chore rows already have completion/reopen/Undo in the personal summary.
  // Exclude only those exact IDs from the household tile, not every chore for
  // this member: the two bounded reads can contain different sets of rows.
  const choresShownElsewhere = home.chores
    .filter(
      (chore) =>
        chore.assigneeId === viewer.id &&
        (isOpenStatus(chore.status) || isDoneStatus(chore.status)),
    )
    .map((chore) => chore.id);

  return (
    <>
      <HomeSummary
        viewer={viewer}
        {...home}
        preparationBacklinks={preparationBacklinks}
      />
      {weeklyResetReady() &&
        !fridgeMode &&
        ["parent", "teen", "child"].includes(user.role) && (
          <Suspense fallback={null}>
            <WeeklyResetLauncher
              key={`${sessionUser.id}:${familyId}`}
              userId={sessionUser.id}
              familyId={familyId}
            />
          </Suspense>
        )}
      <TodayBoard
        data={data}
        fridgeMode={fridgeMode}
        viewer={viewer}
        choresShownElsewhere={choresShownElsewhere}
        preparationBacklinks={preparationBacklinks}
      />
      {getStarted && (
        <TodaySetup viewer={viewer} familyId={familyId} steps={getStarted} />
      )}
    </>
  );
}
