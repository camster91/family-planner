"use client";
import * as React from "react";
import { ArrowUp, ArrowDown, SlidersHorizontal } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import {
  defaultPersonalLayout,
  type TodayLayout,
  type TodaySection,
} from "@/lib/personal-layout";
import { usePersonalLayoutText } from "@/i18n/personal-layout";
import { useUndoToast } from "@/components/ui/toast";

export default function TodayLayoutEditor({
  available,
}: {
  available: TodaySection[];
}) {
  const { layout, today, remembered, previewToday, saveToday } =
    useDisplayPreferences();
  const text = usePersonalLayoutText();
  const showUndo = useUndoToast();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<TodayLayout>(today);
  const [previewing, setPreviewing] = React.useState(false);
  const original = React.useRef(layout.today);
  const previewRef = React.useRef(previewToday);
  previewRef.current = previewToday;
  React.useEffect(
    () => () => {
      previewRef.current(null);
    },
    [],
  );
  const close = () => {
    previewToday(null);
    setPreviewing(false);
    setOpen(false);
  };
  const update = (next: TodayLayout) => {
    setDraft(next);
    if (previewing) previewToday(next);
  };
  const reorder = (section: TodaySection, direction: -1 | 1) => {
    const visibleOrder = draft.order.filter((item) => available.includes(item));
    const position = visibleOrder.indexOf(section);
    const other = visibleOrder[position + direction];
    if (!other) return;
    const order = [...draft.order];
    const index = order.indexOf(section),
      target = order.indexOf(other);
    [order[index], order[target]] = [order[target], order[index]];
    update({ ...draft, order });
  };
  return (
    <>
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        onClick={() => {
          original.current = layout.today;
          setDraft(layout.today);
          setPreviewing(false);
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {text("customize")}
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={text("title")}
        description={text("description")}
        closeLabel={text("close")}
        variant="form"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary min-h-[44px] flex-1"
              onClick={close}
            >
              {text("cancel")}
            </button>
            <button
              type="button"
              className="btn-filled min-h-[44px] flex-1"
              onClick={() => {
                const previous = original.current;
                saveToday(draft);
                setPreviewing(false);
                setOpen(false);
                showUndo({
                  title: text("saved"),
                  onUndo: () => saveToday(previous),
                });
              }}
            >
              {text("save")}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <ul className="divide-y divide-[var(--surface-separator)]">
            {draft.order
              .filter((section) => available.includes(section))
              .map((section, index, rows) => (
                <li key={section} className="flex items-center gap-2 py-2">
                  <label className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!draft.hidden.includes(section)}
                      disabled={section === "next"}
                      onChange={(event) =>
                        update({
                          ...draft,
                          hidden: event.target.checked
                            ? draft.hidden.filter((item) => item !== section)
                            : [...draft.hidden, section],
                        })
                      }
                      className="h-5 w-5"
                    />
                    <span className="text-body text-label-primary">
                      {text(section)}
                      {section === "next" && (
                        <small className="block text-footnote text-label-secondary">
                          {text("anchor")}
                        </small>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn-plain min-h-[44px] min-w-[44px] disabled:opacity-30"
                    disabled={index === 0}
                    aria-label={text("up", { section: text(section) })}
                    onClick={() => reorder(section, -1)}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-plain min-h-[44px] min-w-[44px] disabled:opacity-30"
                    disabled={index === rows.length - 1}
                    aria-label={text("down", { section: text(section) })}
                    onClick={() => reorder(section, 1)}
                  >
                    <ArrowDown size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
          </ul>
          <label className="flex min-h-[44px] items-center gap-3">
            <input
              type="checkbox"
              checked={draft.includeChores}
              onChange={(event) =>
                update({ ...draft, includeChores: event.target.checked })
              }
              className="h-5 w-5"
            />
            {text("includeChores")}
          </label>
          <fieldset>
            <legend className="label-apple">{text("density")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["comfortable", "compact"] as const).map((density) => (
                <button
                  type="button"
                  key={density}
                  aria-pressed={draft.density === density}
                  onClick={() => update({ ...draft, density })}
                  className={
                    draft.density === density
                      ? "btn-filled min-h-[44px]"
                      : "btn-tinted min-h-[44px]"
                  }
                >
                  {text(density)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-body">
            {text("calendarView")}
            <select
              className="input-apple mt-2"
              value={draft.calendarView}
              onChange={(event) => {
                const calendarView = event.target.value;
                if (
                  calendarView === "day" ||
                  calendarView === "week" ||
                  calendarView === "agenda"
                )
                  update({ ...draft, calendarView });
              }}
            >
              {(["day", "week", "agenda"] as const).map((view) => (
                <option key={view} value={view}>
                  {text(view)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => {
                previewToday(draft);
                setPreviewing(true);
              }}
            >
              {text(previewing ? "previewing" : "preview")}
            </button>
            <button
              type="button"
              className="btn-ghost min-h-[44px]"
              onClick={() => update(defaultPersonalLayout().today)}
            >
              {text("reset")}
            </button>
          </div>
          {previewing && (
            <p role="status" className="text-footnote text-label-secondary">
              {text("previewHelp")}
            </p>
          )}
          {!remembered && (
            <p role="status" className="text-footnote text-label-secondary">
              {text("storage")}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
