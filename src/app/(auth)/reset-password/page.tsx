"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Suspense } from "react";
import { useTranslation } from "@/i18n";
import {
  authRecoveryMessages,
  type AuthRecoveryMessage,
  type RecoveryFeedback,
} from "@/i18n/auth-recovery";

function ResetPasswordForm() {
  const { t } = useTranslation();
  const msg = (key: AuthRecoveryMessage) =>
    t(key, undefined, authRecoveryMessages);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RecoveryFeedback | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const password = String(fields.get("password") ?? "");
    const confirmPassword = String(fields.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError({ kind: "owned", key: "auth.passwordMismatch" });
      return;
    }
    if (password.length < 8) {
      setError({ kind: "owned", key: "auth.passwordTooShort" });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error
            ? { kind: "raw", text: data.error }
            : { kind: "owned", key: "common.error" },
        );
        return;
      }
      setSuccess(true);
    } catch {
      setError({ kind: "owned", key: "auth.unexpectedError" });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-panel space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-[var(--success-tint)] rounded-[var(--radius-xl)] flex items-center justify-center">
                <KeyRound className="w-8 h-8 text-success-text" />
              </div>
            </div>
            <h1 className="text-title-2 text-label-primary">
              {t("auth.resetPasswordTitle")}
            </h1>
            <p className="mt-2 text-[var(--label-secondary)]">
              {msg("resetSuccess")}
            </p>
          </div>
          <button
            onClick={() => router.push("/login")}
            className="btn-primary w-full py-3"
          >
            {t("auth.signIn")}
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-panel space-y-8">
          <div className="text-center">
            <h1 className="text-title-2 text-label-primary">
              {msg("invalidTitle")}
            </h1>
            <p className="mt-2 text-[var(--label-secondary)]">
              {msg("invalidBody")}
            </p>
          </div>
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="inline-flex items-center min-h-11 text-[var(--accent-text)] hover:underline font-medium"
            >
              {t("auth.sendResetLink")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-panel space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[var(--accent-fill)] rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-title-2 text-label-primary">
            {t("auth.setNewPassword")}
          </h1>
          <p className="mt-2 text-[var(--label-secondary)]">
            {t("auth.setNewPassword")}
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div
                role="alert"
                className="bg-[var(--danger-tint)] text-[var(--danger-text)] px-4 py-3 rounded-[var(--radius-md)]"
              >
                {error.kind === "raw" ? error.text : t(error.key)}
              </div>
            )}

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--label-primary)] mb-2"
              >
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  className="input-field pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 min-w-11 min-h-11 flex items-center justify-center text-[var(--label-tertiary)] hover:text-[var(--accent-text)] transition-colors"
                  aria-label={
                    showPassword ? msg("hidePassword") : msg("showPassword")
                  }
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-label-tertiary">
                {t("auth.passwordHint")}
              </p>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-[var(--label-primary)] mb-2"
              >
                {t("auth.confirmPassword")}
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  className="input-field pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 min-w-11 min-h-11 flex items-center justify-center text-[var(--label-tertiary)] hover:text-[var(--accent-text)] transition-colors"
                  aria-label={
                    showConfirmPassword
                      ? msg("hidePassword")
                      : msg("showPassword")
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? t("auth.resetting") : t("auth.resetPasswordBtn")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ResetLoading() {
  const { t } = useTranslation();
  const msg = (key: AuthRecoveryMessage) =>
    t(key, undefined, authRecoveryMessages);
  return (
    <div className="auth-page">
      <div className="text-label-tertiary">{msg("loading")}</div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetLoading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
