"use client";

import { ListImagePicker } from "@/components/lists/ListImagePicker";
import * as React from "react";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { Plus, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  listTypeFilter,
  listsFilterHref,
  type ListTypeKey as ListFilterKey,
} from "@/lib/list-type-filter";
import { useTranslation } from "@/i18n";
import { listCreateMessages, type ListCreateMessage } from "@/i18n/list-create";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_TTL_MS,
  newIdempotencyKey,
} from "@/lib/idempotency-key";
import {
  usePendingFormNavigation,
  usePendingFormNavigationController,
} from "@/components/layout/pending-form-navigation";

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

// 'meal_plan' is no longer offered for new lists (ADR-0007 O-8); meals live in /dashboard/meals.
type ListTypeKey = "grocery" | "todo" | "wishlist" | "shopping" | "custom";

class CreateListFailure extends Error {
  constructor(readonly messageKey: "permissionError" | "createError") {
    super(messageKey);
  }
}

function isAmbiguousCreate(status: number): boolean {
  return status === 408 || status === 409 || status >= 500;
}

const TYPE_LABELS: Record<ListTypeKey, ListCreateMessage> = {
  grocery: "typeGrocery",
  todo: "typeTodo",
  wishlist: "typeWishlist",
  shopping: "typeShopping",
  custom: "typeCustom",
};

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function CreateListForm({
  inSheet = false,
  onBusyChange,
  canCreate = true,
  initialType,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
  initialType?: ListFilterKey | null;
} = {}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = listCreateMessages[locale];
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imageUploading, setImageUploading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<ListTypeKey>(
    initialType && initialType !== "meal_plan" ? initialType : "grocery",
  );
  const [returnFilter, setReturnFilter] = React.useState<ListFilterKey | null>(
    initialType ?? null,
  );
  const [loading, setLoading] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  // Stays set from the first submit until the redirect: a second tap during
  // the request or the success pause must not create a second list.
  const submittingRef = React.useRef(false);
  const saveIntent = React.useRef<{
    payload: string;
    key: string;
    createdAt: number;
    expired?: boolean;
  } | null>(null);
  const expiredIntent = saveIntent.current?.expired === true;
  const busy = loading || !!success || imageUploading || unknown;
  const directNavigation = usePendingFormNavigationController(busy && !inSheet);
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;
  React.useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  React.useEffect(() => {
    if (initialType !== undefined) return;
    const requested = listTypeFilter(
      new URLSearchParams(window.location.search).get("type"),
    );
    setReturnFilter(requested);
    if (requested && requested !== "meal_plan") setType(requested);
  }, [initialType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !name.trim() ||
      submittingRef.current ||
      loading ||
      !!success ||
      imageUploading
    )
      return;
    const body = {
      name,
      type,
      image_url: imageUrl ?? undefined,
      description: description?.trim() ? description : undefined,
    };
    const payload = JSON.stringify(body);
    const existingIntent = saveIntent.current;
    if (existingIntent) {
      const expired =
        existingIntent.expired ||
        Date.now() - existingIntent.createdAt >= IDEMPOTENCY_TTL_MS;
      if (expired) {
        saveIntent.current = { ...existingIntent, expired: true };
        setUnknown(false);
        setError(copy.unknownExpired);
        return;
      }
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);
    const wasUnknown = unknown;
    setUnknown(false);
    setSuccess(null);

    try {
      // A retry keeps the original payload and key. A fresh key is created
      // only for a new draft, and inside the guarded request boundary.
      const intent =
        saveIntent.current ??
        ({ payload, key: newIdempotencyKey(), createdAt: Date.now() } as const);
      saveIntent.current = intent;
      const res = await fetch("/api/lists/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: intent.key,
        },
        body: intent.payload,
      });
      await res.json().catch(() => null);
      if (!res.ok) {
        if (isAmbiguousCreate(res.status) || wasUnknown) {
          setUnknown(true);
          setError(copy.unknownError);
          return;
        }
        saveIntent.current = null;
        throw new CreateListFailure(
          res.status === 403 ? "permissionError" : "createError",
        );
      }

      saveIntent.current = null;
      setUnknown(false);
      setSuccess(copy.created);
      setTimeout(() => {
        void (async () => {
          if ((await navigation?.releaseBeforeNavigation()) === false) return;
          // A filtered entry should show the newly created list, even if its
          // type changed in the form. Unfiltered entry keeps All Lists.
          router.push(listsFilterHref(returnFilter ? type : null));
          router.refresh();
        })();
      }, 1200);
    } catch (err) {
      submittingRef.current = false;
      const outcomeIsUnknown =
        !(err instanceof CreateListFailure) && saveIntent.current !== null;
      if (!(err instanceof CreateListFailure)) setUnknown(outcomeIsUnknown);
      setError(
        err instanceof CreateListFailure
          ? copy[err.messageKey]
          : outcomeIsUnknown
            ? copy.unknownError
            : copy.createError,
      );
    } finally {
      // A retryable/ambiguous response leaves the intent in saveIntent; the
      // next explicit submit may check that same key and payload.
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (!canCreate) {
    return (
      <div
        className="max-w-lg mx-auto px-4 py-12 text-center"
        data-testid="list-create-refused"
      >
        <h1 className="text-title-2 font-display text-label-primary">
          {copy.refusalTitle}
        </h1>
        <p className="text-body text-label-secondary mt-2">
          {copy.refusalDescription}
        </p>
        <Link
          href={listsFilterHref(returnFilter)}
          className="btn-tinted inline-flex mt-6 min-h-[44px] items-center justify-center px-5"
        >
          {copy.back}
        </Link>
      </div>
    );
  }

  return (
    <div className={inSheet ? "" : "max-w-lg mx-auto pb-20"}>
      {!inSheet && (
        <>
          {/* Back */}
          <div className="px-4 pt-4">
            {busy ? (
              <span
                aria-disabled="true"
                data-testid="list-create-back-busy"
                className="inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent)]"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{copy.back}</span>
              </span>
            ) : (
              <Link
                href={listsFilterHref(returnFilter)}
                className="inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent)]"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{copy.back}</span>
              </Link>
            )}
          </div>
        </>
      )}
      <div className={inSheet ? "space-y-6" : "px-4 mt-4 space-y-6"}>
        {!inSheet && (
          <>
            {/* Title */}
            <div>
              <h1 className="text-large-title font-display text-label-primary">
                {copy.title}
              </h1>
              <p className="text-subhead text-label-secondary mt-1">
                {copy.subtitle}
              </p>
            </div>
          </>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div
              role="alert"
              className="bg-[var(--tint-rewards)]/20 border border-[var(--tint-rewards)]/30 rounded-xl px-4 py-3 text-subhead text-[var(--tint-rewards)]"
            >
              {error}
            </div>
          )}
          {success && (
            <div
              role="status"
              className="bg-[var(--tint-lists)]/20 border border-[var(--tint-lists)]/30 rounded-xl px-4 py-3 text-subhead text-[var(--tint-lists)]"
            >
              {success}
            </div>
          )}

          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="text-subhead text-label-secondary mb-2 block"
            >
              {copy.name}
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              autoFocus
              disabled={busy || expiredIntent}
              className="input-apple"
            />
          </div>

          <div>
            <label
              htmlFor="list-type"
              className="text-subhead text-label-secondary mb-2 block"
            >
              {copy.type}
            </label>
            <select
              id="list-type"
              value={type}
              onChange={(event) => setType(event.target.value as ListTypeKey)}
              disabled={busy || expiredIntent}
              className="input-apple min-h-[44px]"
            >
              {(Object.keys(TYPE_LABELS) as ListTypeKey[]).map((key) => (
                <option key={key} value={key}>
                  {copy[TYPE_LABELS[key]]}
                </option>
              ))}
            </select>
          </div>

          {type === "custom" && (
            <p className="text-footnote text-label-secondary">
              {copy.customGuidance}
            </p>
          )}

          <details
            data-testid="list-description-section"
            className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)]"
            onInvalidCapture={(event) => {
              event.currentTarget.open = true;
            }}
          >
            <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-body text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span className="font-semibold">{copy.description}</span>{" "}
              <span className="text-footnote text-label-secondary">
                · {description.trim() ? copy.descriptionAdded : copy.optional}
              </span>
            </summary>
            <div className="px-4 pb-4">
              <label htmlFor="description" className="sr-only">
                {copy.description}
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={copy.descriptionPlaceholder}
                rows={2}
                disabled={busy || expiredIntent}
                className="input-apple resize-none"
              />
            </div>
          </details>

          <ListImagePicker
            value={imageUrl}
            onChange={setImageUrl}
            disabled={busy || expiredIntent}
            onBusyChange={setImageUploading}
          />

          {/* Submit */}
          <div
            className={
              inSheet
                ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1"
                : ""
            }
          >
            <button
              type="submit"
              disabled={
                loading ||
                !!success ||
                imageUploading ||
                expiredIntent ||
                !name.trim()
              }
              aria-busy={busy}
              className={cn(
                "btn-filled w-full justify-center py-3",
                (loading ||
                  !!success ||
                  imageUploading ||
                  expiredIntent ||
                  !name.trim()) &&
                  "opacity-50 pointer-events-none",
              )}
            >
              {loading || success || imageUploading ? (
                <>
                  <span className="motion-safe:animate-spin" aria-hidden="true">
                    ⟳
                  </span>
                  <span className="sr-only">
                    {imageUploading
                      ? copy.uploadingImageStatus
                      : success
                        ? copy.createdButton
                        : copy.creating}
                  </span>
                </>
              ) : unknown ? (
                <span>{copy.retry}</span>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>{copy.create}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
