"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { PAIRING_POLL_MS } from "@/lib/device-client";
import { formatCountdown, waitText } from "./use-device-client";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  noticeTextClass,
  primaryButtonClass,
} from "./styles";
import { PRODUCT_BRAND } from "@/lib/brand";
import {
  useDeviceText,
  type DeviceMessage,
  type DeviceFeedback,
} from "@/i18n/device-management";

type Ended = "expired" | "cancelled" | "denied" | "mismatch";

type Step =
  | { kind: "label" }
  | { kind: "code"; pairingId: string; code: string; expiresAt: number }
  | { kind: "confirm"; pairingId: string; expiresAt: number }
  | { kind: "connecting"; pairingId: string; expiresAt: number }
  | {
      kind: "done";
      label: string;
      /** From the server: null (nothing replaced), or whether the old tablet is now removed. */
      replaced: { removed: boolean } | null;
    }
  | { kind: "ended"; reason: Ended };

const ENDED_KEYS: Record<Ended, DeviceMessage> = {
  expired: "endedExpired",
  cancelled: "endedCancelled",
  denied: "endedDenied",
  mismatch: "endedMismatch",
};

async function readError(res: Response) {
  const body = await res.json().catch(() => null);
  const raw = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
  return {
    code:
      typeof body?.error?.code === "string"
        ? (body.error.code as string)
        : `HTTP_${res.status}`,
    attemptsLeft:
      typeof body?.error?.attemptsLeft === "number"
        ? (body.error.attemptsLeft as number)
        : null,
    retryAfter: Number.isFinite(raw) ? raw : null,
  };
}

/**
 * "Pair a tablet" (SHARED_DEVICE.md §5.1 steps 1 and 3): name → one-time
 * code with its expiry countdown → poll until the tablet claims it → "Type
 * the number shown on the tablet" → confirmed → paired. "This isn't my
 * tablet" cancels. With `replace` and the box ticked, the pairing carries
 * `replacesDeviceId`: the server revokes the old tablet in the same
 * transaction that connects the new one (so replacing works at the 5-tablet
 * limit), and the dialog reports the removal only from the server's answer
 * (§7 "Replace").
 */
export default function PairTabletDialog({
  open,
  onClose,
  onPaired,
  replace,
}: {
  open: boolean;
  onClose: () => void;
  onPaired: () => void;
  replace?: { id: string; label: string } | null;
}) {
  const text = useDeviceText();
  const textRef = React.useRef(text);
  textRef.current = text;
  const [step, setStep] = React.useState<Step>({ kind: "label" });
  const [label, setLabel] = React.useState(() => text("kitchen"));
  const [removeOld, setRemoveOld] = React.useState(true);
  const [digits, setDigits] = React.useState("");
  const [error, setError] = React.useState<DeviceFeedback | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const labelRef = React.useRef<HTMLInputElement>(null);
  const digitsRef = React.useRef<HTMLInputElement>(null);
  const labelForDone = React.useRef(label);
  const attempt = React.useRef(0);
  const operation = React.useRef<
    "create" | "confirm" | "deny" | "remove" | null
  >(null);
  const openRef = React.useRef(open);
  const stepRef = React.useRef(step);
  openRef.current = open;
  stepRef.current = step;
  const currentAttempt = React.useCallback(
    (token: number) => openRef.current && attempt.current === token,
    [],
  );

  React.useEffect(() => {
    attempt.current += 1;
    operation.current = null;
    if (open) {
      setStep({ kind: "label" });
      setRetryState("idle");
      setLabel(replace ? replace.label : textRef.current("kitchen"));
      setRemoveOld(true);
      setDigits("");
      setError(null);
      setBusy(false);
    }
    return () => {
      attempt.current += 1;
    };
  }, [open, replace]);

  const pairingId =
    step.kind === "code" ||
    step.kind === "confirm" ||
    step.kind === "connecting"
      ? step.pairingId
      : null;
  const expiresAt =
    step.kind === "code" ||
    step.kind === "confirm" ||
    step.kind === "connecting"
      ? step.expiresAt
      : null;
  const polling = step.kind === "code" || step.kind === "connecting";

  React.useEffect(() => {
    if (step.kind === "confirm") digitsRef.current?.focus();
  }, [step.kind]);

  // Countdown.
  React.useEffect(() => {
    if (!open || expiresAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= expiresAt) setStep({ kind: "ended", reason: "expired" });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, expiresAt]);

  const [retryState, setRetryState] = React.useState<
    "idle" | "busy" | "failed"
  >("idle");

  /** Recovery when the server did not remove the replaced tablet: a plain revoke, checked. */
  const removeOldNow = async () => {
    if (!replace || step.kind !== "done" || operation.current) return;
    const token = attempt.current;
    operation.current = "remove";
    setRetryState("busy");
    try {
      const res = await fetch(
        `/api/family/devices/${encodeURIComponent(replace.id)}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "replaced" }),
        },
      );
      if (!currentAttempt(token)) return;
      if (!res.ok) throw new Error(String(res.status));
      setStep((current) =>
        currentAttempt(token) && current.kind === "done"
          ? { ...current, replaced: { removed: true } }
          : current,
      );
      setRetryState("idle");
    } catch {
      if (currentAttempt(token)) setRetryState("failed");
    } finally {
      if (currentAttempt(token)) operation.current = null;
    }
  };

  // Poll the pairing while waiting for the tablet (claim) or for issue (paired).
  React.useEffect(() => {
    if (!open || !polling || !pairingId) return;
    const token = attempt.current;
    let cancelled = false;
    let timer: number | undefined;
    const advance = (next: Step) =>
      setStep((current) =>
        currentAttempt(token) &&
        (current.kind === "code" || current.kind === "connecting") &&
        current.kind === step.kind &&
        current.pairingId === pairingId
          ? next
          : current,
      );
    const poll = async () => {
      if (cancelled || !currentAttempt(token)) return;
      let delay = PAIRING_POLL_MS;
      try {
        const res = await fetch(
          `/api/family/devices/pairings/${encodeURIComponent(pairingId)}`,
          { cache: "no-store" },
        );
        if (cancelled || !currentAttempt(token)) return;
        if (res.ok) {
          const body = (await res.json()) as {
            status: string;
            replaces?: { deviceId: string; removed: boolean } | null;
          };
          const active = stepRef.current;
          if (
            cancelled ||
            !currentAttempt(token) ||
            (active.kind !== "code" && active.kind !== "connecting") ||
            active.kind !== step.kind ||
            active.pairingId !== pairingId
          )
            return;
          if (body.status === "claimed" && step.kind === "code") {
            advance({
              kind: "confirm",
              pairingId,
              expiresAt: expiresAt ?? Date.now(),
            });
            return;
          }
          if (body.status === "paired") {
            setRetryState("idle");
            advance({
              kind: "done",
              label: labelForDone.current,
              replaced: body.replaces
                ? { removed: body.replaces.removed }
                : null,
            });
            return;
          }
          if (body.status === "expired" || body.status === "cancelled") {
            advance({ kind: "ended", reason: body.status });
            return;
          }
        } else if (res.status === 429) {
          const { retryAfter } = await readError(res);
          delay = Math.max(PAIRING_POLL_MS, (retryAfter ?? 5) * 1000);
        }
      } catch {
        // Offline for a moment: keep polling until the code expires.
      }
      if (!cancelled && currentAttempt(token))
        timer = window.setTimeout(poll, delay);
    };
    timer = window.setTimeout(poll, PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, polling, pairingId, expiresAt, step.kind, currentAttempt]);

  const cancelPairing = async (id: string) => {
    await fetch(`/api/family/devices/pairings/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
  };

  const close = () => {
    attempt.current += 1;
    operation.current = null;
    // Closing mid-pairing cancels the code, so it cannot be used later.
    if (pairingId && step.kind !== "connecting") void cancelPairing(pairingId);
    if (step.kind === "done" || step.kind === "connecting") onPaired();
    onClose();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openRef.current || operation.current) return;
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 40) {
      setError({ key: "nameLengthLong" });
      return;
    }
    const token = attempt.current;
    operation.current = "create";
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/family/devices/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          replace && removeOld
            ? { label: trimmed, replacesDeviceId: replace.id }
            : { label: trimmed },
        ),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          pairingId: string;
          code: string;
          expiresAt: string;
        };
        if (!currentAttempt(token)) {
          // Closing before POST returned could not yet know this code's ID.
          // Retire only that abandoned attempt; never reopen it in a new dialog.
          if (typeof body.pairingId === "string" && body.pairingId)
            void cancelPairing(body.pairingId);
          return;
        }
        labelForDone.current = trimmed;
        setStep((current) =>
          currentAttempt(token)
            ? {
                kind: "code",
                pairingId: body.pairingId,
                code: body.code,
                expiresAt: Date.parse(body.expiresAt),
              }
            : current,
        );
        return;
      }
      const { code, retryAfter } = await readError(res);
      if (!currentAttempt(token)) return;
      if (code === "DEVICE_LIMIT_REACHED") {
        setError({ key: replace && !removeOld ? "limitRemove" : "limit" });
      } else if (replace && res.status === 404) {
        setError({ key: "replaceMissing", params: { label: replace.label } });
      } else if (replace && code === "VALIDATION_ERROR") {
        setError({ key: "replaceRemoved", params: { label: replace.label } });
      } else if (res.status === 429) {
        setError({ key: "pairRate", retryAfter });
      } else {
        setError({ key: "createFailed" });
      }
    } catch {
      if (currentAttempt(token))
        setError({ key: "unreachable", params: { brand: PRODUCT_BRAND.name } });
    } finally {
      if (currentAttempt(token)) {
        operation.current = null;
        setBusy(false);
      }
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "confirm" || operation.current || !openRef.current)
      return;
    if (!/^\d{4}$/.test(digits)) {
      setError({ key: "digitsRequired" });
      return;
    }
    const token = attempt.current;
    operation.current = "confirm";
    const stillConfirming = () =>
      currentAttempt(token) &&
      stepRef.current.kind === "confirm" &&
      stepRef.current.pairingId === step.pairingId;
    const advance = (next: Step) =>
      setStep((current) =>
        currentAttempt(token) &&
        current.kind === "confirm" &&
        current.pairingId === step.pairingId
          ? next
          : current,
      );
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/family/devices/pairings/${encodeURIComponent(step.pairingId)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ digits }),
        },
      );
      if (!stillConfirming()) return;
      if (res.ok) {
        advance({
          kind: "connecting",
          pairingId: step.pairingId,
          expiresAt: step.expiresAt,
        });
        return;
      }
      const { code, attemptsLeft } = await readError(res);
      if (!stillConfirming()) return;
      setDigits("");
      if (code === "PAIRING_DIGITS_MISMATCH") {
        if (attemptsLeft === 0) advance({ kind: "ended", reason: "mismatch" });
        else
          setError({
            key:
              attemptsLeft === null
                ? "digitsFew"
                : attemptsLeft === 1
                  ? "digitsOne"
                  : "digitsMany",
            params: attemptsLeft === null ? undefined : { count: attemptsLeft },
          });
      } else if (code === "PAIRING_EXPIRED") {
        advance({ kind: "ended", reason: "expired" });
      } else if (code === "PAIRING_CANCELLED") {
        advance({ kind: "ended", reason: "cancelled" });
      } else {
        setError({ key: "confirmFailed" });
      }
    } catch {
      if (stillConfirming())
        setError({ key: "unreachable", params: { brand: PRODUCT_BRAND.name } });
    } finally {
      if (currentAttempt(token)) {
        operation.current = null;
        setBusy(false);
      }
    }
  };

  const deny = async () => {
    if (step.kind !== "confirm" || operation.current === "deny") return;
    // A deliberate rejection supersedes any pending confirmation UI result.
    const token = ++attempt.current;
    operation.current = "deny";
    setBusy(true);
    await cancelPairing(step.pairingId);
    if (!currentAttempt(token)) return;
    operation.current = null;
    setBusy(false);
    setStep({ kind: "ended", reason: "denied" });
  };

  const title =
    step.kind === "label"
      ? replace
        ? text("replaceTitle", { label: replace.label })
        : text("pairTablet")
      : step.kind === "code"
        ? text("codeTitle")
        : step.kind === "confirm"
          ? text("confirmTitle")
          : step.kind === "connecting"
            ? text("connecting")
            : step.kind === "done"
              ? text("connected")
              : text("stopped");

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      closeLabel={text("close")}
      testId="pair-dialog"
      initialFocusRef={step.kind === "label" ? labelRef : undefined}
    >
      {step.kind === "label" && (
        <form onSubmit={create} className="space-y-5" noValidate>
          <p className="text-[16px] leading-snug text-label-secondary">
            {text("pairHelp")}
          </p>
          <div>
            <label htmlFor="pair-label" className={labelClass}>
              {text("tabletName")}
            </label>
            <input
              ref={labelRef}
              id="pair-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </div>
          {replace && (
            <label className="flex min-h-[44px] items-center gap-3 text-[16px] text-label-primary">
              <input
                type="checkbox"
                checked={removeOld}
                onChange={(e) => setRemoveOld(e.target.checked)}
                className="h-6 w-6"
              />
              {text("removeOld", { label: replace.label })}
            </label>
          )}
          {error && (
            <p role="alert" className={errorTextClass}>
              {text(error.key, {
                ...error.params,
                ...(error.key === "pairRate"
                  ? { wait: waitText(error.retryAfter, text) }
                  : {}),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className={primaryButtonClass}
            >
              {busy && (
                <Loader2
                  className="h-5 w-5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {text("getCode")}
            </button>
            <button
              type="button"
              onClick={close}
              className={neutralButtonClass}
            >
              {text("cancel")}
            </button>
          </div>
        </form>
      )}

      {step.kind === "code" && (
        <div className="space-y-5">
          <p className="text-[16px] leading-snug text-label-secondary">
            {text("openOnTablet", { url: `${origin}/device/pair` })}
          </p>
          <p
            data-testid="pairing-code"
            className="font-mono text-[40px] font-bold leading-none tracking-[0.12em] text-label-primary"
          >
            {step.code}
          </p>
          <p
            data-testid="pairing-expiry"
            className="text-[16px] text-label-secondary"
          >
            {text("expires", {
              countdown: formatCountdown(step.expiresAt - now),
            })}
          </p>
          <p
            role="status"
            className="flex items-center gap-2 text-[16px] text-label-primary"
          >
            <Loader2
              className="h-5 w-5 shrink-0 motion-safe:animate-spin"
              aria-hidden="true"
            />
            {text("waiting")}
          </p>
          <button type="button" onClick={close} className={neutralButtonClass}>
            {text("cancel")}
          </button>
        </div>
      )}

      {step.kind === "confirm" && (
        <form onSubmit={confirm} className="space-y-5" noValidate>
          <p className="text-[16px] leading-snug text-label-secondary">
            {text("confirmHelp")}
          </p>
          <div>
            <label htmlFor="pair-digits" className={labelClass}>
              {text("number")}
            </label>
            <input
              ref={digitsRef}
              id="pair-digits"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              value={digits}
              onChange={(e) => {
                setDigits(e.target.value.replace(/\D/g, "").slice(0, 4));
                setError(null);
              }}
              className={`${inputClass} max-w-[12rem] font-mono text-[28px] tracking-[0.3em]`}
            />
          </div>
          <p
            data-testid="pairing-expiry"
            className="text-[16px] text-label-secondary"
          >
            {text("expires", {
              countdown: formatCountdown(step.expiresAt - now),
            })}
          </p>
          {error && (
            <p role="alert" className={errorTextClass}>
              {text(error.key, {
                ...error.params,
                ...(error.key === "pairRate"
                  ? { wait: waitText(error.retryAfter, text) }
                  : {}),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className={primaryButtonClass}
            >
              {text("connect")}
            </button>
            <button type="button" onClick={deny} className={neutralButtonClass}>
              {text("notMine")}
            </button>
          </div>
        </form>
      )}

      {step.kind === "connecting" && (
        <p
          role="status"
          className="flex items-center gap-2 text-[17px] text-label-primary"
        >
          <Loader2
            className="h-5 w-5 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {text("connectingHelp")}
        </p>
      )}

      {step.kind === "done" && (
        <div className="space-y-5">
          <p role="status" className={noticeTextClass}>
            {text("connectedHelp", { label: step.label })}
            {replace && step.replaced?.removed
              ? text("oldRemoved", { label: replace.label })
              : ""}
          </p>
          {replace && step.replaced && !step.replaced.removed && (
            <div role="alert" className={`space-y-3 ${errorTextClass}`}>
              <p>
                {retryState === "failed"
                  ? text("oldRemoveRetry", { label: replace.label })
                  : text("oldNotRemoved", { label: replace.label })}
              </p>
              <button
                type="button"
                onClick={() => void removeOldNow()}
                disabled={retryState === "busy"}
                className={dangerButtonClass}
              >
                {text("removeLabel", { label: replace.label })}
              </button>
            </div>
          )}
          <button type="button" onClick={close} className={primaryButtonClass}>
            {text("done")}
          </button>
        </div>
      )}

      {step.kind === "ended" && (
        <div className="space-y-5">
          <p role="alert" className={noticeTextClass}>
            {text(ENDED_KEYS[step.reason])}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                attempt.current += 1;
                operation.current = null;
                setBusy(false);
                setRetryState("idle");
                setError(null);
                setDigits("");
                setStep({ kind: "label" });
              }}
              className={primaryButtonClass}
            >
              {text("newCode")}
            </button>
            <button
              type="button"
              onClick={close}
              className={neutralButtonClass}
            >
              {text("close")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
