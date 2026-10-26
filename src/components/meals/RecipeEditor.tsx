"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { MealContextLink as Link } from "./MealContextLink";
import { publicRecipeUrl } from "@/lib/recipe-discovery";
import { legacyRecipeSource } from "@/lib/recipe-curation-contract";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner } from "@/lib/recipe-owner-contract";
import { parseRecipeDetail } from "@/lib/recipe-detail-client";
import { RECIPE_EDIT_PROTOCOL } from "@/lib/recipe-input-contract";
import { RECIPE_CREATE_COMMAND_MAX_AGE_MS } from "@/lib/recipe-create-command-window";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { useRecipeEditorText } from "@/i18n/recipe-editor";
import { RecipeDraftBoundary } from "./RecipeDraftBoundary";
import type { RecipeEditableDocument } from "@/lib/review-document-contract";
import type { ReviewReceiptState } from "@/lib/review-document-store";
import type { RecipeOption } from "./RecipePicker";
import type { RecipeDetailData } from "./RecipeDetail";

interface IngredientDraft {
  key: number;
  clientId?: string;
  name: string;
  amount: string;
  unit: string;
  note: string;
  ingredientId?: string;
  originalName?: string;
}

function toMinutes(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 60) return "invalid";
  return n;
}

/**
 * Inline "new recipe" panel: title, prep and cook minutes, ingredient lines.
 * Exported for tests.
 */
export type RecipeEditorProps = {
  expectedRecipeOwner?: import("@/lib/recipe-owner-contract").RecipeOwner;
  onOwnerHold?: () => void;
  recoveryIdentity?: { userId: string; familyId: string };
  recoveryOnly?: boolean;
  onCreated?: (recipe: RecipeOption & { source_url?: string | null }) => void;
  initialRecipe?: RecipeDetailData;
  initialDraft?: {
    source_url?: string;
    source_copy?: boolean;
    servings?: number | null;
    title: string;
    description: string;
    instructions: string;
    prep_time: number | null;
    cook_time: number | null;
  };
  onSaved?: (recipe: RecipeDetailData) => void;
  onCancel: () => void;
  onSavingChange?: (saving: boolean) => void;
  /** Owning meal save/delete disables this inline editor. */
  disabled?: boolean;
  /** Synchronous owner guard for handlers retained before a render. */
  isMutationPending?: () => boolean;
};
export type RecipeOwnedFormProps = {
  initialOwnedDraft?: RecipeEditableDocument;
  onDraftChange?: (draft: RecipeEditableDocument) => void;
  onOwnedSubmit?: (
    body: Record<string, unknown>,
    draft: RecipeEditableDocument,
  ) => Promise<void>;
};

export function RecipeEditor(props: RecipeEditorProps) {
  if (props.initialRecipe) return <RecipeEditorForm {...props} />;
  return (
    <RecipeDraftBoundary
      {...props}
      renderForm={(owned) => <RecipeEditorForm {...props} {...owned} />}
    />
  );
}

function RecipeEditorForm({
  expectedRecipeOwner,
  onOwnerHold,
  onCreated,
  onCancel,
  initialRecipe,
  initialDraft,
  onSaved,
  onSavingChange,
  disabled = false,
  isMutationPending,
  initialOwnedDraft,
  onDraftChange,
  onOwnedSubmit,
}: RecipeEditorProps & RecipeOwnedFormProps) {
  const originalRecipeOwner = React.useRef(expectedRecipeOwner ? Object.freeze({ ...expectedRecipeOwner }) : null);
  const currentRecipeOwner = React.useRef(expectedRecipeOwner ?? null);
  currentRecipeOwner.current = expectedRecipeOwner ?? null;
  const ownerMismatch = Boolean((originalRecipeOwner.current || currentRecipeOwner.current) &&
    !sameRecipeOwner(originalRecipeOwner.current, currentRecipeOwner.current));
  const ownerHeld = React.useRef(false);
  const [ownerHold, setOwnerHold] = React.useState(false);
  const reloadFocus = React.useRef<HTMLButtonElement>(null);
  const callbacks = React.useRef({ onCreated, onSaved, onSavingChange, onOwnerHold });
  callbacks.current = { onCreated, onSaved, onSavingChange, onOwnerHold };
  const text = useRecipeEditorText();
  const baseId = React.useId();
  const titleRef = React.useRef<HTMLInputElement>(null);
  const nextKey = React.useRef(
    initialOwnedDraft?.lines.length ?? initialRecipe?.ingredients.length ?? 1,
  );
  const [title, setTitle] = React.useState(
    initialOwnedDraft?.title ??
      initialRecipe?.title ??
      initialDraft?.title ??
      "",
  );
  const [servings, setServings] = React.useState(
    initialOwnedDraft
      ? initialOwnedDraft.servings
      : initialRecipe
        ? String(initialRecipe.servings ?? "")
        : initialDraft
          ? initialDraft.servings == null
            ? ""
            : String(initialDraft.servings)
          : "2",
  );
  const [description, setDescription] = React.useState(
    initialOwnedDraft?.description ??
      initialRecipe?.description ??
      initialDraft?.description ??
      "",
  );
  const [instructions, setInstructions] = React.useState(
    initialOwnedDraft?.instructions ??
      initialRecipe?.instructions ??
      initialDraft?.instructions ??
      "",
  );
  const [prep, setPrep] = React.useState(
    initialOwnedDraft
      ? initialOwnedDraft.prep
      : (initialRecipe?.prep_time ?? initialDraft?.prep_time) == null
        ? ""
        : String(initialRecipe?.prep_time ?? initialDraft?.prep_time),
  );
  const [cook, setCook] = React.useState(
    initialOwnedDraft
      ? initialOwnedDraft.cook
      : (initialRecipe?.cook_time ?? initialDraft?.cook_time) == null
        ? ""
        : String(initialRecipe?.cook_time ?? initialDraft?.cook_time),
  );
  const [lines, setLines] = React.useState<IngredientDraft[]>(() =>
    initialOwnedDraft
      ? initialOwnedDraft.lines.map((line, key) => ({
          key,
          clientId: line.clientId,
          name: line.name,
          amount: line.amount,
          unit: line.unit,
          note: line.note,
          ingredientId: line.ingredientId ?? undefined,
          originalName: line.originalName ?? undefined,
        }))
      : initialRecipe
        ? initialRecipe.ingredients.map((line, key) => ({
            key,
            name: line.ingredient.name,
            amount: String(line.amount),
            unit: line.unit ?? "",
            note: line.note ?? "",
            ingredientId: line.ingredient.id,
            originalName: line.ingredient.name,
          }))
        : [{ key: 0, name: "", amount: "1", unit: "", note: "" }],
  );
  const originalLines = React.useRef(lines);
  const sourceUrl = initialOwnedDraft
    ? initialOwnedDraft.sourceUrl
    : (initialDraft?.source_url ??
      legacyRecipeSource(initialDraft?.description));
  const safeSourceUrl = sourceUrl ? publicRecipeUrl(sourceUrl) : null;
  const [sourceCopy, setSourceCopy] = React.useState(
    initialOwnedDraft?.sourceCopy ?? initialDraft?.source_copy ?? false,
  );
  const ownedDraft = React.useMemo<RecipeEditableDocument>(
    () => ({
      domain: "recipe",
      title,
      description,
      instructions,
      servings,
      prep,
      cook,
      sourceUrl: sourceUrl ?? null,
      sourceCopy,
      lines: lines.map((line) => ({
        clientId: line.clientId ?? `line-${line.key}`,
        name: line.name,
        amount: line.amount,
        unit: line.unit,
        note: line.note,
        ingredientId: line.ingredientId ?? null,
        originalName: line.originalName ?? null,
      })),
    }),
    [
      title,
      description,
      instructions,
      servings,
      prep,
      cook,
      sourceUrl,
      sourceCopy,
      lines,
    ],
  );
  React.useEffect(() => {
    if (!ownerHeld.current && !ownerMismatch) onDraftChange?.(ownedDraft);
  }, [ownedDraft, onDraftChange, ownerMismatch]);
  const [duplicate, setDuplicate] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const mutationPending = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [uncertain, setUncertain] = React.useState(false);
  const uncertainRef = React.useRef(false);
  const confirmedRef = React.useRef(false);
  const [confirmed, setConfirmed] = React.useState<{ id: string } | null>(null);
  const [handoffFailed, setHandoffFailed] = React.useState(false);
  const [receiptState, setReceiptState] = React.useState<ReviewReceiptState | null>(null);
  const [receiptFailed, setReceiptFailed] = React.useState(false);
  const formLive = React.useRef(true);
  const formEpoch = React.useRef(0);
  const requestController = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    formLive.current = true;
    return () => { formLive.current = false; formEpoch.current++; requestController.current?.abort(); };
  }, []);
  const holdOwner = React.useCallback(() => {
    if (!formLive.current || ownerHeld.current) return;
    ownerHeld.current = true;
    formEpoch.current++;
    requestController.current?.abort();
    mutationPending.current = false;
    setSaving(false);
    setOwnerHold(true);
    // Local containment must survive absent or throwing parent callbacks.
    try { callbacks.current.onSavingChange?.(false); } catch {}
    try { callbacks.current.onOwnerHold?.(); } catch {}
  }, []);
  React.useEffect(() => { if (ownerMismatch) holdOwner(); }, [ownerMismatch, holdOwner]);
  React.useEffect(() => {
    if ((ownerHold || ownerMismatch) && document.activeElement === document.body)
      reloadFocus.current?.focus();
  }, [ownerHold, ownerMismatch]);
  const creationAttempt = React.useRef<{
    key: string;
    body: string;
    startedAt: number;
  } | null>(null);
  const uncertainMessage = text(
    initialRecipe ? "uncertain" : "uncertainCreate",
  );
  const markUncertain = () => {
    if (confirmedRef.current || ownerHeld.current) return;
    uncertainRef.current = true;
    setUncertain(true);
    setError(uncertainMessage);
  };

  React.useEffect(() => {
    if (!initialRecipe) titleRef.current?.focus();
    // Editing is focused by the owning Dialog so its return target is preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (key: number, patch: Partial<IngredientDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: nextKey.current++,
        clientId: newIdempotencyKey(),
        name: "",
        amount: "1",
        unit: "",
        note: "",
      },
    ]);

  const removeLine = (key: number) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  async function writeRecipe(body: Record<string, unknown>) {
    if (!formLive.current || ownerHeld.current) return;
    const own = formEpoch.current;
    const completionCallbacks = callbacks.current;
    const expectedOwner = originalRecipeOwner.current;
    if ((expectedOwner || currentRecipeOwner.current) && !sameRecipeOwner(expectedOwner, currentRecipeOwner.current)) {
      holdOwner(); return;
    }
    if (initialRecipe && expectedOwner && initialRecipe.revision === undefined) {
      setError(text("editVersionMissing"));
      return;
    }
    if (onOwnedSubmit && !initialRecipe) {
      await onOwnedSubmit(
        {
          ...body,
          ...(sourceUrl
            ? { source_url: sourceUrl, source_copy: sourceCopy }
            : {}),
          creation_protocol: "herewoven.recipe-create.v1",
          ...(expectedOwner ? { creation_owner: expectedOwner, creation_issued_at: Date.now() } : {}),
        },
        ownedDraft,
      );
      return;
    }
    if (!initialRecipe && !creationAttempt.current) {
      const issuedAt = Date.now();
      creationAttempt.current = {
        key: newIdempotencyKey(),
        body: JSON.stringify({
          ...body,
          ...(sourceUrl
            ? { source_url: sourceUrl, source_copy: sourceCopy }
            : {}),
          creation_protocol: "herewoven.recipe-create.v1",
          ...(expectedOwner ? { creation_owner: expectedOwner, creation_issued_at: issuedAt } : {}),
        }),
        startedAt: issuedAt,
      };
    }
    const attempt = creationAttempt.current;
    // Never renew a create command beyond its original one-day retry window.
    if (
      attempt &&
      (Date.now() < attempt.startedAt ||
        Date.now() - attempt.startedAt >= RECIPE_CREATE_COMMAND_MAX_AGE_MS)
    ) {
      markUncertain();
      setError(text("expiredCreate"));
      return;
    }
    const abort = new AbortController();
    requestController.current = abort;
    const result = await runOwnedForeground(
      async (signal) => {
        const response = await fetch(
          initialRecipe
            ? `/api/recipes/${encodeURIComponent(initialRecipe.id)}`
            : "/api/recipes",
          {
            method: initialRecipe ? "PATCH" : "POST",
            headers: {
              "Content-Type": "application/json",
              ...(attempt ? { [IDEMPOTENCY_HEADER]: attempt.key } : {}),
              ...(expectedOwner ? { [RECIPE_OWNER_HEADER]: JSON.stringify(expectedOwner) } : {}),
            },
            body: attempt?.body ?? JSON.stringify({
              ...body,
              ...(initialRecipe && expectedOwner ? { edit_protocol: RECIPE_EDIT_PROTOCOL, edit_owner: expectedOwner } : {}),
            }),
            signal,
          },
        );
        // Admit the original owner before decoding a successful private body.
        // Access refusals may be proxy HTML or oversized/slow JSON; their body
        // is not needed to retire this household view.
        if (expectedOwner && ([401, 403].includes(response.status) ||
          (response.ok && !sameRecipeOwner(expectedOwner, readRecipeOwner(response.headers?.get(RECIPE_OWNER_HEADER) ?? null)))))
          return { kind: "reply" as const, response, reply: null, ownerRefused: true };
        const reply = await readBoundedJsonResponse(
          response,
          signal,
          1024 * 1024,
        );
        return { kind: "reply" as const, response, reply, ownerRefused: false };
      },
      { timeoutMs: 30_000, signal: abort.signal },
    );
    if (!formLive.current || own !== formEpoch.current) return;
    if ((expectedOwner || currentRecipeOwner.current) && !sameRecipeOwner(expectedOwner, currentRecipeOwner.current)) {
      holdOwner(); return;
    }
    if (result.kind !== "reply") {
      markUncertain();
      return;
    }
    const res = result.response;
    if (expectedOwner && (result.ownerRefused ||
        (result.reply as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED")) {
      markUncertain();
      holdOwner();
      return;
    }
    const data = result.reply as {
      recipe?: RecipeDetailData;
      error?: { code?: string };
      existingRecipe?: { id?: unknown; title?: unknown };
    } | null;
    if (!res.ok) {
      if (["RECIPE_COMMAND_EXPIRED", "RECIPE_COMMAND_TIME_UNCONFIRMED"].includes(data?.error?.code ?? "")) {
        markUncertain(); return;
      }
      // A prior unknown attempt stays unknown even if this retry is refused.
      if (res.status === 413 && data?.error?.code === "RECIPE_REQUEST_TOO_LARGE" && !uncertainRef.current) {
        creationAttempt.current = null;
        setError(text("requestTooLarge"));
        return;
      }
      if (
        data?.error?.code === "RECIPE_SOURCE_EXISTS" &&
        typeof data.existingRecipe?.id === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(data.existingRecipe.id) &&
        typeof data.existingRecipe.title === "string"
      ) {
        creationAttempt.current = null;
        uncertainRef.current = false;
        setUncertain(false);
        setDuplicate({
          id: data.existingRecipe.id,
          title: data.existingRecipe.title,
        });
        setError(text("sourceExists"));
        return;
      }
      if (data?.error?.code === "RECIPE_SOURCE_CHECK_UNAVAILABLE") {
        creationAttempt.current = null;
        uncertainRef.current = false;
        setUncertain(false);
        setError(text("sourceCheckUnavailable"));
        return;
      }
      if (initialRecipe && data?.error?.code === "REVISION_CONFLICT") {
        setError(text("revisionConflict"));
        return;
      }
      if (res.status >= 500 || res.status === 409 || uncertainRef.current)
        markUncertain();
      else {
        creationAttempt.current = null;
        setError(text("rejected"));
      }
      return;
    }
    if (
      !data?.recipe ||
      typeof data.recipe.id !== "string" ||
      !data.recipe.id ||
      typeof data.recipe.title !== "string"
    ) {
      markUncertain();
      return;
    }
    let r = data.recipe;
    if (initialRecipe) {
      try {
        r = parseRecipeDetail(r, initialRecipe.id, { requireRevision: !!expectedOwner });
      } catch {
        markUncertain();
        return;
      }
    }
    confirmRecipe(r, completionCallbacks);
  }

  function confirmRecipe(r: RecipeDetailData, handoff = callbacks.current) {
    if (!formLive.current || ownerHeld.current) return;
    const owner = originalRecipeOwner.current;
    if ((owner || currentRecipeOwner.current) && !sameRecipeOwner(owner, currentRecipeOwner.current)) {
      holdOwner(); return;
    }
    confirmedRef.current = true;
    setConfirmed({ id: r.id });
    setHandoffFailed(false);
    creationAttempt.current = null;
    uncertainRef.current = false;
    setUncertain(false);
    setError(null);
    try {
      if (initialRecipe) handoff.onSaved?.(r);
      else
        handoff.onCreated?.({
          id: r.id,
          title: r.title,
          prep_time: r.prep_time,
          cook_time: r.cook_time,
          servings: r.servings,
          source_url: r.source_url ?? sourceUrl ?? null,
        });
    } catch {
      if (formLive.current) setHandoffFailed(true);
    }
  }

  async function inspectCreation() {
    if ((originalRecipeOwner.current || currentRecipeOwner.current) &&
      !sameRecipeOwner(originalRecipeOwner.current, currentRecipeOwner.current)) { holdOwner(); return; }
    const attempt = creationAttempt.current;
    if (!formLive.current || ownerHeld.current || confirmedRef.current || initialRecipe || !attempt || mutationPending.current || disabled || isMutationPending?.()) return;
    mutationPending.current = true;
    const own = ++formEpoch.current;
    const abort = new AbortController();
    requestController.current = abort;
    setSaving(true);
    callbacks.current.onSavingChange?.(true);
    setError(null);
    setReceiptFailed(false);
    try {
      const result = await runOwnedForeground(async signal => {
        const { inspectRecipeCreateReceipt } = await import("@/lib/review-document-receipts");
        if (signal.aborted) return { kind: "unknown" as const };
        try {
          return { kind: "receipt" as const, state: await inspectRecipeCreateReceipt(
            { key: attempt.key, body: attempt.body }, originalRecipeOwner.current ?? undefined, signal) };
        } catch (error) {
          if (error && typeof error === "object" && "reason" in error && error.reason === "OWNER_CHANGED")
            return { kind: "owner-held" as const };
          throw error;
        }
      }, { signal: abort.signal, timeoutMs: 15_000 });
      if (!formLive.current || own !== formEpoch.current) return;
      if (result.kind === "owner-held") { holdOwner(); return; }
      if (result.kind === "receipt") setReceiptState(result.state);
      else setReceiptFailed(true);
    } finally {
      if (formLive.current && own === formEpoch.current) {
        mutationPending.current = false;
        setSaving(false);
        callbacks.current.onSavingChange?.(false);
      }
    }
  }

  async function retryCreation() {
    if (
      !formLive.current || ownerHeld.current || confirmedRef.current || initialRecipe ||
      !creationAttempt.current ||
      receiptState?.state === "committed" || receiptState?.state === "expired" ||
      mutationPending.current ||
      disabled ||
      isMutationPending?.()
    )
      return;
    const own = formEpoch.current;
    mutationPending.current = true;
    setSaving(true);
    callbacks.current.onSavingChange?.(true);
    setError(null);
    try {
      await writeRecipe({});
    } catch {
      if (formLive.current && own === formEpoch.current) markUncertain();
    } finally {
      if (formLive.current && own === formEpoch.current) {
        mutationPending.current = false;
        setSaving(false);
        callbacks.current.onSavingChange?.(false);
      }
    }
  }

  const submit = async () => {
    if (
      !formLive.current || ownerHeld.current || confirmedRef.current || disabled ||
      isMutationPending?.() ||
      mutationPending.current ||
      saving ||
      uncertainRef.current
    )
      return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(text("emptyTitle"));
      titleRef.current?.focus();
      return;
    }
    if (
      cleanTitle.length > 200 ||
      description.length > 2000 ||
      instructions.length > 20000
    ) {
      setError(text("contentTooLong"));
      return;
    }
    const baseServings = Number(servings);
    // Legacy unknowns are not a guessed base count. An unrelated edit must
    // omit that unchanged field; creates and changed counts still validate.
    const unchangedUnknownServings =
      !!initialRecipe && initialRecipe.servings == null && servings === "";
    if (
      !unchangedUnknownServings &&
      (!servings.trim() ||
        !Number.isInteger(baseServings) ||
        baseServings < 1 ||
        baseServings > 100)
    ) {
      setError(text("invalidServings"));
      return;
    }
    const prepMinutes = toMinutes(prep);
    const cookMinutes = toMinutes(cook);
    if (prepMinutes === "invalid" || cookMinutes === "invalid") {
      setError(text("invalidTimes"));
      return;
    }
    const ingredients: {
      name?: string;
      ingredient_id?: string;
      amount: number;
      unit?: string | null;
      note?: string | null;
    }[] = [];
    for (const line of lines) {
      const name = line.name.trim();
      if (!name) {
        if (line.ingredientId) {
          setError(text("existingIngredientName"));
          return;
        }
        continue;
      }
      const amount = Number(line.amount.trim());
      if (
        !line.amount.trim() ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 100000
      ) {
        setError(text("invalidAmount", { name }));
        return;
      }
      const unit = line.unit.trim();
      ingredients.push(
        initialRecipe
          ? {
              ...(line.ingredientId &&
              name.normalize("NFC").replace(/\s+/g, " ").toLowerCase() ===
                line.originalName
                  ?.normalize("NFC")
                  .trim()
                  .replace(/\s+/g, " ")
                  .toLowerCase()
                ? { ingredient_id: line.ingredientId }
                : { name }),
              amount,
              unit: unit || null,
              note: line.note.trim() || null,
            }
          : {
              name,
              amount,
              ...(unit ? { unit } : {}),
              ...(line.note.trim() ? { note: line.note.trim() } : {}),
            },
      );
    }

    if (ingredients.length > 100) {
      setError(text("tooManyIngredients"));
      return;
    }
    const own = formEpoch.current;
    mutationPending.current = true;
    setSaving(true);
    try {
      callbacks.current.onSavingChange?.(true);
      setError(null);
      const fields = {
        title: cleanTitle,
        servings: Number(servings),
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        prep_time: prepMinutes,
        cook_time: cookMinutes,
      };
      const drafts = {
        title,
        servings,
        description,
        instructions,
        prep_time: prep,
        cook_time: cook,
      };
      const originalDrafts = initialRecipe
        ? {
            title: initialRecipe.title,
            servings: String(initialRecipe.servings ?? ""),
            description: initialRecipe.description ?? "",
            instructions: initialRecipe.instructions ?? "",
            prep_time:
              initialRecipe.prep_time == null
                ? ""
                : String(initialRecipe.prep_time),
            cook_time:
              initialRecipe.cook_time == null
                ? ""
                : String(initialRecipe.cook_time),
          }
        : null;
      const body: Record<string, unknown> = originalDrafts
        ? Object.fromEntries(
            Object.entries(fields).filter(
              ([key]) =>
                drafts[key as keyof typeof drafts] !==
                originalDrafts[key as keyof typeof drafts],
            ),
          )
        : {
            title: cleanTitle,
            servings: Number(servings),
            ...(fields.description ? { description: fields.description } : {}),
            ...(fields.instructions
              ? { instructions: fields.instructions }
              : {}),
            ...(prepMinutes !== null ? { prep_time: prepMinutes } : {}),
            ...(cookMinutes !== null ? { cook_time: cookMinutes } : {}),
            ...(ingredients.length > 0 ? { ingredients } : {}),
          };
      // Preserve untouched join rows (and legacy notes) by omitting the replacement field.
      if (
        initialRecipe &&
        JSON.stringify(lines) !== JSON.stringify(originalLines.current)
      )
        body.ingredients = ingredients;
      if (initialRecipe && Object.keys(body).length === 0) {
        confirmRecipe(initialRecipe);
        return;
      }
      if (initialRecipe && initialRecipe.revision !== undefined)
        body.base_revision = initialRecipe.revision;
      if (initialRecipe?.updated_at)
        body.base_updated_at = initialRecipe.updated_at;
      await writeRecipe(body);
    } catch {
      if (formLive.current && own === formEpoch.current) markUncertain();
    } finally {
      if (formLive.current && own === formEpoch.current) {
        mutationPending.current = false;
        setSaving(false);
        callbacks.current.onSavingChange?.(false);
      }
    }
  };

  // Enter in a field creates the recipe instead of submitting the meal form.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!initialRecipe) void submit();
    }
  };

  const receiptMessage = receiptFailed ? "receiptUnavailable" : receiptState?.state === "committed"
    ? ({ present: "receiptPresent", removed: "receiptRemoved", unknown: "receiptUnknown" } as const)[receiptState.current]
    : receiptState ? ({ absent: "receiptAbsent", pending: "receiptPending", expired: "receiptExpired",
        "duplicate-source": "receiptRefused", refused: "receiptRefused" } as const)[receiptState.state] : null;

  if (ownerHold || ownerMismatch) return (
    <section role="alert" className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3">
      <p className="text-subhead text-label-primary">{text("ownerChanged")}</p>
      <button ref={reloadFocus} type="button" className="btn-tinted min-h-[44px]" onClick={() => window.location.reload()}>
        {text("reloadOwner")}
      </button>
    </section>
  );

  return (
    <fieldset
      className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3"
      data-testid="recipe-quick-create"
      disabled={saving || disabled}
    >
      <legend className="px-1 text-subhead font-semibold text-label-primary">
        {initialRecipe ? text("recipeDetails") : text("newRecipe")}
      </legend>

      <fieldset disabled={!!confirmed || (uncertain && !initialRecipe)} className="space-y-3">
        {!initialRecipe && safeSourceUrl && (
          <div className="space-y-2">
            <a
              href={safeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center break-all"
            >
              {text("sourceLink")}
            </a>
            <label className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                checked={sourceCopy}
                onChange={(event) => setSourceCopy(event.target.checked)}
              />
              {text("sourceCopy")}
            </label>
          </div>
        )}
        <div>
          <label
            htmlFor={`${baseId}-title`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            {text("recipeName")}
          </label>
          <input
            ref={titleRef}
            id={`${baseId}-title`}
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
        </div>

        <div>
          <label
            htmlFor={`${baseId}-servings`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            {text("baseServings")}
          </label>
          <input
            id={`${baseId}-servings`}
            type="text"
            inputMode="numeric"
            maxLength={80}
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
          <p className="text-footnote text-label-secondary">
            {text("servingsHint")}
          </p>
        </div>
        <div>
          <label
            htmlFor={`${baseId}-description`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            {text("description")}
          </label>
          <textarea
            id={`${baseId}-description`}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full input-apple min-h-[88px]"
          />
        </div>
        <div>
          <label
            htmlFor={`${baseId}-instructions`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            {text("method")}
          </label>
          <textarea
            id={`${baseId}-instructions`}
            maxLength={20000}
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full input-apple min-h-[88px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor={`${baseId}-prep`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {text("prepMinutes")}
            </label>
            <input
              id={`${baseId}-prep`}
              type="text"
              inputMode="numeric"
              maxLength={80}
              value={prep}
              onChange={(e) => setPrep(e.target.value)}
              onKeyDown={onKeyDown}
              className="w-full input-apple min-h-[44px]"
            />
          </div>
          <div>
            <label
              htmlFor={`${baseId}-cook`}
              className="text-subhead text-label-secondary mb-1 block"
            >
              {text("cookMinutes")}
            </label>
            <input
              id={`${baseId}-cook`}
              type="text"
              inputMode="numeric"
              maxLength={80}
              value={cook}
              onChange={(e) => setCook(e.target.value)}
              onKeyDown={onKeyDown}
              className="w-full input-apple min-h-[44px]"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-subhead text-label-secondary">
            {text("ingredientsOptional")}
          </p>
          <p className="text-footnote text-label-secondary">
            {text("ingredientsOrderHint")}
          </p>
          {lines.map((line, i) => (
            <div
              key={line.key}
              role="group"
              aria-label={text("ingredientGroup", { number: i + 1 })}
              className="flex flex-wrap items-end gap-2"
            >
              <div className="w-16 shrink-0">
                <label
                  htmlFor={`${baseId}-amt-${line.key}`}
                  className="text-caption-1 text-label-secondary block"
                >
                  {text("amount")}
                </label>
                <input
                  id={`${baseId}-amt-${line.key}`}
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) =>
                    updateLine(line.key, { amount: e.target.value })
                  }
                  onKeyDown={onKeyDown}
                  className="w-full input-apple min-h-[44px]"
                />
              </div>
              <div className="w-16 shrink-0">
                <label
                  htmlFor={`${baseId}-unit-${line.key}`}
                  className="text-caption-1 text-label-secondary block"
                >
                  {text("unit")}
                </label>
                <input
                  id={`${baseId}-unit-${line.key}`}
                  type="text"
                  maxLength={32}
                  value={line.unit}
                  onChange={(e) =>
                    updateLine(line.key, { unit: e.target.value })
                  }
                  onKeyDown={onKeyDown}
                  className="w-full input-apple min-h-[44px]"
                />
              </div>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${baseId}-name-${line.key}`}
                  className="text-caption-1 text-label-secondary block"
                >
                  {text("ingredient")}
                </label>
                <input
                  id={`${baseId}-name-${line.key}`}
                  type="text"
                  maxLength={200}
                  value={line.name}
                  onChange={(e) =>
                    updateLine(line.key, { name: e.target.value })
                  }
                  onKeyDown={onKeyDown}
                  className="w-full input-apple min-h-[44px]"
                />
              </div>
              <div className="w-full">
                <label
                  htmlFor={`${baseId}-note-${line.key}`}
                  className="text-caption-1 text-label-secondary block"
                >
                  {text("ingredientNote")}
                </label>
                <input
                  id={`${baseId}-note-${line.key}`}
                  type="text"
                  maxLength={200}
                  value={line.note}
                  onChange={(e) =>
                    updateLine(line.key, { note: e.target.value })
                  }
                  onKeyDown={onKeyDown}
                  className="w-full input-apple min-h-[44px]"
                />
              </div>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                aria-label={text("removeIngredient", { number: i + 1 })}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-secondary active:bg-[var(--surface-fill)]"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            className="inline-flex min-h-[44px] items-center gap-1 px-1 text-subhead text-[var(--accent-text)]"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {text("addIngredient")}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-footnote text-[var(--danger-text)]">
          {error}
        </p>
      )}

      {confirmed && (
        <div className="space-y-2">
          <p role={handoffFailed ? "alert" : "status"} className="text-footnote">{text(handoffFailed ? "savedHandoffFailed" : "savedConfirmed")}</p>
          <Link href={`/dashboard/meals/recipes/${encodeURIComponent(confirmed.id)}`} className="btn-tinted min-h-[44px] inline-flex items-center">{text("openConfirmedRecipe")}</Link>
        </div>
      )}
      {duplicate && (
        <Link
          className="btn-tinted min-h-[44px] inline-flex items-center"
          href={`/dashboard/meals/recipes/${encodeURIComponent(duplicate.id)}`}
          onClick={(event) => {
            if (mutationPending.current) event.preventDefault();
          }}
        >
          {text("openExisting", { title: duplicate.title })}
        </Link>
      )}
      {uncertain && !initialRecipe && (
        <div className="space-y-2">
          {receiptMessage && <p role={receiptFailed ? "alert" : "status"} className="text-footnote">{text(receiptMessage)}</p>}
          <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void inspectCreation()}>{text("inspectCreate")}</button>
          {receiptState?.state === "committed" && <Link href="/dashboard/meals/explore" className="btn-plain min-h-[44px] inline-flex items-center">{text("openRecipeBox")}</Link>}
          <details>
            <summary className="min-h-[44px] flex items-center cursor-pointer">{text("moreRecovery")}</summary>
            <button type="button" className="btn-plain min-h-[44px]" disabled={receiptState?.state === "committed" || receiptState?.state === "expired"}
              onClick={() => void retryCreation()}>{text("retryCreate")}</button>
          </details>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            if (mutationPending.current || disabled || isMutationPending?.())
              return;
            onCancel();
          }}
          className="btn-plain flex-1 min-h-[44px]"
        >
          {text(confirmed ? "closeConfirmed" : "cancel")}
        </button>
        <button
          type="button"
          disabled={uncertain || !!confirmed}
          onClick={() => void submit()}
          className="btn-tinted flex-1 min-h-[44px]"
        >
          {saving ? text("saving") : text("saveRecipe")}
        </button>
      </div>
    </fieldset>
  );
}
