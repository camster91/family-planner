"use client";

import * as React from "react";
import { Gift, Cake, Heart, CalendarDays, Plus, Trash2 } from "lucide-react";
import { InsetList, SectionHeader } from "@/components/ui/list-row";
import { FeatureGate } from "@/components/ui/feature-gate";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { parseDateOnly } from "@/lib/dates";
import { useTranslation } from "@/i18n";
import { useAnniversariesText } from "@/i18n/anniversaries";
import { formatDateOnly, toDateOnlyLocal, toDateOnlyUTC } from "@/lib/dates";
import {
  buildDateItems,
  type ApiDateItem,
  type DateItem,
  type FamilyDate,
} from "@/lib/anniversary-dates";

// Dates are stored as UTC midnight of the calendar day, so format them in UTC:
// local getters would show the previous day west of UTC.
function formatDate(dateStr: string, locale: string): string {
  return formatDateOnly(dateStr, { month: "long", day: "numeric" }, locale);
}

function getDateSubtitle(
  date: FamilyDate,
  daysUntil: number,
  t: (key: string) => string,
  locale: string,
): string {
  const dateStr = formatDate(date.date, locale);
  if (daysUntil === 0) return `${dateStr} · ${t("dates.today")}`;
  if (daysUntil === 1) return `${dateStr} · ${t("dates.tomorrow")}`;
  return `${dateStr} · ${daysUntil}${t("dates.daysAway")}`;
}

function DateSection({
  title,
  items,
  onItemClick,
  t,
  locale,
}: {
  title: string;
  items: DateItem[];
  onItemClick: (item: DateItem) => void;
  t: (key: string) => string;
  locale: string;
}) {
  if (!items.length) return null;
  return (
    <section aria-label={title} className="min-w-0">
      <SectionHeader>{title}</SectionHeader>
      <InsetList>
        {items.map((item, i) => {
          const Icon =
            item.type === "birthday"
              ? Cake
              : item.type === "anniversary"
                ? Heart
                : CalendarDays;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick(item)}
              className={`flex min-h-[72px] w-full items-start gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${i < items.length - 1 ? "border-b border-[var(--surface-separator)]" : ""}`}
            >
              <Icon
                aria-hidden="true"
                className="mt-1 h-5 w-5 shrink-0 text-label-secondary"
              />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                <span className="block text-body font-semibold text-label-primary">
                  {item.name}
                </span>
                <span className="block text-footnote text-label-secondary">
                  {getDateSubtitle(item, item.daysUntil, t, locale)}
                </span>
                <span className="block text-caption-1 text-label-secondary">
                  {t(
                    item.type === "birthday"
                      ? "dates.dateBirthday"
                      : item.type === "anniversary"
                        ? "dates.dateAnniversary"
                        : "dates.dateCustom",
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </InsetList>
    </section>
  );
}

interface DateFormData {
  name: string;
  type: "birthday" | "anniversary" | "custom";
  date: string;
  notes: string;
}

function AddEditModal({
  mode,
  initial,
  onSave,
  onDelete,
  t,
  saving,
  error,
}: {
  mode: "add" | "edit";
  initial?: DateItem;
  onSave: (data: DateFormData) => void;
  onDelete?: () => void;
  t: (key: string) => string;
  saving: boolean;
  error?: string | null;
}) {
  const text = useAnniversariesText();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [type, setType] = React.useState<"birthday" | "anniversary" | "custom">(
    initial?.type ?? "birthday",
  );
  // Stored as UTC midnight: pre-fill the UTC calendar day, or saving an
  // unchanged edit would shift the date back a day west of UTC.
  const [date, setDate] = React.useState(() =>
    initial?.date ? toDateOnlyUTC(initial.date) : "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");

  const nameId = React.useId();
  const typeId = React.useId();
  const dateId = React.useId();
  const notesId = React.useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, type, date, notes });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-footnote text-danger-text">
            {error}
          </p>
        )}
        <div>
          <label
            htmlFor={nameId}
            className="block text-caption-1 text-label-secondary mb-1"
          >
            {t("dates.dateName")}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={text("namePlaceholder")}
            required
          />
        </div>
        <div>
          <label
            htmlFor={typeId}
            className="block text-caption-1 text-label-secondary mb-1"
          >
            {t("dates.dateType")}
          </label>
          <select
            id={typeId}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="birthday">{t("dates.dateBirthday")}</option>
            <option value="anniversary">{t("dates.dateAnniversary")}</option>
            <option value="custom">{t("dates.dateCustom")}</option>
          </select>
        </div>
        <div>
          <label
            htmlFor={dateId}
            className="block text-caption-1 text-label-secondary mb-1"
          >
            {t("dates.dateDate")}
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            required
          />
        </div>
        <details open={initial?.notes ? true : undefined}>
          <summary className="min-h-[44px] cursor-pointer py-3 text-subhead text-label-secondary">
            {text("optionalDetails")}
          </summary>
          <label
            htmlFor={notesId}
            className="block text-caption-1 text-label-secondary mb-1"
          >
            {t("dates.dateNotes")}
          </label>
          <input
            id={notesId}
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </details>
      </div>
      <p className="mt-3 text-footnote text-label-secondary">
        {text("annual")}
      </p>
      <div className="mt-6 flex gap-2">
        {mode === "edit" && onDelete && (
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            className="min-h-[44px] px-3 py-2 rounded-lg text-danger-text text-subhead font-medium flex items-center gap-1.5 hover:bg-[var(--danger-tint)]"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {t("common.delete")}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="ml-auto min-h-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-on-accent text-subhead font-semibold disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

export default function AnniversariesPage() {
  return (
    <FeatureGate featureKey="anniversaries">
      <AnniversariesPageInner />
    </FeatureGate>
  );
}

function AnniversariesPageInner() {
  const { t } = useTranslation();
  const locale = useDisplayLocale();
  const [dates, setDates] = React.useState<ApiDateItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [viewItem, setViewItem] = React.useState<DateItem | null>(null);
  const [editItem, setEditItem] = React.useState<DateItem | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DateItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<
    "failed" | "network" | null
  >(null);
  usePendingFormNavigationController(saving || deleting);
  const addDateRef = React.useRef<HTMLButtonElement>(null);
  const retryDatesRef = React.useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = React.useRef<HTMLButtonElement>(null);
  const mutationRef = React.useRef(false);
  const anniversariesText = useAnniversariesText();

  const fetchDates = React.useCallback(async () => {
    try {
      const res = await fetch("/api/anniversaries");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (
        !Array.isArray(data.dates) ||
        !data.dates.every(
          (d: ApiDateItem) =>
            d &&
            typeof d.id === "string" &&
            d.id.length > 0 &&
            typeof d.name === "string" &&
            ["birthday", "anniversary", "custom"].includes(d.type) &&
            typeof d.date === "string" &&
            parseDateOnly(d.date.slice(0, 10)) &&
            (d.notes == null || typeof d.notes === "string") &&
            (d.can_edit === undefined || typeof d.can_edit === "boolean") &&
            (d.can_delete === undefined || typeof d.can_delete === "boolean") &&
            Number.isFinite(d.days_until) &&
            typeof d.next_occurrence === "string" &&
            parseDateOnly(d.next_occurrence.slice(0, 10)),
        ) ||
        new Set(data.dates.map((d: ApiDateItem) => d.id)).size !==
          data.dates.length
      )
        throw new Error("Invalid dates response");
      setDates(data.dates);
      setError(null);
    } catch {
      setError(t("dates.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  const { birthdays, anniversaries, others } = buildDateItems(
    dates,
    toDateOnlyLocal(new Date()),
  );
  const hasDates = birthdays.length + anniversaries.length + others.length > 0;

  const ordered = [...birthdays, ...anniversaries, ...others].sort(
    (a, b) => a.daysUntil - b.daysUntil,
  );
  const nextUp = ordered.filter((d) => d.daysUntil <= 90);
  const moreDates = ordered.filter((d) => d.daysUntil > 90);

  const handleSave = async (data: DateFormData) => {
    if (mutationRef.current || (editItem && editItem.can_edit !== true)) return;
    mutationRef.current = true;
    setSaving(true);
    setModalError(null);
    try {
      if (editItem) {
        const res = await fetch(
          `/api/anniversaries/${encodeURIComponent(editItem.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
        );
        if (!res.ok) throw new Error("Failed to update");
      } else {
        const res = await fetch("/api/anniversaries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create");
      }
      setShowAdd(false);
      setEditItem(null);
      await fetchDates();
    } catch {
      // Keep the modal open and say so.
      setModalError(t("common.error"));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  };

  const openDeleteConfirmation = () => {
    if (!editItem || editItem.can_delete !== true || mutationRef.current)
      return;
    setDeleteError(null);
    setDeleteTarget(editItem);
  };

  const closeDeleteConfirmation = () => {
    if (mutationRef.current) return;
    setDeleteError(null);
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    const item = deleteTarget;
    if (!item || item.can_delete !== true || mutationRef.current) return;
    mutationRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/anniversaries/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setDeleteError("failed");
        return;
      }
      setDeleteTarget(null);
      setEditItem(null);
      await fetchDates();
      window.requestAnimationFrame(() =>
        (addDateRef.current ?? retryDatesRef.current)?.focus(),
      );
    } catch {
      setDeleteError("network");
    } finally {
      mutationRef.current = false;
      setDeleting(false);
    }
  };

  const handleItemClick = (item: DateItem) => {
    if (mutationRef.current) return;
    setModalError(null);
    if (item.can_edit === true) setEditItem(item);
    else setViewItem(item);
  };

  const closeModal = () => {
    if (mutationRef.current) return;
    setModalError(null);
    setShowAdd(false);
    setEditItem(null);
  };

  if (loading) {
    return (
      <div className="w-full min-w-0 space-y-6">
        <div>
          <h1 className="text-large-title font-display">{t("dates.title")}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {t("dates.subtitle")}
          </p>
        </div>
        <div className="card-apple p-8 text-center">
          <p role="status" className="text-subhead text-label-secondary">
            {t("dates.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 space-y-6">
        <div>
          <h1 className="text-large-title font-display">{t("dates.title")}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {t("dates.subtitle")}
          </p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-danger-text">{error}</p>
          <button
            ref={retryDatesRef}
            onClick={fetchDates}
            className="mt-3 min-h-[44px] min-w-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-on-accent text-subhead font-semibold"
          >
            {t("routeState.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-large-title font-display">{t("dates.title")}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {t("dates.subtitle")}
          </p>
        </div>
        <button
          ref={addDateRef}
          onClick={() => setShowAdd(true)}
          className="flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-fill)] text-on-accent text-subhead font-semibold"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t("dates.addDate")}
        </button>
      </div>

      {hasDates && (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="min-w-0 space-y-6">
            <DateSection
              title={anniversariesText("nextUp")}
              items={nextUp}
              onItemClick={handleItemClick}
              t={t}
              locale={locale}
            />
            {nextUp.length === 0 && (
              <div className="card-apple p-6 text-label-secondary">
                {anniversariesText("nothingSoon")}
              </div>
            )}
            {moreDates.length > 0 && (
              <details open={nextUp.length === 0 ? true : undefined}>
                <summary className="min-h-[44px] cursor-pointer py-3 text-subhead font-semibold">
                  {anniversariesText("moreDates", { count: moreDates.length })}
                </summary>
                <DateSection
                  title={anniversariesText("later")}
                  items={moreDates}
                  onItemClick={handleItemClick}
                  t={t}
                  locale={locale}
                />
              </details>
            )}
          </div>
          <aside className="card-apple h-fit p-5">
            <h2 className="text-title-3 font-display">
              {anniversariesText("annualTitle")}
            </h2>
            <p className="mt-2 text-subhead text-label-secondary">
              {anniversariesText("annual")}
            </p>
            <p className="mt-3 text-footnote text-label-secondary">
              {anniversariesText("householdVisibility")}
            </p>
          </aside>
        </div>
      )}

      {!hasDates && (
        <div className="card-apple p-8 text-center">
          <Gift className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <h2 className="text-title-3 text-label-primary">
            {t("dates.empty")}
          </h2>
          <p className="text-subhead text-label-secondary mt-1">
            {t("dates.emptySubtitle")}
          </p>
        </div>
      )}

      {/* Add modal */}
      <Dialog
        variant="form"
        closeLabel={anniversariesText("close")}
        open={showAdd && !editItem}
        onClose={saving || deleting ? undefined : closeModal}
        title={t("dates.addDate")}
      >
        <AddEditModal
          mode="add"
          onSave={handleSave}
          t={t}
          saving={saving || deleting}
          error={modalError}
        />
      </Dialog>

      {/* Edit modal */}
      <Dialog
        variant="form"
        closeLabel={anniversariesText("close")}
        open={!!editItem}
        onClose={saving || deleting ? undefined : closeModal}
        title={t("common.edit")}
      >
        {editItem && (
          <AddEditModal
            mode="edit"
            initial={editItem}
            onSave={handleSave}
            onDelete={
              editItem.can_delete === true ? openDeleteConfirmation : undefined
            }
            t={t}
            saving={saving || deleting}
            error={modalError}
          />
        )}
      </Dialog>

      <Dialog
        variant="form"
        open={!!viewItem}
        onClose={() => setViewItem(null)}
        title={viewItem?.name ?? ""}
        closeLabel={anniversariesText("close")}
      >
        {viewItem && (
          <div className="space-y-4 break-words [overflow-wrap:anywhere]">
            <p className="text-subhead text-label-secondary">
              {getDateSubtitle(viewItem, viewItem.daysUntil, t, locale)}
            </p>
            <p className="text-footnote text-label-secondary">
              {anniversariesText("annual")}
            </p>
            {viewItem.notes && (
              <p className="whitespace-pre-wrap text-body">{viewItem.notes}</p>
            )}
            <p className="text-footnote text-label-secondary">
              {anniversariesText("readOnly")}
            </p>
          </div>
        )}
      </Dialog>

      {deleteTarget && (
        <Dialog
          open
          role="alertdialog"
          testId="remove-anniversary-dialog"
          title={anniversariesText("deleteTitle", { name: deleteTarget.name })}
          description={anniversariesText("deleteDescription", {
            name: deleteTarget.name,
          })}
          initialFocusRef={cancelDeleteRef}
          onClose={deleting ? undefined : closeDeleteConfirmation}
          closeLabel={anniversariesText("deleteClose")}
        >
          <div aria-busy={deleting}>
            {deleteError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {deleteError === "network"
                  ? anniversariesText("deleteNetworkError")
                  : anniversariesText("deleteFailed")}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelDeleteRef}
                type="button"
                disabled={deleting}
                onClick={closeDeleteConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {deleting
                  ? anniversariesText("deleting")
                  : deleteError
                    ? t("routeState.tryAgain")
                    : t("common.delete")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
