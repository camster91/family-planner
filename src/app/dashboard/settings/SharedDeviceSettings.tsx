"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, TabletSmartphone } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
} from "@/components/device/styles";
import { PRODUCT_BRAND } from "@/lib/brand";
import { useSettingsCopy, SettingsText } from "./settings-copy";
import { settingsFeedback, type SettingsFeedback } from "@/i18n/settings";

async function errorCode(
  res: Response,
): Promise<{ code: string; retryAfter: number | null }> {
  const body = await res.json().catch(() => null);
  const code =
    typeof body?.error?.code === "string"
      ? body.error.code
      : `HTTP_${res.status}`;
  const raw = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
  return { code, retryAfter: Number.isFinite(raw) ? raw : null };
}

/**
 * Settings → Family → Family tablet entries for shared tablets (#241): the
 * Devices page and the parent's own Tablet PIN (SHARED_DEVICE.md §6.1, §7).
 * Rendered only for parents while the kill switch is on (decided server-side
 * in ./page.tsx).
 */
export default function SharedDeviceSettings({
  initialHasPin,
}: {
  initialHasPin: boolean;
}) {
  const copy = useSettingsCopy();
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [pinOpen, setPinOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [message, setMessage] = useState<SettingsFeedback | null>(null);

  return (
    <>
      <Link
        href="/dashboard/settings/devices"
        className="w-full p-3 text-left text-foreground hover:bg-muted rounded-lg flex items-center gap-3 min-h-[44px]"
      >
        <TabletSmartphone className="w-4 h-4 text-primary" aria-hidden="true" />
        <div>
          <div className="font-medium">{copy("devices")}</div>
          <div className="text-xs text-label-tertiary">
            {copy("devicesDescription")}
          </div>
        </div>
      </Link>

      <div
        className="w-full p-3 rounded-lg flex flex-wrap items-center gap-3"
        data-testid="tablet-pin"
      >
        <KeyRound className="w-4 h-4 text-primary" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <div className="font-medium text-foreground">{copy("pin")}</div>
          <div className="text-xs text-label-tertiary">
            {hasPin ? copy("pinSetDescription") : copy("pinUnsetDescription")}
          </div>
          {message && (
            <p role="status" className="mt-1 text-sm text-foreground">
              <SettingsText feedback={message} />
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setPinOpen(true);
            }}
            className={neutralButtonClass}
          >
            {hasPin ? copy("changePin") : copy("setPin")}
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setRemoveOpen(true);
              }}
              className={neutralButtonClass}
            >
              {copy("removePin")}
            </button>
          )}
        </div>
      </div>

      <PinDialog
        open={pinOpen}
        change={hasPin}
        onClose={() => setPinOpen(false)}
        onSaved={() => {
          setHasPin(true);
          setPinOpen(false);
          setMessage(settingsFeedback("pinSaved"));
        }}
      />

      <Dialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={copy("removePinTitle")}
        description={copy("removePinDescription")}
        testId="remove-pin"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={dangerButtonClass}
            onClick={async () => {
              const res = await fetch("/api/users/elevation-pin", {
                method: "DELETE",
              }).catch(() => null);
              setRemoveOpen(false);
              if (res && res.ok) {
                setHasPin(false);
                setMessage(settingsFeedback("pinRemoved"));
              } else {
                setMessage(settingsFeedback("pinRemoveFailed"));
              }
            }}
          >
            {copy("removePin")}
          </button>
          <button
            type="button"
            className={neutralButtonClass}
            onClick={() => setRemoveOpen(false)}
          >
            {copy("cancel")}
          </button>
        </div>
      </Dialog>
    </>
  );
}

function PinDialog({
  open,
  change,
  onClose,
  onSaved,
}: {
  open: boolean;
  change: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const copy = useSettingsCopy();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<SettingsFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setPin("");
    setConfirm("");
    setPassword("");
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) return setError(settingsFeedback("pinDigits"));
    if (pin !== confirm) return setError(settingsFeedback("pinMismatch"));
    if (!password) return setError(settingsFeedback("pinPasswordRequired"));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users/elevation-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, currentPassword: password }),
      });
      if (res.ok) {
        setPin("");
        setConfirm("");
        setPassword("");
        onSaved();
        return;
      }
      const { code, retryAfter } = await errorCode(res);
      if (code === "PIN_TOO_WEAK") {
        setError(settingsFeedback("pinWeak"));
      } else if (code === "INVALID_PASSWORD") {
        setError(settingsFeedback("pinPasswordIncorrect"));
      } else if (res.status === 429) {
        setError(
          !retryAfter || retryAfter <= 60
            ? settingsFeedback("pinRateMinute")
            : settingsFeedback("pinRateMinutes", {
                minutes: Math.ceil(retryAfter / 60),
              }),
        );
      } else {
        setError(settingsFeedback("pinSaveFailed"));
      }
    } catch {
      setError(settingsFeedback("pinNetwork", { brand: PRODUCT_BRAND.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={change ? copy("changePinTitle") : copy("setPinTitle")}
      description={copy("pinDescription")}
      initialFocusRef={firstRef}
      testId="pin-dialog"
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="tablet-pin-new" className={labelClass}>
            {copy("newPin")}
          </label>
          <input
            ref={firstRef}
            id="tablet-pin-new"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tablet-pin-confirm" className={labelClass}>
            {copy("confirmPin")}
          </label>
          <input
            id="tablet-pin-confirm"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={confirm}
            onChange={(e) =>
              setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tablet-pin-password" className={labelClass}>
            {copy("pinCurrentPassword")}
          </label>
          <input
            id="tablet-pin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className={errorTextClass}>
            <SettingsText feedback={error} />
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {copy("savePin")}
          </button>
          <button type="button" onClick={close} className={neutralButtonClass}>
            {copy("cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
