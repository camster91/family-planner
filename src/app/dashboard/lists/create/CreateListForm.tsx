"use client";

import { ListImagePicker } from "@/components/lists/ListImagePicker";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronLeft, ListChecks } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Glyph } from "@/components/ui/glyph";
import { listTypeFilter } from "@/lib/list-type-filter";
import { useTranslation } from "@/i18n";
import { listCreateMessages, type ListCreateMessage } from "@/i18n/list-create";

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

// 'meal_plan' is no longer offered for new lists (ADR-0007 O-8); meals live in /dashboard/meals.
type ListTypeKey = "grocery" | "todo" | "wishlist" | "shopping" | "custom";

interface TypeConfig {
  nameKey: ListCreateMessage;
  color: "lists" | "rewards" | "meals" | "family";
  icon: React.ComponentType<{ className?: string }>;
}

class CreateListFailure extends Error {
  constructor(readonly messageKey: "permissionError" | "createError") {
    super(messageKey);
  }
}

const TYPE_CONFIG: Record<ListTypeKey, TypeConfig> = {
  grocery: { nameKey: "typeGrocery", color: "lists", icon: ShoppingCartIcon },
  todo: { nameKey: "typeTodo", color: "rewards", icon: CheckSquareIcon },
  wishlist: { nameKey: "typeWishlist", color: "family", icon: HeartIcon },
  shopping: { nameKey: "typeShopping", color: "lists", icon: ShoppingBagIcon },
  custom: { nameKey: "typeCustom", color: "lists", icon: ListChecks },
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  grocery: ShoppingCartIcon,
  todo: CheckSquareIcon,
  wishlist: HeartIcon,
  shopping: ShoppingBagIcon,
};

// -----------------------------------------------------------------------
// Inline SVG icons
// -----------------------------------------------------------------------

function ShoppingCartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function CheckSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06z" />
    </svg>
  );
}

function ShoppingBagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

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
        router.push("/dashboard/lists");
        router.refresh();
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
            <Link
              href="/dashboard/lists"
              className="inline-flex items-center gap-1 text-subhead text-[var(--accent)]"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{copy.back}</span>
            </Link>
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

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="text-subhead text-label-secondary mb-2 block"
            >
              {copy.description}{" "}
              <span className="text-label-tertiary">{copy.optional}</span>
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

          {/* Type selector */}
          <div>
            <label className="text-subhead text-label-secondary mb-3 block">
              {copy.type}
            </label>
            <div
              className={
                inSheet ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"
              }
            >
              {(Object.keys(TYPE_CONFIG) as ListTypeKey[]).map((t) => {
                const cfg = TYPE_CONFIG[t];
                const Icon = cfg.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    disabled={busy}
                    className={cn(
                      "card-apple p-3 flex flex-col items-center gap-2 text-center transition-all",
                      type === t
                        ? "ring-2 ring-[var(--accent)]"
                        : "active:scale-95",
                    )}
                  >
                    <Glyph color={cfg.color} size="md">
                      <Icon className="w-5 h-5 text-white" />
                    </Glyph>
                    <span className="text-caption-1 text-label-primary font-medium">
                      {copy[cfg.nameKey]}
                    </span>
                    {type === t && (
                      <span className="text-caption-2 text-[var(--accent)] font-medium">
                        {copy.selected}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {type === "custom" && (
            <p className="text-footnote text-label-secondary">
              {copy.customGuidance}
            </p>
          )}

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
