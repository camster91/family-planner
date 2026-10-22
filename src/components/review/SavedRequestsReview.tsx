"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useScheduleReviewActive } from "@/components/calendar/review/ScheduleReviewProvider";
import { useReviewInboxText } from "@/i18n/review-inbox";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import type {
  SavedReviewItem,
  SavedReviewKind,
} from "@/lib/review-inbox/saved-requests";
export default function SavedRequestsReview({
  identity,
}: {
  identity: { userId: string; familyId: string };
}) {
  const copy = useReviewInboxText(),
    locale = useDisplayLocale(),
    params = useSearchParams();
  const preparationActive = usePreparationActive(),
    scheduleActive = useScheduleReviewActive();
  const suspended =
    preparationActive ||
    scheduleActive ||
    params.has("responsibilityId") ||
    params.get("mode") === "fridge";
  const [kind, setKind] = React.useState<SavedReviewKind>("preparation"),
    [rows, setRows] = React.useState<SavedReviewItem[]>([]),
    [busy, setBusy] = React.useState(false),
    [checked, setChecked] = React.useState(false),
    [failed, setFailed] = React.useState(false),
    [paused, setPaused] = React.useState(false),
    [offset, setOffset] = React.useState(0);
  const projectionIdentity = JSON.stringify([
    identity.userId,
    identity.familyId,
    kind,
  ]);
  const [projectionKey, setProjectionKey] = React.useState<string | null>(null);
  const visible = projectionKey === projectionIdentity;
  const epoch = React.useRef(0),
    live = React.useRef({ identity, suspended, kind });
  live.current = { identity, suspended, kind };
  const clear = React.useCallback(() => {
    epoch.current++;
    setProjectionKey(null);
    setRows([]);
    setBusy(false);
    setChecked(false);
    setFailed(false);
    setPaused(false);
    setOffset(0);
  }, []);
  React.useEffect(() => {
    clear();
    return () => {
      epoch.current++;
    };
  }, [identity.userId, identity.familyId, suspended, clear]);
  React.useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") clear();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("fp-owned:")) clear();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", clear);
    window.addEventListener("storage", storage);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", clear);
      window.removeEventListener("storage", storage);
    };
  }, [clear]);
  async function check() {
    if (busy || suspended || document.visibilityState !== "visible") return;
    clear();
    const operation = ++epoch.current;
    setBusy(true);
    const original = { ...identity },
      selected = kind;
    const current = () =>
      epoch.current === operation &&
      !live.current.suspended &&
      live.current.kind === selected &&
      live.current.identity.userId === original.userId &&
      live.current.identity.familyId === original.familyId;
    try {
      const { readSavedReviewRequests } =
        await import("@/lib/review-inbox/saved-requests");
      if (!current()) return;
      const result = await readSavedReviewRequests(selected, original);
      if (!current()) return;
      setProjectionKey(
        JSON.stringify([original.userId, original.familyId, selected]),
      );
      setRows(result.items);
      setPaused(result.paused);
      setChecked(true);
    } catch {
      if (current()) {
        setProjectionKey(
          JSON.stringify([original.userId, original.familyId, selected]),
        );
        setFailed(true);
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  const labels = {
    preparation: copy.savedPreparation,
    schedule: copy.savedSchedule,
    responsibility: copy.savedResponsibility,
    recipe: copy.savedRecipe,
    capture: copy.savedCapture,
  };
  if (suspended) return null;
  return (
    <section aria-label={copy.saved} className="space-y-4">
      <p className="max-w-2xl text-body text-label-secondary">
        {copy.savedHint}
      </p>
      <label className="block text-body text-label-primary">
        {copy.savedType}
        <select
          value={kind}
          onChange={(event) => {
            clear();
            setKind(event.target.value as SavedReviewKind);
          }}
          className="mt-2 block min-h-11 rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-3 text-label-primary"
        >
          <option value="preparation">{copy.preparation}</option>
          <option value="schedule">{copy.schedule}</option>
          <option value="responsibility">{copy.responsibility}</option>
          <option value="recipe">{copy.recipe}</option>
          <option value="capture">{copy.capture}</option>
        </select>
      </label>
      <button
        type="button"
        className="btn-tinted min-h-11"
        onClick={() => void check()}
        disabled={busy}
      >
        {busy ? copy.checking : copy.checkSaved}
      </button>
      {visible && failed && (
        <p role="alert" className="text-body text-label-secondary">
          {copy.savedUnavailable}
        </p>
      )}
      {visible && paused && (
        <p role="status" className="text-footnote text-label-secondary">
          {copy.savedPaused}
        </p>
      )}
      {visible && checked && rows.length === 0 && (
        <p role="status">{copy.savedEmpty}</p>
      )}
      {visible && rows.length > 0 && (
        <ul className="list-inset divide-y divide-[var(--surface-separator)]">
          {rows.slice(offset, offset + 5).map((row) => (
            <li key={row.id} className="p-4">
              <h2 className="text-headline text-label-primary">
                {labels[row.kind]}
              </h2>
              <time
                dateTime={row.issuedAt}
                className="text-footnote text-label-secondary"
              >
                {new Date(row.issuedAt).toLocaleString(locale)}
              </time>
              <p className="text-footnote text-label-secondary">
                {row.phase === "editing"
                  ? copy.draftUnsubmitted
                  : copy.savedUnknown}
              </p>
              <Link href={row.href} className="btn-plain min-h-11">
                {copy.openSaved}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {visible && offset + 5 < rows.length && (
        <button
          type="button"
          className="btn-tinted min-h-11"
          onClick={() => setOffset((value) => value + 5)}
        >
          {copy.next}
        </button>
      )}
      {visible && offset > 0 && (
        <button
          type="button"
          className="btn-tinted min-h-11"
          onClick={() => setOffset(0)}
        >
          {copy.first}
        </button>
      )}
    </section>
  );
}
