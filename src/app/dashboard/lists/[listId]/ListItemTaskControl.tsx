"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { listTasksMessages, type ListTasksMessage } from "@/i18n/list-tasks";
import { MEMBER_COLOR_CSS, isMemberColorKey } from "@/lib/member-colors";
import { dueState, isDueDay, type ListItemTaskView } from "@/lib/list-tasks";

type Person = { kind: "account" | "profile"; id: string; name: string; color: string };
const key = (person: { kind: string; id: string }) => `${person.kind}:${person.id}`;
/** The reader's own "today" as YYYY-MM-DD. */
function localToday(): string {
  const now = new Date();
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
export function ListItemTaskControl({ itemId, itemName, initial, canEdit, disabled = false }: {
  itemId: string; itemName: string; initial?: ListItemTaskView | null; canEdit: boolean; disabled?: boolean;
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
    const chosen = people?.find((person) => key(person) === owner) ?? null;
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/lists/items/task", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, owner: chosen ? { kind: chosen.kind, id: chosen.id } : null, due: due || null }),
      });
      const body = response.ok ? await response.json() : null;
      const saved = (body as { task?: ListItemTaskView } | null)?.task;
      if (!saved || (saved.due !== null && !isDueDay(saved.due))) throw new Error("save failed");
      setTask(saved);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const state = task.due ? dueState(task.due, localToday()) : null;
  const dueDate = task.due
    ? new Intl.DateTimeFormat(locale === "es" ? "es" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${task.due}T00:00:00Z`))
    : "";
  const dueText = !task.due ? null : state === "today" ? msg("dueToday") : state === "overdue" ? msg("overdue", { date: dueDate }) : msg("dueOn", { date: dueDate });
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
          className="min-h-[44px] text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline">
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
              {due && <button type="button" className="btn-plain min-h-[44px]" disabled={saving} onClick={() => setDue("")}>{msg("clear")}</button>}
            </div>
          </div>
          {failed && <p role="alert" className="text-footnote text-danger-text">{msg("failed")}</p>}
        </div>
      </Dialog>
    </div>
  );
}
