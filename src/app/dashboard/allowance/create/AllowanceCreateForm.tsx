"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { allowanceCreateMessages } from "@/i18n/allowance-create";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { usePendingFormNavigationGuard } from "@/components/layout/pending-form-navigation";

interface AllowanceMember {
  id: string;
  name: string;
  avatar_url?: string | null;
}

type MemberRosterState = {
  status: "loading" | "ready" | "error";
  members: AllowanceMember[];
  error: string | null;
};

function readMemberRoster(value: unknown): AllowanceMember[] | null {
  if (!value || typeof value !== "object") return null;
  const members = (value as { members?: unknown }).members;
  if (!Array.isArray(members)) return null;
  const parsed = members.filter((member): member is AllowanceMember => {
    if (!member || typeof member !== "object") return false;
    const row = member as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      row.id.length > 0 &&
      typeof row.name === "string" &&
      row.name.trim().length > 0 &&
      (row.avatar_url === undefined ||
        row.avatar_url === null ||
        typeof row.avatar_url === "string")
    );
  });
  return parsed.length === members.length ? parsed : null;
}

type AllowanceCreateError = "permissionError" | "createError";

type AllowanceCreatePayload = {
  to_user_id: string;
  amount: number;
  reason: string | null;
};

type AllowanceIntent = {
  fingerprint: string;
  key: string;
};

class CreateAllowanceFailure extends Error {
  constructor(readonly messageKey: AllowanceCreateError) {
    super(messageKey);
  }
}

export default function AllowanceCreateForm({
  inSheet = false,
  onBusyChange,
  canCreate = true,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
} = {}) {
  const router = useRouter();
  const formId = useId();
  const { locale } = useTranslation();
  const copy = allowanceCreateMessages[locale];
  const [memberRoster, setMemberRoster] = useState<MemberRosterState>({
    status: "loading",
    members: [],
    error: null,
  });
  const [draft, setDraft] = useState({
    to_user_id: "",
    amount: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  // Keep one key for one canonical intent. A response can be lost after the
  // server commits, so the next submit with the same draft must replay the
  // same request. Editing the draft changes the fingerprint and therefore
  // starts a new intent with a new key.
  const intentRef = useRef<AllowanceIntent | null>(null);

  const loadMembers = useCallback(async () => {
    setMemberRoster((current) => ({
      ...current,
      status: "loading",
      error: null,
    }));
    try {
      const response = await fetch("/api/family/members", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("member roster load failed");
      const payload: unknown = await response.json();
      const members = readMemberRoster(payload);
      if (!members) throw new Error("member roster response was invalid");
      setMemberRoster({ status: "ready", members, error: null });
    } catch {
      setMemberRoster((current) => ({
        ...current,
        status: "error",
        error: copy.rosterError,
      }));
    }
  }, [copy.rosterError]);

  useEffect(() => {
    if (canCreate) void loadMembers();
  }, [canCreate, loadMembers]);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [onBusyChange, saving]);
  usePendingFormNavigationGuard(saving);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number.parseFloat(draft.amount);
    const payload: AllowanceCreatePayload = {
      to_user_id: draft.to_user_id,
      amount,
      reason: draft.reason.trim() || null,
    };
    if (
      !payload.to_user_id ||
      Number.isNaN(amount) ||
      amount <= 0 ||
      memberRoster.status !== "ready" ||
      memberRoster.members.length === 0 ||
      submittingRef.current
    ) {
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    const fingerprint = JSON.stringify(payload);
    if (intentRef.current?.fingerprint !== fingerprint) {
      intentRef.current = { fingerprint, key: newIdempotencyKey() };
    }
    const idempotencyKey = intentRef.current.key;

    try {
      const response = await fetch("/api/allowance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        // A malformed 2xx response is a retryable failure. Keep the intent
        // and its key so a retry can recover a committed allowance safely.
      }
      const allowanceId =
        responseBody && typeof responseBody === "object"
          ? (responseBody as { allowance?: { id?: unknown } }).allowance?.id
          : undefined;
      if (
        !response.ok ||
        typeof allowanceId !== "string" ||
        allowanceId.trim().length === 0
      ) {
        throw new CreateAllowanceFailure(
          response.status === 403 ? "permissionError" : "createError",
        );
      }

      router.push("/dashboard/allowance");
      router.refresh();
    } catch (cause) {
      submittingRef.current = false;
      // Do not display arbitrary API text; the API still enforces the role and
      // family checks while the form provides stable localized feedback.
      setMemberRoster((current) => ({ ...current, error: null }));
      setSaveError(
        cause instanceof CreateAllowanceFailure
          ? copy[cause.messageKey]
          : cause instanceof TypeError
            ? copy.networkError
            : copy.createError,
      );
    } finally {
      setSaving(false);
    }
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  if (!canCreate) {
    return (
      <div
        className="max-w-lg mx-auto px-4 py-12 text-center"
        data-testid="allowance-create-refused"
      >
        <h1 className="text-title-2 font-display text-label-primary">
          {copy.refusalTitle}
        </h1>
        <p className="text-body text-label-secondary mt-2">
          {copy.refusalDescription}
        </p>
        <Link
          href="/dashboard/allowance"
          className="btn-tinted inline-flex mt-6 min-h-[44px] items-center justify-center px-5"
        >
          {copy.back}
        </Link>
      </div>
    );
  }

  const memberSelectId = `${formId}-for`;
  const amountId = `${formId}-amount`;
  const reasonId = `${formId}-reason`;
  const canSubmit =
    !saving &&
    memberRoster.status === "ready" &&
    memberRoster.members.length > 0 &&
    !!draft.to_user_id &&
    Number.parseFloat(draft.amount) > 0;

  return (
    <div
      className={inSheet ? "space-y-5" : "max-w-lg mx-auto space-y-6 pb-20"}
      data-testid="allowance-create-form"
    >
      {!inSheet && (
        <>
          <div className="px-4 pt-4">
            {saving ? (
              <span
                aria-disabled="true"
                data-testid="allowance-create-back-busy"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-tertiary"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {copy.back}
              </span>
            ) : (
              <Link
                href="/dashboard/allowance"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-secondary hover:text-label-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {copy.back}
              </Link>
            )}
          </div>
          <div className="px-4">
            <div className="flex items-center gap-2">
              <div className="glyph bg-tint-budget" aria-hidden="true">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-label-primary">
                {copy.title}
              </h1>
            </div>
            <p className="text-subhead text-label-secondary mt-1">
              {copy.subtitle}
            </p>
          </div>
        </>
      )}

      <form
        onSubmit={handleSubmit}
        className={inSheet ? "space-y-5" : "space-y-5 px-4"}
      >
        {saveError && (
          <div
            role="alert"
            className="rounded-xl bg-[var(--danger-tint)] border border-[var(--danger-tint)] p-4 text-danger-text text-sm"
          >
            {saveError}
          </div>
        )}

        <div>
          <label htmlFor={memberSelectId} className="label-apple">
            {copy.forLabel}
          </label>
          {memberRoster.status === "loading" && (
            <p role="status" className="text-footnote text-label-secondary">
              {copy.loadingMembers}
            </p>
          )}
          {memberRoster.status === "error" && (
            <div
              role="alert"
              className="space-y-2 rounded-[var(--radius-md)] bg-[var(--danger-tint)] p-3 text-sm text-danger-text"
            >
              <p>{memberRoster.error}</p>
              <button
                type="button"
                onClick={() => void loadMembers()}
                className="btn-secondary min-h-[44px]"
              >
                {copy.tryAgain}
              </button>
            </div>
          )}
          {memberRoster.status === "ready" &&
            memberRoster.members.length === 0 && (
              <p role="status" className="text-footnote text-label-secondary">
                {copy.noMembers}
              </p>
            )}
          <select
            id={memberSelectId}
            value={draft.to_user_id}
            onChange={(event) => {
              setSaveError(null);
              setDraft((current) => ({
                ...current,
                to_user_id: event.target.value,
              }));
            }}
            className="input-apple min-h-[44px]"
            disabled={
              saving ||
              memberRoster.status !== "ready" ||
              memberRoster.members.length === 0
            }
          >
            <option value="">{copy.memberPlaceholder}</option>
            {memberRoster.status === "ready" &&
              memberRoster.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor={amountId} className="label-apple">
            {copy.amount}
          </label>
          <input
            id={amountId}
            type="number"
            step="0.01"
            min="0"
            value={draft.amount}
            onChange={(event) => {
              setSaveError(null);
              setDraft((current) => ({
                ...current,
                amount: event.target.value,
              }));
            }}
            placeholder={copy.amountPlaceholder}
            className="input-apple min-h-[44px]"
            disabled={saving}
          />
        </div>

        <div>
          <label htmlFor={reasonId} className="label-apple">
            {copy.reason}
          </label>
          <input
            id={reasonId}
            type="text"
            value={draft.reason}
            onChange={(event) => {
              setSaveError(null);
              setDraft((current) => ({
                ...current,
                reason: event.target.value,
              }));
            }}
            placeholder={copy.reasonPlaceholder}
            className="input-apple min-h-[44px]"
            disabled={saving}
          />
        </div>

        <div
          className={
            inSheet
              ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-4 pb-1"
              : "flex gap-2 justify-end pt-4"
          }
        >
          <button
            type="button"
            onClick={() =>
              inSheet ? router.back() : router.push("/dashboard/allowance")
            }
            disabled={saving}
            className="btn-plain min-h-[44px]"
          >
            {copy.cancel}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={saving}
            className="btn-filled min-h-[44px]"
          >
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </form>
    </div>
  );
}
