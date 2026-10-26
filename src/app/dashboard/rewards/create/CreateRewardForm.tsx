"use client";

import { requestOwnedJson } from "@/lib/owned-request-http";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { rewardCreateMessages, type RewardCreateMessage } from "@/i18n/reward-create";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  forgetLatestRewardCreateDraft,
  forgetRewardCreateIntent,
  latestRewardCreateDraft,
  rememberRewardCreateDraft,
  rememberRewardCreateIntent,
  rewardCreateIntent,
  rewardCreateOwnerKey,
  rewardCreateSignature,
  rewardCreateWithinRetryWindow,
  rewardCreateStorageHeld,
  type RewardCreateIntent,
  type RewardCreateDraft,
  type RewardCreateOwner,
} from "@/lib/reward-create-intent";
import {
  usePendingFormNavigation,
  usePendingFormNavigationController,
} from "@/components/layout/pending-form-navigation";

const ICON_OPTIONS = [
  "🎁",
  "🎮",
  "🍕",
  "🍦",
  "🎬",
  "📚",
  "⏰",
  "💰",
  "🏆",
  "⭐",
] as const;

type RewardCreateError = "permissionError" | "createError";

type CreatePayload = {
  name: string;
  description?: string;
  cost: number;
  icon: string;
};

function isCreatedReward(
  value: unknown,
  payload: CreatePayload,
  owner?: RewardCreateOwner,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reward = (value as { reward?: unknown }).reward;
  if (!reward || typeof reward !== "object" || Array.isArray(reward)) return false;
  const row = reward as {
    id?: unknown;
    name?: unknown;
    cost?: unknown;
    icon?: unknown;
    status?: unknown;
    family_id?: unknown;
    created_by?: unknown;
  };
  const ownerMatches =
    !owner || (
      row.family_id !== undefined && row.family_id !== null && row.family_id === owner.familyId &&
      row.created_by !== undefined && row.created_by !== null && row.created_by === owner.userId
    );
  return typeof row.id === "string" && row.id.length > 0 &&
    row.name === payload.name && row.cost === payload.cost &&
    row.icon === payload.icon && row.status === "available" && ownerMatches;
}

class CreateRewardFailure extends Error {
  constructor(readonly messageKey: RewardCreateError) {
    super(messageKey);
  }
}

type CreateRewardFormProps = {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
  owner?: RewardCreateOwner;
};

/**
 * Keep each household's draft state in its own mounted boundary. The key is
 * deterministic on both server and client; the browser-only draft cache is
 * hydrated in an effect inside the keyed form below.
 */
export default function CreateRewardForm(props: CreateRewardFormProps = {}) {
  return <CreateRewardFormInner key={JSON.stringify([rewardCreateOwnerKey(props.owner), props.canCreate ?? true])} {...props} />;
}

function CreateRewardFormInner({
  inSheet = false,
  onBusyChange,
  canCreate = true,
  owner,
}: CreateRewardFormProps) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = rewardCreateMessages[locale];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState(50);
  const [icon, setIcon] = useState<(typeof ICON_OPTIONS)[number]>(
    "🎁",
  );
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RewardCreateMessage | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const submittingRef = useRef(false);
  const requestKeys = useRef(new Map<string, RewardCreateIntent>());
  const uncertainRequests = useRef(new Set<string>());
  const [recoveryIntent, setRecoveryIntent] = useState<RewardCreateIntent | null>(null);
  const [accessHeld, setAccessHeld] = useState(false);
  const [storageHeld, setStorageHeld] = useState(false);
  const live = useRef(true);
  const workEpoch = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; workEpoch.current++; activeRequest.current?.abort(); submittingRef.current = false; };
  }, []);
  const confirmedRequests = useRef(new Set<string>());
  const ownerUserId = owner?.userId;
  const ownerFamilyId = owner?.familyId;
  const scopedOwner = useMemo(
    () => ownerUserId && ownerFamilyId ? { userId: ownerUserId, familyId: ownerFamilyId } : undefined,
    [ownerUserId, ownerFamilyId],
  );
  const directNavigation = usePendingFormNavigationController(
    loading && !inSheet,
  );
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  useEffect(() => {
    // This effect is intentionally the first browser read. Rendering always
    // starts from the same defaults as SSR, so a cached private draft cannot
    // change the server/client HTML during hydration.
    const draft = latestRewardCreateDraft(scopedOwner);
    if (draft) {
      setName(draft.name);
      setDescription(draft.description);
      setCost(draft.cost);
      setIcon((draft.icon as (typeof ICON_OPTIONS)[number]) || "🎁");
      const pending = rewardCreateIntent(scopedOwner, rewardCreateSignature(draft));
      if (pending) {
        requestKeys.current.set(rewardCreateSignature(draft), pending);
        uncertainRequests.current.add(rewardCreateSignature(draft));
        setRecoveryIntent(pending); setUncertain(true);
        setError(rewardCreateWithinRetryWindow(pending) ? "recoveryTitle" : "retryAgeHold");
      }
    }
    setStorageHeld(rewardCreateStorageHeld(scopedOwner));
    setHydrated(true);
  }, [scopedOwner]);

  useEffect(() => {
    if (!hydrated) return;
    // This write is fenced behind post-mount hydration. It cannot write the
    // previous owner's state into the new owner's scope during a key switch.
    rememberRewardCreateDraft(scopedOwner, { name, description, cost, icon });
  }, [hydrated, scopedOwner, name, description, cost, icon]);

  const submit = async (retry?: RewardCreateIntent) => {
    if (!live.current || !canCreate || accessHeld || submittingRef.current) return;
    if (rewardCreateStorageHeld(scopedOwner)) { setStorageHeld(true); return; }
    const draft: RewardCreateDraft = retry?.draft ?? { name: name.trim(), description: description.trim(), cost, icon };
    if (!draft.name.trim()) return;
    const signature = rewardCreateSignature(draft);
    if (confirmedRequests.current.has(signature)) {
      router.push("/dashboard/rewards"); router.refresh(); return;
    }
    const stored = rewardCreateIntent(scopedOwner, signature);
    const remembered = requestKeys.current.get(signature);
    let intent = retry ?? remembered ?? stored;
    if (intent && [remembered, stored].some(candidate => candidate && candidate.key !== intent!.key)) {
      setRecoveryIntent(intent); setUncertain(true); setError("recoveryHold"); return;
    }
    if (!intent) {
      try { intent = { key: newIdempotencyKey(), draft: { ...draft }, issuedAt: Date.now() }; }
      catch { setError("createError"); return; }
    }
    if (!rewardCreateWithinRetryWindow(intent)) {
      setRecoveryIntent(intent); setUncertain(true); setError("retryAgeHold"); return;
    }
    const original = intent;
    const persisted = rememberRewardCreateIntent(scopedOwner, signature, original.draft, original.key, original.issuedAt as number);
    if (scopedOwner && !persisted) {
      setRecoveryIntent(original); setUncertain(Boolean(stored || remembered));
      setError(stored || remembered ? "recoveryHold" : "capacityError"); return;
    }
    requestKeys.current.set(signature, original);
    const payload: CreatePayload = { name: original.draft.name.trim(), description: original.draft.description.trim() || undefined,
      cost: original.draft.cost, icon: original.draft.icon };
    submittingRef.current = true;
    const epoch = ++workEpoch.current;
    const current = () => live.current && epoch === workEpoch.current;
    const controller = new AbortController(); activeRequest.current = controller;
    const retain = (message: RewardCreateMessage) => {
      uncertainRequests.current.add(signature); setRecoveryIntent(original); setUncertain(true); setError(message);
    };
    setLoading(true); setError(null); setUncertain(false); setConfirmed(false);
    try {
      const result = await requestOwnedJson("/api/rewards", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: original.key }, body: JSON.stringify(payload),
      }, 256 * 1024);
      if (!current()) return;
      if (result.kind !== "reply") { retain("networkError"); return; }
      const { response, body: data } = result;
      const code = data && typeof data === "object" ? (data as { code?: unknown }).code : null;
      if ([401, 403].includes(response.status) || code === "REWARD_ACCESS_CHANGED" || code === "REWARD_ACCESS_UNCONFIRMED") setAccessHeld(true);
      if (!response.ok) {
        const ambiguous = response.status >= 500 || [401, 403, 408, 409, 425, 429].includes(response.status)
          || code === "REWARD_ACCESS_CHANGED" || code === "REWARD_ACCESS_UNCONFIRMED"
          || uncertainRequests.current.has(signature) || Boolean(stored || remembered || retry);
        if (ambiguous) retain(response.status === 403 ? "permissionError" : "createError");
        else { requestKeys.current.delete(signature); forgetRewardCreateIntent(scopedOwner, signature); setRecoveryIntent(null); }
        throw new CreateRewardFailure(response.status === 403 ? "permissionError" : "createError");
      }
      if (!isCreatedReward(data, payload, scopedOwner)) { retain("recoveryTitle"); return; }
      confirmedRequests.current.add(signature); uncertainRequests.current.delete(signature);
      requestKeys.current.delete(signature); forgetRewardCreateIntent(scopedOwner, signature);
      forgetLatestRewardCreateDraft(scopedOwner, signature); setRecoveryIntent(null);
      const allowed = await navigation?.releaseBeforeNavigation();
      if (!current()) return;
      if (allowed === false) { setConfirmed(true); return; }
      router.push("/dashboard/rewards"); router.refresh();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof CreateRewardFailure) setError(cause.messageKey);
      else retain("networkError");
    } finally {
      if (current()) { activeRequest.current = null; submittingRef.current = false; setLoading(false); }
    }
  };

  const checkRewards = async () => {
    if (!live.current || submittingRef.current) return;
    const epoch = workEpoch.current;
    const allowed = await navigation?.releaseBeforeNavigation();
    if (!live.current || epoch !== workEpoch.current || allowed === false) return;
    router.push("/dashboard/rewards"); router.refresh();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submit();
  };

  if (storageHeld) return <div role="alert" className="card-apple p-5 space-y-3">
    <p>{copy.storageHold}</p><button type="button" onClick={() => void checkRewards()} className="btn-tinted inline-flex min-h-[44px] items-center">{copy.checkRewards}</button>
  </div>;

  if (accessHeld) return <div role="alert" className="card-apple p-5 space-y-3">
    <p>{copy.accessHold}</p><button type="button" onClick={() => void checkRewards()} className="btn-tinted inline-flex min-h-[44px] items-center">{copy.checkRewards}</button>
  </div>;

  if (!canCreate) {
    return (
      <div
        className="max-w-lg mx-auto px-4 py-12 text-center"
        data-testid="reward-create-refused"
      >
        <h1 className="text-title-2 font-display text-label-primary">
          {copy.refusalTitle}
        </h1>
        <p className="text-body text-label-secondary mt-2">
          {copy.refusalDescription}
        </p>
        <Link
          href="/dashboard/rewards"
          className="btn-tinted inline-flex mt-6 min-h-[44px] items-center justify-center px-5"
        >
          {copy.back}
        </Link>
      </div>
    );
  }

  return (
    <div
      className={inSheet ? "space-y-5" : "max-w-lg mx-auto space-y-6 pb-20"}
      data-testid="reward-create-form"
    >
      {!inSheet && (
        <>
          <div className="px-4 pt-4">
            {loading ? (
              <span
                aria-disabled="true"
                data-testid="reward-create-back-busy"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-secondary"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {copy.back}
              </span>
            ) : (
              <Link
                href="/dashboard/rewards"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-secondary hover:text-label-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {copy.back}
              </Link>
            )}
          </div>
          <div className="px-4">
            <h1 className="text-2xl font-bold text-label-primary">
              {copy.title}
            </h1>
            <p className="text-subhead text-label-secondary mt-1">
              {copy.subtitle}
            </p>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 px-4">
        {confirmed && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-[var(--success-tint)] bg-[var(--success-tint)]/40 p-4 text-success-text text-sm"
          >
            <p>{copy.confirmedTitle}</p>
            <p className="mt-1 text-label-secondary">{copy.confirmedDescription}</p>
            <button
              type="button"
              className="btn-plain mt-3 min-h-[44px]"
              onClick={() => void checkRewards()}
            >
              {copy.checkRewards}
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[var(--danger-tint)] border border-[var(--danger-tint)] p-4 text-danger-text text-sm"
          >
            <p>{copy[error]}</p>
            {uncertain && (
              <>
                <p className="mt-1">{copy.recoveryDescription}</p>
                {recoveryIntent && <p className="mt-1 [overflow-wrap:anywhere]">{copy.recoveryName.replace("{name}", recoveryIntent.draft.name)}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-plain min-h-[44px]" onClick={() => void submit(recoveryIntent ?? undefined)} disabled={loading || !recoveryIntent || !rewardCreateWithinRetryWindow(recoveryIntent)}>
                    {copy.tryAgain}
                  </button>
                  <button type="button" className="btn-plain min-h-[44px]" onClick={() => void checkRewards()} disabled={loading}>
                    {copy.checkRewards}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <fieldset disabled={loading} aria-busy={loading} className="space-y-5">
        <div className="space-y-1.5">
          <label
            htmlFor="reward-name"
            className="text-subhead text-label-secondary"
          >
            {copy.name}
          </label>
          <input
            id="reward-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
            placeholder={copy.namePlaceholder}
            className="input-apple"
            autoFocus={!inSheet}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="reward-description"
            className="text-subhead text-label-secondary"
          >
            {copy.description}{" "}
            <span className="text-label-tertiary">{copy.optional}</span>
          </label>
          <textarea
            id="reward-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder={copy.descriptionPlaceholder}
            className="input-apple resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="reward-cost"
            className="text-subhead text-label-secondary"
          >
            {copy.cost}
          </label>
          <div className="flex items-center gap-3">
            <input
              id="reward-cost"
              type="number"
              value={cost}
              onChange={(event) =>
                setCost(
                  Math.max(1, Number.parseInt(event.target.value, 10) || 0),
                )
              }
              min={1}
              max={100000}
              required
              className="input-apple w-28"
            />
            <span className="text-subhead text-label-secondary">
              {copy.points}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <p
            id="reward-icon-label"
            className="text-subhead text-label-secondary"
          >
            {copy.icon}
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-labelledby="reward-icon-label"
          >
            {ICON_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                aria-label={copy.iconOption.replace("{icon}", emoji)}
                aria-pressed={icon === emoji}
                title={copy.iconOption.replace("{icon}", emoji)}
                className={`h-11 w-11 rounded-xl text-xl flex items-center justify-center transition-all duration-150 ${
                  icon === emoji
                    ? "bg-tint-rewards text-white ring-2 ring-tint-rewards ring-offset-1"
                    : "bg-surface-fill text-label-secondary hover:bg-surface-fill-secondary"
                }`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
        </div>
        </fieldset>

        <div
          className={
            inSheet
              ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-4 pb-1"
              : "pt-4"
          }
        >
          <button
            type="submit"
            disabled={loading || !name.trim()}
            aria-busy={loading}
            className="btn-tinted bg-tint-rewards text-white w-full min-h-[44px] py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? copy.creating : copy.create}
          </button>
        </div>
      </form>
    </div>
  );
}
