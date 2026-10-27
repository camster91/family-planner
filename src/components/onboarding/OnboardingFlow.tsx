"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Users,
  ArrowRight,
  CheckCircle,
  Sparkles,
  UserPlus,
  Mail,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { readHouseholdProfiles } from "@/lib/household-profile-types";
import { useOnboardingText } from "@/i18n/onboarding";

const ProfileSetupPanel = dynamic(
  () =>
    import("@/components/family/ProfileSetupPanel").then((module) => ({
      default: module.ProfileSetupPanel,
    })),
  { ssr: false, loading: () => null },
);

type InviteRole = "child" | "teen" | "parent";
type ProfileAvailability = "checking" | "available" | "unavailable";

interface OnboardingFlowProps {
  userId: string;
}

type Member = { id: string };

type ReconcileResult = "found" | "absent" | "unknown";
type RosterRefreshState = "fresh" | "refreshing" | "stale";

const ROSTER_REFRESH_TIMEOUT_MS = 2500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfirmedInviteResponse(
  payload: unknown,
  email: string,
  role: InviteRole,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const response = payload as { success?: unknown; invite?: unknown };
  if (
    response.success !== true ||
    !response.invite ||
    typeof response.invite !== "object"
  ) {
    return false;
  }
  const invite = response.invite as {
    email?: unknown;
    role?: unknown;
    expires_at?: unknown;
  };
  return (
    isNonEmptyString(invite.email) &&
    invite.email.trim().toLowerCase() === email.trim().toLowerCase() &&
    invite.role === role &&
    isNonEmptyString(invite.expires_at) &&
    !Number.isNaN(Date.parse(invite.expires_at))
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type JsonReadResult = { response: Response; payload: unknown };

async function fetchJsonWithinTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<JsonReadResult | null> {
  return withTimeout(
    (async () => {
      const response = await fetch(input, init);
      let payload: unknown = null;
      try {
        // Keep the response body inside the same timeout as fetch(). A
        // response can be received while its streamed JSON body remains
        // unavailable, and that must become a truthful stale read.
        payload = await response.json();
      } catch {
        payload = null;
      }
      return { response, payload };
    })(),
    timeoutMs,
  );
}

function readError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = (payload as { error?: unknown }).error;
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return fallback;
}

export default function OnboardingFlow({
  userId: _userId,
}: OnboardingFlowProps) {
  const text = useOnboardingText();
  const [step, setStep] = useState(1);
  const [familyName, setFamilyName] = useState("");
  const [loading, setLoading] = useState(false);
  const creatingFamilyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [profileAvailability, setProfileAvailability] =
    useState<ProfileAvailability>("unavailable");
  const [profileCount, setProfileCount] = useState(0);
  const [memberCount, setMemberCount] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("child");
  const [sendingInvite, setSendingInvite] = useState(false);
  const sendingInviteRef = useRef(false);
  const [inviteError, setInviteError] = useState("");
  const [rosterRefresh, setRosterRefresh] =
    useState<RosterRefreshState>("fresh");
  usePendingFormNavigationController(loading || sendingInvite);

  const loadProfileAvailability = useCallback(async () => {
    setProfileAvailability("checking");
    try {
      // The public capability manifest describes the queue/read protocol and
      // intentionally stays at v1 while profile setup is dormant. A
      // successful authenticated parent-scoped profile read is the actual
      // compatibility proof for this opt-in surface; a 409/refusal keeps the
      // no-email option hidden without advertising a production flag.
      const result = await fetchJsonWithinTimeout(
        "/api/family/profiles",
        { cache: "no-store" },
        ROSTER_REFRESH_TIMEOUT_MS,
      );
      if (!result?.response.ok) {
        setProfileAvailability("unavailable");
        return;
      }
      const profiles = readHouseholdProfiles(result.payload);
      if (!profiles) {
        setProfileAvailability("unavailable");
        return;
      }
      setProfileCount(
        profiles.filter((profile) => !profile.archived_at).length,
      );
      setProfileAvailability("available");
    } catch {
      // Unknown capability is never treated as permission to write a profile.
      setProfileAvailability("unavailable");
    }
  }, []);

  const refreshRoster = useCallback(async () => {
    setRosterRefresh("refreshing");
    try {
      const [memberRead, profileRead] = await Promise.all([
        fetchJsonWithinTimeout(
          "/api/family/members",
          { cache: "no-store" },
          ROSTER_REFRESH_TIMEOUT_MS,
        ),
        profileAvailability === "available"
          ? fetchJsonWithinTimeout(
              "/api/family/profiles",
              { cache: "no-store" },
              ROSTER_REFRESH_TIMEOUT_MS,
            )
          : Promise.resolve(null),
      ]);
      let fresh = memberRead !== null && memberRead.response.ok;
      if (memberRead?.response.ok) {
        const payload = memberRead.payload;
        const members =
          payload && typeof payload === "object"
            ? (payload as { members?: unknown }).members
            : null;
        if (
          Array.isArray(members) &&
          members.every(
            (member) =>
              member &&
              typeof member === "object" &&
              isNonEmptyString((member as Member).id),
          )
        ) {
          setMemberCount(members.length);
        } else {
          fresh = false;
        }
      }
      if (profileAvailability === "available") {
        fresh = fresh && profileRead !== null && profileRead.response.ok;
        if (profileRead?.response.ok) {
          const profiles = readHouseholdProfiles(profileRead.payload);
          if (profiles) {
            setProfileCount(
              profiles.filter((profile) => !profile.archived_at).length,
            );
          } else {
            fresh = false;
          }
        }
      }
      setRosterRefresh(fresh ? "fresh" : "stale");
    } catch {
      // Keep the current count rather than showing a false empty roster.
      setRosterRefresh("stale");
    }
  }, [profileAvailability]);

  useEffect(() => {
    if (step !== 3) return;
    void loadProfileAvailability();
  }, [loadProfileAvailability, step]);

  async function reconcileFamily(): Promise<ReconcileResult> {
    try {
      const result = await fetchJsonWithinTimeout(
        "/api/auth/me",
        { cache: "no-store" },
        ROSTER_REFRESH_TIMEOUT_MS,
      );
      if (!result) return "unknown";
      const { response, payload } = result;
      const user =
        payload && typeof payload === "object"
          ? (payload as { user?: { family_id?: unknown } }).user
          : null;
      if (response.ok && user && isNonEmptyString(user.family_id)) {
        setNotice(text("reconcileFound"));
        setStep(3);
        setMemberCount(1);
        return "found";
      }
      if (
        response.ok &&
        user &&
        (user.family_id === null || user.family_id === undefined)
      ) {
        return "absent";
      }
    } catch {
      // Keep the original draft and show the honest unknown state below.
    }
    return "unknown";
  }

  async function createFamily() {
    if (creatingFamilyRef.current) return;
    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setError(text("createError"));
      return;
    }
    // Enter/click can reach this handler before the loading render commits.
    creatingFamilyRef.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // A server error, or the route's already-belongs 400, can arrive
        // after the transaction committed. Reconcile once through the
        // authenticated session rather than issuing a duplicate POST.
        if (res.status >= 500 || res.status === 400) {
          const reconciled = await reconcileFamily();
          if (reconciled === "found") return;
          if (reconciled === "unknown") {
            setError(text("reconcileUnknown"));
            return;
          }
        }
        setError(readError(data, text("createError")));
        return;
      }
      const family =
        data && typeof data === "object"
          ? (data as { family?: unknown }).family
          : null;
      if (!family || typeof family !== "object") {
        const reconciled = await reconcileFamily();
        if (reconciled === "found") return;
        setError(
          reconciled === "unknown"
            ? text("reconcileUnknown")
            : text("invalidResponse"),
        );
        return;
      }
      if (!isNonEmptyString((family as { id?: unknown }).id)) {
        const reconciled = await reconcileFamily();
        if (reconciled === "found") return;
        setError(
          reconciled === "unknown"
            ? text("reconcileUnknown")
            : text("invalidResponse"),
        );
        return;
      }
      setMemberCount(1);
      setStep(3);
    } catch {
      if ((await reconcileFamily()) === "found") return;
      setError(text("reconcileUnknown"));
    } finally {
      creatingFamilyRef.current = false;
      setLoading(false);
    }
  }

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || sendingInviteRef.current) return;
    sendingInviteRef.current = true;
    setSendingInvite(true);
    setInviteError("");
    setNotice("");
    try {
      const response = await fetch("/api/family/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setInviteError(readError(payload, text("inviteError")));
        return;
      }
      if (!isConfirmedInviteResponse(payload, email, inviteRole)) {
        // The invite route has an external mail side effect. An incomplete
        // 2xx envelope is not a confirmation, so retain the draft and make
        // the parent choose whether to retry manually.
        setInviteError(text("inviteError"));
        return;
      }
      setInviteEmail("");
      setInviteOpen(false);
      setNotice(text("inviteSent"));
      // The invite row/mail commit is complete. Release the mutation guard
      // before best-effort roster reads so a slow read cannot block Back or
      // close forever. The refresh state remains truthful if it times out.
      setSendingInvite(false);
      void refreshRoster();
    } catch {
      // Invite sends have an external mail side effect. Do not blindly retry;
      // retain the email and let the parent choose whether to try again.
      setInviteError(text("inviteError"));
    } finally {
      sendingInviteRef.current = false;
      setSendingInvite(false);
    }
  }

  const totalPeople = memberCount + profileCount;
  const peopleAdded = (
    totalPeople === 1 ? text("peopleAddedOne") : text("peopleAddedMany")
  ).replace("{count}", String(totalPeople));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        className="mb-8 flex items-center justify-center gap-4"
        aria-label={text("progressLabel")}
      >
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            aria-current={item === step ? "step" : undefined}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
              item === step
                ? "bg-accent-fill text-white"
                : item < step
                  ? "bg-success text-white"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {item < step ? (
              <CheckCircle className="h-5 w-5" aria-hidden="true" />
            ) : (
              item
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--accent-tint)]">
            <Sparkles className="h-10 w-10 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">
            {text("welcomeTitle")}
          </h2>
          <p className="mx-auto max-w-md text-muted-foreground">
            {text("welcomeDescription")}
          </p>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-accent-fill px-6 py-3 font-semibold text-white transition-colors hover:bg-accent-fill-hover"
          >
            {text("getStarted")}
            <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--success-tint)]">
              <Users
                className="h-10 w-10 text-success-text"
                aria-hidden="true"
              />
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              {text("createTitle")}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {text("createDescription")}
            </p>
          </div>

          <div className="mx-auto max-w-md space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-lg bg-[var(--danger-tint)] p-3 text-sm text-danger-text"
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="rounded-lg bg-[var(--success-tint)] p-3 text-sm text-success-text"
              >
                {notice}
              </div>
            )}
            <label
              htmlFor="onboarding-family-name"
              className="block font-medium text-foreground"
            >
              {text("familyNameLabel")}
            </label>
            <input
              id="onboarding-family-name"
              type="text"
              value={familyName}
              onChange={(event) => setFamilyName(event.target.value)}
              placeholder={text("familyNamePlaceholder")}
              className="w-full rounded-xl border border-input bg-card px-4 py-3 text-lg text-foreground focus:border-[var(--focus-ring)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void createFamily();
                }
              }}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => void createFamily()}
              disabled={loading}
              className="min-h-[44px] w-full rounded-xl bg-accent-fill px-6 py-3 font-semibold text-white transition-colors hover:bg-accent-fill-hover disabled:opacity-50"
            >
              {loading ? text("creatingFamily") : text("createFamily")}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              {text("joinPrompt")}{" "}
              <Link
                href="/join"
                aria-disabled={loading || undefined}
                tabIndex={loading ? -1 : undefined}
                onClick={(event) => {
                  if (loading) event.preventDefault();
                }}
                className={`font-medium text-primary hover:underline ${loading ? "pointer-events-none opacity-60" : ""}`}
              >
                {text("joinExisting")}
              </Link>
            </p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--accent-tint)]">
              <UserPlus className="h-10 w-10 text-primary" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              {text("addEveryoneTitle")}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
              {text("addEveryoneDescription")}
            </p>
            <p
              className="mt-3 text-sm font-medium text-label-secondary"
              role="status"
            >
              {peopleAdded}
            </p>
            {rosterRefresh === "refreshing" && (
              <p className="mt-2 text-sm text-muted-foreground" role="status">
                {text("rosterRefreshing")}
              </p>
            )}
            {rosterRefresh === "stale" && (
              <div
                className="mt-2 flex flex-col items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <span>{text("rosterStale")}</span>
                <button
                  type="button"
                  onClick={() => void refreshRoster()}
                  className="btn-secondary min-h-[44px] px-4"
                >
                  {text("retryRoster")}
                </button>
              </div>
            )}
          </div>

          {notice && (
            <div
              role="status"
              className="rounded-lg bg-[var(--success-tint)] p-3 text-sm text-success-text"
            >
              {notice}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-[var(--surface-separator)] bg-card p-5">
              <Mail className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-foreground">
                {text("accountOptionTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {text("accountOptionDescription")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setInviteError("");
                  setInviteOpen(true);
                }}
                className="btn-filled mt-4 inline-flex min-h-[44px] w-full items-center justify-center"
              >
                <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                {text("addAccount")}
              </button>
              <Link
                href="/dashboard/family/invite"
                className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-3 text-sm font-medium text-primary hover:bg-[var(--surface-fill)]"
              >
                {text("openFullInvitePage")}
              </Link>
            </section>

            <section className="rounded-2xl border border-[var(--surface-separator)] bg-card p-5">
              <UserPlus
                className="mb-3 h-6 w-6 text-primary"
                aria-hidden="true"
              />
              <h3 className="text-lg font-semibold text-foreground">
                {text("profileOptionTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {text("profileOptionDescription")}
              </p>
              {profileAvailability === "checking" && (
                <p className="mt-4 text-sm text-muted-foreground" role="status">
                  {text("profileChecking")}
                </p>
              )}
              {profileAvailability === "available" && (
                <div className="mt-4">
                  <ProfileSetupPanel onProfilesChanged={refreshRoster} />
                </div>
              )}
              {profileAvailability === "unavailable" && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground" role="status">
                    {text("profileUnavailable")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadProfileAvailability()}
                    className="btn-secondary min-h-[44px] w-full"
                  >
                    {text("checkAgain")}
                  </button>
                </div>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="btn-tinted inline-flex min-h-[44px] items-center justify-center"
            >
              {text("finishLater")}
            </Link>
            <Link
              href="/dashboard"
              className="btn-secondary inline-flex min-h-[44px] items-center justify-center"
            >
              {text("continueToToday")}
            </Link>
          </div>
        </div>
      )}

      <Dialog
        open={inviteOpen}
        onClose={sendingInvite ? undefined : () => setInviteOpen(false)}
        title={text("accountInviteTitle")}
        description={text("accountInviteDescription")}
        closeLabel={text("close")}
        variant="form"
        footer={
          <button
            type="submit"
            form="onboarding-account-invite-form"
            disabled={sendingInvite || !inviteEmail.trim()}
            className="btn-filled min-h-[44px] w-full"
          >
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            {sendingInvite ? text("sendingInvite") : text("sendInvite")}
          </button>
        }
        testId="onboarding-account-invite"
      >
        <form
          id="onboarding-account-invite-form"
          onSubmit={sendInvite}
          className="space-y-4"
        >
          {inviteError && (
            <p
              role="alert"
              className="rounded-xl bg-[var(--danger-tint)] px-4 py-3 text-sm text-danger-text"
            >
              {inviteError}
            </p>
          )}
          <div>
            <label htmlFor="onboarding-invite-email" className="label-apple">
              {text("emailLabel")}
            </label>
            <input
              id="onboarding-invite-email"
              type="email"
              required
              autoComplete="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={text("emailPlaceholder")}
              className="input-apple"
              disabled={sendingInvite}
            />
          </div>
          <div>
            <label htmlFor="onboarding-invite-role" className="label-apple">
              {text("roleLabel")}
            </label>
            <select
              id="onboarding-invite-role"
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as InviteRole)
              }
              className="input-apple"
              disabled={sendingInvite}
            >
              <option value="child">{text("roleChild")}</option>
              <option value="teen">{text("roleTeen")}</option>
              <option value="parent">{text("roleParent")}</option>
            </select>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
