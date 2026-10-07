"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Star, Gift, Calendar, Sparkles, X } from "lucide-react";

import { BrandMotion } from "@/components/ui/brand-motion";
import { MOTION } from "@/lib/brand-illustrations";
import { Avatar } from "@/components/ui/avatar";
import { CheckboxRow } from "@/components/ui/checkbox-row";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";
import { xpForNextLevel } from "@/lib/gamification";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import type { UserRole } from "@/types";
import {
  useKeepClearOfUndoToast,
  useToast,
  useUndoToast,
} from "@/components/ui/toast";
import { setChoreDone } from "@/lib/chore-tick-client";
import {
  formatRelativePastDate,
  isDueToday,
  toDateOnlyLocal,
  toDateOnlyUTC,
} from "@/lib/dates";
import { groupByRoutine, normalizeRoutineName } from "@/lib/routine-icons";
import KidRoutines from "./KidRoutines";
import { useLocalNow } from "@/components/ui/use-hydrated";
import { useDisplayLocale } from "@/components/ui/use-display-locale";

interface Chore {
  id: string;
  title: string;
  due_date: string;
  status: string;
  points?: number;
  verified_notes?: string | null;
  /** Picture routines (#272). */
  icon?: string | null;
  routine?: string | null;
  routine_order?: number | null;
}

interface Event {
  id: string;
  title: string;
  start_time: string;
  location?: string | null;
}

interface Reward {
  id: string;
  name: string;
  cost: number;
  description?: string | null;
  status?: "available" | "claimed" | "approved" | "redeemed";
}

interface KidHomeProps {
  user: {
    name?: string;
    role?: UserRole;
    avatar_url?: string | null;
    xp?: number | null;
    level?: number | null;
    family_id?: string | null;
  };
  workPreviewLimited?: boolean;
  chores: Chore[];
  events: Event[];
  rewards: Reward[];
}

// Both helpers use the viewer's zone, so they are only called after hydration
// (useLocalNow is non-null): the server renders in UTC (O-31).
function formatRelativeDate(dateStr: string, now: Date, locale: string): string {
  const date = new Date(dateStr);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function formatTime(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const OPEN_STATUSES = new Set(["pending", "in_progress", "overdue"]);
const isOpen = (c: Chore) => OPEN_STATUSES.has(c.status);

/** "Was due yesterday" / "Was due Jan 3": a plain fact, no scolding (BRAND.md). */
function wasDueLabel(dueDate: string, now: Date): string {
  const label = formatRelativePastDate(dueDate, now);
  return `Was due ${label === "Yesterday" ? "yesterday" : label}`;
}

/** How long the "You did it!" celebration stays before settling into "All done". */
export const CELEBRATE_MS = 6000;

// XP threshold to level up from `level` — shared with the server logic
// (gamification.ts xpForNextLevel) so the ring matches awardChoreXP.
const xpForLevel = xpForNextLevel;

/** How many open chores a group (today's, or earlier ones) shows at a time. */
export const MISSIONS_AT_ONCE = 3;

/**
 * The rows a chore group shows: up to `cap` chores that are still open here,
 * plus any the child ticked on this page (they stay, ticked, where they were).
 * So ticking a visible chore brings the next open one in without a reload,
 * and the list never shows more than `cap` things still to do. The order of
 * `list` is kept.
 */
export function visibleMissions<T extends { id: string }>(
  list: T[],
  tickedHere: ReadonlySet<string>,
  cap: number = MISSIONS_AT_ONCE,
): T[] {
  let open = 0;
  return list.filter((c) => {
    if (tickedHere.has(c.id)) return true;
    if (open >= cap) return false;
    open += 1;
    return true;
  });
}

/** "Casey Smith" → "Casey": a kid is greeted by first name. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export default function KidHome({
  user,
  chores: serverChores,
  events,
  rewards,
  workPreviewLimited = false,
}: KidHomeProps) {
  const displayLocale = useDisplayLocale();
  const [celebratingReward, setCelebratingReward] = useState<string | null>(
    null,
  );
  const [claimingReward, setClaimingReward] = useState(false);
  const rewardsEnabled = useFeatureEnabled("rewards");
  // Points & streaks (#248). When off the server also omits xp/level and the
  // chores' points, so this only decides what to draw.
  const gamification = useFeatureEnabled("gamification");
  const [showToday, setShowToday] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [showCatchup, setShowCatchup] = useState(false);
  const [completedChores, setCompletedChores] = useState<Set<string>>(
    new Set(),
  );
  const latestServerChores = useRef(serverChores);
  latestServerChores.current = serverChores;
  // A successful Undo can follow refreshed completed props. Keep its server-
  // accepted reopen visible until the next refresh; verified rows always win.
  const [reopenedChores, setReopenedChores] = useState<{
    from: Chore[];
    rows: Map<string, Chore>;
  } | null>(null);
  const chores =
    reopenedChores?.from === serverChores
      ? [
          ...serverChores.map((c) =>
            reopenedChores.rows.has(c.id) && c.status === "completed"
              ? { ...c, status: "pending" }
              : c,
          ),
          // Bounded previews may omit a just-completed catch-up row. Restore only
          // the known snapshot after the server accepts Undo, never inferred work.
          ...Array.from(reopenedChores.rows.values()).filter(
            (c) => !serverChores.some((row) => row.id === c.id),
          ),
        ]
      : serverChores;
  const pendingCompletions = useRef(new Set<string>());
  // Fresh server rows replace settled ticks (including a parent's send-back),
  // but a refresh cannot cancel the optimistic state of an in-flight write.
  useEffect(() => {
    setCompletedChores((prev) =>
      prev.size > 0
        ? new Set([...prev].filter((id) => pendingCompletions.current.has(id)))
        : prev,
    );
  }, [serverChores]);
  // Rewards claimed on this screen: hidden at once (a second tap would 409)
  // until router.refresh() brings the server's list.
  const [claimedRewards, setClaimedRewards] = useState<Set<string>>(new Set());
  // XP balance returned by the claim, until fresh props arrive. Keyed to the
  // prop it replaced so a later refresh always wins.
  const [xpAfterClaim, setXpAfterClaim] = useState<{
    from: number | null | undefined;
    xp: number;
  } | null>(null);
  // Finishing the last to-do on this page (O-42): a short "You did it!" burst
  // that settles into the "All done for today!" card. Only shown while
  // nothing is left, so an Undo (or a failed tick) takes it away again.
  const [celebration, setCelebration] = useState<"burst" | "settled" | null>(
    null,
  );
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { addToast } = useToast();
  const showUndo = useUndoToast();
  // A short page can end (the Rewards card) right where the Undo card sits:
  // while one shows, reserve its height below the content and lift the end
  // clear of it, so nothing is ever hidden under the card.
  const contentRef = useRef<HTMLDivElement>(null);
  const undoRoom = useKeepClearOfUndoToast(contentRef);

  const userXp =
    xpAfterClaim && xpAfterClaim.from === user.xp
      ? xpAfterClaim.xp
      : (user.xp ?? 0);
  const userLevel = user.level ?? 1;
  // Threshold to reach level+1 is xpForNextLevel(level) = 100 * level
  const xpNextLevel = xpForLevel(userLevel);
  const xpProgress = Math.min(userXp / xpNextLevel, 1);

  // Picture routines (#272): the child's chores due today that belong to a
  // routine, grouped and in step order. Done steps stay (shown ticked).
  // Routine steps on other days (a daily routine's later occurrences, or
  // yesterday's) are not mixed in; older open steps have a catch-up group.
  const inRoutine = (c: Chore) => normalizeRoutineName(c.routine) !== null;
  // "Today" is the viewer's local day, unknown on the server (O-31): until
  // hydration everything day-based is left out and a placeholder holds its
  // place, so the server HTML and the first client render match.
  const now = useLocalNow();
  const routineChores = now
    ? (chores ?? []).filter((c) => inRoutine(c) && isDueToday(c.due_date, now))
    : [];
  const { routines } = groupByRoutine(routineChores);

  // Missions are the child's open chores due on their local today — three
  // still-to-do at a time, with Show more for the rest of the bounded server
  // preview. Ticking one brings the next in (visibleMissions); the ticked row
  // stays with its "You did it!".
  // Recurring chores keep future copies, so the due day matters, not just the
  // status. Routine steps show above as picture cards, so they are never
  // repeated here. Earlier open chores get their own small group, and
  // tomorrow's are a read-only peek; neither counts as today's missions.
  const todayKey = now ? toDateOnlyLocal(now) : null;
  const tomorrow = now ? new Date(now.getTime()) : null;
  tomorrow?.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow ? toDateOnlyLocal(tomorrow) : null;
  const openChores = todayKey
    ? (chores ?? []).filter((c) => isOpen(c) && !inRoutine(c))
    : [];
  const allTodayChores = openChores.filter(
    (c) => toDateOnlyUTC(c.due_date) === todayKey,
  );
  const todayChores = showToday
    ? allTodayChores
    : visibleMissions(allTodayChores, completedChores);
  const hiddenToday = allTodayChores.length - todayChores.length;
  const allEarlierChores = openChores
    .filter((c) => toDateOnlyUTC(c.due_date) < (todayKey ?? ""))
    // Most recent first.
    .sort((a, b) =>
      toDateOnlyUTC(b.due_date).localeCompare(toDateOnlyUTC(a.due_date)),
    );
  const earlierChores = showEarlier
    ? allEarlierChores
    : visibleMissions(allEarlierChores, completedChores);
  const hiddenEarlier = allEarlierChores.length - earlierChores.length;
  const allCatchupChores = todayKey
    ? (chores ?? [])
        .filter(
          (c) =>
            inRoutine(c) && isOpen(c) && toDateOnlyUTC(c.due_date) < todayKey,
        )
        .sort(
          (a, b) =>
            toDateOnlyUTC(b.due_date).localeCompare(
              toDateOnlyUTC(a.due_date),
            ) ||
            (a.routine_order ?? 99) - (b.routine_order ?? 99) ||
            a.id.localeCompare(b.id),
        )
    : [];
  const catchupChores = showCatchup
    ? allCatchupChores
    : visibleMissions(allCatchupChores, completedChores);
  const hiddenCatchup = allCatchupChores.length - catchupChores.length;
  const tomorrowChores = openChores
    .filter((c) => toDateOnlyUTC(c.due_date) === tomorrowKey)
    .slice(0, 3);

  // Everything the child can still tick here: open chores due today or
  // earlier (all of them, not just the few shown) and today's routine steps.
  const todoIds = [
    ...allCatchupChores.map((c) => c.id),
    ...openChores
      .filter((c) => toDateOnlyUTC(c.due_date) <= (todayKey ?? ""))
      .map((c) => c.id),
    ...routineChores
      .filter((c) => c.status !== "completed" && c.status !== "verified")
      .map((c) => c.id),
  ];
  const remainingTodos = todoIds.filter(
    (id) => !completedChores.has(id),
  ).length;
  const finishedHere =
    !!now &&
    !workPreviewLimited &&
    celebration !== null &&
    todoIds.length > 0 &&
    remainingTodos === 0;
  // Read after a tick's request returns, so it sees that tick's optimistic state.
  const remainingRef = useRef(remainingTodos);
  useEffect(() => {
    remainingRef.current = remainingTodos;
  });
  useEffect(
    () => () => {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    },
    [],
  );
  // The card appears below the list the child just finished: bring it into
  // view (gently, unless they asked for reduced motion), with its bottom
  // above the Undo card. Measured by hand: Chromium's
  // scrollIntoView({ block: 'nearest' }) left a card that was already on
  // screen where it was, ignoring its scroll margin, so "All done for today."
  // sat under the Undo card. The scroll margins (scroll-mt/-mb) set the room.
  useEffect(() => {
    if (!finishedHere || celebration !== "burst") return;
    const card = celebrationRef.current;
    if (!card) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = window.getComputedStyle(card);
    const roomBelow = parseFloat(style.scrollMarginBottom) || 0;
    const roomAbove = parseFloat(style.scrollMarginTop) || 0;
    const rect = card.getBoundingClientRect();
    // Scroll up by what is hidden at the bottom...
    let up = rect.bottom + roomBelow - window.innerHeight;
    // ...and if that brings the end of the page (the Rewards card) on screen,
    // far enough that it clears the Undo card too...
    const endBottom = contentRef.current?.getBoundingClientRect().bottom;
    if (
      endBottom !== undefined &&
      endBottom - Math.max(up, 0) < window.innerHeight
    ) {
      up = Math.max(up, endBottom + roomBelow - window.innerHeight);
    }
    // ...but never past the card's top.
    up = Math.min(up, rect.top - roomAbove);
    if (up > 0)
      window.scrollBy?.({ top: up, behavior: reduce ? "auto" : "smooth" });
  }, [finishedHere, celebration]);

  // Today's events (the viewer's local day) — up to 2
  const todayEvents = todayKey
    ? (events ?? [])
        .filter((e) => toDateOnlyLocal(new Date(e.start_time)) === todayKey)
        .slice(0, 2)
    : [];

  // The reward to offer: the one being celebrated (its cost is already spent,
  // so it may no longer look affordable), else the first one the child can
  // afford, else the first available one with "Need N more XP" (as on the
  // Rewards board; the claim endpoint refuses a reward the XP cannot cover).
  const availableRewards = (rewards ?? []).filter(
    (r) => r.status === "available" && !claimedRewards.has(r.id),
  );
  const claimableReward =
    availableRewards.find((r) => r.id === celebratingReward) ??
    availableRewards.find((r) => r.cost <= userXp) ??
    availableRewards[0];
  const celebratingThis =
    !!claimableReward && celebratingReward === claimableReward.id;
  const canClaimReward =
    !!claimableReward && (celebratingThis || claimableReward.cost <= userXp);

  async function handleClaimReward(rewardId: string) {
    if (claimingReward) return;
    setClaimingReward(true);
    try {
      const res = await fetch("/api/rewards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId }),
      });
      if (res.ok) {
        // The claim spent XP: show the new balance now (the response carries
        // it), then drop the claimed reward and reload server data once the
        // celebration ends, so it is never offered again.
        const data = await res.json().catch(() => ({}));
        if (typeof data?.xp === "number")
          setXpAfterClaim({ from: user.xp, xp: data.xp });
        setCelebratingReward(rewardId);
        setTimeout(() => {
          setCelebratingReward(null);
          setClaimedRewards((prev) => new Set([...prev, rewardId]));
          router.refresh();
        }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        addToast({
          type: "error",
          title: "Couldn't claim that",
          message: data.error || "Please try again.",
        });
      }
    } catch {
      // Offline or the request failed: say so instead of an unhandled rejection.
      addToast({
        type: "error",
        title: "Couldn't claim that",
        message: "Check your connection and try again.",
      });
    } finally {
      setClaimingReward(false);
    }
  }

  async function handleChoreToggle(choreId: string, alreadyDone: boolean) {
    if (
      alreadyDone ||
      completedChores.has(choreId) ||
      pendingCompletions.current.has(choreId)
    )
      return;
    const snapshot = (chores ?? []).find((c) => c.id === choreId);
    if (!snapshot) return;
    pendingCompletions.current.add(choreId);
    setCompletedChores((prev) => new Set([...prev, choreId]));
    const rollback = () =>
      setCompletedChores((prev) => {
        const next = new Set(prev);
        next.delete(choreId);
        return next;
      });
    try {
      const res = await fetch("/api/chores/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choreId }),
      });
      // fetch only rejects on network failure; a 4xx/5xx must also undo the
      // optimistic tick, or the chore looks done while the server disagrees.
      if (!res.ok) {
        rollback();
        const data = await res.json().catch(() => ({}));
        addToast({
          type: "error",
          title: "Couldn't mark it done",
          message: data.error || "Please try again.",
        });
        return;
      }
    } catch {
      rollback();
      addToast({
        type: "error",
        title: "Couldn't mark it done",
        message: "Check your connection and try again.",
      });
      return;
    } finally {
      pendingCompletions.current.delete(choreId);
    }
    // That was the last one: celebrate, then settle into "All done".
    if (remainingRef.current === 0) {
      setCelebration("burst");
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(
        () => setCelebration((c) => (c === "burst" ? "settled" : c)),
        CELEBRATE_MS,
      );
    }
    // Undo over confirm (#269): a mis-tap is one tap to reverse.
    const title = (chores ?? []).find((c) => c.id === choreId)?.title;
    showUndo({
      title: title ? `“${title}” done` : "Done",
      message: "A parent will check it.",
      onUndo: async () => {
        const result = await setChoreDone(choreId, false);
        if (result.ok) {
          rollback();
          const from = latestServerChores.current;
          setReopenedChores((prev) => ({
            from,
            rows: new Map([
              ...(prev?.from === from ? prev.rows : []),
              [choreId, { ...snapshot, status: "pending" }],
            ]),
          }));
          router.refresh();
        } else
          addToast({
            type: "error",
            title: "Couldn't undo",
            message: result.message,
          });
      },
    });
  }

  function renderMission(chore: Chore, note?: string) {
    const baseDone =
      chore.status === "completed" || chore.status === "verified";
    const isDone = baseDone || completedChores.has(chore.id);
    return (
      <button
        type="button"
        onClick={() => handleChoreToggle(chore.id, isDone)}
        disabled={isDone}
        className={cn(
          "w-full flex flex-wrap items-center gap-3 px-4 py-3 min-h-[64px] text-left",
          "transition-colors duration-200 motion-reduce:transition-none",
          !isDone && "active:bg-[var(--surface-fill-secondary)]",
        )}
      >
        {/* Big check circle. Only the check and title fade when done, so
            "You did it!" keeps its full sage contrast. */}
        <div
          className={cn(
            "w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300",
            isDone && "opacity-60",
            isDone
              ? "bg-success border-success animate-check-pop"
              : "border-label-tertiary",
          )}
        >
          {isDone && (
            <svg className="w-4 h-4 text-white" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <div className={cn("flex-1 min-w-0", isDone && "opacity-60")}>
          <div
            className={cn(
              "text-[17px] font-medium leading-snug [overflow-wrap:anywhere]",
              isDone
                ? "text-label-tertiary line-through"
                : "text-label-primary",
            )}
          >
            {chore.title}
          </div>
          {note && (
            <div className="text-footnote text-label-secondary mt-1">
              {note}
            </div>
          )}
          {!isDone && chore.verified_notes?.trim() && (
            <div className="text-footnote text-label-secondary mt-1 [overflow-wrap:anywhere]">
              <span className="block font-semibold">Have another go</span>
              <span className="block">{chore.verified_notes.trim()}</span>
            </div>
          )}
          {gamification && chore.points && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="w-3.5 h-3.5 text-brand-mustard fill-brand-mustard" />
              <span className="text-footnote text-label-secondary">
                {chore.points} points
              </span>
            </div>
          )}
        </div>
        {isDone && (
          <span className="text-body text-success-text font-medium shrink-0">
            You did it!
          </span>
        )}
      </button>
    );
  }

  return (
    // Bottom room so the Undo card (fixed above the phone tab bar) never covers
    // the last row when scrolled to the end (O-42).
    <div className="mx-auto max-w-4xl pb-28 md:pb-20">
      <header className="mb-5 flex items-center justify-between gap-4">
        <h1 className="min-w-0 font-display text-[30px] font-semibold leading-tight tracking-tight text-label-primary [overflow-wrap:anywhere] md:text-[40px]">
          {`Hi, ${firstName(user?.name) ?? "there"}!`}
        </h1>
        <Avatar name={user?.name ?? "?"} src={user?.avatar_url} size="lg" />
      </header>

      <div ref={contentRef} className="space-y-5 md:space-y-6">
        {workPreviewLimited && (
          <p role="status" className="text-footnote text-label-secondary">
            Showing a limited set of your chores. A parent can help you find any
            others.
          </p>
        )}

        {/* Picture routines (#272): first, because they say what to do next. */}
        {routines.length > 0 && (
          <KidRoutines
            routines={routines}
            tickedIds={completedChores}
            onComplete={(id) => {
              const chore = routineChores.find((c) => c.id === id);
              if (chore)
                handleChoreToggle(
                  id,
                  chore.status === "completed" || chore.status === "verified",
                );
            }}
          />
        )}

        {/* Today's Chores */}
        {todayChores.length > 0 && (
          <section>
            <p className="section-header">Today&apos;s Missions</p>
            <div className="list-inset" id="today-missions">
              {todayChores.map((chore, i) => (
                <div
                  key={chore.id}
                  className={cn(i === todayChores.length - 1 && "border-b-0")}
                >
                  {renderMission(chore)}
                </div>
              ))}
            </div>
            {(showToday || hiddenToday > 0) && (
              <button
                type="button"
                aria-controls="today-missions"
                aria-expanded={showToday}
                onClick={() => setShowToday((show) => !show)}
                className="min-h-[44px] px-4 text-body text-label-primary focus-visible:outline"
              >
                {showToday ? "Show less" : `Show more (${hiddenToday})`}
              </button>
            )}
          </section>
        )}

        {/* Earlier open chores: their own small group, most recent first, tickable */}
        {earlierChores.length > 0 && (
          <section>
            <p className="section-header">Still to do</p>
            <div className="list-inset" id="earlier-missions">
              {earlierChores.map((chore, i) => (
                <div
                  key={chore.id}
                  className={cn(i === earlierChores.length - 1 && "border-b-0")}
                >
                  {now &&
                    renderMission(chore, wasDueLabel(chore.due_date, now))}
                </div>
              ))}
            </div>
            {(showEarlier || hiddenEarlier > 0) && (
              <button
                type="button"
                aria-controls="earlier-missions"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier((show) => !show)}
                className="min-h-[44px] px-4 text-body text-label-primary focus-visible:outline"
              >
                {showEarlier ? "Show less" : `Show more (${hiddenEarlier})`}
              </button>
            )}
          </section>
        )}

        {/* Catch-up keeps older occurrences separate from today's picture sequence. */}
        {catchupChores.length > 0 && (
          <section aria-labelledby="routine-catchup-heading">
            <h2 id="routine-catchup-heading" className="section-header">
              Routine catch-up
            </h2>
            <p className="text-footnote text-label-secondary mb-2">
              Earlier steps to finish when you can.
            </p>
            <div className="list-inset" id="routine-catchup-work">
              {catchupChores.map((chore) => (
                <div key={chore.id}>
                  {now &&
                    renderMission(
                      chore,
                      `${chore.routine?.trim()} · ${wasDueLabel(chore.due_date, now)}`,
                    )}
                </div>
              ))}
            </div>
            {(showCatchup || hiddenCatchup > 0) && (
              <button
                type="button"
                aria-controls="routine-catchup-work"
                aria-expanded={showCatchup}
                onClick={() => setShowCatchup((show) => !show)}
                className="min-h-[44px] px-4 text-body text-label-primary focus-visible:outline"
              >
                {showCatchup
                  ? "Show less"
                  : `Show more (${hiddenCatchup})`}
              </button>
            )}
          </section>
        )}

        {/* Before hydration the local day is unknown: hold the missions' place. */}
        {!now && (
          <section
            aria-label="Today's chores"
            aria-busy="true"
            data-testid="kid-home-pending"
          >
            <div className="h-16 rounded-[var(--radius-xl)] bg-[var(--surface-fill)]" />
          </section>
        )}

        {/* Just ticked the last one (O-42): a short celebration, then the
            plain "All done" card. Inline, so nothing is blocked; the brand
            motion shows its still under reduced motion, data saver or dark. */}
        {finishedHere && celebration === "burst" && (
          <div
            ref={celebrationRef}
            className="card-apple relative p-6 text-center animate-spring-up scroll-mt-20 scroll-mb-44 md:scroll-mb-4"
            role="status"
            data-testid="kid-celebration"
          >
            <button
              type="button"
              onClick={() => setCelebration("settled")}
              aria-label="Close"
              className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-label-tertiary hover:text-label-secondary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <BrandMotion
              motion={MOTION.celebrate}
              play="immediate"
              className="mx-auto mb-3 h-auto w-[192px] rounded-[var(--radius-lg)] md:w-[224px]"
            />
            <p className="text-title-2 font-semibold text-label-primary">
              You did it!
            </p>
            <p className="text-body text-label-secondary mt-1">
              All done for today.
            </p>
          </div>
        )}

        {finishedHere && celebration === "settled" && (
          <div
            className="card-apple p-6 text-center"
            data-testid="kid-all-done"
          >
            <BrandMotion
              motion={MOTION.celebrate}
              className="mx-auto mb-3 h-auto w-[160px] rounded-[var(--radius-lg)] md:w-[192px]"
            />
            <p className="text-title-3 text-label-primary">
              All done for today!
            </p>
            <p className="text-subhead text-label-secondary mt-1">
              Enjoy your day, superstar!
            </p>
          </div>
        )}

        {/* No chores state (a routine shows its own progress instead) */}
        {now &&
          !workPreviewLimited &&
          !finishedHere &&
          todayChores.length === 0 &&
          routines.length === 0 && (
            <div className="card-apple p-6 text-center">
              <BrandMotion
                motion={MOTION.celebrate}
                className="mx-auto mb-3 h-auto w-[160px] rounded-[var(--radius-lg)] md:w-[192px]"
              />
              {earlierChores.length > 0 || catchupChores.length > 0 ? (
                // Not "all done" while older chores are still waiting above.
                <>
                  <p className="text-title-3 text-label-primary">
                    Nothing new today!
                  </p>
                  <p className="text-subhead text-label-secondary mt-1">
                    Finish the ones above when you can.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-title-3 text-label-primary">
                    All done for today!
                  </p>
                  <p className="text-subhead text-label-secondary mt-1">
                    Enjoy your day, superstar!
                  </p>
                </>
              )}
            </div>
          )}

        {/* Stars card — XP + level progress (only with Points & streaks on) */}
        {gamification && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] p-4 flex items-center gap-4">
            <ProgressRing
              progress={xpProgress}
              size={64}
              strokeWidth={6}
              color="var(--accent)"
            >
              <div className="flex flex-col items-center leading-none">
                <Star className="w-5 h-5 text-[var(--accent)] fill-current" />
                <span className="text-[16px] font-bold tabular-nums text-label-primary leading-none mt-0.5">
                  {userXp}
                </span>
              </div>
            </ProgressRing>
            <div className="flex-1 min-w-0">
              <p className="text-title-3 text-label-primary leading-tight font-semibold">
                Level {userLevel}
              </p>
              <p className="text-subhead text-label-secondary mt-1">
                {xpNextLevel - userXp} points to go!
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {[...Array(Math.min(userLevel, 5))].map((_, i) => (
                  <Sparkles
                    key={i}
                    className="w-4 h-4 text-brand-mustard fill-brand-mustard"
                  />
                ))}
                {userLevel > 5 && (
                  <span className="text-footnote text-label-tertiary">
                    +{userLevel - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tomorrow: a read-only peek, so "All done for today!" can be true */}
        {tomorrowChores.length > 0 && (
          <section>
            <p className="section-header">Tomorrow</p>
            <ul className="list-inset">
              {tomorrowChores.map((chore, i) => (
                <li
                  key={chore.id}
                  className={cn(
                    "px-4 py-3 min-h-[44px] flex items-center text-body text-label-secondary",
                    i === tomorrowChores.length - 1 && "border-b-0",
                  )}
                >
                  <span className="truncate">{chore.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Coming up — events */}
        {todayEvents.length > 0 && (
          <section>
            <p className="section-header">Coming up</p>
            <div className="list-inset">
              {todayEvents.map((event, i) => (
                <ListRow
                  key={event.id}
                  icon={Calendar}
                  glyphColor="calendar"
                  title={event.title}
                  subtitle={
                    event.location
                      ? `${formatTime(event.start_time, displayLocale)} · ${event.location}`
                      : formatTime(event.start_time, displayLocale)
                  }
                  showChevron={false}
                  trailing={
                    <span className="text-footnote text-label-tertiary">
                      {now && formatRelativeDate(event.start_time, now, displayLocale)}
                    </span>
                  }
                  className={cn(i === todayEvents.length - 1 && "border-b-0")}
                />
              ))}
            </div>
          </section>
        )}

        {/* Rewards card — claim most recent available reward (hidden when the
            rewards feature is off; the claim endpoint 403s in that case) */}
        {rewardsEnabled && claimableReward && (
          <section>
            <p className="section-header">Rewards</p>
            <div className="card-apple p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-12 h-12 rounded-full bg-tint-rewards flex items-center justify-center shrink-0 transition-transform duration-300",
                    celebratingReward === claimableReward.id && "scale-125",
                  )}
                >
                  <Gift className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body text-label-primary font-medium truncate">
                    {claimableReward.name}
                  </p>
                  {claimableReward.description && (
                    <p className="text-footnote text-label-secondary truncate mt-0.5">
                      {claimableReward.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <Star className="w-3.5 h-3.5 text-brand-mustard fill-brand-mustard" />
                    <span className="text-footnote text-label-secondary">
                      {claimableReward.cost} points
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleClaimReward(claimableReward.id)}
                  disabled={
                    claimingReward || celebratingThis || !canClaimReward
                  }
                  className={cn(
                    "btn-primary min-h-[44px] px-4 py-2 text-body shrink-0 transition-all duration-200",
                    celebratingThis
                      ? "bg-success animate-check-pop"
                      : !canClaimReward
                        ? "bg-muted text-label-tertiary cursor-not-allowed"
                        : claimingReward
                          ? "opacity-50"
                          : "",
                  )}
                >
                  {celebratingThis
                    ? "🎉 Claimed!"
                    : canClaimReward
                      ? "Claim"
                      : `Need ${claimableReward.cost - userXp} more points`}
                </button>
              </div>
              {celebratingReward === claimableReward.id && (
                <div className="mt-3 flex items-center justify-center gap-1 animate-spring-up">
                  <span className="text-xl">🎉</span>
                  <span className="text-title-3 text-success-text font-semibold">
                    You got it!
                  </span>
                  <span className="text-xl">🎉</span>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      {undoRoom > 0 && (
        <div
          aria-hidden="true"
          data-testid="undo-room"
          style={{ height: undoRoom }}
        />
      )}
    </div>
  );
}
