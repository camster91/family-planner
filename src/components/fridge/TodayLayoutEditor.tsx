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
import DisplayPreferencesStatus from "@/components/account/DisplayPreferencesStatus";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";

export default function TodayLayoutEditor({
  available,
  scope = "person",
  openOnMount = false,
  open: controlledOpen,
  onOpenChange,
  hideInternalLauncher = false,
  showStatus = true,
}: {
  available: TodaySection[];
  scope?: "person" | "household";
  /** Used by the Today-board launcher after its optional chunk has loaded. */
  openOnMount?: boolean;
  /** Optional controlled dialog state for a launcher that stays mounted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The parent launcher owns the opener when the editor is deferred. */
  hideInternalLauncher?: boolean;
  /** The Today board keeps the status row in its lightweight launcher. */
  showStatus?: boolean;
}) {
  const preferences = useDisplayPreferences();
  const {
    layout,
    today,
    defaultToday,
    personalizedToday,
    revision,
    defaultsRevision,
    saving,
    syncState,
    canManageDefaults,
    previewToday,
    saveToday,
    resetToday,
    saveDefaults,
  } = preferences;
  const household = scope === "household";
  const text = usePersonalLayoutText(),
    showUndo = useUndoToast();
  const controlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(openOnMount),
    [draft, setDraft] = React.useState<TodayLayout>(today);
  const open = controlledOpen ?? uncontrolledOpen;
  const [previewing, setPreviewing] = React.useState(false),
    [inherit, setInherit] = React.useState(false);
  const writing = React.useRef(false);
  const original = React.useRef({
    today: layout.today,
    personalized: personalizedToday,
    revision,
  });
  const baseline = React.useRef(0);
  const [baselineView, setBaselineView] = React.useState(0);
  const previewRef = React.useRef(previewToday);
  previewRef.current = previewToday;
  usePendingFormNavigationController(saving);
  React.useEffect(
    () => () => {
      if (!household) previewRef.current(null);
    },
    [household],
  );
  const currentRevision = household ? defaultsRevision : revision;
  const changedElsewhere = open && baselineView !== currentRevision;
  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    if (writing.current || saving) return;
    if (!household) previewToday(null);
    setPreviewing(false);
    setOpen(false);
  };
  const update = (next: TodayLayout) => {
    setDraft(next);
    setInherit(false);
    if (previewing && !household) previewToday(next);
  };
  const captureLatest = (keepDraft: boolean) => {
    original.current = {
      today: household ? defaultToday : layout.today,
      personalized: personalizedToday,
      revision,
    };
    baseline.current = currentRevision;
    setBaselineView(currentRevision);
    if (!keepDraft) {
      setDraft(household ? defaultToday : layout.today);
      setInherit(false);
      setPreviewing(false);
      if (!household) previewToday(null);
    }
  };
  const captureLatestRef = React.useRef(captureLatest);
  captureLatestRef.current = captureLatest;
  const previousOpen = React.useRef(false);
  React.useEffect(() => {
    const wasOpen = previousOpen.current;
    previousOpen.current = open;
    if (open && !wasOpen) captureLatestRef.current(false);
  }, [open]);
  const reorder = (section: TodaySection, direction: -1 | 1) => {
    const visibleOrder = draft.order.filter((item) => available.includes(item));
    const other = visibleOrder[visibleOrder.indexOf(section) + direction];
    if (!other) return;
    const order = [...draft.order],
      index = order.indexOf(section),
      target = order.indexOf(other);
    [order[index], order[target]] = [order[target], order[index]];
    update({ ...draft, order });
  };
  const save = async () => {
    if (writing.current || saving || syncState !== "ready" || changedElsewhere)
      return;
    writing.current = true;
    try {
      const previous = original.current;
      const receipt = household
        ? await saveDefaults(draft, baseline.current)
        : inherit
          ? await resetToday(baseline.current)
          : await saveToday(draft, baseline.current);
      if (!receipt) return;
      setPreviewing(false);
      setOpen(false);
      showUndo({
        title: text(household ? "defaultsSaved" : "saved"),
        onUndo: () => {
          if (household)
            void saveDefaults(previous.today, receipt.defaultsRevision);
          else if (previous.personalized)
            void saveToday(previous.today, receipt.revision);
          else void resetToday(receipt.revision);
        },
      });
    } finally {
      writing.current = false;
    }
  };
  if (household && syncState === "ready" && !canManageDefaults) return null;
  return (
    <>
      {!hideInternalLauncher && (
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          disabled={saving || syncState !== "ready"}
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          {text(household ? "householdDefaults" : "customize")}
        </button>
      )}
      {showStatus && <DisplayPreferencesStatus />}
      <Dialog
        open={open}
        onClose={saving ? undefined : close}
        title={text(household ? "householdDefaults" : "title")}
        description={text(household ? "defaultsDescription" : "description")}
        closeLabel={text("close")}
        variant="form"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary min-h-[44px] flex-1"
              disabled={saving}
              onClick={close}
            >
              {text("cancel")}
            </button>
            <button
              type="button"
              className="btn-filled min-h-[44px] flex-1"
              disabled={saving || syncState !== "ready" || changedElsewhere}
              onClick={() => void save()}
            >
              {text(saving ? "saving" : "save")}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <DisplayPreferencesStatus />
          {changedElsewhere && (
            <div
              role="status"
              className="space-y-3 rounded-xl bg-[var(--surface-fill)] p-3"
            >
              <p>{text("changedElsewhere")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  onClick={() => captureLatest(false)}
                >
                  {text("useSaved")}
                </button>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  onClick={() => captureLatest(true)}
                >
                  {text("keepDraft")}
                </button>
              </div>
            </div>
          )}
          <fieldset disabled={saving} className="space-y-5">
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
                    calendarView === "month" ||
                    calendarView === "agenda"
                  )
                    update({ ...draft, calendarView });
                }}
              >
                {(["day", "week", "month", "agenda"] as const).map((view) => (
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
                  if (!household) previewToday(draft);
                  setPreviewing(true);
                }}
              >
                {text(previewing ? "previewing" : "preview")}
              </button>
              <button
                type="button"
                className="btn-ghost min-h-[44px]"
                onClick={() => {
                  const defaults = household
                    ? defaultPersonalLayout().today
                    : defaultToday;
                  setDraft(defaults);
                  setInherit(!household);
                  if (previewing && !household) previewToday(defaults);
                }}
              >
                {text("reset")}
              </button>
            </div>
          </fieldset>
          {previewing && (
            <div
              role="status"
              className="rounded-xl bg-[var(--surface-fill)] p-3"
            >
              <p className="text-footnote text-label-secondary">
                {text("previewHelp")}
              </p>
              <ol className="mt-2 flex flex-wrap gap-2">
                {draft.order
                  .filter(
                    (section) =>
                      available.includes(section) &&
                      !draft.hidden.includes(section),
                  )
                  .map((section) => (
                    <li
                      key={section}
                      className="rounded-full bg-[var(--surface-elevated)] px-3 py-2 text-footnote"
                    >
                      {text(section)}
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
