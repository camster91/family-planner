"use client";

// Email confirm step (O-24). The emailed link opens this page; opening it does
// nothing to the token, so a mail scanner that fetches the link cannot use it
// up. Only the "Confirm my email" button POSTs /api/auth/verify-email.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { PRODUCT_BRAND } from "@/lib/brand";
import {
  confirmEmailToken,
  VERIFIED_REDIRECT,
  type VerifyOutcome,
} from "@/lib/verify-email";
import { useTranslation } from "@/i18n";
import {
  emailConfirmationMessages,
  type EmailConfirmationMessage,
} from "@/i18n/email-confirmation";

type State = "idle" | "submitting" | Exclude<VerifyOutcome, "verified">;

function VerifyEmailConfirm() {
  const { t } = useTranslation();
  const copy = (
    key: EmailConfirmationMessage,
    params?: Record<string, string>,
  ) => t(key, params, emailConfirmationMessages);
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>("idle");

  const confirm = async () => {
    if (!token) return;
    setState("submitting");
    const outcome = await confirmEmailToken(token);
    if (outcome === "verified") {
      router.replace(VERIFIED_REDIRECT);
      return;
    }
    setState(outcome);
  };

  const canRetry =
    state === "idle" ||
    state === "submitting" ||
    state === "error" ||
    state === "rate_limited";
  const notice =
    state === "idle" || state === "submitting"
      ? null
      : {
          kind:
            state === "already_verified"
              ? ("success" as const)
              : ("error" as const),
          text: copy(state),
        };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-[var(--accent-fill)] rounded-[var(--radius-xl)] flex items-center justify-center shadow-[var(--shadow-md)]">
            <MailCheck className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
        </div>

        <div className="card-apple p-6">
          <div className="auth-heading">
            <h1 className="text-title-2">{copy("title")}</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mt-1">
              {token
                ? copy("instruction", { brand: PRODUCT_BRAND.name })
                : copy("missing")}
            </p>
          </div>

          {notice && (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={
                notice.kind === "error"
                  ? "mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
                  : "mb-4 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-4 py-3 text-[15px] text-[var(--label-primary)]"
              }
            >
              {notice.text}
            </p>
          )}

          {token && canRetry && (
            <button
              type="button"
              onClick={confirm}
              disabled={state === "submitting"}
              className="btn-filled w-full py-3"
            >
              {copy(state === "submitting" ? "confirming" : "confirm")}
            </button>
          )}

          <Link
            href="/login"
            className="btn-plain w-full py-3 mt-3 flex justify-center"
          >
            {copy("signIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const copy = (key: EmailConfirmationMessage) =>
    t(key, undefined, emailConfirmationMessages);
  return (
    <Suspense
      fallback={
        <div className="auth-page">
          <div className="text-[var(--label-secondary)]">{copy("loading")}</div>
        </div>
      }
    >
      <VerifyEmailConfirm />
    </Suspense>
  );
}
