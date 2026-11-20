"use client";

import * as React from "react";
import { Sparkles, Trash2, Undo2 } from "lucide-react";
import { useSmartAddText, type SmartAddMessage } from "@/i18n/smart-add";
import {
  MEAL_SLOTS,
  createdIdOf,
  fallbackGroceryRows,
  newIdempotencyKey,
  rowProblem,
  savePlanFor,
  sendKeyed,
  undoPlanFor,
  viewerNow,
  type SavedRecord,
  type SmartList,
  type SmartPerson,
  type SmartRow,
} from "@/lib/smart-add-client";

type RowState = {
  row: SmartRow;
  key: string;
  status: "draft" | "saving" | "saved" | "error";
};

const input =
  "min-h-[44px] w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]";
const button =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50";

const KIND_LABEL: Record<SmartRow["kind"], SmartAddMessage> = {
  event: "kindEvent",
  chore: "kindChore",
  grocery: "kindGrocery",
  meal: "kindMeal",
};

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * The smart "Add" box at the top of "Add or ask" (#144). Hidden unless the
 * server says this person may use it (deployment on, household opted in,
 * parent or teen, not a shared tablet). Every draft is reviewed and saved
 * through the existing create routes; nothing saves without a tap.
 */
export function SmartAddBox({ role, open }: { role: string; open: boolean }) {
  const text = useSmartAddText();
  const [available, setAvailable] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<RowState[]>([]);
  const [people, setPeople] = React.useState<SmartPerson[]>([]);
  const [lists, setLists] = React.useState<SmartList[]>([]);
  const [peopleOnEvents, setPeopleOnEvents] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [fallback, setFallback] = React.useState(false);
  const [saved, setSaved] = React.useState<SavedRecord[]>([]);
  const mealOwner = React.useRef<{ userId: string; familyId: string } | null>(
    null,
  );
  const canUse = role === "parent" || role === "teen";

  React.useEffect(() => {
    if (!open || !canUse || typeof fetch !== "function") return;
    const controller = new AbortController();
    fetch("/api/ai/smart-add", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setAvailable(Boolean(body && body.available === true)))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, [open, canUse]);

  if (!canUse || !available) return null;

  const accounts = people.filter((p) => p.kind === "account");

  const showFallback = (reason: SmartAddMessage) => {
    const local = fallbackGroceryRows(note);
    setFallback(true);
    setMessage(text(reason));
    setRows(
      local.map((row) => ({ row, key: newIdempotencyKey(), status: "draft" })),
    );
  };

  async function makeDrafts(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim() || busy) return;
    setMessage(null);
    setSaved([]);
    setFallback(false);
    if (!isOnline()) {
      showFallback("offline");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/ai/smart-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ text: note.trim(), ...viewerNow() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setRows([]);
        setMessage(
          typeof body?.error === "string" ? body.error : text("unclear"),
        );
        return;
      }
      setPeople(Array.isArray(body.people) ? body.people : []);
      setLists(Array.isArray(body.lists) ? body.lists : []);
      setPeopleOnEvents(body.peopleOnEvents === true);
      const drafts: SmartRow[] = Array.isArray(body.drafts) ? body.drafts : [];
      setRows(
        drafts.map((row) => ({
          row,
          key: newIdempotencyKey(),
          status: "draft",
        })),
      );
      if (body.status === "refused") setMessage(text("refused"));
      else if (!drafts.length) setMessage(text("unclear"));
      else if (body.dropped > 0) setMessage(text("dropped"));
    } catch {
      setMessage(null);
      showFallback(isOnline() ? "groceryFallbackHint" : "offline");
    } finally {
      setBusy(false);
    }
  }

  const update = (id: string, patch: Partial<SmartRow>) =>
    setRows((current) =>
      current.map((s) =>
        s.row.id === id && s.status !== "saved"
          ? { ...s, row: { ...s.row, ...patch } as SmartRow, status: "draft" }
          : s,
      ),
    );
  const remove = (id: string) =>
    setRows((current) => current.filter((s) => s.row.id !== id));

  async function ensureMealOwner() {
    if (mealOwner.current) return mealOwner.current;
    const response = await fetch("/api/meals/create", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (
      !response.ok ||
      typeof body?.userId !== "string" ||
      typeof body?.familyId !== "string"
    )
      throw new Error("meal owner");
    mealOwner.current = { userId: body.userId, familyId: body.familyId };
    return mealOwner.current;
  }

  async function saveRows(ids: string[]) {
    if (!isOnline()) {
      setMessage(text("offline"));
      return;
    }
    setBusy(true);
    const added: SavedRecord[] = [];
    let failed = false;
    const today = viewerNow().localDate;
    for (const id of ids) {
      const state = rows.find((s) => s.row.id === id);
      if (!state || state.status === "saved" || rowProblem(state.row, role))
        continue;
      setRows((current) =>
        current.map((s) => (s.row.id === id ? { ...s, status: "saving" } : s)),
      );
      try {
        const meal =
          state.row.kind === "meal" ? await ensureMealOwner() : undefined;
        const result = await sendKeyed(
          savePlanFor(state.row, { peopleOnEvents, meal, today }),
          state.key,
        );
        if (!result.ok) throw new Error(String(result.status));
        const createdId = createdIdOf(result.body);
        if (createdId) added.push({ kind: state.row.kind, id: createdId });
        setRows((current) =>
          current.map((s) => (s.row.id === id ? { ...s, status: "saved" } : s)),
        );
      } catch {
        failed = true;
        // Keep the same key: a retry replays instead of adding twice.
        setRows((current) =>
          current.map((s) => (s.row.id === id ? { ...s, status: "error" } : s)),
        );
      }
    }
    setBusy(false);
    setSaved((current) => [...current, ...added]);
    if (failed) setMessage(text("saveFailed"));
    else if (added.length)
      setMessage(
        added.length === 1
          ? text("addedOne")
          : text("added", { count: added.length }),
      );
  }

  async function undo() {
    setBusy(true);
    let failed = false;
    for (const record of saved) {
      try {
        const result = await sendKeyed(
          undoPlanFor(record, mealOwner.current ?? undefined),
          newIdempotencyKey(),
        );
        if (!result.ok && result.status !== 404) failed = true;
      } catch {
        failed = true;
      }
    }
    setBusy(false);
    setSaved([]);
    setRows([]);
    setMessage(text(failed ? "undoFailed" : "undone"));
  }

  const ready = rows.filter(
    (s) => s.status !== "saved" && !rowProblem(s.row, role),
  );

  return (
    <section
      aria-labelledby="smart-add-label"
      className="sm:col-span-2 rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] p-3"
      data-testid="smart-add"
    >
      <form onSubmit={makeDrafts} className="grid gap-2">
        <label
          id="smart-add-label"
          htmlFor="smart-add-input"
          className="flex items-center gap-2 text-sm font-semibold text-label-primary"
        >
          <Sparkles size={18} aria-hidden="true" />
          {text("label")}
          <span className="text-xs font-normal text-label-secondary">
            · {text("aiLabel")}
          </span>
        </label>
        <textarea
          id="smart-add-input"
          className={input}
          rows={2}
          maxLength={1000}
          value={note}
          placeholder={text("placeholder")}
          aria-describedby="smart-add-hint"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="smart-add-hint" className="text-xs text-label-secondary">
            {text("hint")}
          </p>
          <button
            type="submit"
            className={`${button} bg-[var(--accent-fill)] text-white`}
            disabled={busy || !note.trim()}
          >
            {busy && !rows.length ? text("working") : text("submit")}
          </button>
        </div>
      </form>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-label-secondary"
        >
          {message}
        </p>
      )}

      {saved.length > 0 && role === "parent" && (
        <button
          type="button"
          className={`${button} mt-2 border border-[var(--surface-separator)]`}
          onClick={undo}
          disabled={busy}
        >
          <Undo2 size={18} aria-hidden="true" />
          {text("undo")}
        </button>
      )}

      {rows.length > 0 && (
        <div
          className="mt-3 grid gap-2"
          aria-label={text("reviewTitle")}
          role="group"
        >
          <p className="text-sm font-semibold text-label-primary">
            {fallback ? text("kindGrocery") : text("reviewTitle")}
          </p>
          <ul className="grid gap-2">
            {rows.map((state) => (
              <ReviewRow
                key={state.row.id}
                state={state}
                role={role}
                accounts={accounts}
                people={people}
                lists={lists}
                peopleOnEvents={peopleOnEvents}
                busy={busy}
                text={text}
                onChange={(patch) => update(state.row.id, patch)}
                onRemove={() => remove(state.row.id)}
                onSave={() => saveRows([state.row.id])}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${button} bg-[var(--accent-fill)] text-white`}
              disabled={busy || ready.length === 0}
              onClick={() => saveRows(ready.map((s) => s.row.id))}
            >
              {busy ? text("saving") : text("addAll")}
            </button>
            <button
              type="button"
              className={`${button} border border-[var(--surface-separator)]`}
              disabled={busy}
              onClick={() => {
                setRows([]);
                setMessage(null);
              }}
            >
              {text("cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewRow({
  state,
  role,
  accounts,
  people,
  lists,
  peopleOnEvents,
  busy,
  text,
  onChange,
  onRemove,
  onSave,
}: {
  state: RowState;
  role: string;
  accounts: SmartPerson[];
  people: SmartPerson[];
  lists: SmartList[];
  peopleOnEvents: boolean;
  busy: boolean;
  text: ReturnType<typeof useSmartAddText>;
  onChange: (patch: Partial<SmartRow>) => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const { row, status } = state;
  const id = `smart-row-${row.id}`;
  const problem = rowProblem(row, role);
  const locked = status === "saved" || status === "saving";
  const field = (
    label: SmartAddMessage,
    control: React.ReactNode,
    htmlFor: string,
  ) => (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-xs text-label-secondary">
        {text(label)}
      </label>
      {control}
    </div>
  );
  return (
    <li
      className="rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-3"
      data-testid="smart-add-row"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-label-secondary">
          {text(KIND_LABEL[row.kind])}
        </span>
        {status === "saved" && (
          <span role="status" className="text-xs text-label-secondary">
            {text("addedOne")}
          </span>
        )}
        {status === "error" && (
          <span
            role="alert"
            className="text-xs text-[var(--danger-text,#b42318)]"
          >
            {text("saveFailed")}
          </span>
        )}
      </div>
      <fieldset disabled={locked} className="grid gap-2 sm:grid-cols-2">
        {field(
          "title",
          <input
            id={`${id}-title`}
            className={input}
            value={row.title}
            maxLength={200}
            onChange={(e) => onChange({ title: e.target.value })}
          />,
          `${id}-title`,
        )}
        {row.kind === "event" && (
          <>
            {field(
              "date",
              <input
                id={`${id}-date`}
                type="date"
                className={input}
                value={row.date}
                onChange={(e) =>
                  e.target.value && onChange({ date: e.target.value })
                }
              />,
              `${id}-date`,
            )}
            {field(
              "start",
              <input
                id={`${id}-start`}
                type="time"
                className={input}
                value={row.startTime ?? ""}
                onChange={(e) =>
                  onChange({ startTime: e.target.value || null })
                }
              />,
              `${id}-start`,
            )}
            {field(
              "end",
              <input
                id={`${id}-end`}
                type="time"
                className={input}
                value={row.endTime ?? ""}
                onChange={(e) => onChange({ endTime: e.target.value || null })}
              />,
              `${id}-end`,
            )}
            {peopleOnEvents && people.length > 0 && (
              <fieldset className="grid gap-1 sm:col-span-2">
                <legend className="text-xs text-label-secondary">
                  {text("who")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => {
                    const checked = row.people.some(
                      (x) => x.kind === p.kind && x.id === p.id,
                    );
                    return (
                      <label
                        key={`${p.kind}:${p.id}`}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--surface-separator)] px-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            onChange({
                              people: checked
                                ? row.people.filter(
                                    (x) =>
                                      !(x.kind === p.kind && x.id === p.id),
                                  )
                                : [...row.people, p],
                              checkPeople: false,
                            })
                          }
                        />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </>
        )}
        {row.kind === "chore" && (
          <>
            {field(
              "dueDate",
              <input
                id={`${id}-due`}
                type="date"
                className={input}
                value={row.dueDate ?? ""}
                onChange={(e) => onChange({ dueDate: e.target.value || null })}
              />,
              `${id}-due`,
            )}
            {field(
              "who",
              <select
                id={`${id}-who`}
                className={input}
                value={row.assignee?.id ?? ""}
                onChange={(e) =>
                  onChange({
                    assignee:
                      accounts.find((a) => a.id === e.target.value) ?? null,
                    checkPeople: false,
                  })
                }
              >
                <option value="">{text("nobody")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>,
              `${id}-who`,
            )}
          </>
        )}
        {row.kind === "grocery" && (
          <>
            {field(
              "quantity",
              <input
                id={`${id}-qty`}
                type="number"
                min={1}
                max={99}
                className={input}
                value={row.quantity}
                onChange={(e) =>
                  onChange({
                    quantity: Math.min(
                      99,
                      Math.max(1, Number(e.target.value) || 1),
                    ),
                  })
                }
              />,
              `${id}-qty`,
            )}
            {lists.length > 0 &&
              field(
                "list",
                <select
                  id={`${id}-list`}
                  className={input}
                  value={row.list?.id ?? ""}
                  onChange={(e) =>
                    onChange({
                      list: lists.find((l) => l.id === e.target.value) ?? null,
                    })
                  }
                >
                  <option value="">{text("groceryListDefault")}</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>,
                `${id}-list`,
              )}
          </>
        )}
        {row.kind === "meal" && (
          <>
            {field(
              "date",
              <input
                id={`${id}-date`}
                type="date"
                className={input}
                value={row.date}
                onChange={(e) =>
                  e.target.value && onChange({ date: e.target.value })
                }
              />,
              `${id}-date`,
            )}
            {field(
              "slot",
              <select
                id={`${id}-slot`}
                className={input}
                value={row.slot}
                onChange={(e) =>
                  onChange({
                    slot: e.target.value as (typeof MEAL_SLOTS)[number],
                  })
                }
              >
                {MEAL_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {text(slot)}
                  </option>
                ))}
              </select>,
              `${id}-slot`,
            )}
          </>
        )}
      </fieldset>
      {(problem ||
        ((row.kind === "event" || row.kind === "chore") && row.checkPeople)) &&
        status !== "saved" && (
          <p className="mt-2 text-xs text-label-secondary">
            {text(problem ?? "checkWho")}
          </p>
        )}
      {status !== "saved" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`${button} border border-[var(--surface-separator)]`}
            disabled={busy || Boolean(problem)}
            onClick={onSave}
          >
            {text("addOne")}
          </button>
          <button
            type="button"
            className={`${button} border border-[var(--surface-separator)]`}
            disabled={busy}
            onClick={onRemove}
            aria-label={`${text("remove")}: ${row.title}`}
          >
            <Trash2 size={16} aria-hidden="true" />
            {text("remove")}
          </button>
        </div>
      )}
    </li>
  );
}
