"use client";

import { PreparationEntry } from "@/components/calendar/preparation/PreparationEntry";
import type { PreparationBacklinks } from "@/lib/event-preparation/discovery";
import Link from "next/link";
import { CalendarDays, CheckSquare } from "lucide-react";
import type { BoardChore } from "@/app/dashboard/today/today-board-data";
import { useTodayBoardText } from "@/i18n/today-board";
import {
  Region,
  ScheduleEventRows,
  ChoreRow,
  EmptyRegionLine,
  areaClass,
  emptyLineActionClass,
  type BoardPerson,
} from "./regions";
import { emptyTextClass, metaTextClass } from "./styles";
import type { PersonChores, TodayEvent } from "./board-model";
import personalStyles from "./personal-today.module.css";

/** Person-app summary only. Input is the existing scoped/deduplicated board view. */
export function NextUpRegion({
  events,
  people,
  chores,
  showChores,
  calendarHref,
  choresHref,
  onTick,
  canTick,
  preparationEnabled = false,
  preparationBacklinks = {},
  compactEmpty = false,
  addEventHref = null,
  addChoreHref = null,
  noChoresYet = false,
}: {
  /** Shrink an empty card to one line with its first action (personal Today). */
  compactEmpty?: boolean;
  /** "Add event" on an empty schedule; null hides it. */
  addEventHref?: string | null;
  /** "Add a chore" when the household never added one; null hides it. */
  addChoreHref?: string | null;
  /** The household has never added a chore (not just none due today). */
  noChoresYet?: boolean;
  preparationEnabled?: boolean;
  preparationBacklinks?: PreparationBacklinks;
  events: TodayEvent[];
  people: Map<string, BoardPerson>;
  chores: PersonChores[];
  showChores: boolean;
  calendarHref: string | null;
  choresHref: string | null;
  onTick?: ((chore: BoardChore) => void) | null;
  canTick?: (chore: BoardChore) => boolean;
}) {
  const text = useTodayBoardText();
  const open = showChores
    ? chores.flatMap((person) =>
        person.open.map((chore) => ({ chore, member: person.member })),
      )
    : [];
  // Reserve up to three rows for chores, then fill spare capacity with events.
  const shownEvents = events.slice(0, 6 - Math.min(open.length, 3));
  const shownChores = open.slice(0, 6 - shownEvents.length);
  const moreEvents = events.length - shownEvents.length;
  const moreChores = open.length - shownChores.length;
  const done = showChores
    ? chores.reduce((sum, person) => sum + person.doneCount, 0)
    : 0;
  const waiting = showChores
    ? chores.reduce((sum, person) => sum + (person.awaitingCheckCount ?? 0), 0)
    : 0;
  return (
    <div className={`${areaClass.today} ${personalStyles.nextSections} ${!showChores ? personalStyles.singleSection : ""}`}>
    {compactEmpty && shownEvents.length === 0 ? (
      <EmptyRegionLine
        id="board-next-up"
        area="today"
        title={text("today")}
        icon={CalendarDays}
        glyph="calendar"
        message={text("calendarEmptyToday")}
        action={
          addEventHref ? (
            <Link href={addEventHref} className={emptyLineActionClass}>
              {text("addEvent")}
            </Link>
          ) : undefined
        }
      />
    ) : (
    <Region
      id="board-next-up"
      area="today"
      title={text("today")}
      icon={CalendarDays}
      glyph="calendar"
      href={calendarHref}
      hrefLabel={text("openCalendar")}
    >
      {shownEvents.length === 0 && <p className={emptyTextClass}>{text("calendarEmpty")}</p>}
      {shownEvents.length > 0 && (
        <ScheduleEventRows
          events={shownEvents}
          people={people}
          eventAction={
            preparationEnabled
              ? (event) => <PreparationEntry eventId={event.id} />
              : undefined
          }
        />
      )}
      {moreEvents > 0 && (
        <p className={`${metaTextClass} mt-2`}>
          {text("moreLaterToday", { count: moreEvents })}
        </p>
      )}
    </Region>
    )}
      {showChores && compactEmpty && open.length === 0 && done === 0 ? (
        <EmptyRegionLine
          id="next-up-chores"
          area="chores"
          title={text("choresToday")}
          icon={CheckSquare}
          glyph="chore"
          message={text(noChoresYet ? "choresNone" : "choresEmpty")}
          action={
            noChoresYet && addChoreHref ? (
              <Link href={addChoreHref} className={emptyLineActionClass}>
                {text("addFirstChore")}
              </Link>
            ) : undefined
          }
        />
      ) : showChores && (
        <Region
          id="next-up-chores"
          area="chores"
          title={text("choresToday")}
          icon={CheckSquare}
          glyph="chore"
          href={choresHref}
          hrefLabel={text("openChores")}
        >
          {open.length === 0 && done === 0 && <p className={emptyTextClass}>{text(noChoresYet ? "choresNone" : "choresEmpty")}</p>}
          {shownChores.length > 0 && <ul className="space-y-1">
            {shownChores.map(({ chore, member }) => (
              <ChoreRow
                key={chore.id}
                chore={chore}
                name={people.get(member.id)?.name ?? member.name}
                showOwner
                onTick={onTick}
                canTick={canTick}
                action={
                  preparationEnabled && preparationBacklinks[chore.id] ? (
                    <PreparationEntry
                      eventId={preparationBacklinks[chore.id]}
                      backlink
                    />
                  ) : undefined
                }
              />
            ))}
          </ul>}
          {moreChores > 0 && (
            <p className={`${metaTextClass} mt-2`}>
              {text("more", { count: moreChores })}
            </p>
          )}
          {done > 0 && (
            <p data-testid="chore-done" className={`${metaTextClass} mt-2`}>
              {waiting > 0
                ? text("doneWaiting", { done, waiting })
                : text("done", { count: done })}
            </p>
          )}
        </Region>
      )}
    </div>
  );
}
