"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { rewardCreateMessages } from "@/i18n/reward-create";
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

class CreateRewardFailure extends Error {
  constructor(readonly messageKey: RewardCreateError) {
    super(messageKey);
  }
}

export default function CreateRewardForm({
  inSheet = false,
  onBusyChange,
  canCreate = true,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
} = {}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = rewardCreateMessages[locale];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState(50);
  const [icon, setIcon] = useState<(typeof ICON_OPTIONS)[number]>("🎁");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const directNavigation = usePendingFormNavigationController(
    loading && !inSheet,
  );
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          cost,
          icon,
        }),
      });

      // Consume the response safely without displaying arbitrary server text.
      // The API remains the authority; the UI gives a stable localized reason.
      await response.json().catch(() => null);
      if (!response.ok) {
        throw new CreateRewardFailure(
          response.status === 403 ? "permissionError" : "createError",
        );
      }

      await navigation?.releaseBeforeNavigation();
      router.push("/dashboard/rewards");
      router.refresh();
    } catch (cause) {
      submittingRef.current = false;
      setError(
        cause instanceof CreateRewardFailure
          ? copy[cause.messageKey]
          : cause instanceof TypeError
            ? copy.networkError
            : copy.createError,
      );
    } finally {
      setLoading(false);
    }
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
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[var(--danger-tint)] border border-[var(--danger-tint)] p-4 text-danger-text text-sm"
          >
            {error}
          </div>
        )}

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
