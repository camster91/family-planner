"use client";

import { ListImagePicker } from "@/components/lists/ListImagePicker";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { listTypeFilter } from "@/lib/list-type-filter";
import { useTranslation } from "@/i18n";
import { listCreateMessages, type ListCreateMessage } from "@/i18n/list-create";
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
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
  canCreate?: boolean;
} = {}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = listCreateMessages[locale];
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imageUploading, setImageUploading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<ListTypeKey>("grocery");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  // Stays set from the first submit until the redirect: a second tap during
  // the request or the success pause must not create a second list.
  const submittingRef = React.useRef(false);
  const busy = loading || !!success || imageUploading;
  const directNavigation = usePendingFormNavigationController(busy && !inSheet);
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;
  React.useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  React.useEffect(() => {
    const requested = listTypeFilter(
      new URLSearchParams(window.location.search).get("type"),
    );
    if (requested && requested !== "meal_plan") setType(requested);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submittingRef.current || imageUploading) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/lists/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          image_url: imageUrl ?? undefined,
          description: description?.trim() ? description : undefined,
        }),
      });
      await res.json().catch(() => null);
      if (!res.ok) {
        throw new CreateListFailure(
          res.status === 403 ? "permissionError" : "createError",
        );
      }

      setSuccess(copy.created);
      setTimeout(() => {
        void (async () => {
          if ((await navigation?.releaseBeforeNavigation()) === false) return;
          router.push("/dashboard/lists");
          router.refresh();
        })();
      }, 1200);
    } catch (err) {
      submittingRef.current = false;
      setError(
        err instanceof CreateListFailure
          ? copy[err.messageKey]
          : err instanceof TypeError
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
        data-testid="list-create-refused"
      >
        <h1 className="text-title-2 font-display text-label-primary">
          {copy.refusalTitle}
        </h1>
        <p className="text-body text-label-secondary mt-2">
          {copy.refusalDescription}
        </p>
        <Link
          href="/dashboard/lists"
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
                href="/dashboard/lists"
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
              disabled={busy}
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
                className="input-apple resize-none"
              />
            </div>
          </details>

          <ListImagePicker
            value={imageUrl}
            onChange={setImageUrl}
            disabled={loading || !!success}
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
              disabled={busy || !name.trim()}
              aria-busy={busy}
              className={cn(
                "btn-filled w-full justify-center py-3",
                (busy || !name.trim()) && "opacity-50 pointer-events-none",
              )}
            >
              {busy ? (
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
