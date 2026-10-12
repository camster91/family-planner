"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { canonicalBodySignature } from "@/lib/request-signature";
import {
  isHouseholdProfile,
  readApiErrorCode,
  readHouseholdProfiles,
  type HouseholdProfile,
  type HouseholdProfileRole,
} from "@/lib/household-profile-types";
import { useProfileSetupText } from "@/i18n/profile-setup";

type LoadState = "idle" | "loading" | "ready" | "unsupported" | "error";
type ProfileSetupPanelProps = {
  onProfilesChanged?: () => void | Promise<void>;
};

function roleLabel(role: HouseholdProfileRole, text: ReturnType<typeof useProfileSetupText>) {
  return text(role === "child" ? "roleChild" : role === "teen" ? "roleTeen" : "roleParent");
}

function responseErrorCode(value: unknown): string | null {
  return readApiErrorCode(value);
}

export function ProfileSetupPanel({ onProfilesChanged }: ProfileSetupPanelProps = {}) {
  const text = useProfileSetupText();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [profiles, setProfiles] = useState<HouseholdProfile[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<HouseholdProfileRole>("child");
  const [age, setAge] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePendingFormNavigationController(saving);
  const idempotencyKey = useRef<{ key: string; signature: string } | null>(null);
  const ambiguousKeys = useRef(new Map<string, string>());

  async function loadProfiles() {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/family/profiles", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setState(response.status === 409 && responseErrorCode(payload) === "PROFILE_SETUP_UNSUPPORTED" ? "unsupported" : "error");
        if (response.status !== 409) setError(text("loadError"));
        return;
      }
      const nextProfiles = readHouseholdProfiles(payload);
      if (!nextProfiles) {
        setState("error");
        setError(text("invalidResponse"));
        return;
      }
      setProfiles(nextProfiles);
      setState("ready");
    } catch {
      setState("error");
      setError(text("loadError"));
    }
  }

  function openPanel() {
    setOpen(true);
    setNotice(null);
    if (state === "idle") void loadProfiles();
  }

  function closePanel() {
    if (!saving) setOpen(false);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const parsedAge = age.trim() ? Number(age) : null;
    const body = {
      name: trimmedName,
      role,
      ...(parsedAge === null ? {} : { age: parsedAge }),
    };
    const signature = canonicalBodySignature(body);
    const key =
      idempotencyKey.current?.signature === signature
        ? idempotencyKey.current.key
        : ambiguousKeys.current.get(signature) ?? newIdempotencyKey();
    idempotencyKey.current = { key, signature };
    try {
      const response = await fetch("/api/family/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409 && responseErrorCode(payload) === "PROFILE_SETUP_UNSUPPORTED") {
          setState("unsupported");
          ambiguousKeys.current.delete(signature);
          idempotencyKey.current = null;
        } else {
          if (response.status >= 500) ambiguousKeys.current.set(signature, key);
          setError(response.status >= 500 ? text("networkError") : text("saveError"));
        }
        return;
      }
      const profile = payload && typeof payload === "object" ? (payload as { profile?: unknown }).profile : undefined;
      if (!isHouseholdProfile(profile)) {
        ambiguousKeys.current.set(signature, key);
        setError(text("invalidResponse"));
        return;
      }
      setProfiles((current) => [...current, profile]);
      setName("");
      setAge("");
      ambiguousKeys.current.delete(signature);
      idempotencyKey.current = null;
      setNotice(text("profileSaved"));
      // The profile write is committed. Release the mutation guard before a
      // best-effort roster read so a slow or unavailable read cannot make the
      // saved form appear stuck. The parent owns any stale-refresh message.
      void Promise.resolve()
        .then(() => onProfilesChanged?.())
        .catch(() => undefined);
    } catch {
      ambiguousKeys.current.set(signature, key);
      setError(text("networkError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-expanded={open}
        className="btn-tinted inline-flex min-h-[44px] items-center justify-center px-5 py-3"
      >
        <UserPlus className="mr-2 h-5 w-5" aria-hidden="true" />
        {text("addWithoutEmail")}
      </button>
      <Dialog
        open={open}
        onClose={closePanel}
        title={text("profileSetupTitle")}
        description={text("profileSetupDescription")}
        closeLabel={text("close")}
        variant="form"
        testId="profile-setup-dialog"
      >
        {state === "loading" && <p role="status" className="text-body text-label-secondary">{text("loadingProfiles")}</p>}
        {state === "unsupported" && (
          <div className="space-y-4" role="status">
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-fill)] p-4">
              <h3 className="text-body font-semibold text-label-primary">{text("unsupportedTitle")}</h3>
              <p className="mt-1 text-body text-label-secondary">{text("unsupportedDescription")}</p>
            </div>
            <Link href="/dashboard/family/invite" className="btn-filled inline-flex min-h-[44px] items-center justify-center w-full">
              {text("inviteInstead")}
            </Link>
          </div>
        )}
        {state === "error" && (
          <div className="space-y-4" role="alert">
            <p className="text-body text-[var(--danger-text)]">{error ?? text("loadError")}</p>
            <button type="button" onClick={() => void loadProfiles()} className="btn-secondary min-h-[44px] w-full">
              {text("retry")}
            </button>
          </div>
        )}
        {state === "ready" && (
          <div className="space-y-5">
            <section aria-labelledby="profile-setup-saved" className="space-y-2">
              <h3 id="profile-setup-saved" className="text-body font-semibold text-label-primary">{text("savedProfiles")}</h3>
              {profiles.length === 0 ? (
                <p className="text-body text-label-secondary">{text("noProfiles")}</p>
              ) : (
                <ul className="space-y-2">
                  {profiles.map((profile) => (
                    <li key={profile.id} className="rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-body text-label-primary">
                      <span className="font-medium">{profile.name}</span>
                      <span className="ml-2 text-label-secondary">{roleLabel(profile.role, text)}</span>
                      {profile.archived_at && <span className="ml-2 text-label-tertiary">({text("archivedProfile")})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <form onSubmit={saveProfile} className="space-y-4" aria-label={text("addAnother")}>
              <div>
                <label htmlFor="profile-name" className="label-apple">{text("nameLabel")}</label>
                <input id="profile-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder={text("namePlaceholder")} className="input-apple" required disabled={saving} />
              </div>
              <div>
                <label htmlFor="profile-role" className="label-apple">{text("roleLabel")}</label>
                <select id="profile-role" value={role} onChange={(event) => setRole(event.target.value as HouseholdProfileRole)} className="input-apple" disabled={saving}>
                  <option value="child">{text("roleChild")}</option>
                  <option value="teen">{text("roleTeen")}</option>
                  <option value="parent">{text("roleParent")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="profile-age" className="label-apple">{text("ageLabel")}</label>
                <input id="profile-age" type="number" min={role === "parent" ? 18 : role === "teen" ? 13 : 0} max={role === "parent" ? 120 : 17} value={age} onChange={(event) => setAge(event.target.value)} className="input-apple" disabled={saving} />
              </div>
              {error && <p role="alert" className="text-body text-[var(--danger-text)]">{error}</p>}
              {notice && <p role="status" className="text-body text-success-text">{notice}</p>}
              <button type="submit" disabled={saving || !name.trim()} className="btn-filled min-h-[44px] w-full">
                {saving ? text("savingProfile") : text("saveProfile")}
              </button>
            </form>
          </div>
        )}
      </Dialog>
    </>
  );
}
