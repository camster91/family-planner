"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
  authEntryMessages,
  authEntryArrivalKey,
  type AuthEntryMessage,
  type AuthEntryFeedback,
} from "@/i18n/auth-entry";

import { clearAllPersonQueues } from "@/lib/offline-queue-browser";
import { loginNoticeFor, safeRedirectPath } from "@/lib/safe-redirect";

export default function LoginPage() {
  const { t } = useTranslation();
  const copy = (key: AuthEntryMessage) => t(key, undefined, authEntryMessages);
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthEntryFeedback | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [registerHref, setRegisterHref] = useState("/register");
  const [deletedNotice, setDeletedNotice] = useState<
    "householdDeleted" | "accountDeleted" | null
  >(null);
  // After the email confirm step (/verify-email).
  const [verifyNotice, setVerifyNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Nobody is signed in on this page (the middleware sends a signed-in user
    // away), so offline changes left by an ended session are dropped, never
    // replayed (#162, OFFLINE_SYNC.md "Security").
    void clearAllPersonQueues();
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) setRegisterHref(`/register?token=${encodeURIComponent(token)}`);
    // After Settings → Delete (docs/product/ACCOUNT_DELETION.md).
    const deleted = params.get("deleted");
    if (deleted === "household") setDeletedNotice("householdDeleted");
    else if (deleted === "account") setDeletedNotice("accountDeleted");
    setVerifyNotice(loginNoticeFor(params));
  }, []);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read DOM values before re-rendering: password managers may not emit change events.
    const fields = new FormData(e.currentTarget);
    const submittedEmail = String(fields.get("email") ?? "");
    const password = String(fields.get("password") ?? "");
    setEmail(submittedEmail);
    setLoading(true);
    setError(null);
    // The arrival notices ("email verified", "account deleted") are stale once
    // the person tries to sign in; leaving them above a fresh error is confusing.
    setVerifyNotice(null);
    setDeletedNotice(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: submittedEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ? { raw: data.error } : { shared: "auth.loginFailed" },
        );
        return;
      }

      const params = new URLSearchParams(window.location.search);
      // Same-origin paths only: `//host` would leave the app (open redirect).
      const redirect = safeRedirectPath(params.get("redirect"));
      const token = params.get("token");
      if (redirect) {
        router.push(redirect);
      } else if (token) {
        router.push(`/join?token=${encodeURIComponent(token)}`);
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch {
      setError({ shared: "auth.unexpectedError" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendState("sending");
    try {
      // Always answers 200 whether or not the account exists; nothing to
      // surface beyond the confirmation state.
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Transport error — the endpoint's own retries/rate limits apply.
    }
    setResendState("sent");
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="card-apple p-6">
          <div className="auth-heading">
            <h1 className="text-title-2">{t("auth.welcomeBack")}</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mt-1">
              {t("auth.signInSubtitle")}
            </p>
          </div>

          {deletedNotice && (
            <p
              role="status"
              className="mb-4 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-4 py-3 text-[15px] text-[var(--label-primary)]"
            >
              {copy(deletedNotice)}
            </p>
          )}

          {verifyNotice && (
            <p
              role={verifyNotice.kind === "error" ? "alert" : "status"}
              className={
                verifyNotice.kind === "error"
                  ? "mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
                  : "mb-4 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-4 py-3 text-[15px] text-[var(--label-primary)]"
              }
            >
              {authEntryArrivalKey(verifyNotice.text)
                ? copy(authEntryArrivalKey(verifyNotice.text)!)
                : verifyNotice.text}
            </p>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="bg-[var(--danger-tint)] text-[var(--danger-text)] text-[15px] rounded-[var(--radius-md)] px-4 py-3"
              >
                {"raw" in error
                  ? error.raw
                  : "shared" in error
                    ? t(error.shared)
                    : copy(error.owned)}
              </div>
            )}

            {error && "raw" in error && /verify/i.test(error.raw) && (
              <button
                type="button"
                className="btn-plain w-full py-3"
                onClick={handleResend}
                disabled={resendState !== "idle" || loading}
              >
                {resendState === "sent"
                  ? copy("resendComplete")
                  : resendState === "sending"
                    ? copy("sending")
                    : copy("resend")}
              </button>
            )}

            <div>
              <label htmlFor="email" className="label-apple">
                {t("auth.email")}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                defaultValue=""
                onChange={(e) => setEmail(e.target.value)}
                className="input-apple"
                placeholder={copy("emailPlaceholder")}
              />
            </div>

            <div>
              <label htmlFor="password" className="label-apple">
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="input-apple pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center text-[var(--label-tertiary)] hover:text-[var(--label-primary)] transition-colors"
                  aria-label={copy(
                    showPassword ? "hidePassword" : "showPassword",
                  )}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="mt-1 text-right">
                <Link
                  href="/forgot-password"
                  className="btn-plain inline-flex min-h-11 items-center py-1 px-2 -my-1 text-[15px]"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="btn-filled w-full py-3"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    {t("auth.signingIn")}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <LogIn className="w-4 h-4" />
                    {t("auth.signIn")}
                  </span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-4 text-center">
            <p className="text-[15px] text-[var(--label-secondary)]">
              {t("auth.noAccount")}{" "}
              <Link
                href={registerHref}
                className="btn-plain inline-flex min-h-11 items-center py-1 px-2 -my-1"
              >
                {t("auth.signUp")}
              </Link>
            </p>
          </div>
        </div>

        <p className="auth-help">
          {t("auth.bySigningIn")}{" "}
          <Link
            href="/terms"
            className="inline-block max-w-full underline underline-offset-4"
          >
            {t("auth.termsOfService")}
          </Link>{" "}
          {t("auth.and")}{" "}
          <Link
            href="/privacy"
            className="inline-block max-w-full underline underline-offset-4"
          >
            {t("auth.privacyPolicy")}
          </Link>
        </p>
      </div>
    </div>
  );
}
