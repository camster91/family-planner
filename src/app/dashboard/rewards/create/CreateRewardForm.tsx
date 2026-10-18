"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { rewardCreateMessages } from "@/i18n/reward-create";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  latestRewardCreateDraft,
  forgetRewardCreateIntent,
  rememberRewardCreateDraft,
  rememberRewardCreateIntent,
  rewardCreateIntent,
  rewardCreateSignature,
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

function isCreatedReward(value: unknown, payload: CreatePayload): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reward = (value as { reward?: unknown }).reward;
  if (!reward || typeof reward !== "object" || Array.isArray(reward)) return false;
  const row = reward as { id?: unknown; name?: unknown; cost?: unknown; icon?: unknown; status?: unknown };
  return typeof row.id === "string" && row.id.length > 0 &&
    row.name === payload.name && row.cost === payload.cost &&
    row.icon === payload.icon && row.status === "available";
}

class CreateRewardFailure extends Error {
  constructor(readonly messageKey: RewardCreateError) {
    super(messageKey);
  }
}

export default function CreateRewardForm({
  inSheet = false,
  onBusyChange,
  canCreate = true,
  owner,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
  owner?: RewardCreateOwner;
} = {}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = rewardCreateMessages[locale];
  const [initialDraft] = useState<RewardCreateDraft | null>(() => latestRewardCreateDraft(owner));
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [cost, setCost] = useState(initialDraft?.cost ?? 50);
  const [icon, setIcon] = useState<(typeof ICON_OPTIONS)[number]>(
    (initialDraft?.icon as (typeof ICON_OPTIONS)[number] | undefined) ?? "🎁",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const submittingRef = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const confirmedRequests = useRef(new Set<string>());
  const directNavigation = usePendingFormNavigationController(
    loading && !inSheet,
  );
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  useEffect(() => {
    rememberRewardCreateDraft(owner, { name, description, cost, icon });
  }, [owner, name, description, cost, icon]);

  const submit = async () => {
    if (!name.trim() || submittingRef.current) return;

    const draft: RewardCreateDraft = {
      name: name.trim(),
      description: description.trim(),
      cost,
      icon,
    };
    const payload: CreatePayload = {
      ...draft,
      description: draft.description || undefined,
    };
    const signature = rewardCreateSignature(draft);
    if (confirmedRequests.current.has(signature)) {
      router.push("/dashboard/rewards");
      router.refresh();
      return;
    }
    const storedIntent = rewardCreateIntent(owner, signature);
    const key = requestKeys.current.get(signature) ?? storedIntent?.key ?? newIdempotencyKey();
    requestKeys.current.set(signature, key);
    rememberRewardCreateIntent(owner, signature, draft, key);

    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setUncertain(false);
    setConfirmed(false);

    try {
      const response = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const ambiguous = response.status >= 500 || response.status === 409;
        if (ambiguous) setUncertain(true);
        else {
          requestKeys.current.delete(signature);
          forgetRewardCreateIntent(owner, signature);
        }
        throw new CreateRewardFailure(
          response.status === 403 ? "permissionError" : "createError",
        );
      }
      if (!isCreatedReward(data, payload)) {
        submittingRef.current = false;
        setUncertain(true);
        setError(copy.recoveryTitle);
        return;
      }
      confirmedRequests.current.add(signature);
      requestKeys.current.delete(signature);
      forgetRewardCreateIntent(owner, signature);

      if ((await navigation?.releaseBeforeNavigation()) === false) {
        // A pending-navigation guard can keep the user on this form. Allow a
        // GET-only return to the rewards shelf after the create is confirmed.
        submittingRef.current = false;
        setConfirmed(true);
        return;
      }
      router.push("/dashboard/rewards");
      router.refresh();
    } catch (cause) {
      submittingRef.current = false;
      const isNetwork = cause instanceof TypeError;
      if (isNetwork) setUncertain(true);
      setError(
        cause instanceof CreateRewardFailure
          ? copy[cause.messageKey]
          : isNetwork
            ? copy.networkError
            : copy.createError,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submit();
  };

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
              onClick={() => {
                router.push("/dashboard/rewards");
                router.refresh();
              }}
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
            <p>{error}</p>
            {uncertain && (
              <>
                <p className="mt-1">{copy.recoveryDescription}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-plain min-h-[44px]" onClick={() => void submit()} disabled={loading}>
                    {copy.tryAgain}
                  </button>
                  <button type="button" className="btn-plain min-h-[44px]" onClick={() => { router.push("/dashboard/rewards"); router.refresh(); }} disabled={loading}>
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
