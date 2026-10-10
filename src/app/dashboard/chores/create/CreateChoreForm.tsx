"use client";
import { nextSelectedWeekday } from "@/lib/chore-weekdays";
import { useTodayKey } from "@/components/ui/use-hydrated";
import { parseDateOnly, toDateOnlyLocal } from "@/lib/dates";
import { ChoreFormSection } from "@/components/chores/ChoreFormSection";
import { routineIconLabel } from "@/lib/routine-icons";
import { MonthlyScheduleHint } from "@/components/chores/MonthlyScheduleHint";
import { WeeklyDaysPicker } from "@/components/chores/WeeklyDaysPicker";

import { useState, useEffect, useRef, useId } from "react";
import { useRouter } from "next/navigation";
import { missingFieldsHint } from "@/lib/form-hints";
import { ArrowLeft, Plus, Camera } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useFeatureEnabled } from "@/components/providers/features-provider";
import {
  RoutineFields,
  RoutineIconPicker,
  routineRequestFields,
} from "@/components/chores/RoutineIconPicker";
import { TakeTurnsPicker } from "@/components/chores/TakeTurnsPicker";
import {
  ROUTINE_NAME_MAX,
  ROUTINE_ORDER_MAX,
  normalizeRoutineName,
} from "@/lib/routine-icons";
import { ROTATION_MIN } from "@/lib/chore-rotation";

type Difficulty = "easy" | "medium" | "hard";
type Frequency = "once" | "daily" | "weekly" | "monthly";

const difficultyOptions: {
  value: Difficulty;
  label: string;
  description: string;
}[] = [
  { value: "easy", label: "Easy", description: "5–10 min" },
  { value: "medium", label: "Medium", description: "15–30 min" },
  { value: "hard", label: "Hard", description: "30+ min" },
];

const frequencyOptions: { value: Frequency; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export default function CreateChoreForm({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const todayKey = useTodayKey();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState(10);
  // Points & streaks off (#248): the field is hidden and the default is sent,
  // so XP keeps accruing in the background if the family turns it back on.
  const gamification = useFeatureEnabled("gamification");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  useEffect(() => { onBusyChange?.(loading || photoUploading); }, [loading, photoUploading, onBusyChange]);
  // Picture routines (#272).
  const [icon, setIcon] = useState<string | null>(null);
  const [routine, setRoutine] = useState("");
  const [routineOrder, setRoutineOrder] = useState("");
  // Take turns (O-39): repeating chores only.
  const [takeTurns, setTakeTurns] = useState(false);
  const [rotation, setRotation] = useState<string[]>([]);
  const rotating = frequency !== "once" && takeTurns;
  const submitHint = missingFieldsHint([
    ...(title.trim() ? [] : ["a title"]),
    ...(frequency === "weekly"
      ? weeklyDays.length
        ? []
        : ["at least one weekday"]
      : dueDate
        ? []
        : ["a due date"]),
    ...(rotating
      ? rotation.length < ROTATION_MIN
        ? [`at least ${ROTATION_MIN} people to take turns`]
        : []
      : assignedTo
        ? []
        : ["who does it"]),
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = normalizeRoutineName(params.get("routine"));
    if (name && name.length <= ROUTINE_NAME_MAX) {
      setRoutine(name);
      const step = Number(params.get("step"));
      if (Number.isInteger(step) && step >= 1 && step <= ROUTINE_ORDER_MAX)
        setRoutineOrder(String(step));
      const date = params.get("date");
      if (date && parseDateOnly(date)) setDueDate(date);
    }
  }, []);

  useEffect(() => {
    const loadFamilyMembers = async () => {
      try {
        const res = await fetch("/api/family/members");
        const data = await res.json();
        if (res.ok && data.members) {
          setFamilyMembers(data.members);
          if (data.members.length > 0 && !assignedTo) {
            const requested = new URLSearchParams(window.location.search).get(
              "member",
            );
            setAssignedTo(
              data.members.find((m: { id: string }) => m.id === requested)
                ?.id ?? data.members[0].id,
            );
          }
        }
      } catch (err) {
        console.error("Error loading family members:", err);
      }
    };
    loadFamilyMembers();
  }, [assignedTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (frequency === "weekly" && !weeklyDays.length) {
      setError("Choose at least one weekday");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chores/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          points,
          // Taking turns: the first person in the order takes the first one.
          ...(rotating ? { rotation } : { assigned_to: assignedTo }),
          // Occurrence dates remain internal; weekly users choose weekdays.
          due_date:
            frequency === "weekly"
              ? nextSelectedWeekday(
                  parseDateOnly(toDateOnlyLocal(new Date()))!,
                  weeklyDays,
                  true,
                )!
                  .toISOString()
                  .slice(0, 10)
              : dueDate,
          difficulty,
          frequency,
          ...(frequency === "weekly" ? { weekly_days: weeklyDays } : {}),
          photo_url: photoUrl,
          icon,
          ...routineRequestFields(routine, routineOrder),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create chore");
        return;
      }

      router.push("/dashboard/chores");
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={inSheet ? "" : "max-w-xl mx-auto pb-20"}>
      {!inSheet && <>
      {/* Back nav */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/chores" className="btn-plain text-base py-2">
          <ArrowLeft className="w-5 h-5" />
          <span>Chores</span>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">New Chore</h1>
        <p className="text-subhead text-label-secondary mt-1">
          Assign a task to a family member.
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
              Title
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-apple"
              placeholder="e.g., Take out the trash"
            />
          </div>

          {/* Points + Assignee row (points only with Points & streaks on;
            no assignee while taking turns: the order decides) */}
          <div className="space-y-3">
            {!rotating && (
              <div>
                <label className="label-apple" htmlFor="assignedTo">
                  Assign To
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
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Frequency picker */}
          <div>
            <p id={`${fieldId}-frequency`} className="label-apple">
              Frequency
            </p>
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
                  {opt.label}
                </button>
              ))}
            </div>
            {frequency !== "once" && (
              <p className="text-footnote text-label-tertiary mt-1.5">
                This chore keeps repeating{" "}
                {frequency === "weekly"
                  ? "on the selected weekdays"
                  : frequency === "daily"
                    ? "every day"
                    : "every month"}
                .
              </p>
            )}
          </div>

          {/* Weekly schedules use weekdays; no user-entered due date. */}
          {frequency !== "weekly" && (
            <div>
              <label className="label-apple" htmlFor="dueDate">
                Due Date
              </label>
              <input
                id="dueDate"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-apple"
                min={todayKey ?? undefined}
              />
            </div>
          )}
        </div>

        {frequency === "monthly" && <MonthlyScheduleHint />}

        {frequency === "weekly" && (
          <WeeklyDaysPicker days={weeklyDays} onChange={setWeeklyDays} />
        )}

        {/* Take turns (O-39): repeating chores only */}
        {frequency !== "once" && (
          <TakeTurnsPicker
            members={familyMembers}
            on={takeTurns}
            onToggle={setTakeTurns}
            order={rotation}
            onOrderChange={setRotation}
          />
        )}

        <ChoreFormSection
          title={gamification ? "Details & points" : "Details"}
          summary={`${description.trim() ? "Instructions added · " : ""}${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} difficulty${gamification ? ` · ${points} points` : ""}`}
        >
          {/* Description */}
          <div>
            <label className="label-apple" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-apple min-h-[80px] resize-none"
              placeholder="Instructions or details..."
              rows={3}
            />
          </div>

          {/* Difficulty picker */}
          <div>
            <p id={`${fieldId}-difficulty`} className="label-apple">
              Difficulty
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
                  <div className="text-body font-semibold">{opt.label}</div>
                  <div className="text-caption-1 text-label-secondary mt-0.5">
                    {opt.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {gamification && (
            <div>
              <label className="label-apple" htmlFor="points">
                Points
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
          title="Pictures & routine"
          summary={[
            routine.trim()
              ? `${routine}${routineOrder ? ` · Step ${routineOrder}` : ""}`
              : "No routine",
            routineIconLabel(icon) ?? "No picture",
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
          title="Photo"
          summary={
            photoUploading
              ? "Uploading…"
              : photoPreview
                ? "Photo selected"
                : "Optional photo attachment"
          }
        >
          {/* Photo attach */}
          <div>
            <p id={`${fieldId}-photo`} className="label-apple">
              Photo
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
                  if (!res.ok) throw new Error(data.error || "Upload failed");
                  setPhotoUrl(data.url);
                  setPhotoPreview(data.url);
                } catch (err) {
                  console.error("Photo upload error:", err);
                  alert("Failed to upload photo");
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
                <span className="text-sm">Uploading...</span>
              ) : photoPreview ? (
                <span className="text-sm">Photo selected</span>
              ) : (
                <>
                  <Camera className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">Add photo</span>
                </>
              )}
            </button>
            {photoPreview && (
              <div className="mt-2 relative w-24 h-24 rounded-[var(--radius-md)] overflow-hidden border border-[var(--surface-separator)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl(null);
                    setPhotoPreview(null);
                  }}
                  aria-label="Remove photo"
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
            disabled={loading || submitHint !== null}
            aria-describedby={submitHint ? `${fieldId}-submit-hint` : undefined}
            className="btn-filled w-full"
          >
            {loading ? "Creating..." : "Create Chore"}
          </button>
          {submitHint && (
            <p
              id={`${fieldId}-submit-hint`}
              className="text-footnote text-label-secondary mt-2 text-center"
            >
              {submitHint}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
