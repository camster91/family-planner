"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { listTasksMessages, type ListTasksMessage } from "@/i18n/list-tasks";
import { MEMBER_COLOR_CSS, isMemberColorKey } from "@/lib/member-colors";
import { dueState, isDueDay, type ListItemTaskView } from "@/lib/list-tasks";
import { useNow } from "@/components/fridge/sync-status";

type Person = { kind: "account" | "profile"; id: string; name: string; color: string };
const key = (person: { kind: string; id: string }) => `${person.kind}:${person.id}`;
/** The reader's own day as YYYY-MM-DD, from a browser clock reading. */
function localDay(ms: number): string {
  const now = new Date(ms);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function readPeople(body: unknown): Person[] | null {
  const list = (body as { supported?: unknown; people?: unknown } | null)?.people;
  if ((body as { supported?: unknown } | null)?.supported !== true || !Array.isArray(list)) return null;
  return list.filter((p): p is Person => !!p && (p.kind === "account" || p.kind === "profile") && typeof p.id === "string" && typeof p.name === "string");
}

/**
 * Who a to-do is for and when it is due (default-off). Shows the saved owner
 * and due date under the item, and lets a parent or teen change them. The
 * family is loaded only when the dialog is first opened.
 */
export function ListItemTaskControl({ itemId, itemName, initial, canEdit, disabled = false, done = false, onSaved }: {
  itemId: string; itemName: string; initial?: ListItemTaskView | null; canEdit: boolean; disabled?: boolean;
  /** A ticked item is finished: its due day is shown plainly, never as overdue or due today. */
  done?: boolean;
  /** Told what was saved, so the list can keep it (for example to put it back after Undo). */
  onSaved?: (itemId: string, task: ListItemTaskView) => void;
}) {
  const { t, locale } = useTranslation();
  const msg = (name: ListTasksMessage, params?: Record<string, string>) => t(name, params, listTasksMessages);
  const id = useId();
  const [task, setTask] = useState<ListItemTaskView>(initial ?? { owner: null, due: null });
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The server only knows "today" in its own zone, so the due label waits for
  // the browser clock and follows it past midnight.
  const now = useNow(60_000);

  // A refreshed list can bring a newer owner or due date (set on another
  // device). Follow it rather than keeping the first value seen.
  const initialKey = JSON.stringify(initial ?? null);
  useEffect(() => {
    setTask(initial ?? { owner: null, due: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
  }, [initialKey]);

  const begin = () => {
    setOwner(task.owner ? key(task.owner) : "");
    setDue(task.due ?? "");
    setFailed(false);
    setOpen(true);
    if (people) return;
    setPeopleFailed(false);
    fetch("/api/lists/people", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { const found = readPeople(body); if (found) setPeople(found); else setPeopleFailed(true); })
      .catch(() => setPeopleFailed(true));
  };
  const save = async () => {
    // Send only what the person changed: a field left out is unchanged on the
    // server, so an unloaded family list or a stale copy cannot wipe the
    // owner or due date someone else set.
    const change: { owner?: { kind: Person["kind"]; id: string } | null; due?: string | null } = {};
    if (people && owner !== (task.owner ? key(task.owner) : "")) {
      const chosen = people.find((person) => key(person) === owner) ?? null;
      change.owner = chosen ? { kind: chosen.kind, id: chosen.id } : null;
    }
    if (due !== (task.due ?? "")) change.due = due || null;
    if (change.owner === undefined && change.due === undefined) { setOpen(false); return; }
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/lists/items/task", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...change }),
      });
      const body = response.ok ? await response.json() : null;
      const saved = (body as { task?: ListItemTaskView } | null)?.task;
      if (!saved || (saved.due !== null && !isDueDay(saved.due))) throw new Error("save failed");
      setTask(saved);
      onSaved?.(itemId, saved);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const state = task.due && now !== null ? (done ? "upcoming" : dueState(task.due, localDay(now))) : null;
  const dueDate = task.due
    ? new Intl.DateTimeFormat(locale === "es" ? "es" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${task.due}T00:00:00Z`))
    : "";
  const dueText = !task.due || now === null ? null : state === "today" ? msg("dueToday") : state === "overdue" ? msg("overdue", { date: dueDate }) : msg("dueOn", { date: dueDate });
  if (!canEdit && !task.owner && !task.due) return null;

  return (
    <div data-testid="list-item-task" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-footnote text-label-secondary">
      {task.owner && (
        <span data-testid="list-item-task-owner" className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full"
            style={{ background: isMemberColorKey(task.owner.color) ? MEMBER_COLOR_CSS[task.owner.color] : "currentColor" }} />
          <span style={{ overflowWrap: "anywhere" }}>{msg("forPerson", { name: task.owner.name })}</span>
        </span>
      )}
      {dueText && (
        <span data-testid="list-item-task-due" data-due-state={state ?? undefined} className={state === "overdue" ? "font-semibold text-danger-text" : state === "today" ? "font-semibold text-label-primary" : undefined}>
          {dueText}
        </span>
      )}
      {canEdit && (
        <button type="button" disabled={disabled} onClick={begin} aria-haspopup="dialog" aria-label={msg("setFor", { item: itemName })}
          className="min-h-[44px] min-w-[44px] px-2 text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline">
          {msg("set")}
        </button>
      )}
      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title={msg("title")} description={itemName} testId="list-item-task-dialog"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-tinted min-h-[44px]" disabled={saving} onClick={() => setOpen(false)}>{msg("cancel")}</button>
            <button type="button" className="btn-filled min-h-[44px]" disabled={saving || (!people && !peopleFailed)} onClick={() => void save()}>
              {saving ? msg("saving") : msg("save")}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <div>
            <label className="label-apple" htmlFor={`${id}-owner`}>{msg("owner")}</label>
            <select id={`${id}-owner`} className="input-apple min-h-[44px]" value={owner} disabled={saving || !people} onChange={(event) => setOwner(event.target.value)}>
              <option value="">{msg("ownerNone")}</option>
              {(people ?? (task.owner ? [task.owner as Person] : [])).map((person) => <option key={key(person)} value={key(person)}>{person.name}</option>)}
            </select>
            {peopleFailed && <p role="alert" className="mt-1 text-footnote text-danger-text">{msg("peopleFailed")}</p>}
          </div>
          <div>
            <label className="label-apple" htmlFor={`${id}-due`}>{msg("due")}</label>
            <div className="flex items-center gap-2">
              <input id={`${id}-due`} type="date" className="input-apple" value={due} disabled={saving} onChange={(event) => setDue(event.target.value)} />
              {due && <button type="button" className="btn-plain min-h-[44px] min-w-[44px] px-2" disabled={saving} onClick={() => setDue("")}>{msg("clear")}</button>}
            </div>
          </div>
          {failed && <p role="alert" className="text-footnote text-danger-text">{msg("failed")}</p>}
        </div>
      </Dialog>
    </div>
  );
}
