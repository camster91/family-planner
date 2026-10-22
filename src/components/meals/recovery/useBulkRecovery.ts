"use client";
import * as React from "react";
import type { MealPrepContext } from "@/lib/meal-batches";
import { canonicalRequestJson } from "@/lib/idempotency-request-json";
import { sameQueueOwner } from "@/lib/queue-owner-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { browserPrepRecovery } from "@/lib/meal-prep-recovery/browser";
import {
  PrepOwnerChanged,
  readPrepContext,
  makePrepDraft,
  makePrepIntent,
  inspectPrepIntent,
  sendPrepIntent,
} from "@/lib/meal-prep-recovery/client";
import {
  prepDraft,
  prepDraftPayload,
  type PrepDraft,
  type PrepJournalEntry,
} from "@/lib/meal-prep-recovery/draft-contract";
import { prepDraftInput } from "@/lib/meal-prep-recovery/draft-input";
import type {
  PrepContext,
  PrepReceipt,
} from "@/lib/meal-prep-recovery/contract";
type Local = Extract<PrepJournalEntry, { kind: "local-prep-draft" }>;
type Inspection = Awaited<ReturnType<typeof inspectPrepIntent>>;
export function useBulkRecovery(
  scope: MealPrepContext | null,
  onChanged: (receipt: PrepReceipt) => void,
  recoveryRequested = false,
) {
  const store = React.useRef<ReturnType<typeof browserPrepRecovery> | null>(
      null,
    ),
    ctx = React.useRef<PrepContext | null>(null),
    local = React.useRef<Local | null>(null);
  const editAuthorized = React.useRef(false),
    attachingKey = React.useRef<string | null>(null);
  const reader = React.useRef<(() => PrepDraft) | null>(null),
    token = React.useRef<string | null>(null),
    formKeyRef = React.useRef<string | null>(null);
  const alive = React.useRef(false),
    epoch = React.useRef(0),
    operation = React.useRef(false),
    flushTail = React.useRef(Promise.resolve());
  const callback = React.useRef(onChanged);
  callback.current = onChanged;
  const [mode, setModeState] = React.useState<
      "loading" | "legacy" | "owned" | "held"
    >("loading"),
    modeRef = React.useRef(mode);
  const setMode = (value: typeof mode) => {
    modeRef.current = value;
    setModeState(value);
  };
  const [rows, setRows] = React.useState<PrepJournalEntry[]>([]),
    [draft, setDraft] = React.useState<PrepDraft | null>(null);
  const [formKey, setFormKeyState] = React.useState<string | null>(null),
    [active, setActive] = React.useState(false),
    [dirty, setDirty] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [busy, setBusy] = React.useState(false),
    [issue, setIssue] = React.useState<
      "owner" | "storage" | "held" | "invalid" | "load" | null
    >(null),
    [context, setContext] = React.useState<PrepContext | null>(null);
  const [confirmed, setConfirmed] = React.useState<Record<string, PrepReceipt>>(
      {},
    ),
    [inspections, setInspections] = React.useState<Record<string, Inspection>>(
      {},
    );
  const setFormKey = (value: string | null) => {
    formKeyRef.current = value;
    setFormKeyState(value);
  };
  React.useEffect(() => {
    alive.current = true;
    operation.current = false;
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, []);
  function failed(error: unknown) {
    if (
      error instanceof PrepOwnerChanged ||
      (error instanceof OwnedRequestRecoveryError &&
        error.reason === "OWNER_CHANGED")
    ) {
      editAuthorized.current = false;
      attachingKey.current = null;
      epoch.current++;
      operation.current = false;
      store.current = null;
      ctx.current = null;
      local.current = null;
      reader.current = null;
      token.current = null;
      setMode("held");
      setContext(null);
      setRows([]);
      setDraft(null);
      setFormKey(null);
      setConfirmed({});
      setInspections({});
      setActive(false);
      setDirty(false);
      setBusy(false);
      setIssue("owner");
    } else
      setIssue(
        store.current?.hasUncertainStorage()
          ? "storage"
          : error instanceof OwnedRequestRecoveryError
            ? "held"
            : "invalid",
      );
  }
  async function perform(run: (current: () => boolean) => Promise<void>) {
    if (operation.current || !alive.current) return;
    operation.current = true;
    setBusy(true);
    setIssue(null);
    const stamp = epoch.current;
    try {
      await run(() => alive.current && epoch.current === stamp);
    } catch (error) {
      if (alive.current && epoch.current === stamp) failed(error);
    } finally {
      if (alive.current && epoch.current === stamp) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function fresh() {
    const stamp = epoch.current,
      next = await readPrepContext(),
      old = ctx.current;
    if (!alive.current || epoch.current !== stamp)
      throw new Error("Bulk view ended");
    if (
      !old?.owner ||
      !next.owner ||
      !sameQueueOwner(old.owner, next.owner) ||
      old.userId !== next.userId ||
      old.familyId !== next.familyId ||
      old.role !== next.role
    )
      throw new PrepOwnerChanged();
    ctx.current = next;
    setContext(next);
    return next;
  }
  async function synchronize() {
    const selected = store.current,
      stamp = epoch.current;
    if (!selected) throw new Error("Bulk store unavailable");
    const entries = await selected.snapshot();
    if (!alive.current || stamp !== epoch.current || selected !== store.current)
      return;
    setRows(entries);
    local.current =
      entries.find((row): row is typeof row & Local => row.kind === "local-prep-draft") ??
      null;
    setDraft(
      local.current
        ? prepDraftPayload.parse(JSON.parse(local.current.body)).draft
        : null,
    );
  }
  async function load() {
    if (!scope && !recoveryRequested) return;
    if (
      scope &&
      ctx.current &&
      (scope.userId !== ctx.current.userId ||
        scope.familyId !== ctx.current.familyId)
    ) {
      failed(new PrepOwnerChanged());
      return;
    }
    await perform(async (current) => {
      const next = await readPrepContext();
      if (!current()) return;
      if (
        !next.owner ||
        (scope !== null &&
          (scope.userId !== next.userId || scope.familyId !== next.familyId)) ||
        (ctx.current?.owner && !sameQueueOwner(ctx.current.owner, next.owner))
      )
        throw new PrepOwnerChanged();
      const journal = store.current ?? browserPrepRecovery(next),
        entries = await journal.initialize();
      if (!current()) return;
      store.current = journal;
      ctx.current = next;
      setContext(next);
      setRows(entries);
      local.current =
        entries.find((row): row is typeof row & Local => row.kind === "local-prep-draft") ??
        null;
      setDraft(
        local.current
          ? prepDraftPayload.parse(JSON.parse(local.current.body)).draft
          : null,
      );
      setMode(next.enabled || journal.hasSavedJournal() ? "owned" : "legacy");
    });
  }
  const latestLoad = React.useRef(load);
  latestLoad.current = load;
  React.useEffect(() => {
    if (scope || recoveryRequested) void latestLoad.current();
    else if (ctx.current) failed(new PrepOwnerChanged());
  }, [scope?.userId, scope?.familyId, recoveryRequested]);
  function rawBody(raw: PrepDraft, currentContext: PrepContext) {
    return JSON.stringify(
      prepDraftPayload.parse({
        userId: currentContext.userId,
        familyId: currentContext.familyId,
        role: currentContext.role,
        generation: currentContext.owner!.generation,
        draft: prepDraft.parse(raw),
      }),
    );
  }
  function flush() {
    const next = flushTail.current.then(async () => {
      if (
        !editAuthorized.current ||
        !reader.current ||
        !local.current ||
        modeRef.current !== "owned"
      )
        return;
      const old = local.current,
        journal = store.current,
        currentContext = ctx.current,
        stamp = epoch.current;
      if (!journal || !currentContext)
        throw new Error("Bulk draft unavailable");
      const identity = token.current;
      const changed = {
        ...old,
        body: rawBody(reader.current(), currentContext),
      };
      if (changed.body !== old.body) {
        await journal.replaceLocalDraft(changed, old.body);
        if (alive.current && epoch.current === stamp) {
          local.current = changed;
          setDraft(prepDraftPayload.parse(JSON.parse(changed.body)).draft);
        }
      }
      if (
        alive.current &&
        epoch.current === stamp &&
        identity === token.current
      ) {
        const stillDirty =
          !!reader.current &&
          !!local.current &&
          rawBody(reader.current(), currentContext) !== local.current.body;
        setDirty(stillDirty);
        if (stillDirty) setRevision((value) => value + 1);
      }
    });
    flushTail.current = next.catch(() => undefined);
    return next;
  }
  async function attach(read: () => PrepDraft, identity: string) {
    if (modeRef.current !== "owned") return;
    if (operation.current && token.current === identity) return;
    if (token.current && token.current !== identity) {
      setIssue("held");
      return;
    }
    editAuthorized.current = false;
    attachingKey.current = null;
    token.current = identity;
    reader.current = read;
    setActive(true);
    setFormKey(null);
    await perform(async (current) => {
      const currentContext = await fresh();
      if (!current() || token.current !== identity) return;
      if (!currentContext.enabled || !store.current)
        throw new Error("Bulk editing paused");
      if (local.current) {
        const saved = prepDraftPayload.parse(
          JSON.parse(local.current.body),
        ).draft;
        if (
          canonicalRequestJson(saved) !==
          canonicalRequestJson(prepDraft.parse(read()))
        )
          throw new Error("Restore saved bulk work first");
        attachingKey.current = local.current.key;
      } else {
        const entry = makePrepDraft(prepDraft.parse(read()), currentContext);
        attachingKey.current = entry.key;
        await store.current.stage(entry);
        if (!current()) return;
        local.current = entry;
      }
      if (!current()) return;
      if (token.current !== identity) {
        await synchronize();
        return;
      }
      editAuthorized.current = true;
      setFormKey(local.current!.key);
      await flush();
      await synchronize();
    });
  }
  function detach(identity: string) {
    if (token.current !== identity) return;
    editAuthorized.current = false;
    attachingKey.current = null;
    token.current = null;
    reader.current = null;
    setActive(false);
    setFormKey(null);
    setDirty(false);
  }
  function changed(identity: string) {
    if (
      !editAuthorized.current ||
      modeRef.current !== "owned" ||
      token.current !== identity ||
      !reader.current ||
      !local.current ||
      operation.current
    )
      return;
    setDirty(true);
    setRevision((value) => value + 1);
  }
  React.useEffect(() => {
    if (!dirty || busy || issue === "storage" || issue === "owner") return;
    const stamp = epoch.current,
      timer = setTimeout(() => {
        void flush().catch((error) => {
          if (alive.current && epoch.current === stamp) failed(error);
        });
      }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, busy, issue, revision]);
  async function sent(key: string, current: () => boolean) {
    const journal = store.current;
    if (!journal) throw new Error("Bulk store unavailable");
    const result = await journal.send(key, true, async (entry, ownerScope) => {
      if (entry.kind !== "meal-prep") throw new Error("Not a network intent");
      const currentContext = await fresh();
      if (currentContext.owner?.scope !== ownerScope)
        throw new PrepOwnerChanged();
      return sendPrepIntent(entry, currentContext);
    });
    if (!current()) return;
    if (result.kind === "confirmed") {
      setConfirmed((old) => ({ ...old, [key]: result.receipt }));
      callback.current(result.receipt);
    }
    await synchronize();
  }
  async function save(input: unknown, url: string) {
    await perform(async (current) => {
      if (
        !editAuthorized.current ||
        modeRef.current !== "owned" ||
        !reader.current ||
        !local.current ||
        !store.current ||
        local.current.key !== formKeyRef.current
      )
        throw new Error("Bulk editable draft required");
      const currentContext = await fresh();
      const raw = prepDraft.parse(reader.current()),
        actual = prepDraftInput(raw, currentContext);
      if (
        (raw.kind === "create"
          ? "/api/meals/bulk"
          : "/api/meals/bulk/actions") !== url ||
        canonicalRequestJson(actual) !== canonicalRequestJson(input)
      )
        throw new Error("Bulk form changed before save");
      await flush();
      if (
        canonicalRequestJson(prepDraft.parse(reader.current())) !==
          canonicalRequestJson(raw) ||
        canonicalRequestJson(
          prepDraftPayload.parse(JSON.parse(local.current.body)).draft,
        ) !== canonicalRequestJson(raw)
      )
        throw new Error("Bulk form changed while saving");
      const entry = makePrepIntent(actual, currentContext, local.current.key);
      await store.current.promoteLocalDraft(entry, local.current.body);
      if (!current()) return;
      local.current = null;
      setDraft(null);
      setDirty(false);
      setFormKey(entry.key);
      await synchronize();
      await sent(entry.key, current);
    });
  }
  async function inspect(key: string) {
    await perform(async (current) => {
      await flush();
      if (!store.current) throw new Error("Bulk store unavailable");
      const proof = await store.current.inspect(
        key,
        async (entry, currentContext) => {
          if (entry.kind !== "meal-prep")
            throw new Error("Not a network intent");
          return inspectPrepIntent(entry, currentContext);
        },
      );
      if (!current()) return;
      setInspections((old) => ({ ...old, [key]: proof }));
      if (proof.state === "committed" && proof.receipt) {
        setConfirmed((old) => ({ ...old, [key]: proof.receipt! }));
        callback.current(proof.receipt);
      }
    });
  }
  async function retry(key: string) {
    await perform(async (current) => {
      await flush();
      await sent(key, current);
    });
  }
  async function dismiss(key: string) {
    await perform(async (current) => {
      if (local.current?.key !== key) await flush();
      if (formKeyRef.current === key)
        throw new Error("Close this form before removing its work");
      await store.current?.dismiss(key);
      if (!current()) return;
      setConfirmed((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      setInspections((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      await synchronize();
    });
  }
  async function reloadStored(onLoaded: () => void) {
    await perform(async (current) => {
      if (!store.current || store.current.hasUncertainStorage())
        throw new Error("Repair the exact storage change first");
      await fresh();
      await store.current.initialize();
      if (!current()) return;
      editAuthorized.current = false;
      attachingKey.current = null;
      reader.current = null;
      token.current = null;
      setActive(false);
      setDirty(false);
      setFormKey(null);
      await synchronize();
      if (current()) onLoaded();
    });
  }
  async function repair() {
    await perform(async (current) => {
      const originalKey = local.current?.key ?? formKeyRef.current;
      await store.current?.recoverStorage();
      if (!current()) return;
      await synchronize();
      if (
        local.current &&
        reader.current &&
        (local.current.key === attachingKey.current ||
          local.current.key === originalKey)
      ) {
        editAuthorized.current = true;
        setFormKey(local.current.key);
        await flush();
      } else if (
        originalKey &&
        (await store.current!.snapshot()).some(
          (row) => row.key === originalKey && row.kind === "meal-prep",
        )
      ) {
        setFormKey(originalKey);
        setDirty(false);
      }
    });
  }
  async function prepareLeave() {
    const stamp = epoch.current;
    if (
      operation.current ||
      store.current?.hasUncertainStorage() ||
      issue === "owner"
    )
      return false;
    try {
      await flush();
      if (modeRef.current === "owned") await store.current?.snapshot();
      const unchanged =
        !editAuthorized.current ||
        !reader.current ||
        !local.current ||
        (!!ctx.current &&
          rawBody(reader.current(), ctx.current) === local.current.body);
      return (
        unchanged &&
        alive.current &&
        epoch.current === stamp &&
        !store.current?.hasUncertainStorage()
      );
    } catch (error) {
      failed(error);
      return false;
    }
  }
  const privacyHold =
    issue === "owner" ||
    (!!scope &&
      !!context &&
      (scope.userId !== context.userId || scope.familyId !== context.familyId));
  return {
    mode: privacyHold ? ("held" as const) : mode,
    context: privacyHold ? null : context,
    rows: privacyHold ? [] : rows,
    draft: privacyHold ? null : draft,
    active,
    dirty,
    formKey: privacyHold ? null : formKey,
    confirmed: privacyHold ? ({} as Record<string, PrepReceipt>) : confirmed,
    inspections: privacyHold ? ({} as Record<string, Inspection>) : inspections,
    busy,
    issue,
    privacyHold,
    held:
      privacyHold ||
      mode === "held" ||
      issue === "storage" ||
      issue === "held",
    load,
    attach,
    detach,
    changed,
    save,
    inspect,
    retry,
    dismiss,
    repair,
    reloadStored,
    prepareLeave,
    isBusy: () => operation.current,
    storageUncertain: () => store.current?.hasUncertainStorage() ?? false,
    clearError: () => {
      if (issue === "invalid") setIssue(null);
    },
  };
}
export type BulkRecovery = ReturnType<typeof useBulkRecovery>;
