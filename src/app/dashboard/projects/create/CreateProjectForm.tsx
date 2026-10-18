"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, PlusCircle, Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useTranslation } from "@/i18n";
import { projectCreateMessages } from "@/i18n/project-create";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { canonicalBodySignature } from "@/lib/request-signature";
import {
  usePendingFormNavigation,
  usePendingFormNavigationController,
} from "@/components/layout/pending-form-navigation";

const PRESET_COLORS = [
  { value: "#3B82F6", labelKey: "colorBlue", ring: "ring-blue-400" },
  { value: "#EC4899", labelKey: "colorPink", ring: "ring-pink-400" },
  { value: "#8B5CF6", labelKey: "colorPurple", ring: "ring-purple-400" },
  { value: "#10B981", labelKey: "colorGreen", ring: "ring-emerald-400" },
  { value: "#F59E0B", labelKey: "colorAmber", ring: "ring-amber-400" },
  { value: "#6366F1", labelKey: "colorIndigo", ring: "ring-indigo-400" },
] as const;
type ProjectColor = (typeof PRESET_COLORS)[number]["value"];

export default function CreateProjectForm({
  inSheet = false,
  onBusyChange,
}: {
  inSheet?: boolean;
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const router = useRouter();
  const { addToast } = useToast();
  const { locale } = useTranslation();
  const copy = projectCreateMessages[locale];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>(PRESET_COLORS[0].value);
  const [loading, setLoading] = useState(false);
  const currentRequest = useRef<{ key: string; signature: string } | null>(
    null,
  );
  const ambiguousRequests = useRef(new Map<string, string>());
  const directNavigation = usePendingFormNavigationController(
    loading && !inSheet,
  );
  const sheetNavigation = usePendingFormNavigation();
  const navigation = inSheet ? sheetNavigation : directNavigation;

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    };
    const signature = canonicalBodySignature(body);
    const key =
      currentRequest.current?.signature === signature
        ? currentRequest.current.key
        : (ambiguousRequests.current.get(signature) ?? newIdempotencyKey());
    currentRequest.current = { key, signature };

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: key,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status >= 500) ambiguousRequests.current.set(signature, key);
        else {
          ambiguousRequests.current.delete(signature);
          currentRequest.current = null;
        }
        const serverMessage =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : copy.createFallback;
        throw new Error(serverMessage);
      }
      const projectId = data?.project?.id;
      if (typeof projectId !== "string" || projectId.trim().length === 0) {
        ambiguousRequests.current.set(signature, key);
        throw new Error(copy.createFallback);
      }

      // Keep the request key until navigation is released. If the sheet or
      // route guard stays open after a confirmed response, retrying the same
      // draft must replay the known create rather than create a duplicate.
      if ((await navigation?.releaseBeforeNavigation()) === false) return;

      ambiguousRequests.current.delete(signature);
      currentRequest.current = null;

      addToast({
        type: "success",
        title: copy.created,
        message: copy.createdMessage.replace("{name}", name.trim()),
      });
      router.push(`/dashboard/projects/${projectId}`);
      router.refresh();
    } catch (error) {
      addToast({
        type: "error",
        title: copy.createError,
        message: error instanceof Error ? error.message : copy.createFallback,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={inSheet ? "space-y-5" : "max-w-lg mx-auto space-y-6 pb-20"}>
      {!inSheet && (
        <>
          <div className="px-4 pt-4">
            {loading ? (
              <span
                aria-disabled="true"
                data-testid="project-create-back-busy"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-label-tertiary"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {copy.back}
              </span>
            ) : (
              <Link
                href="/dashboard/projects"
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

      <div
        className={
          inSheet
            ? "space-y-5"
            : "rounded-2xl bg-card border shadow-sm overflow-hidden mx-4"
        }
      >
        <div
          className="h-1.5 w-full transition-colors duration-300"
          style={{ backgroundColor: color }}
        />

        <div className={inSheet ? "space-y-5" : "p-6 space-y-5"}>
          <form
            onSubmit={handleSubmit}
            aria-busy={loading}
            className="space-y-5"
          >
            <fieldset disabled={loading} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="name"
                  className="text-subhead text-label-secondary"
                >
                  {copy.name} <span className="text-danger-text">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={copy.namePlaceholder}
                  className="input-apple"
                  required
                  autoFocus
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="description"
                  className="text-subhead text-label-secondary"
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
                  maxLength={1000}
                />
                <p className="text-caption-1 text-label-tertiary text-right">
                  {copy.characterCount.replace(
                    "{count}",
                    String(description.length),
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <p
                  id="project-color-label"
                  className="text-subhead text-label-secondary"
                >
                  {copy.color}
                </p>
                <div
                  role="group"
                  aria-labelledby="project-color-label"
                  className="flex flex-wrap gap-2"
                >
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      className={cn(
                        "h-11 w-11 rounded-xl border-2 transition-all duration-150 flex items-center justify-center",
                        color === c.value
                          ? "border-foreground ring-2 ring-offset-1 ring-label-tertiary"
                          : "border-transparent hover:border-input",
                      )}
                      style={{ backgroundColor: c.value }}
                      title={copy[c.labelKey]}
                      aria-label={copy.colorOption.replace(
                        "{color}",
                        copy[c.labelKey],
                      )}
                      aria-pressed={color === c.value}
                    >
                      {color === c.value && (
                        <Check
                          className="w-4 h-4 text-white"
                          strokeWidth={3}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={cn(
                  "pt-4",
                  inSheet &&
                    "sticky bottom-0 bg-[var(--surface-elevated)] pb-1",
                )}
              >
                <button
                  type="submit"
                  disabled={!name.trim() || loading}
                  aria-busy={loading}
                  className={cn(
                    "w-full py-3 rounded-xl text-base font-semibold transition-all duration-200",
                    name.trim() && !loading
                      ? "bg-tint-projects text-white hover:opacity-90"
                      : "bg-muted text-label-tertiary cursor-not-allowed",
                  )}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {copy.creating}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <PlusCircle className="w-4 h-4" />
                      {copy.create}
                    </span>
                  )}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>

      {!inSheet && (
        <div className="rounded-xl bg-surface-fill p-4 text-center mx-4">
          <p className="text-caption-1 text-label-secondary">{copy.tip}</p>
        </div>
      )}
    </div>
  );
}
