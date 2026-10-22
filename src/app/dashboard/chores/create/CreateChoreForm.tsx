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
import { ArrowLeft, Plus, Camera } from "lucide-react";
import Link from "next/link";
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
import {
  ROUTINE_NAME_MAX,
  ROUTINE_ORDER_MAX,
  normalizeRoutineName,
} from "@/lib/routine-icons";
import { ROTATION_MIN } from "@/lib/chore-rotation";
import {
  usePendingFormNavigation,
  usePendingFormNavigationController,
} from "@/components/layout/pending-form-navigation";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { canonicalBodySignature } from "@/lib/request-signature";
import {
  findActiveHouseholdProfile,
  readApiErrorCode,
  type HouseholdProfile,
} from "@/lib/household-profile-types";
import {
  fetchHouseholdProfiles,
  readProfileChoreCreateSuccess,
} from "@/lib/household-profile-client";
import { useProfileSetupText } from "@/i18n/profile-setup";

import {
  captureChoreDraft,
  parseReviewedChore,
  type CaptureChoreDraft,
} from "@/lib/capture-chore-review";

type Difficulty = "easy" | "medium" | "hard";
type Frequency = "once" | "daily" | "weekly" | "monthly";
type AssignmentTarget =
  { kind: "account"; id: string } | { kind: "profile"; id: string };

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

export default function CreateChoreForm({
  inSheet = false,
  onBusyChange,
  review,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Capture review only: no create request, keys or navigation from this form. */
  review?: {
    initial: CaptureChoreDraft;
    onChange: (draft: CaptureChoreDraft) => void;
    onReview: (
      draft: CaptureChoreDraft,
      request: {
        action: "chore.create" | "chore.profile.create";
        body: string;
      },
    ) => void;
    submitLabel: string;
  };
} = {}) {
  const { locale, t } = useTranslation();
  const message = (
    key: ChoreFormMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, choreFormMessages);
  const todayKey = useTodayKey();
  const [title, setTitle] = useState(review?.initial.title ?? "");
  const [description, setDescription] = useState(
    review?.initial.description ?? "",
  );
  const [pointsInput, setPoints] = useState(review?.initial.points ?? "10");
  const points = Number(pointsInput);
  // Points & streaks off (#248): the field is hidden and the default is sent,
  // so XP keeps accruing in the background if the family turns it back on.
  const gamification = useFeatureEnabled("gamification");
  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget>(
    review?.initial.assignment ?? {
      kind: "account",
      id: "",
    },
  );
  const [profileOptions, setProfileOptions] = useState<HouseholdProfile[]>([]);
  const [profileRecurrenceSupported, setProfileRecurrenceSupported] =
    useState(false);
  const [dueDate, setDueDate] = useState(review?.initial.dueDate ?? "");
  const [weeklyStart, setWeeklyStart] = useState(
    review?.initial.weeklyStart ?? "",
  );
  const [difficulty, setDifficulty] = useState<Difficulty>(
    review?.initial.difficulty ?? "medium",
  );
  const [frequency, setFrequency] = useState<Frequency>(
    review?.initial.frequency ?? "once",
  );
  const [weeklyDays, setWeeklyDays] = useState<number[]>(
    review?.initial.weeklyDays ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    review?.initial.photoUrl ?? null,
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    review?.initial.photoUrl ?? null,
  );
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const photoUploadPending = useRef(false);
  const busy = loading || photoUploading;
  const directNavigation = usePendingFormNavigationController(busy && !inSheet);
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const profileText = useProfileSetupText();
  const profileIdempotencyKey = useRef<{
    key: string;
    signature: string;
  } | null>(null);
  const profileAmbiguousKeys = useRef(new Map<string, string>());
  const profileDraftRevision = useRef(0);
  const profilePendingRequest = useRef<{
    body: Record<string, unknown>;
    key: string;
    signature: string;
    draftRevision: number;
  } | null>(null);
  const markProfileDraftEdited = () => {
    profileIdempotencyKey.current = null;
    profilePendingRequest.current = null;
    profileDraftRevision.current += 1;
  };
  const assignedTo =
    assignmentTarget.kind === "account" ? assignmentTarget.id : "";
  const profileTargetId =
    assignmentTarget.kind === "profile" ? assignmentTarget.id : null;
  const profileTargetMissing = Boolean(
    profileTargetId &&
    !findActiveHouseholdProfile(profileOptions, profileTargetId),
  );
  // Picture routines (#272).
  const [icon, setIcon] = useState<string | null>(review?.initial.icon ?? null);
  const [routine, setRoutine] = useState(review?.initial.routine ?? "");
  const [routineOrder, setRoutineOrder] = useState(
    review?.initial.routineOrder ?? "",
  );
  // Take turns (O-39): repeating chores only.
  const [takeTurns, setTakeTurns] = useState(
    review?.initial.takeTurns ?? false,
  );
  const [rotation, setRotation] = useState<string[]>(
    review?.initial.rotation ?? [],
  );
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const reviewState: CaptureChoreDraft = {
    title,
    description,
    points: pointsInput,
    assignment: assignmentTarget,
    dueDate,
    weeklyStart,
    difficulty,
    frequency,
    weeklyDays,
    photoUrl,
    icon,
    routine,
    routineOrder,
    takeTurns,
    rotation,
  };
  const reviewSignature = JSON.stringify(reviewState);
  const previousReviewSignature = useRef(reviewSignature);
  useEffect(() => {
    if (previousReviewSignature.current === reviewSignature) return;
    previousReviewSignature.current = reviewSignature;
    if (reviewRef.current)
      reviewRef.current.onChange(
        captureChoreDraft.parse(JSON.parse(reviewSignature)),
      );
  }, [reviewSignature]);
  const rotating = frequency !== "once" && takeTurns;
  const missingFields = [
    ...(title.trim() ? [] : [message("fieldTitle")]),
    ...(frequency === "weekly"
      ? weeklyDays.length
        ? []
        : [message("fieldWeekday")]
      : dueDate
        ? []
        : [message("fieldDueDate")]),
    ...(rotating
      ? rotation.length < ROTATION_MIN
        ? [message("fieldRotation", { count: ROTATION_MIN })]
        : []
      : assignedTo || profileTargetId
        ? []
        : [message("fieldAssignee")]),
  ];
  const submitHint = profileTargetMissing
    ? profileText("profileTargetRefresh")
    : missingFields.length === 0
      ? null
      : missingFields.length === 1
        ? message("missingOne", { field: missingFields[0] })
        : message("missingMany", {
            fields: missingFields.slice(0, -1).join(", "),
            last: missingFields[missingFields.length - 1],
          });

  useEffect(() => {
    if (reviewRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const name = normalizeRoutineName(params.get("routine"));
    if (name && name.length <= ROUTINE_NAME_MAX) {
      setRoutine(name);
      const step = Number(params.get("step"));
      if (Number.isInteger(step) && step >= 1 && step <= ROUTINE_ORDER_MAX)
        setRoutineOrder(String(step));
      const date = params.get("date");
      if (date && parseDateOnly(date)) {
        setDueDate(date);
        setWeeklyStart(date);
      }
    }
    const requestedProfileId = params.get("profile");
    if (!requestedProfileId || profileOptions.length === 0) return;
    const requestedProfile = findActiveHouseholdProfile(
      profileOptions,
      requestedProfileId,
    );
    if (!requestedProfile) return;
    setAssignmentTarget((current) =>
      current.id ? current : { kind: "profile", id: requestedProfile.id },
    );
  }, [profileOptions]);

  useEffect(() => {
    const loadFamilyMembers = async () => {
      try {
        const res = await fetch("/api/family/members");
        const data = await res.json();
        if (res.ok && data.members) {
          setFamilyMembers(data.members);
          const requestedProfileId = new URLSearchParams(
            window.location.search,
          ).get("profile");
          // A profile query is resolved against the active profile catalog.
          // Never turn a stale or still-loading profile request into the first
          // account in the household.
          if (
            !reviewRef.current &&
            data.members.length > 0 &&
            !assignedTo &&
            !requestedProfileId
          ) {
            const requested = new URLSearchParams(window.location.search).get(
              "member",
            );
            setAssignmentTarget((current) =>
              current.kind === "profile"
                ? current
                : current.id
                  ? current
                  : {
                      kind: "account",
                      id:
                        data.members.find(
                          (m: { id: string }) => m.id === requested,
                        )?.id ?? data.members[0].id,
                    },
            );
          }
        }
      } catch (err) {
        console.error("Error loading family members:", err);
      }
    };
    loadFamilyMembers();
  }, [assignedTo]);

  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      try {
        const profiles = await fetchHouseholdProfiles();
        if (!cancelled && profiles) {
          setProfileRecurrenceSupported(
            profiles.profileChoreSupported === true &&
              profiles.profileChoreRecurrenceSupported === true,
          );
        }
        if (!cancelled && profiles?.profileChoreSupported) {
          setProfileOptions(
            profiles.profiles.filter((profile) => !profile.archived_at),
          );
        }
      } catch {
        // Profile setup is optional; the account assignment path remains available.
      }
    }
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (photoUploadPending.current) return;
    if (frequency === "weekly" && !weeklyDays.length) {
      setError(message("chooseWeekday"));
      return;
    }
    if (
      reviewRef.current &&
      ((frequency !== "weekly" && !parseDateOnly(dueDate)) ||
        (routine.trim() && routineOrder && !/^[0-9]+$/.test(routineOrder)))
    ) {
      setError(message("createFailed"));
      return;
    }
    const viewDay = toDateOnlyLocal(new Date());
    if (
      frequency === "weekly" &&
      weeklyStart &&
      (!parseDateOnly(weeklyStart) || weeklyStart < viewDay)
    ) {
      setError(message("weeklyStartInvalid"));
      return;
    }
    const weeklyDueDate =
      frequency === "weekly"
        ? nextSelectedWeekday(
            parseDateOnly(weeklyStart || viewDay)!,
            weeklyDays,
            true,
          )!
            .toISOString()
            .slice(0, 10)
        : null;
    const profileTarget =
      assignmentTarget.kind === "profile"
        ? findActiveHouseholdProfile(profileOptions, assignmentTarget.id)
        : null;
    const isProfileTarget = assignmentTarget.kind === "profile";
    if (isProfileTarget && !profileTarget) {
      setError(profileText("profileTargetRefresh"));
      return;
    }
    if (
      isProfileTarget &&
      frequency !== "once" &&
      !profileRecurrenceSupported
    ) {
      setError(profileText("profileTargetRecurrenceUnsupported"));
      return;
    }
    if (
      reviewRef.current &&
      !isProfileTarget &&
      (rotating
        ? !rotation.every((id) =>
            familyMembers.some((member) => member.id === id),
          )
        : !familyMembers.some((member) => member.id === assignedTo))
    ) {
      setError(message("fieldAssignee"));
      return;
    }
    setLoading(true);
    setError(null);
    const submittedProfileDraftRevision = isProfileTarget
      ? profileDraftRevision.current
      : null;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      let requestBody: Record<string, unknown>;
      if (profileTarget) {
        const profileDueDate =
          frequency === "weekly" ? weeklyDueDate! : dueDate;
        const computedRequestBody: Record<string, unknown> = {
          protocol: 2,
          selection: { memberId: profileTarget.id },
          title: title.trim(),
          description: description.trim() || null,
          points: 10,
          due_date: profileDueDate,
          difficulty,
          frequency,
          weekly_days: frequency === "weekly" ? weeklyDays : [],
          photo_url: photoUrl,
          icon,
          ...routineRequestFields(routine, routineOrder),
        };
        if (reviewRef.current) {
          parseReviewedChore("chore.profile.create", computedRequestBody);
          reviewRef.current.onReview(captureChoreDraft.parse(reviewState), {
            action: "chore.profile.create",
            body: JSON.stringify(computedRequestBody),
          });
          return;
        }
        const pending = profilePendingRequest.current;
        let signature: string;
        let key: string;
        if (pending && pending.draftRevision === profileDraftRevision.current) {
          requestBody = pending.body;
          signature = pending.signature;
          key = pending.key;
        } else {
          requestBody = computedRequestBody;
          signature = canonicalBodySignature(requestBody);
          key =
            (profileIdempotencyKey.current?.signature === signature
              ? profileIdempotencyKey.current.key
              : profileAmbiguousKeys.current.get(signature)) ??
            newIdempotencyKey();
          profilePendingRequest.current = {
            body: requestBody,
            key,
            signature,
            draftRevision: profileDraftRevision.current,
          };
        }
        profileIdempotencyKey.current = { key, signature };
        headers[IDEMPOTENCY_HEADER] = key;
      } else {
        requestBody = {
          title,
          description: description || null,
          points,
          // Taking turns: the first person in the order takes the first one.
          ...(rotating ? { rotation } : { assigned_to: assignedTo }),
          // Occurrence dates remain internal; weekly users choose weekdays.
          due_date: frequency === "weekly" ? weeklyDueDate! : dueDate,
          difficulty,
          frequency,
          ...(frequency === "weekly" ? { weekly_days: weeklyDays } : {}),
          photo_url: photoUrl,
          icon,
          ...routineRequestFields(routine, routineOrder),
        };
      }
      if (reviewRef.current) {
        if (!/^[0-9]+$/.test(pointsInput)) throw new Error("Invalid points");
        parseReviewedChore("chore.create", requestBody);
        reviewRef.current.onReview(captureChoreDraft.parse(reviewState), {
          action: "chore.create",
          body: JSON.stringify(requestBody),
        });
        return;
      }
      const res = await fetch("/api/chores/create", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (isProfileTarget) {
          const code = readApiErrorCode(data);
          if (code === "MEMBER_PROTOCOL_UNAVAILABLE") {
            profileAmbiguousKeys.current.delete(
              profileIdempotencyKey.current?.signature ?? "",
            );
            profileIdempotencyKey.current = null;
            profilePendingRequest.current = null;
            setError(
              profileText(
                frequency !== "once"
                  ? "profileTargetRecurrenceUnsupported"
                  : "profileTargetUnsupported",
              ),
            );
          } else {
            if (res.status >= 500 && profileIdempotencyKey.current) {
              profileAmbiguousKeys.current.set(
                profileIdempotencyKey.current.signature,
                profileIdempotencyKey.current.key,
              );
            }
            setError(profileText("profileTargetError"));
          }
        } else {
          setError(
            typeof data?.error === "string"
              ? data.error
              : message("createFailed"),
          );
        }
        return;
      }

      if (
        isProfileTarget &&
        !readProfileChoreCreateSuccess(data, profileTarget?.id)
      ) {
        setError(profileText("invalidResponse"));
        return;
      }

      // A native event can still reach a controlled input while a request is
      // in flight (for example through automation). Keep a newly edited draft
      // on screen instead of letting an older response navigate away.
      if (
        isProfileTarget &&
        submittedProfileDraftRevision !== profileDraftRevision.current
      ) {
        return;
      }

      if (isProfileTarget && profileIdempotencyKey.current) {
        profileAmbiguousKeys.current.delete(
          profileIdempotencyKey.current.signature,
        );
        profileIdempotencyKey.current = null;
        profilePendingRequest.current = null;
      }
      if ((await navigation?.releaseBeforeNavigation()) === false) return;
      router.push("/dashboard/chores");
      router.refresh();
    } catch (err) {
      if (isProfileTarget && profileIdempotencyKey.current) {
        profileAmbiguousKeys.current.set(
          profileIdempotencyKey.current.signature,
          profileIdempotencyKey.current.key,
        );
      }
      setError(
        isProfileTarget
          ? profileText("profileTargetError")
          : message("unexpected"),
      );
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={inSheet ? "" : "max-w-xl mx-auto pb-20"}>
      {!inSheet && (
        <>
          {/* Back nav */}
          <div className="px-4 pt-4">
            {busy ? (
              <span
                aria-disabled="true"
                data-testid="chore-create-back-busy"
                className="btn-plain text-base py-2 min-h-[44px]"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>{message("back")}</span>
              </span>
            ) : (
              <Link
                href="/dashboard/chores"
                className="btn-plain text-base py-2 min-h-[44px]"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>{message("back")}</span>
              </Link>
            )}
          </div>

          <div className="px-4 pt-4">
            <h1 className="text-large-title font-display">
              {message("newTitle")}
            </h1>
            <p className="text-subhead text-label-secondary mt-1">
              {message("newDescription")}
            </p>
          </div>
        </>
      )}
      <form
        onSubmit={handleSubmit}
        className={inSheet ? "space-y-4" : "mt-6 space-y-4 px-4"}
      >
        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p className="text-body text-[var(--danger-text)]">{error}</p>
          </div>
        )}

        <fieldset
          disabled={Boolean(profileTargetId) && loading}
          className="m-0 min-w-0 space-y-4 border-0 p-0"
          aria-busy={Boolean(profileTargetId) && loading}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Title */}
            <div>
              <label className="label-apple" htmlFor="title">
                {message("title")}
              </label>
              <input
                id="title"
                maxLength={500}
                type="text"
                required
                value={title}
                onChange={(e) => {
                  markProfileDraftEdited();
                  setTitle(e.target.value);
                }}
                className="input-apple"
                placeholder={message("titlePlaceholder")}
              />
            </div>

            {/* Points + Assignee row (points only with Points & streaks on;
            no assignee while taking turns: the order decides) */}
            <div className="space-y-3">
              {!rotating && (
                <div>
                  <label className="label-apple" htmlFor="assignedTo">
                    {message("assignTo")}
                  </label>
                  <select
                    id="assignedTo"
                    required
                    value={
                      profileTargetId
                        ? `profile:${profileTargetId}`
                        : assignedTo
                    }
                    onChange={(e) => {
                      markProfileDraftEdited();
                      const value = e.target.value;
                      if (value.startsWith("profile:")) {
                        setAssignmentTarget({
                          kind: "profile",
                          id: value.slice("profile:".length),
                        });
                        setTakeTurns(false);
                      } else {
                        setAssignmentTarget({ kind: "account", id: value });
                      }
                    }}
                    className="input-apple"
                  >
                    {review && (
                      <option value="">{message("fieldAssignee")}</option>
                    )}
                    {familyMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                    {profileOptions.length > 0 && (
                      <optgroup label={profileText("profileTargets")}>
                        {profileOptions.map((profile) => (
                          <option
                            key={profile.id}
                            value={`profile:${profile.id}`}
                          >
                            {profile.name} ·{" "}
                            {profileText(
                              profile.role === "child"
                                ? "roleChild"
                                : profile.role === "teen"
                                  ? "roleTeen"
                                  : "roleParent",
                            )}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {profileTargetId && (
                    <p className="text-footnote text-label-secondary mt-1.5">
                      {profileRecurrenceSupported
                        ? profileText("profileTargetRecurrence")
                        : profileText("profileTargetOnce")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Frequency picker */}
            <div>
              <p id={`${fieldId}-frequency`} className="label-apple">
                {message("frequency")}
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
                    onClick={() => {
                      markProfileDraftEdited();
                      setFrequency(opt.value);
                    }}
                    disabled={
                      Boolean(profileTargetId) &&
                      !profileRecurrenceSupported &&
                      opt.value !== "once"
                    }
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
              {frequency !== "once" && (
                <p className="text-footnote text-label-tertiary mt-1.5">
                  {message("repeatDescription", {
                    when:
                      frequency === "weekly"
                        ? message("repeatWeekdays")
                        : frequency === "daily"
                          ? message("repeatDaily")
                          : message("repeatMonthly"),
                  })}
                </p>
              )}
            </div>

            {/* Weekly schedules use weekdays; no user-entered due date. */}
            {frequency !== "weekly" && (
              <div>
                <label className="label-apple" htmlFor="dueDate">
                  {message("dueDate")}
                </label>
                <input
                  id="dueDate"
                  type={review ? "text" : "date"}
                  maxLength={80}
                  placeholder={review ? "YYYY-MM-DD" : undefined}
                  required
                  value={dueDate}
                  onChange={(e) => {
                    markProfileDraftEdited();
                    setDueDate(e.target.value);
                  }}
                  className="input-apple"
                  min={todayKey ?? undefined}
                />
              </div>
            )}
          </div>

          {frequency === "monthly" && <MonthlyScheduleHint />}

          {frequency === "weekly" && (
            <div className="space-y-3">
              <WeeklyDaysPicker
                days={weeklyDays}
                onChange={(days) => {
                  markProfileDraftEdited();
                  setWeeklyDays(days);
                }}
              />
              <details className="rounded-xl bg-[var(--surface-fill)] p-3">
                <summary className="min-h-[44px] cursor-pointer py-2 text-subhead">
                  {message("weeklyStartLater")}
                </summary>
                <label
                  className="label-apple"
                  htmlFor={`${fieldId}-weekly-start`}
                >
                  {message("weeklyStart")}
                </label>
                <input
                  id={`${fieldId}-weekly-start`}
                  className="input-apple"
                  type={review ? "text" : "date"}
                  maxLength={80}
                  placeholder={review ? "YYYY-MM-DD" : undefined}
                  value={weeklyStart}
                  min={todayKey ?? undefined}
                  aria-describedby={`${fieldId}-weekly-start-help`}
                  onChange={(event) => {
                    markProfileDraftEdited();
                    setWeeklyStart(event.target.value);
                  }}
                />
                <p
                  id={`${fieldId}-weekly-start-help`}
                  className="text-footnote text-label-secondary"
                >
                  {message("weeklyStartHelp")}
                </p>
              </details>
            </div>
          )}

          {/* Take turns (O-39): repeating chores only */}
          {frequency !== "once" && !profileTargetId && (
            <TakeTurnsPicker
              members={familyMembers}
              on={takeTurns}
              onToggle={setTakeTurns}
              order={rotation}
              onOrderChange={setRotation}
            />
          )}

          <ChoreFormSection
            title={message(
              gamification && !profileTargetId ? "detailsPoints" : "details",
            )}
            summary={[
              ...(description.trim() ? [message("instructionsAdded")] : []),
              message("difficultySummary", {
                difficulty: message(
                  difficultyOptions.find(
                    (option) => option.value === difficulty,
                  )!.label,
                ),
              }),
              ...(gamification && !profileTargetId
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
                maxLength={1000}
                value={description}
                onChange={(e) => {
                  markProfileDraftEdited();
                  setDescription(e.target.value);
                }}
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
                    onClick={() => {
                      markProfileDraftEdited();
                      setDifficulty(opt.value);
                    }}
                    aria-pressed={difficulty === opt.value}
                    className={cn(
                      "py-3 rounded-[var(--radius-md)] border text-center transition-all duration-200",
                      difficulty === opt.value
                        ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]"
                        : "border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-primary",
                    )}
                  >
                    <div className="text-body font-semibold">
                      {message(opt.label)}
                    </div>
                    <div className="text-caption-1 text-label-secondary mt-0.5">
                      {message(opt.description)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {gamification && !profileTargetId && (
              <div>
                <label className="label-apple" htmlFor="points">
                  {message("points")}
                </label>
                <input
                  id="points"
                  type={review ? "text" : "number"}
                  inputMode="numeric"
                  min="0"
                  max="1000"
                  value={pointsInput}
                  onChange={(e) => setPoints(e.target.value)}
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
            <RoutineIconPicker
              value={icon}
              onChange={(value) => {
                markProfileDraftEdited();
                setIcon(value);
              }}
            />
            <RoutineFields
              preservePartialNumbers={Boolean(review)}
              routine={routine}
              onRoutineChange={(value) => {
                markProfileDraftEdited();
                setRoutine(value);
              }}
              order={routineOrder}
              onOrderChange={(value) => {
                markProfileDraftEdited();
                setRoutineOrder(value);
              }}
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
                  const input = e.currentTarget;
                  const file = input.files?.[0];
                  if (!file || photoUploadPending.current || loading) return;
                  photoUploadPending.current = true;
                  setPhotoError(false);
                  markProfileDraftEdited();
                  setPhotoUploading(true);
                  try {
                    const fd = new FormData();
                    fd.append("file", file);
                    const res = await fetch("/api/upload", {
                      method: "POST",
                      body: fd,
                    });
                    const data = await res.json();
                    if (!res.ok)
                      throw new Error(data.error || message("uploadFailed"));
                    if (
                      typeof data?.url !== "string" ||
                      !data.url.startsWith("/api/files/chores/")
                    )
                      throw new Error(message("uploadFailed"));
                    setPhotoUrl(data.url);
                    setPhotoPreview(data.url);
                  } catch {
                    setPhotoError(true);
                  } finally {
                    input.value = "";
                    photoUploadPending.current = false;
                    setPhotoUploading(false);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                aria-describedby={
                  photoError
                    ? `${fieldId}-photo ${fieldId}-photo-error`
                    : `${fieldId}-photo`
                }
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
              {photoError && (
                <p
                  id={`${fieldId}-photo-error`}
                  role="alert"
                  className="mt-2 text-body text-[var(--danger-text)]"
                >
                  {message("uploadFailed")}
                </p>
              )}
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
                      markProfileDraftEdited();
                      setPhotoError(false);
                      setPhotoUrl(null);
                      setPhotoPreview(null);
                    }}
                    disabled={busy}
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
        </fieldset>

        {/* Submit */}
        <div
          className={
            inSheet
              ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1"
              : "pt-2"
          }
        >
          <button
            type="submit"
            disabled={busy || submitHint !== null}
            aria-describedby={submitHint ? `${fieldId}-submit-hint` : undefined}
            className="btn-filled w-full"
          >
            {loading
              ? message("creating")
              : (review?.submitLabel ?? message("create"))}
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
