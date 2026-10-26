"use client";
import * as React from "react";
import { useReviewRecoveryText } from "@/i18n/review-recovery";
import { MealContextLink as Link } from "./MealContextLink";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useRecipeEditorText } from "@/i18n/recipe-editor";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { navigateAfterOwnedDrafts } from "@/lib/owned-draft-exit";
import { useOwnedDraftExit } from "@/components/layout/owned-draft-navigation";
import { useRoutineLinkNavigation } from "@/components/chores/useRoutineLinkNavigation";
import {
  browserReviewDocument,
  readReviewDocumentContext,
} from "@/lib/review-document-browser";
import {
  reviewDocumentPayload,
  type ReviewDocumentContext,
  type ReviewDocumentEntry,
  type RecipeEditableDocument,
} from "@/lib/review-document-contract";
import {
  newReviewDocument,
  type ReviewReceiptState,
} from "@/lib/review-document-store";
import { inspectReviewDocumentReceipt } from "@/lib/review-document-receipts";
import { submitReviewDocumentRequest } from "@/lib/review-document-submit";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner } from "@/lib/recipe-owner-contract";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import type { RecipeEditorProps, RecipeOwnedFormProps } from "./RecipeEditor";

type View =
  | "loading"
  | "choose"
  | "editing"
  | "submitted"
  | "legacy"
  | "hold"
  | "completed";
const documentOf = (entry: ReviewDocumentEntry) =>
  reviewDocumentPayload.parse(JSON.parse(entry.body));
const recipeReply = z.object({
  recipe: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    title: z.string(),
    prep_time: z.number().nullable(),
    cook_time: z.number().nullable(),
    servings: z.number(),
    source_url: z.string().max(1500).nullable().optional(),
  }),
});

/** All canonical creates, including imports and meal quick-add, share one
 * explicitly restored personal document. Existing-recipe edits stay separate.
 */
export function RecipeDraftBoundary(
  props: RecipeEditorProps & {
    renderForm: (
      owned: RecipeOwnedFormProps & Partial<RecipeEditorProps>,
    ) => React.ReactNode;
  },
) {
  const text = useRecipeEditorText(),
    router = useRouter();
  const recoveryText = useReviewRecoveryText();
  const recoveryTextRef = React.useRef(recoveryText);
  recoveryTextRef.current = recoveryText;
  const callbacks = React.useRef(props);
  callbacks.current = props;
  const originalRecipeOwner = React.useRef(props.expectedRecipeOwner ? Object.freeze({ ...props.expectedRecipeOwner }) : null);
  const inspectRecipeReceipt = React.useCallback((
    request: Parameters<typeof inspectReviewDocumentReceipt>[0], reviewContext: ReviewDocumentContext,
  ) => inspectReviewDocumentReceipt(request, reviewContext, originalRecipeOwner.current ?? undefined), []);
  const context = React.useRef<ReviewDocumentContext | null>(null);
  const store = React.useRef<ReturnType<typeof browserReviewDocument> | null>(
    null,
  );
  const entry = React.useRef<ReviewDocumentEntry | null>(null);
  const latest = React.useRef<RecipeEditableDocument | null>(null);
  const terminalRefusal = React.useRef<{
    body: string;
    code: "RECIPE_SOURCE_EXISTS" | "RECIPE_SOURCE_CHECK_UNAVAILABLE";
  } | null>(null);
  const discardedWhileHidden = React.useRef(false);
  const acknowledged = React.useRef("");
  const mounted = React.useRef(false),
    epoch = React.useRef(0),
    flight = React.useRef(false);
  const initialized = React.useRef(false);
  const authorized = React.useRef(false);
  const retiredOwner = React.useRef(false);
  const idle = React.useRef<Promise<void>>(Promise.resolve());
  const viewRef = React.useRef<View>("loading");
  const [view, setViewState] = React.useState<View>("loading");
  const [visible, setVisible] = React.useState(false),
    [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false),
    [notice, setNotice] = React.useState<string | null>(null);
  const [seed, setSeed] = React.useState<RecipeEditableDocument>();
  const [formGeneration, setFormGeneration] = React.useState(0);
  const [receipt, setReceipt] = React.useState<ReviewReceiptState | null>(null);
  const [confirmedCompletion, setConfirmedCompletion] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  function setView(next: View) {
    viewRef.current = next;
    setViewState(next);
  }
  function live(token: number) {
    return (
      mounted.current &&
      epoch.current === token &&
      document.visibilityState !== "hidden"
    );
  }
  async function current() {
    const originalOwner = originalRecipeOwner.current;
    if ((originalOwner || callbacks.current.expectedRecipeOwner) &&
        !sameRecipeOwner(originalOwner, callbacks.current.expectedRecipeOwner ?? null))
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const next = await readReviewDocumentContext("recipe", originalOwner ?? undefined);
    if (originalOwner && (next.userId !== originalOwner.actorId || next.familyId !== originalOwner.familyId || next.role !== originalOwner.role))
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const expected = callbacks.current.recoveryIdentity;
    if (
      expected &&
      (expected.userId !== next.userId || expected.familyId !== next.familyId)
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const prior = context.current;
    const changed =
      prior &&
      (prior.userId !== next.userId ||
        prior.familyId !== next.familyId ||
        prior.role !== next.role ||
        prior.adopted !== next.adopted ||
        (prior.adopted &&
          (!prior.owner ||
            !next.owner ||
            !sameQueueOwner(prior.owner, next.owner))));
    if ((next.adopted && !next.owner) || changed)
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    context.current = next;
    return next;
  }
  async function run(task: (token: number) => Promise<void>) {
    if (flight.current) return false;
    flight.current = true;
    let finishIdle!: () => void;
    idle.current = new Promise<void>((resolve) => {
      finishIdle = resolve;
    });
    setBusy(true);
    callbacks.current.onSavingChange?.(true);
    const token = epoch.current;
    try {
      await task(token);
      return live(token);
    } catch (error) {
      if (live(token)) {
        const ownerChanged =
          error instanceof OwnedRequestRecoveryError &&
          error.reason === "OWNER_CHANGED";
        setNotice(
          recoveryTextRef.current[
            error instanceof OwnedRequestRecoveryError
              ? error.reason
              : "UNAVAILABLE"
          ],
        );
        if (ownerChanged) {
          retiredOwner.current = true;
          authorized.current = false;
          setVisible(false);
          setView("hold");
          latest.current = null;
          setSeed(undefined);
          setDuplicate(null);
          setReceipt(null);
          callbacks.current.onOwnerHold?.();
        }
      }
      return false;
    } finally {
      flight.current = false;
      finishIdle();
      if (mounted.current) {
        setBusy(false);
        callbacks.current.onSavingChange?.(
          viewRef.current === "editing" &&
            JSON.stringify(latest.current) !== acknowledged.current,
        );
        if (token !== epoch.current && document.visibilityState !== "hidden")
          void run(load);
      }
    }
  }
  function emptyView(enabled: boolean): View {
    return callbacks.current.recoveryOnly
      ? "completed"
      : enabled
        ? "editing"
        : "legacy";
  }
  async function load(token: number) {
    if (
      new URLSearchParams(window.location.search)
        .getAll("mode")
        .includes("fridge") ||
      window.location.pathname.startsWith("/device")
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    const next = await current();
    if (!next.adopted) {
      if (live(token)) {
        setView(callbacks.current.recoveryOnly ? "hold" : "legacy");
        setVisible(!callbacks.current.recoveryOnly);
        setNotice(
          callbacks.current.recoveryOnly
            ? text("draftRecoveryUnavailable")
            : null,
        );
      }
      return;
    }
    store.current ??= browserReviewDocument(next, originalRecipeOwner.current ?? undefined);
    const rows = initialized.current
      ? await store.current.refresh()
      : await store.current.initialize();
    initialized.current = true;
    await current();
    if (!live(token)) return;
    entry.current = rows[0] ?? null;
    if (discardedWhileHidden.current) {
      discardedWhileHidden.current = false;
      setSeed(undefined);
      setFormGeneration((value) => value + 1);
      setDirty(false);
      setView(emptyView(next.enabled));
    } else if (viewRef.current === "submitted" && !entry.current) {
      setView("completed");
    }
    if (
      viewRef.current === "loading" ||
      viewRef.current === "hold" ||
      (viewRef.current === "submitted" &&
        entry.current &&
        documentOf(entry.current).phase === "editing")
    ) {
      if (entry.current)
        setView(
          documentOf(entry.current).phase === "submitted"
            ? "submitted"
            : "choose",
        );
      else setView(emptyView(next.enabled));
    }
    authorized.current = true;
    setVisible(true);
    setNotice(null);
  }
  React.useEffect(() => {
    mounted.current = true;
    void run(load);
    const hide = () => {
      authorized.current = false;
      epoch.current += 1;
      setVisible(false);
    };
    const refresh = () => {
      if (document.visibilityState !== "hidden") {
        authorized.current = false;
        epoch.current += 1;
        setVisible(false);
        void run(load);
      }
    };
    const visibility = () =>
      document.visibilityState === "hidden" ? hide() : refresh();
    window.addEventListener("blur", hide);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      authorized.current = false;
      epoch.current += 1;
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
    // One controller belongs to the first authenticated identity; never migrate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flush(draft = latest.current) {
    if (!draft || viewRef.current !== "editing") return;
    const next = await current();
    const saved = entry.current;
    if (
      saved &&
      JSON.stringify(documentOf(saved).draft) === JSON.stringify(draft)
    ) {
      await store.current!.read(saved.key); // Same owner + exact baseline, not merely a React comparison.
      acknowledged.current = JSON.stringify(draft);
      return;
    }
    if (!next.enabled) throw new OwnedRequestRecoveryError("DISABLED");
    const provenance = saved
      ? documentOf(saved).provenance
      : {
          source: draft.sourceUrl
            ? ("recipe-link" as const)
            : ("manual" as const),
          sourceUrl: draft.sourceUrl,
          confidence: "unknown" as const,
          unknowns: draft.servings.trim() ? [] : ["servings"],
          evaluatedAt: null,
        };
    entry.current = saved
      ? await store.current!.save(saved.key, saved.body, draft, provenance)
      : await store.current!.begin(
          newIdempotencyKey(),
          newReviewDocument(next, draft, provenance, Date.now()),
        );
    acknowledged.current = JSON.stringify(draft);
  }
  const onDraftChange = React.useCallback((draft: RecipeEditableDocument) => {
    latest.current = draft;
    if (viewRef.current === "editing") {
      const needsSave = JSON.stringify(draft) !== acknowledged.current;
      setDirty(needsSave);
      if (!store.current?.hasUncertainStorage()) setNotice(null);
      callbacks.current.onSavingChange?.(needsSave || flight.current);
    }
  }, []);
  React.useEffect(() => {
    if (!dirty || !visible || busy || notice || view !== "editing") return;
    const timer = window.setTimeout(() => {
      void run(async (token) => {
        await flush();
        if (live(token)) {
          setDirty(JSON.stringify(latest.current) !== acknowledged.current);
          setNotice(null);
        }
      });
    }, 500);
    return () => window.clearTimeout(timer);
    // Latest form lives in a ref; a change during a write remains dirty afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, visible, busy, view, notice]);

  const navigation = usePendingFormNavigationController(
    view !== "legacy" && (view === "editing" || busy || dirty),
    {
      warnOnUnload: busy || dirty,
      onBack: () => {
        void close();
      },
    },
  );
  async function prepareLeave() {
    if (retiredOwner.current) return true;
    if (flight.current) await idle.current;
    if (
      !authorized.current ||
      document.visibilityState === "hidden" ||
      callbacks.current.disabled ||
      callbacks.current.isMutationPending?.()
    )
      return false;
    let prepared = false;
    const checked = await run(async (token) => {
      if (viewRef.current === "editing") {
        await flush();
        if (
          latest.current &&
          JSON.stringify(latest.current) !== acknowledged.current
        )
          throw new OwnedRequestRecoveryError("INTENT_CHANGED");
        if (live(token)) setDirty(false);
      } else await current();
      prepared = live(token) && authorized.current;
    });
    return checked && prepared;
  }
  async function releaseLeave() {
    const token = epoch.current;
    return (
      (retiredOwner.current || authorized.current) &&
      (await navigation.releaseBeforeNavigation()) &&
      live(token)
    );
  }
  useOwnedDraftExit(
    view !== "legacy" && context.current?.adopted !== false,
    prepareLeave,
    releaseLeave,
  );
  async function close(href?: string) {
    if (!mounted.current) return;
    await navigateAfterOwnedDrafts(() => {
      if (href) router.push(href);
      else callbacks.current.onCancel();
    });
  }
  useRoutineLinkNavigation(
    view !== "legacy" && (view === "editing" || dirty || busy),
    async (href) => {
      await close(href);
    },
  );

  async function recover() {
    await run(async (token) => {
      if (!store.current) {
        await load(token);
        return;
      }
      const oldBody = entry.current?.body;
      const rows = store.current.hasUncertainStorage()
        ? await store.current.recoverStorage()
        : await store.current.initialize();
      await current();
      if (!live(token)) return;
      initialized.current = true;
      entry.current = rows[0] ?? null;
      const saved = entry.current ? documentOf(entry.current) : null;
      setReceipt(null);
      setDuplicate(null);
      setNotice(null);
      authorized.current = true;
      setVisible(true);
      if (saved?.phase === "submitted") setView("submitted");
      else if (
        saved &&
        (latest.current === null || entry.current?.body !== oldBody)
      )
        setView("choose");
      else setView(emptyView(context.current!.enabled));
      setDirty(
        latest.current !== null &&
          JSON.stringify(latest.current) !== JSON.stringify(saved?.draft),
      );
    });
  }
  async function restore() {
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      const result = await store.current!.read(saved.key);
      if (
        result.entry.body !== saved.body ||
        result.document.phase !== "editing" ||
        result.document.draft.domain !== "recipe"
      )
        throw new OwnedRequestRecoveryError("INTENT_CHANGED");
      if (!live(token)) return;
      latest.current = result.document.draft;
      acknowledged.current = JSON.stringify(result.document.draft);
      setSeed(result.document.draft);
      setFormGeneration((value) => value + 1);
      setDirty(false);
      setView("editing");
    });
  }
  async function discard() {
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      await store.current!.discardEditable(saved.key, saved.body);
      entry.current = null;
      latest.current = null;
      acknowledged.current = "";
      discardedWhileHidden.current = true;
      if (!live(token)) return;
      discardedWhileHidden.current = false;
      setSeed(undefined);
      setFormGeneration((value) => value + 1);
      setDirty(false);
      setNotice(null);
      setView(emptyView(context.current!.enabled));
    });
  }
  function observeReceipt(
    proof: ReviewReceiptState,
    saved: ReviewDocumentEntry,
  ) {
    if (proof.state === "refused" && proof.reason) {
      terminalRefusal.current = {
        body: saved.body,
        code:
          proof.reason === "source-exists"
            ? "RECIPE_SOURCE_EXISTS"
            : "RECIPE_SOURCE_CHECK_UNAVAILABLE",
      };
    } else terminalRefusal.current = null;
    setReceipt(proof);
    setNotice(null);
  }
  async function send(token: number) {
    const onConfirmed = callbacks.current.onCreated;
    const saved = entry.current;
    if (!saved) throw new OwnedRequestRecoveryError("INTENT_CHANGED");
    const document = documentOf(saved);
    if (document.phase !== "submitted")
      throw new OwnedRequestRecoveryError("INTENT_CHANGED");
    const result = await store.current!.sendExact(
      saved.key,
      saved.body,
      document.requests[0].key,
      inspectRecipeReceipt,
      (request, context) =>
        submitReviewDocumentRequest(request, context, document.expiresAt, originalRecipeOwner.current ?? undefined),
    );
    if (!live(token)) return;
    if (!result.sent) {
      observeReceipt(result.receipt, saved);
      return;
    }
    if (result.result.kind !== "reply") {
      setNotice(text("uncertainCreate"));
      return;
    }
    const response = result.result,
      data = response.body;
    const expectedOwner = originalRecipeOwner.current;
    if (expectedOwner && ([401, 403].includes(response.response.status) ||
        (data as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED" ||
        (response.response.ok && !sameRecipeOwner(expectedOwner,
          readRecipeOwner(response.response.headers?.get(RECIPE_OWNER_HEADER) ?? null)))))
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    if (!response.response.ok) {
      const refusal = z
        .object({
          error: z.object({ code: z.string() }),
          existingRecipe: z
            .object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
              title: z.string().max(200),
            })
            .optional(),
        })
        .safeParse(data);
      if (
        refusal.success &&
        refusal.data.error.code === "RECIPE_SOURCE_EXISTS" &&
        refusal.data.existingRecipe
      ) {
        setDuplicate(refusal.data.existingRecipe);
        setReceipt({ state: "duplicate-source" });
        terminalRefusal.current = {
          body: saved.body,
          code: "RECIPE_SOURCE_EXISTS",
        };
        setNotice(text("draftSourceRefused"));
      } else if (
        refusal.success &&
        refusal.data.error.code === "RECIPE_SOURCE_CHECK_UNAVAILABLE"
      ) {
        // A terminal canonical refusal is distinct from a lost/409-in-progress reply.
        setNotice(text("sourceCheckUnavailable"));
        setReceipt({ state: "refused" });
        terminalRefusal.current = {
          body: saved.body,
          code: "RECIPE_SOURCE_CHECK_UNAVAILABLE",
        };
      } else setNotice(text("uncertainCreate"));
      return;
    }
    const parsed = recipeReply.safeParse(data);
    if (!parsed.success) {
      setNotice(text("uncertainCreate"));
      return;
    }
    const confirmed = await store.current!.retireConfirmed(
      saved.key,
      saved.body,
      inspectRecipeReceipt,
    );
    if (!live(token)) return;
    if (!confirmed) {
      setNotice(text("uncertainCreate"));
      return;
    }
    entry.current = null;
    setDirty(false);
    setConfirmedCompletion(true);
    setView("completed");
    if (!(await navigation.releaseBeforeNavigation()) || !live(token)) return;
    try { onConfirmed?.(parsed.data.recipe); }
    catch { if (live(token)) setNotice(text("savedHandoffFailed")); }
  }
  async function submit(
    body: Record<string, unknown>,
    draft: RecipeEditableDocument,
  ) {
    if (flight.current) await idle.current;
    if (
      !visible ||
      callbacks.current.disabled ||
      callbacks.current.isMutationPending?.()
    )
      return;
    await run(async (token) => {
      latest.current = draft;
      await flush(draft);
      const saved = entry.current!;
      entry.current = await store.current!.freeze(saved.key, saved.body, [
        {
          key: newIdempotencyKey(),
          action: "recipe.create",
          body: JSON.stringify(body),
        },
      ]);
      if (!live(token)) return;
      terminalRefusal.current = null;
      setDirty(false);
      setView("submitted");
      setReceipt(null);
      setNotice(null);
      await send(token);
    });
  }
  async function returnToDraft() {
    await run(async (token) => {
      const saved = entry.current,
        terminal = terminalRefusal.current;
      if (!saved || !terminal || terminal.body !== saved.body) return;
      const document = documentOf(saved);
      if (document.phase !== "submitted" || document.draft.domain !== "recipe")
        return;
      const released = await store.current!.releaseRefused(
        saved.key,
        saved.body,
        newIdempotencyKey(),
        async (request, context) => {
          const proof = await inspectRecipeReceipt(request, context);
          const reason =
            terminal.code === "RECIPE_SOURCE_EXISTS"
              ? "source-exists"
              : "source-check-unavailable";
          if (
            proof.state !== "refused" ||
            proof.reason !== reason ||
            terminalRefusal.current !== terminal
          )
            return null;
          return {
            requestKey: request.key,
            requestBody: request.body,
            code: terminal.code,
          };
        },
      );
      if (!released) return;
      entry.current = released;
      if (!live(token)) return;
      terminalRefusal.current = null;
      latest.current = document.draft;
      acknowledged.current = JSON.stringify(document.draft);
      setSeed(document.draft);
      setFormGeneration((value) => value + 1);
      setReceipt(null);
      setDuplicate(null);
      setNotice(null);
      setDirty(false);
      setView("editing");
    });
  }
  async function inspect() {
    await run(async (token) => {
      const saved = entry.current;
      if (!saved) return;
      const states = await store.current!.inspectReceipts(
        saved.key,
        saved.body,
        inspectRecipeReceipt,
      );
      if (live(token)) {
        observeReceipt(states[0], saved);
        setNotice(null);
      }
    });
  }
  async function finish() {
    await run(async (token) => {
      const saved = entry.current;
      if (
        !saved ||
        !(await store.current!.retireConfirmed(
          saved.key,
          saved.body,
          inspectRecipeReceipt,
        ))
      )
        return;
      if (!live(token)) return;
      entry.current = null;
      if ((await navigation.releaseBeforeNavigation()) && live(token))
        callbacks.current.onCancel();
    });
  }
  const message =
    receipt?.state === "committed"
      ? text(
          receipt.current === "present"
            ? "draftCommitted"
            : receipt.current === "removed"
              ? "draftRemoved"
              : "draftOpaque",
        )
      : receipt
        ? text(
            receipt.state === "absent"
              ? "draftAbsent"
              : receipt.state === "pending"
                ? "draftPending"
                : receipt.state === "expired"
                  ? "expiredCreate"
                  : receipt.state === "duplicate-source" ||
                      (receipt.state === "refused" &&
                        receipt.reason === "source-exists")
                    ? "draftSourceRefused"
                    : receipt.state === "refused" &&
                        receipt.reason === "source-check-unavailable"
                      ? "sourceCheckUnavailable"
                      : "draftRefused",
          )
        : null;
  return (
    <section className="space-y-3" aria-label={text("newRecipe")}>
      {(!visible || view === "loading") && (
        <p role="status">{text("draftChecking")}</p>
      )}
      {notice && (
        <p role="alert" className="text-footnote text-[var(--danger-text)]">
          {notice}
        </p>
      )}
      <div hidden={!visible} className="space-y-3">
        {view === "editing" && !context.current?.enabled && (
          <p role="status">{text("draftPaused")}</p>
        )}
        {view === "editing" && !context.current?.enabled && (
          <button
            type="button"
            className="btn-plain min-h-11"
            disabled={busy}
            onClick={() => void close()}
          >
            {text("draftCloseKeep")}
          </button>
        )}
        {view === "choose" && (
          <div className="space-y-2">
            <p>{text("draftFound")}</p>
            <button
              type="button"
              className="btn-tinted min-h-11"
              disabled={busy}
              onClick={() => void restore()}
            >
              {text("draftRestore")}
            </button>
            <button
              type="button"
              className="btn-plain min-h-11"
              disabled={busy}
              onClick={() => {
                if (window.confirm(text("draftDiscardConfirm"))) void discard();
              }}
            >
              {text("draftDiscard")}
            </button>
          </div>
        )}
        {(view === "editing" || view === "legacy") && (
          <div key={formGeneration}>
            {view === "editing" && (
              <p role="status" className="text-caption-1 text-label-secondary">
                {text(dirty || !entry.current ? "draftSaving" : "draftSaved")}
              </p>
            )}
            {view === "editing" && entry.current && (
              <button
                type="button"
                className="btn-plain min-h-11"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(text("draftDiscardConfirm")))
                    void discard();
                }}
              >
                {text("draftDiscard")}
              </button>
            )}
            {props.renderForm(
              view === "legacy"
                ? {}
                : {
                    initialOwnedDraft: seed,
                    onDraftChange,
                    onOwnedSubmit: submit,
                    onCancel: () => {
                      void close();
                    },
                    disabled:
                      props.disabled ||
                      !context.current?.enabled ||
                      store.current?.hasUncertainStorage(),
                  },
            )}
          </div>
        )}
        {view === "completed" && (
          <div className="space-y-2">
            <p role="status">{text(confirmedCompletion ? "draftCommitted" : "draftReviewClosed")}</p>
            <Link
              className="btn-plain min-h-11"
              href="/dashboard/meals/explore"
            >
              {text("draftRecipeBox")}
            </Link>
            <button
              type="button"
              className="btn-plain min-h-11"
              disabled={busy}
              onClick={() => void close()}
            >
              {text("draftCloseKeep")}
            </button>
          </div>
        )}
        {view === "submitted" && (
          <div className="space-y-2">
            <p>{text("draftSubmitted")}</p>
            {message && <p role="status">{message}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={busy}
                onClick={() => void inspect()}
              >
                {text("draftInspect")}
              </button>
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={busy || !context.current?.enabled}
                onClick={() => void run(send)}
              >
                {text("retryCreate")}
              </button>
              {terminalRefusal.current &&
                terminalRefusal.current.body === entry.current?.body && (
                  <button
                    type="button"
                    className="btn-plain min-h-11"
                    disabled={busy}
                    onClick={() => void returnToDraft()}
                  >
                    {text("draftReturn")}
                  </button>
                )}
              {receipt?.state === "committed" &&
                receipt.current === "present" && (
                  <button
                    type="button"
                    className="btn-plain min-h-11"
                    disabled={busy}
                    onClick={() => void finish()}
                  >
                    {text("draftFinish")}
                  </button>
                )}
              <button
                type="button"
                className="btn-plain min-h-11"
                disabled={busy}
                onClick={() => void close()}
              >
                {text("draftCloseKeep")}
              </button>
            </div>
            <Link
              className="btn-plain min-h-11"
              href={
                duplicate
                  ? `/dashboard/meals/recipes/${encodeURIComponent(duplicate.id)}`
                  : "/dashboard/meals/explore"
              }
            >
              {duplicate
                ? text("openExisting", { title: duplicate.title })
                : text("draftRecipeBox")}
            </Link>
          </div>
        )}
      </div>
      {(notice || !visible) && (
        <button
          type="button"
          className="btn-tinted min-h-11"
          disabled={busy}
          onClick={() => void recover()}
        >
          {text("draftRecover")}
        </button>
      )}
    </section>
  );
}
