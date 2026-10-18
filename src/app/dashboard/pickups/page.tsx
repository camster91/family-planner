"use client";

import * as React from "react";
import { Plus, Car, Trash2 } from "lucide-react";
import { useFeatures } from "@/components/providers/features-provider";
import { LargeHeader } from "@/components/ui/large-header";
import { FeatureGate } from "@/components/ui/feature-gate";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { InsetList, SectionHeader } from "@/components/ui/list-row";
import { CheckboxRow } from "@/components/ui/checkbox-row";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { usePickupsText, type PickupMessage } from "@/i18n/pickups";

interface Pickup {
  id: string;
  title: string;
  location?: string | null;
  pickup_time: string;
  completed: boolean;
  assigned_to?: string | null;
  assignee_name?: string | null;
  assignee_avatar?: string | null;
  notes?: string | null;
}

interface FamilyMember {
  id: string;
  name: string;
  avatar_url?: string | null;
}

const EMPTY_DRAFT = {
  title: "",
  location: "",
  pickup_time: "",
  assigned_to: "",
  notes: "",
};

let pickupHistoryMarkerSequence = 0;

function createPickupHistoryMarker(): string {
  pickupHistoryMarkerSequence += 1;
  return `pickup-form-${Date.now().toString(36)}-${pickupHistoryMarkerSequence.toString(36)}`;
}

function pickupHistoryMarker(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const marker = (state as { pickupForm?: unknown }).pickupForm;
  return typeof marker === "string" && marker.startsWith("pickup-form-")
    ? marker
    : null;
}

function pickupHistoryStateWithoutMarker(
  state: unknown,
): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== "pickupForm"),
  );
}

function pickupHistoryStateFingerprint(state: unknown): string {
  try {
    return JSON.stringify(pickupHistoryStateWithoutMarker(state)) ?? "";
  } catch {
    // History state is structured-cloned by the browser. Keep the marker
    // ownership check conservative if a host supplies a non-JSON value.
    return "";
  }
}

function isPickupHistoryMarker(state: unknown, marker: string): boolean {
  return pickupHistoryMarker(state) === marker;
}

type PickupHistoryEntry = {
  marker: string;
  ownerUrl: string;
  historyLength: number;
  stateFingerprint: string;
  baseUrl: string;
  baseStateFingerprint: string;
};

export default function PickupsPage() {
  return (
    <FeatureGate featureKey="pickups">
      <PickupsPageInner />
    </FeatureGate>
  );
}

function PickupsPageInner() {
  const [pickups, setPickups] = React.useState<Pickup[]>([]);
  const [members, setMembers] = React.useState<FamilyMember[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [membersError, setMembersError] = React.useState(false);
  // The layout derives this presentation capability from the current role.
  // DELETE still verifies parent authority on the server.
  const { canManage: isParent } = useFeatures();
  const [deletingPickup, setDeletingPickup] = React.useState<Pickup | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(false);
  const deleteInFlightRef = React.useRef(false);
  const [adding, setAdding] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [draft, setDraft] = React.useState({ ...EMPTY_DRAFT });
  const formId = React.useId();
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(saving);
  savingRef.current = saving;
  const addingRef = React.useRef(adding);
  addingRef.current = adding;
  const [pendingToggles, setPendingToggles] = React.useState<
    Record<string, boolean>
  >({});
  const pendingToggleRef = React.useRef(new Set<string>());
  const loadInFlightRef = React.useRef(false);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const historyEntryRef = React.useRef<PickupHistoryEntry | null>(null);
  const historyCloseRef = React.useRef<PickupHistoryEntry | null>(null);
  const historyCleanupTimerRef = React.useRef<number | null>(null);
  const backgroundStateRef = React.useRef<{
    element: HTMLElement | null;
    inert: boolean;
    overflow: string;
  } | null>(null);

  const { addToast } = useToast();
  const text = usePickupsText();
  const textRef = React.useRef(text);
  textRef.current = text;
  const displayLocale = useDisplayLocale();

  const notifyFailure = React.useCallback(
    (title: PickupMessage, response?: Response) => {
      addToast({
        type: "error",
        title: textRef.current(title),
        message: response
          ? textRef.current("tryAgain")
          : textRef.current("networkError"),
      });
    },
    [addToast],
  );

  const lockBackground = React.useCallback(() => {
    if (backgroundStateRef.current) return;
    const element = document.querySelector<HTMLElement>(
      "[data-pickups-background]",
    );
    backgroundStateRef.current = {
      element,
      inert: element?.inert ?? false,
      overflow: document.body.style.overflow,
    };
    if (element) element.inert = true;
    document.body.style.overflow = "hidden";
  }, []);

  const unlockBackground = React.useCallback(() => {
    const previous = backgroundStateRef.current;
    if (!previous) return;
    if (previous.element) previous.element.inert = previous.inert;
    document.body.style.overflow = previous.overflow;
    backgroundStateRef.current = null;
  }, []);

  const closeForm = React.useCallback(
    (force = false) => {
      if (closing || (saving && !force)) return;
      const entry = historyEntryRef.current;
      if (
        entry &&
        isPickupHistoryMarker(window.history.state, entry.marker) &&
        !historyCloseRef.current
      ) {
        const isCurrentEntry =
          window.location.href === entry.ownerUrl &&
          window.history.length === entry.historyLength &&
          pickupHistoryStateFingerprint(window.history.state) ===
            entry.stateFingerprint;
        if (isCurrentEntry) {
          // Keep the sheet and background lock until the owned Back traversal
          // emits popstate. This prevents a second close or route action from
          // racing the browser traversal and lets Dialog restore focus safely.
          historyCloseRef.current = entry;
          setClosing(true);
          window.history.back();
          return;
        }

        // A same-URL Next entry or a changed state is no longer ours to
        // consume. Remove only the marker and preserve the rest of that entry.
        const stateWithoutMarker = pickupHistoryStateWithoutMarker(
          window.history.state,
        );
        window.history.replaceState(
          stateWithoutMarker,
          "",
          window.location.href,
        );
      }
      unlockBackground();
      addingRef.current = false;
      historyEntryRef.current = null;
      setClosing(false);
      setAdding(false);
    },
    [closing, saving, unlockBackground],
  );

  // Keep Android/browser back useful while the form is open without putting
  // the draft in a URL or clearing it. Programmatic close consumes the marker;
  // a real back navigation has already restored the previous history entry.
  React.useEffect(() => {
    if (!adding) return;
    lockBackground();
    if (historyCleanupTimerRef.current !== null) {
      window.clearTimeout(historyCleanupTimerRef.current);
      historyCleanupTimerRef.current = null;
    }

    let currentState = window.history.state;
    let pendingClose = historyCloseRef.current;
    if (
      pendingClose &&
      !isPickupHistoryMarker(currentState, pendingClose.marker)
    ) {
      // A delayed back completed before this new render. The old marker is
      // gone, so this form owns a fresh entry.
      historyCloseRef.current = null;
      historyEntryRef.current = null;
      pendingClose = null;
    }

    const existingEntry = historyEntryRef.current;
    const existingMarker = pickupHistoryMarker(window.history.state);
    if (!pendingClose && !existingEntry && existingMarker) {
      // A prior form owner may have unmounted while Next changed the route
      // and carried its state forward. Remove only that marker before this
      // form creates its own entry; preserve every other Next state field.
      const stateWithoutMarker = pickupHistoryStateWithoutMarker(currentState);
      window.history.replaceState(stateWithoutMarker, "", window.location.href);
      currentState = stateWithoutMarker;
    }
    const baseUrl = existingEntry?.baseUrl ?? window.location.href;
    const baseStateFingerprint =
      existingEntry?.baseStateFingerprint ??
      pickupHistoryStateFingerprint(currentState);
    const marker =
      pendingClose?.marker ??
      (existingEntry &&
      isPickupHistoryMarker(currentState, existingEntry.marker)
        ? existingEntry.marker
        : createPickupHistoryMarker());
    const ownerUrl = existingEntry?.ownerUrl ?? window.location.href;
    const state =
      currentState && typeof currentState === "object" ? currentState : {};
    if (!isPickupHistoryMarker(currentState, marker)) {
      window.history.pushState(
        { ...state, pickupForm: marker },
        "",
        window.location.href,
      );
    }
    historyEntryRef.current = {
      marker,
      ownerUrl,
      historyLength: window.history.length,
      stateFingerprint: pickupHistoryStateFingerprint(window.history.state),
      baseUrl,
      baseStateFingerprint,
    };
    const onPopState = () => {
      const pending = historyCloseRef.current;
      if (pending) {
        const currentState = window.history.state;
        const stillOwned =
          window.location.href === pending.ownerUrl &&
          window.history.length === pending.historyLength &&
          isPickupHistoryMarker(currentState, pending.marker) &&
          pickupHistoryStateFingerprint(currentState) ===
            pending.stateFingerprint;
        if (stillOwned) {
          return;
        }
        const returnedToBase =
          window.location.href === pending.baseUrl &&
          window.history.length === pending.historyLength &&
          pickupHistoryStateFingerprint(currentState) ===
            pending.baseStateFingerprint;
        if (
          !returnedToBase &&
          isPickupHistoryMarker(currentState, pending.marker)
        ) {
          window.history.replaceState(
            pickupHistoryStateWithoutMarker(currentState),
            "",
            window.location.href,
          );
        }
        historyCloseRef.current = null;
        historyEntryRef.current = null;
        unlockBackground();
        addingRef.current = false;
        setClosing(false);
        setAdding(false);
        return;
      }

      const activeEntry = historyEntryRef.current;
      if (!activeEntry) return;
      if (savingRef.current) {
        const current = window.history.state;
        const currentState =
          current && typeof current === "object" ? current : {};
        window.history.pushState(
          {
            ...currentState,
            pickupForm: activeEntry.marker,
          },
          "",
          window.location.href,
        );
        return;
      }
      unlockBackground();
      addingRef.current = false;
      historyEntryRef.current = null;
      setClosing(false);
      setAdding(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      unlockBackground();
      const entry = historyEntryRef.current;
      if (!entry || historyCloseRef.current) return;
      // Strict Mode runs setup/cleanup/setup synchronously. Keep the marker
      // through that probe, but consume it if the component really unmounts.
      historyCleanupTimerRef.current = window.setTimeout(() => {
        historyCleanupTimerRef.current = null;
        if (historyEntryRef.current !== entry) return;
        if (!isPickupHistoryMarker(window.history.state, entry.marker)) {
          historyEntryRef.current = null;
          return;
        }
        historyEntryRef.current = null;
        const isCurrentEntry =
          window.location.href === entry.ownerUrl &&
          window.history.length === entry.historyLength &&
          pickupHistoryStateFingerprint(window.history.state) ===
            entry.stateFingerprint;
        if (isCurrentEntry) {
          window.history.back();
          return;
        }
        const currentState = window.history.state;
        if (isPickupHistoryMarker(currentState, entry.marker)) {
          window.history.replaceState(
            pickupHistoryStateWithoutMarker(currentState),
            "",
            window.location.href,
          );
        }
      }, 0);
    };
  }, [adding, lockBackground, unlockBackground]);

  const load = React.useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setLoading(true);
    setLoadError(false);
    try {
      const [pickupResponse, membersResponse] = await Promise.all([
        fetch("/api/pickups", { cache: "no-store" }).catch(() => null),
        fetch("/api/family/members", { cache: "no-store" }).catch(() => null),
      ]);
      const memberData = membersResponse?.ok
        ? await membersResponse.json().catch(() => null)
        : null;
      const membersAvailable = Array.isArray(memberData?.members);
      setMembersError(!membersAvailable);
      if (membersAvailable) setMembers(memberData.members);
      if (!pickupResponse?.ok) throw new Error("pickups load failed");
      const pickupData = await pickupResponse.json();
      if (!Array.isArray(pickupData?.pickups))
        throw new Error("Invalid pickups response");
      setPickups(pickupData.pickups);
      return true;
    } catch {
      // Keep existing rows visible during a refresh; an empty list is only
      // truthful after a successful response.
      setLoadError(true);
      return false;
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (
      !draft.title.trim() ||
      !draft.pickup_time ||
      saving ||
      closing ||
      membersError ||
      loading
    )
      return;
    setSaving(true);
    try {
      const res = await fetch("/api/pickups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          location: draft.location.trim() || null,
          pickup_time: new Date(draft.pickup_time).toISOString(),
          assigned_to: draft.assigned_to || null,
          notes: draft.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        notifyFailure("addFailed", res);
        return;
      }
      setDraft({ ...EMPTY_DRAFT });
      closeForm(true);
      await load();
    } catch {
      notifyFailure("addFailed");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: string, completed: boolean) {
    if (pendingToggleRef.current.has(id)) return;
    const previous = pickups.find((pickup) => pickup.id === id)?.completed;
    if (previous === undefined) return;
    pendingToggleRef.current.add(id);
    setPendingToggles((current) => ({ ...current, [id]: true }));
    setPickups((current) =>
      current.map((pickup) =>
        pickup.id === id ? { ...pickup, completed } : pickup,
      ),
    );
    const rollback = () =>
      setPickups((current) =>
        current.map((pickup) =>
          pickup.id === id ? { ...pickup, completed: previous } : pickup,
        ),
      );
    try {
      const res = await fetch(`/api/pickups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) {
        rollback();
        notifyFailure("updateFailed", res);
      }
    } catch {
      rollback();
      notifyFailure("updateFailed");
    } finally {
      pendingToggleRef.current.delete(id);
      setPendingToggles((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  async function removePickup() {
    if (!isParent || !deletingPickup || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleting(true);
    setDeleteError(false);
    const id = deletingPickup.id;
    try {
      const response = await fetch(`/api/pickups/${id}`, { method: "DELETE" });
      const result = response.ok
        ? await response.json().catch(() => null)
        : null;
      if (!response.ok || result?.ok !== true) {
        setDeleteError(true);
        return;
      }
      setPickups((current) => current.filter((pickup) => pickup.id !== id));
      setDeletingPickup(null);
      // The row's opener no longer exists after confirmed deletion.
      setTimeout(() => addButtonRef.current?.focus(), 0);
    } catch {
      setDeleteError(true);
    } finally {
      deleteInFlightRef.current = false;
      setDeleting(false);
    }
  }

  const openDelete = isParent
    ? (pickup: Pickup) => {
        setDeleteError(false);
        setDeletingPickup(pickup);
      }
    : undefined;

  const formatTime = React.useCallback(
    (iso: string) => {
      const date = new Date(iso);
      return date.toLocaleString(displayLocale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    },
    [displayLocale],
  );

  const now = new Date();
  const upcoming = pickups.filter(
    (pickup) => !pickup.completed && new Date(pickup.pickup_time) >= now,
  );
  const past = pickups.filter(
    (pickup) => pickup.completed || new Date(pickup.pickup_time) < now,
  );

  return (
    <>
      <div data-pickups-background className="w-full min-w-0 space-y-6">
        <LargeHeader
          greeting={text("greeting")}
          title={text("title")}
          subtitle={text("subtitle")}
          trailing={
            <button
              ref={addButtonRef}
              type="button"
              onClick={() => {
                setClosing(false);
                setAdding(true);
              }}
              className="btn-tinted"
              aria-expanded={adding}
              aria-controls={adding ? formId : undefined}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{text("add")}</span>
            </button>
          }
        />

        {loadError && (
          <div
            role="alert"
            className="card-apple flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div>
              <p className="text-body font-semibold text-label-primary">
                {text("loadErrorTitle")}
              </p>
              <p className="text-footnote text-label-secondary">
                {text("loadErrorDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="btn-tinted min-h-[44px] min-w-[44px]"
            >
              {loading ? text("refreshing") : text("retry")}
            </button>
          </div>
        )}

        {loading && pickups.length === 0 ? (
          <div
            className="list-inset"
            aria-busy="true"
            aria-label={text("refreshing")}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="row-apple border-b border-[var(--surface-separator)] last:border-b-0"
              >
                <div className="glyph bg-surface-fill shimmer" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 rounded-full shimmer" />
                  <div className="h-2.5 w-48 rounded-full shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : pickups.length === 0 && !loadError ? (
          <EmptyState
            icon={Car}
            glyphColor="lists"
            title={text("emptyTitle")}
            description={text("emptyDescription")}
          />
        ) : pickups.length > 0 ? (
          <div aria-busy={loading}>
            {upcoming.length > 0 && (
              <section>
                <SectionHeader>{text("upcoming")}</SectionHeader>
                <InsetList>
                  {upcoming.map((pickup, index) => (
                    <PickupRow
                      key={pickup.id}
                      pickup={pickup}
                      onToggle={toggle}
                      disabled={!!pendingToggles[pickup.id]}
                      last={index === upcoming.length - 1}
                      formatTime={formatTime}
                      onDelete={openDelete}
                      deleteLabel={text("deletePickup")}
                    />
                  ))}
                </InsetList>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <SectionHeader>{text("past")}</SectionHeader>
                <InsetList>
                  {past.map((pickup, index) => (
                    <PickupRow
                      key={pickup.id}
                      pickup={pickup}
                      onToggle={toggle}
                      disabled={!!pendingToggles[pickup.id]}
                      last={index === past.length - 1}
                      formatTime={formatTime}
                      onDelete={openDelete}
                      deleteLabel={text("deletePickup")}
                    />
                  ))}
                </InsetList>
              </section>
            )}
          </div>
        ) : null}
      </div>
      <Dialog
        open={!!deletingPickup}
        role="alertdialog"
        title={text("deletePickup")}
        description={text("deleteDescription")}
        closeLabel={text("closeDelete")}
        onClose={deleting ? undefined : () => setDeletingPickup(null)}
      >
        <p className="break-words text-body font-semibold">
          {deletingPickup?.title}
        </p>
        {deleteError && (
          <p role="alert" className="mt-3 text-body text-danger-text">
            {text("deleteFailed")}
          </p>
        )}
        {deleteError && (
          <button
            type="button"
            className="btn-tinted mt-3 min-h-11"
            disabled={loading}
            onClick={() => {
              void load().then((loaded) => {
                if (loaded) setDeletingPickup(null);
              });
            }}
          >
            {text("refreshPickups")}
          </button>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={deleting}
            className="btn-plain min-h-11"
            onClick={() => setDeletingPickup(null)}
          >
            {text("cancel")}
          </button>
          <button
            type="button"
            disabled={deleting}
            aria-busy={deleting}
            className="min-h-11 rounded-full bg-danger-fill px-4 text-body font-semibold text-white"
            onClick={() => void removePickup()}
          >
            {text(deleting ? "deleting" : "deletePickup")}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={adding}
        title={text("newPickup")}
        variant="form"
        initialFocusRef={titleRef}
        closeLabel={text("closeForm")}
        description={text(
          saving || closing ? "pendingDescription" : "draftDescription",
        )}
        onClose={saving || closing ? undefined : closeForm}
      >
        <form
          id={formId}
          onSubmit={add}
          className="space-y-4"
          aria-busy={saving || closing}
        >
          <div>
            <label htmlFor={`${formId}-title`} className="label-apple">
              {text("titleLabel")}
            </label>
            <input
              ref={titleRef}
              id={`${formId}-title`}
              type="text"
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder={text("titlePlaceholder")}
              className="input-apple"
              required
            />
          </div>
          <div>
            <label htmlFor={`${formId}-when`} className="label-apple">
              {text("when")}
            </label>
            <input
              id={`${formId}-when`}
              type="datetime-local"
              value={draft.pickup_time}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pickup_time: event.target.value,
                }))
              }
              className="input-apple"
              required
            />
          </div>
          <div>
            <label htmlFor={`${formId}-location`} className="label-apple">
              {text("location")}
            </label>
            <input
              id={`${formId}-location`}
              type="text"
              value={draft.location}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              placeholder={text("locationPlaceholder")}
              className="input-apple"
            />
          </div>
          <div>
            <label htmlFor={`${formId}-assigned`} className="label-apple">
              {text("assignedTo")}
            </label>
            <select
              id={`${formId}-assigned`}
              value={draft.assigned_to}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  assigned_to: event.target.value,
                }))
              }
              className="input-apple"
              disabled={membersError || loading}
            >
              <option value="">
                {text(membersError ? "membersUnavailable" : "anyone")}
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {membersError && (
              <div className="mt-2" role="alert">
                <p className="text-footnote text-danger-text">
                  {text("membersUnavailable")}
                </p>
                <button
                  type="button"
                  className="btn-tinted mt-2 min-h-11"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  {text(loading ? "refreshing" : "retryMembers")}
                </button>
              </div>
            )}
          </div>
          <div>
            <label htmlFor={`${formId}-notes`} className="label-apple">
              {text("notes")}
            </label>
            <input
              id={`${formId}-notes`}
              type="text"
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder={text("notesPlaceholder")}
              className="input-apple"
            />
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 bg-[var(--surface-elevated)] pt-3 pb-1">
            <button
              type="button"
              onClick={() => closeForm()}
              disabled={saving || closing}
              className="btn-plain min-h-[44px] min-w-[44px]"
            >
              {text("cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || closing || membersError || loading}
              aria-busy={saving}
              className="btn-filled min-h-[44px] min-w-[44px]"
            >
              {saving ? text("saving") : text("save")}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function PickupRow({
  pickup,
  onToggle,
  disabled,
  last,
  formatTime,
  onDelete,
  deleteLabel,
}: {
  pickup: Pickup;
  onToggle: (id: string, completed: boolean) => void;
  disabled: boolean;
  last: boolean;
  formatTime: (iso: string) => string;
  onDelete?: (pickup: Pickup) => void;
  deleteLabel: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-center ${last ? "" : "border-b border-[var(--surface-separator)]"}`}
      aria-busy={disabled}
    >
      <CheckboxRow
        className="min-w-0 flex-1"
        checked={pickup.completed}
        onChange={(completed) => onToggle(pickup.id, completed)}
        disabled={disabled}
        wrap
        title={pickup.title}
        subtitle={`${formatTime(pickup.pickup_time)}${pickup.location ? ` · ${pickup.location}` : ""}`}
        glyph={
          pickup.assignee_avatar ? (
            <Avatar
              name={pickup.assignee_name || "?"}
              src={pickup.assignee_avatar}
              size="sm"
            />
          ) : (
            <div className="glyph bg-tint-lists">
              <Car className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
          )
        }
        meta={pickup.assignee_name || undefined}
      />
      {onDelete && (
        <button
          type="button"
          disabled={disabled}
          className="mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-danger-text hover:bg-[var(--surface-fill)]"
          aria-label={`${deleteLabel}: ${pickup.title}`}
          onClick={() => onDelete(pickup)}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
