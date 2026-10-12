"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  checkMemberProtocol,
  readApiCapabilities,
} from "@/lib/api-capabilities";
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
  const [inviteError, setInviteError] = useState("");
  usePendingFormNavigationController(loading || sendingInvite);

  const loadProfileAvailability = useCallback(async () => {
    setProfileAvailability("checking");
    try {
      const capabilities = await readApiCapabilities();
      if (!checkMemberProtocol(capabilities, 2).supported) {
        setProfileAvailability("unavailable");
        return;
      }

      // Protocol metadata is necessary but not sufficient. The parent-scoped
      // list must also succeed before this UI offers a profile write.
      const response = await fetch("/api/family/profiles", {
        cache: "no-store",
      });
      if (!response.ok) {
        setProfileAvailability("unavailable");
        return;
      }
      const payload: unknown = await response.json();
      const profiles = readHouseholdProfiles(payload);
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
    try {
      const memberResponse = await fetch("/api/family/members", {
        cache: "no-store",
      });
      if (memberResponse.ok) {
        const payload: unknown = await memberResponse.json();
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
              typeof (member as Member).id === "string",
          )
        ) {
          setMemberCount(members.length);
        }
      }
      if (profileAvailability !== "available") return;
      const profileResponse = await fetch("/api/family/profiles", {
        cache: "no-store",
      });
      if (!profileResponse.ok) return;
      const profiles = readHouseholdProfiles(await profileResponse.json());
      if (profiles)
        setProfileCount(
          profiles.filter((profile) => !profile.archived_at).length,
        );
    } catch {
      // Keep the current count rather than showing a false empty roster.
    }
  }, [profileAvailability]);

  useEffect(() => {
    if (step !== 3) return;
    void loadProfileAvailability();
  }, [loadProfileAvailability, step]);

  async function reconcileFamily(): Promise<boolean> {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const payload: unknown = await response.json();
      const user =
        payload && typeof payload === "object"
          ? (payload as { user?: { family_id?: unknown } }).user
          : null;
      if (
        response.ok &&
        user &&
        typeof user.family_id === "string" &&
        user.family_id
      ) {
        setNotice(text("reconcileFound"));
        setStep(3);
        setMemberCount(1);
        return true;
      }
    } catch {
      // Keep the original draft and show the honest unknown state below.
    }
    return false;
  }

  async function createFamily() {
    if (loading) return;
    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setError(text("createError"));
      return;
    }
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
        setError(readError(data, text("createError")));
        return;
      }
      const family =
        data && typeof data === "object"
          ? (data as { family?: unknown }).family
          : null;
      if (!family || typeof family !== "object") {
        setError(text("invalidResponse"));
        return;
      }
      setMemberCount(1);
      setStep(3);
    } catch {
      if (await reconcileFamily()) return;
      setError(text("reconcileUnknown"));
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || sendingInvite) return;
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
      setInviteEmail("");
      setInviteOpen(false);
      setNotice(text("inviteSent"));
      await refreshRoster();
    } catch {
      // Invite sends have an external mail side effect. Do not blindly retry;
      // retain the email and let the parent choose whether to try again.
      setInviteError(text("inviteError"));
    } finally {
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
        aria-label="Onboarding progress"
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
                if (event.key === "Enter") void createFamily();
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
                className="font-medium text-primary hover:underline"
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
            <section className="rounded-2xl border border-[var(--separator)] bg-card p-5">
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

            <section className="rounded-2xl border border-[var(--separator)] bg-card p-5">
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
        testId="onboarding-account-invite"
      >
        <form onSubmit={sendInvite} className="space-y-4">
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
          <button
            type="submit"
            disabled={sendingInvite || !inviteEmail.trim()}
            className="btn-filled min-h-[44px] w-full"
          >
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            {sendingInvite ? text("sendingInvite") : text("sendInvite")}
          </button>
        </form>
      </Dialog>
    </div>
  );
}
