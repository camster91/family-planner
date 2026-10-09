"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import {
  accountDeletionMessages,
  type AccountDeletionMessage,
} from "@/i18n/account-deletion";
import Link from "next/link";
import { Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  AccountDeletionLoading,
  AccountDeletionFailure,
} from "./AccountDeletionStatus";
import { downloadMyData } from "@/lib/data-export-client";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  ACCOUNT_DELETE_PHRASE,
  confirmationMatches,
  type DeletionOptions,
} from "@/lib/account-deletion-shared";

/**
 * Delete account / delete household (docs/product/ACCOUNT_DELETION.md).
 *
 * Built in the page (no browser confirm): it loads what the member may delete
 * (`GET /api/users/deletion`), offers the data export first, then asks for the
 * current password and a typed confirmation: "DELETE" for an account, the
 * household name for a household. The destructive button stays disabled until
 * both are filled in and the typed text matches.
 *
 * - A teen, child, or parent with another parent: deletes their own account
 *   (`DELETE /api/users`).
 * - The only parent: can invite another parent first, or delete the whole
 *   household with every member account (`DELETE /api/family`).
 *
 * The request carries an Idempotency-Key. If the network drops, it is sent
 * again once with the same key; a 401 on that retry means the first request
 * already deleted the account (its session is gone), so it counts as done.
 */

type Feedback =
  | {
      kind: "owned";
      key: "noConnection" | "stillWorking" | "sessionEnded" | "nothingDeleted";
    }
  | { kind: "server"; text: string };

type Phase =
  | { kind: "loading" }
  | { kind: "load-error" }
  | { kind: "ready"; options: DeletionOptions };

export interface DeleteAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /** After a successful deletion. Defaults to a full navigation to the sign-in page. */
  onDeleted?: (mode: "account" | "household") => void;
  /**
   * False where only the member's own account may be deleted (the user menu
   * for teens and children): household deletion is never offered, even if the
   * server would allow it.
   */
  allowHousehold?: boolean;
}

function defaultOnDeleted(mode: "account" | "household") {
  window.location.assign(`/login?deleted=${mode}`);
}

export default function DeleteAccountDialog({
  open,
  onClose,
  onDeleted = defaultOnDeleted,
  allowHousehold = true,
}: DeleteAccountDialogProps) {
  const { t } = useTranslation();
  const msg = (
    key: AccountDeletionMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, accountDeletionMessages);
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [password, setPassword] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Feedback | null>(null);
  const [exportState, setExportState] = React.useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const keyRef = React.useRef<string | null>(null);
  // True while `keyRef` belongs to an attempt whose outcome is unknown (the
  // network dropped twice) or that the server reported as still running. If
  // that attempt went on to delete the account, a later request with the same
  // key is answered 401 (the session is gone): that 401 means "done".
  const pendingRef = React.useRef(false);

  const load = React.useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/users/deletion", { cache: "no-store" });
      if (!res.ok) throw new Error("options");
      setPhase({
        kind: "ready",
        options: (await res.json()) as DeletionOptions,
      });
    } catch {
      setPhase({ kind: "load-error" });
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setPassword("");
    setTyped("");
    setError(null);
    setBusy(false);
    setExportState("idle");
    // Keep a key whose request may still have deleted the account.
    if (!pendingRef.current) keyRef.current = null;
    void load();
  }, [open, load]);

  const options = phase.kind === "ready" ? phase.options : null;
  const householdMode = allowHousehold && Boolean(options?.canDeleteHousehold);
  const blocked = options ? !options.canDeleteAccount && !householdMode : false;
  const householdName = options?.household?.name ?? "";
  const expected = householdMode ? householdName : ACCOUNT_DELETE_PHRASE;
  const ready =
    Boolean(options) &&
    !blocked &&
    password.length > 0 &&
    confirmationMatches(typed, expected);

  const handleExport = async () => {
    setExportState("working");
    try {
      await downloadMyData();
      setExportState("done");
    } catch {
      setExportState("error");
    }
  };

  const send = async (key: string): Promise<Response> => {
    const url = householdMode ? "/api/family" : "/api/users";
    const body = householdMode
      ? {
          familyId: options?.household?.id ?? null,
          password,
          confirmation: typed,
        }
      : { password, confirmation: typed };
    return fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        [IDEMPOTENCY_HEADER]: key,
      },
      body: JSON.stringify(body),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const mode = householdMode ? "household" : "account";
    // One key per confirmed attempt; kept across the network retry below.
    keyRef.current = keyRef.current ?? newIdempotencyKey();
    const earlierAttemptPending = pendingRef.current;
    let res: Response | null = null;
    let retried = false;
    try {
      res = await send(keyRef.current);
    } catch {
      retried = true;
      try {
        res = await send(keyRef.current);
      } catch {
        res = null;
      }
    }
    if (
      res &&
      (res.ok || ((retried || earlierAttemptPending) && res.status === 401))
    ) {
      pendingRef.current = false;
      onDeleted(mode);
      return;
    }
    setBusy(false);
    if (!res) {
      // Unknown outcome: keep the key so the next try cannot run twice.
      pendingRef.current = true;
      setError({ kind: "owned", key: "noConnection" });
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.status === 409 && data?.error?.code === "IDEMPOTENCY_IN_PROGRESS") {
      pendingRef.current = true;
      setError({ kind: "owned", key: "stillWorking" });
      return;
    }
    // A refused request did nothing: the next attempt uses a new key.
    keyRef.current = null;
    pendingRef.current = false;
    if (res.status === 401) {
      setError({ kind: "owned", key: "sessionEnded" });
    } else {
      const serverText =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.error?.message === "string"
            ? data.error.message
            : null;
      setError(
        serverText !== null
          ? { kind: "server", text: serverText }
          : { kind: "owned", key: "nothingDeleted" },
      );
    }
  };

  const title = msg(householdMode ? "householdTitle" : "accountTitle");

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      closeLabel={msg("close")}
      testId="delete-account-dialog"
    >
      {phase.kind === "loading" && <AccountDeletionLoading />}
      {phase.kind === "load-error" && (
        <AccountDeletionFailure onRetry={() => void load()} />
      )}

      {options && blocked && (
        <div className="space-y-4">
          <p className="text-[16px] text-label-primary">
            {options.isOnlyParent
              ? msg("onlyParentBlocked")
              : msg("lastMemberBlocked")}
          </p>
          <button
            type="button"
            className="btn-tinted min-h-[44px] w-full"
            onClick={onClose}
          >
            {msg("close")}
          </button>
        </div>
      )}

      {options && !blocked && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2 text-[16px] leading-snug text-label-primary">
            {householdMode ? (
              <>
                <p>
                  {msg("householdWarningPrefix")}
                  <strong>{householdName}</strong>
                  {msg(
                    options.household?.memberCount === 1
                      ? "householdWarningOne"
                      : "householdWarningMany",
                    { count: options.household?.memberCount ?? 1 },
                  )}
                </p>
                <p className="text-label-secondary">
                  {msg("invitePrefix")}
                  <Link
                    href="/dashboard/family/invite"
                    className="font-semibold text-[var(--accent-text)] underline"
                  >
                    {msg("invite")}
                  </Link>
                  .
                </p>
              </>
            ) : (
              <p>
                {msg("accountWarning")}
                {options.household ? msg("retainedHousehold") : ""}
              </p>
            )}
            <p className="font-semibold">{msg("irreversible")}</p>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-border p-4">
            <p className="text-[16px] text-label-primary">
              {msg("exportFirst")}
            </p>
            <button
              type="button"
              className="btn-tinted mt-3 min-h-[44px] w-full"
              onClick={() => void handleExport()}
              disabled={exportState === "working"}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {msg(exportState === "working" ? "exportPreparing" : "export")}
            </button>
            <p
              aria-live="polite"
              className="mt-2 text-[15px] text-label-secondary"
            >
              {exportState === "done" ? msg("exportDone") : ""}
              {exportState === "error" ? msg("exportFailed") : ""}
            </p>
          </div>

          <div>
            <label htmlFor="delete-account-password" className="label-apple">
              {msg("password")}
            </label>
            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              className="input-apple"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="delete-account-confirm" className="label-apple">
              {householdMode ? (
                <>
                  {msg("householdConfirmPrefix")}
                  <strong>{householdName}</strong>
                  {msg("householdConfirmSuffix")}
                </>
              ) : (
                <>
                  {msg("accountConfirmPrefix")}
                  <strong>{ACCOUNT_DELETE_PHRASE}</strong>
                  {msg("accountConfirmSuffix")}
                </>
              )}
            </label>
            <input
              id="delete-account-confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="input-apple"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
            />
          </div>

          {error && (error.kind === "owned" || error.text) && (
            <p
              role="alert"
              className="rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
            >
              {error.kind === "server" ? error.text : msg(error.key)}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              className="btn-ghost min-h-[44px] flex-1"
              onClick={onClose}
              disabled={busy}
            >
              {msg("cancel")}
            </button>
            <button
              type="submit"
              className="btn-destructive min-h-[44px] flex-1 disabled:opacity-40"
              disabled={!ready || busy}
            >
              {msg(
                busy
                  ? "deleting"
                  : householdMode
                    ? "householdTitle"
                    : "deleteAccount",
              )}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
