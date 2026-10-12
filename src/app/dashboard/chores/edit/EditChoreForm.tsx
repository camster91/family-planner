"use client";
import { ChoreFormSection } from "@/components/chores/ChoreFormSection";
import { routineIconLabel } from "@/lib/routine-icons";
import { MonthlyScheduleHint } from "@/components/chores/MonthlyScheduleHint";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";

import { useState, useEffect, useRef, useId, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import {
  choreFormMessages,
  localizedChoreRoutineIconLabel,
  type ChoreFormMessage,
} from "@/i18n/chore-forms";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import {
  RoutineFields,
  RoutineIconPicker,
  routineRequestFields,
} from "@/components/chores/RoutineIconPicker";
import { TakeTurnsPicker } from "@/components/chores/TakeTurnsPicker";
import { ROTATION_MIN, isRotating } from "@/lib/chore-rotation";
import {
  usePendingFormNavigation,
  usePendingFormNavigationController,
} from "@/components/layout/pending-form-navigation";

type Difficulty = "easy" | "medium" | "hard";
type Frequency = "once" | "daily" | "weekly" | "monthly";

const difficultyOptions: {
  value: Difficulty;
  label: ChoreFormMessage;
  description: ChoreFormMessage;
}[] = [
  { value: "easy", label: "easy", description: "easyTime" },
  { value: "medium", label: "medium", description: "mediumTime" },
  { value: "hard", label: "hard", description: "hardTime" },
];

const frequencyOptions: { value: Frequency; label: ChoreFormMessage }[] = [
  { value: "once", label: "once" },
  { value: "daily", label: "daily" },
  { value: "weekly", label: "weekly" },
  { value: "monthly", label: "monthly" },
];

function EditChoreForm({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const { locale, t } = useTranslation();
  const message = useCallback(
    (key: ChoreFormMessage, params?: Record<string, string | number>) =>
      t(key, params, choreFormMessages),
    [t],
  );
  const messageRef = useRef(message);
  messageRef.current = message;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // undefined when the chore API omits points (Points & streaks off, #248):
  // the PATCH then leaves the stored value alone.
  const [points, setPoints] = useState<number | undefined>(10);
  const gamification = useFeatureEnabled("gamification");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([]);
  // A generated copy of a recurring series is stored as 'once'; the form shows
  // its series' frequency instead, and a change applies to the series (O-33).
  const [weeklyDaysDirty, setWeeklyDaysDirty] = useState(false);
  const [seriesCopy, setSeriesCopy] = useState(false);
  const [loadedFrequency, setLoadedFrequency] = useState<Frequency>("once");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const choreId = searchParams.get("id");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const busy = loading || photoUploading;
  const directNavigation = usePendingFormNavigationController(
    busy && !inSheet,
  );
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  // Picture routines (#272).
  const [icon, setIcon] = useState<string | null>(null);
  const [routine, setRoutine] = useState("");
  const [routineOrder, setRoutineOrder] = useState("");
  // Take turns (O-39), a series setting. Sent only when changed here, so a
  // plain save never re-plans the turns.
  const [takeTurns, setTakeTurns] = useState(false);
  const [rotation, setRotation] = useState<string[]>([]);
  const [rotationDirty, setRotationDirty] = useState(false);
  const rotating = frequency !== "once" && takeTurns;

  useEffect(() => {
    if (!choreId) {
      setError(messageRef.current("noIdProvided"));
      setFetching(false);
      return;
    }

    const fetchData = async () => {
      try {
        const [choreRes, membersRes] = await Promise.all([
          fetch(`/api/chores?id=${encodeURIComponent(choreId)}`),
          fetch("/api/family/members"),
        ]);

        if (choreRes.ok) {
          const choresData = await choreRes.json();
          const chore = choresData.chore;
          if (chore) {
            setTitle(chore.title);
            setDescription(chore.description || "");
            setPoints(
              typeof chore.points === "number" ? chore.points : undefined,
            );
            setAssignedTo(chore.assigned_to);
            const d = new Date(chore.due_date);
            setDueDate(d.toISOString().split("T")[0]);
            setDifficulty(chore.difficulty || "medium");
            const template = choresData.template;
            const shownFrequency: Frequency =
              (template ? template.frequency : chore.frequency) || "once";
            setSeriesCopy(Boolean(template));
            setFrequency(shownFrequency);
            setWeeklyDays(
              (template?.weekly_days ?? chore.weekly_days)?.length
                ? (template?.weekly_days ?? chore.weekly_days)
                : shownFrequency === "weekly"
                  ? [d.getUTCDay()]
                  : [],
            );
            setLoadedFrequency(shownFrequency);
            // A one-person list (left after someone was removed) reads as a
            // plain chore here; it stays as it is unless changed.
            const loadedRotation: string[] = Array.isArray(choresData.rotation)
              ? choresData.rotation
              : [];
            setTakeTurns(isRotating(loadedRotation));
            setRotation(isRotating(loadedRotation) ? loadedRotation : []);
            setIcon(typeof chore.icon === "string" ? chore.icon : null);
            setRoutine(chore.routine ?? "");
            setRoutineOrder(
              typeof chore.routine_order === "number"
                ? String(chore.routine_order)
                : "",
            );
            if (chore.photo_url) {
              setPhotoUrl(chore.photo_url);
              setPhotoPreview(chore.photo_url);
            }
          } else {
            setError(messageRef.current("notFound"));
          }
        } else {
          setError(messageRef.current("notFound"));
        }

        if (membersRes.ok) {
          const membersData = await membersRes.json();
          if (membersData.members) {
            setFamilyMembers(membersData.members);
          }
        }
      } catch (err) {
        console.error("Error fetching chore:", err);
        setError(messageRef.current("loadFailed"));
      } finally {
        setFetching(false);
      }
    };

    fetchData();
  }, [choreId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choreId) return;
    if (frequency === "weekly" && !weeklyDays.length) {
      setError(message("chooseWeekday"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choreId,
          title,
          description: description || null,
          points,
          assigned_to: assignedTo,
          ...(frequency !== "weekly" ? { due_date: dueDate } : {}),
          difficulty,
          // A series copy sends its frequency only when it was changed, and
          // then for the whole series.
          ...(seriesCopy
            ? frequency !== loadedFrequency || weeklyDaysDirty
              ? { frequency, apply_to_series: true }
              : {}
            : { frequency }),
          ...(frequency === "weekly" && weeklyDaysDirty
            ? { frequency, weekly_days: weeklyDays }
            : {}),
          photo_url: photoUrl,
          icon,
          ...routineRequestFields(routine, routineOrder),
          // Take turns: for the whole series; null stops taking turns.
          ...(rotationDirty && frequency !== "once"
            ? { rotation: takeTurns ? rotation : null }
            : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || message("updateFailed"));
        return;
      }

      if ((await navigation?.releaseBeforeNavigation()) === false) return;
      router.push("/dashboard/chores");
      router.refresh();
    } catch (err) {
      setError(message("unexpected"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-label-secondary">{message("loading")}</div>
      </div>
    );
  }

  if (!choreId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <div className="card-apple p-8">
          <h2 className="text-title-2 text-label-primary mb-2">
            {message("noChoreSelected")}
          </h2>
          <p className="text-body text-label-secondary mb-6">
            {message("selectChore")}
          </p>
          <Link href="/dashboard/chores" className="btn-filled">
            {message("backToChores")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={inSheet ? "" : "max-w-xl mx-auto pb-20"}>
      {!inSheet && <>
      {/* Back nav */}
      <div className="px-4 pt-4">
        {busy ? (
          <span
            aria-disabled="true"
            data-testid="chore-edit-back-busy"
            className="btn-plain text-base py-2 min-h-[44px]"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>{message("back")}</span>
          </span>
        ) : (
          <Link href="/dashboard/chores" className="btn-plain text-base py-2 min-h-[44px]">
            <ArrowLeft className="w-5 h-5" />
            <span>{message("back")}</span>
          </Link>
        )}
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">{message("editTitle")}</h1>
        <p className="text-subhead text-label-secondary mt-1">
          {message("editDescription")}
        </p>
      </div>

      </>}
      <form onSubmit={handleSubmit} className={inSheet ? "space-y-4" : "mt-6 space-y-4 px-4"}>
        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p className="text-body text-[var(--danger-text)]">{error}</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Title */}
          <div>
            <label className="label-apple" htmlFor="title">
              {message("title")}
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-apple"
              placeholder={message("titlePlaceholder")}
            />
          </div>

          {/* Points + Assignee row (points only with Points & streaks on) */}
          <div className="space-y-3">
            <div>
              <label className="label-apple" htmlFor="assignedTo">
                {rotating ? message("thisTime") : message("assignTo")}
              </label>
              <select
                id="assignedTo"
                required
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="input-apple"
              >
                {familyMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Frequency picker */}
          <div>
            <p id={`${fieldId}-frequency`} className="label-apple">
              {message("frequency")}
            </p>
            {seriesCopy && (
              <p className="text-caption-1 text-label-secondary mb-2">
                {message("seriesHint")}
              </p>
            )}
            <div
              role="group"
              aria-labelledby={`${fieldId}-frequency`}
              className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1"
            >
              {frequencyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFrequency(opt.value)}
                  aria-pressed={frequency === opt.value}
                  className={cn(
                    "flex-1 min-h-[44px] py-2 rounded-md text-sm font-medium transition-all duration-200",
                    frequency === opt.value
                      ? "bg-[var(--surface-elevated)] text-label-primary shadow-sm"
                      : "text-label-secondary hover:text-label-primary",
                  )}
                >
                  {message(opt.label)}
                </button>
              ))}
            </div>
          </div>

          {/* A weekly schedule is edited through its weekdays. */}
          {frequency !== "weekly" && (
            <div>
              <label className="label-apple" htmlFor="dueDate">
                {message("dueDate")}
              </label>
              <input
                id="dueDate"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-apple"
              />
            </div>
          )}
        </div>

        {frequency === "monthly" && <MonthlyScheduleHint />}

        {frequency === "weekly" && (
          <WeeklyDaysPicker
            days={weeklyDays}
            onChange={(days) => {
              setWeeklyDays(days);
              setWeeklyDaysDirty(true);
            }}
          />
        )}

        {/* Take turns (O-39): repeating chores only, for the whole series */}
        {frequency !== "once" && (
          <TakeTurnsPicker
            members={familyMembers}
            on={takeTurns}
            onToggle={(next) => {
              setTakeTurns(next);
              setRotationDirty(true);
            }}
            order={rotation}
            onOrderChange={(next) => {
              setRotation(next);
              setRotationDirty(true);
            }}
          />
        )}

        <ChoreFormSection
          title={message(gamification ? "detailsPoints" : "details")}
          summary={[
            ...(description.trim() ? [message("instructionsAdded")] : []),
            message("difficultySummary", {
              difficulty: message(difficultyOptions.find((option) => option.value === difficulty)!.label),
            }),
            ...(gamification && points !== undefined
              ? [message("pointsSummary", { count: points })]
              : []),
          ].join(" · ")}
        >
          {/* Description */}
          <div>
            <label className="label-apple" htmlFor="description">
              {message("description")}
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-apple min-h-[80px] resize-none"
              placeholder={message("descriptionPlaceholder")}
              rows={3}
            />
          </div>

          {/* Difficulty picker */}
          <div>
            <p id={`${fieldId}-difficulty`} className="label-apple">
              {message("difficulty")}
            </p>
            <div
              role="group"
              aria-labelledby={`${fieldId}-difficulty`}
              className="grid grid-cols-3 gap-2"
            >
              {difficultyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDifficulty(opt.value)}
                  aria-pressed={difficulty === opt.value}
                  className={cn(
                    "py-3 rounded-[var(--radius-md)] border text-center transition-all duration-200",
                    difficulty === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]"
                      : "border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-primary",
                  )}
                >
                  <div className="text-body font-semibold">{message(opt.label)}</div>
                  <div className="text-caption-1 text-label-secondary mt-0.5">
                    {message(opt.description)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {gamification && (
            <div>
              <label className="label-apple" htmlFor="points">
                {message("points")}
              </label>
              <input
                id="points"
                type="number"
                min="1"
                max="1000"
                value={points ?? 10}
                onChange={(e) => setPoints(parseInt(e.target.value) || 10)}
                className="input-apple"
              />
            </div>
          )}
        </ChoreFormSection>

        <ChoreFormSection
          title={message("picturesRoutine")}
          summary={[
            routine.trim()
              ? `${routine}${routineOrder ? ` · ${message("step")} ${routineOrder}` : ""}`
              : message("noRoutine"),
            localizedChoreRoutineIconLabel(locale, icon) ??
              routineIconLabel(icon) ??
              message("noPicture"),
          ].join(" · ")}
        >
          {/* Picture routines (#272): picture, routine and step */}
          <RoutineIconPicker value={icon} onChange={setIcon} />
          <RoutineFields
            routine={routine}
            onRoutineChange={setRoutine}
            order={routineOrder}
            onOrderChange={setRoutineOrder}
          />
        </ChoreFormSection>

        <ChoreFormSection
          title={message("photo")}
          summary={
            photoUploading
              ? message("uploading")
              : photoPreview
                ? message("photoSelected")
                : message("optionalPhoto")
          }
        >
          {/* Photo attach */}
          <div>
            <p id={`${fieldId}-photo`} className="label-apple">
              {message("photo")}
            </p>
            <input
              ref={fileInputRef}
              aria-labelledby={`${fieldId}-photo`}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPhotoUploading(true);
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  const res = await fetch("/api/upload", {
                    method: "POST",
                    body: fd,
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || message("uploadFailed"));
                  setPhotoUrl(data.url);
                  setPhotoPreview(data.url);
                } catch (err) {
                  console.error("Photo upload error:", err);
                  alert(message("uploadFailed"));
                } finally {
                  setPhotoUploading(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
              aria-describedby={`${fieldId}-photo`}
              className={cn(
                "w-full py-3 rounded-[var(--radius-md)] border transition-all duration-200 text-center",
                photoPreview
                  ? "border-[var(--success)] bg-[var(--success-tint)] text-success-text"
                  : "border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-secondary",
              )}
            >
              {photoUploading ? (
                <span className="text-sm">{message("uploading")}</span>
              ) : photoPreview ? (
                <span className="text-sm">{message("photoSelected")}</span>
              ) : (
                <>
                  <Camera className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">{message("addPhoto")}</span>
                </>
              )}
            </button>
            {photoPreview && (
              <div className="mt-2 relative w-24 h-24 rounded-[var(--radius-md)] overflow-hidden border border-[var(--surface-separator)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt={message("preview")}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl(null);
                    setPhotoPreview(null);
                  }}
                  aria-label={message("removePhoto")}
                  className="absolute top-0 right-0 flex h-11 w-11 items-start justify-end p-1"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--danger)] text-xs text-white"
                  >
                    ✕
                  </span>
                </button>
              </div>
            )}
          </div>
        </ChoreFormSection>

        {/* Submit */}
        <div className={inSheet ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1" : "pt-2"}>
          <button
            type="submit"
            disabled={
              loading ||
              !title ||
              !assignedTo ||
              (frequency === "weekly" ? !weeklyDays.length : !dueDate) ||
              (rotating && rotation.length < ROTATION_MIN)
            }
            className="btn-filled w-full"
          >
            {loading ? message("saving") : message("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function EditChorePage({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const { t } = useTranslation();
  const message = useCallback(
    (key: ChoreFormMessage) => t(key, undefined, choreFormMessages),
    [t],
  );
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="text-label-secondary">
            {message("loading")}
          </div>
        </div>
      }
    >
      <EditChoreForm inSheet={inSheet} onBusyChange={onBusyChange} />
    </Suspense>
  );
}
