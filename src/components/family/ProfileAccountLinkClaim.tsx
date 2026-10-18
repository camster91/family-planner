"use client";
import { useEffect, useRef, useState } from "react";
import {
  profileLinkToken,
  type ProfileLinkReceipt,
} from "@/lib/profile-account-link-contract";
import { useProfileLinkText } from "@/i18n/profile-account-link";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import {
  requestProfileLink,
  oneLink,
  linkErrorKey,
} from "./profile-link-client";

export default function ProfileAccountLinkClaim() {
  const { text } = useProfileLinkText();
  const token = useRef<string | null>(null);
  const consumedFragment = useRef(false);
  const busyRef = useRef(false);
  const [hasToken, setHasToken] = useState(false);
  const [preview, setPreview] = useState<ProfileLinkReceipt | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ReturnType<typeof linkErrorKey> | null>(
    null,
  );
  usePendingFormNavigationController(busy);
  useEffect(() => {
    if (consumedFragment.current) return;
    consumedFragment.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const parsed = profileLinkToken.safeParse(fragment.get("token"));
    // Remove even malformed input; never put this proof in browser persistence,
    // request URLs, analytics events, help/assistant context or a return URL.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    token.current = parsed.success ? parsed.data : null;
    setHasToken(parsed.success);
  }, []);
  async function submit(claim: boolean) {
    if (busyRef.current || !token.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const row = oneLink(
        await requestProfileLink(
          claim
            ? { action: "claim", token: token.current, password }
            : { action: "preview", token: token.current },
        ),
        preview ? { id: preview.id, memberId: preview.memberId } : {},
      );
      if (
        !row.account ||
        (claim
          ? row.state !== "claimed"
          : !["pending", "claimed"].includes(row.state))
      )
        throw new Error("Unexpected profile link receipt");
      if (preview?.account && row.account.id !== preview.account.id)
        throw new Error("Account confirmation changed");
      if (claim) {
        setDone(true);
        token.current = null;
        setHasToken(false);
      } else setPreview(row);
    } catch (cause) {
      setError(linkErrorKey(cause));
    } finally {
      setPassword("");
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="mx-auto w-full max-w-xl space-y-5 rounded-[var(--radius-xl)] bg-surface p-5"
      aria-labelledby="profile-link-heading"
    >
      <h1 id="profile-link-heading" className="text-title-1 font-display">
        {text("claimTitle")}
      </h1>
      <p className="text-muted-foreground">{text("claimIntro")}</p>
      {error && <p role="alert">{text(error)}</p>}
      {done ? (
        <p role="status">{text("waiting")}</p>
      ) : !hasToken ? (
        <p>{text("missing")}</p>
      ) : (
        <>
          {!preview ? (
            <button
              className="btn-primary min-h-[44px]"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              {text(busy ? "loading" : "review")}
            </button>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(true);
              }}
            >
              <dl className="space-y-3 break-words">
                <div>
                  <dt className="text-muted-foreground">{text("history")}</dt>
                  <dd>
                    {preview.profileName} · {text(preview.profileRole)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{text("account")}</dt>
                  <dd>
                    {preview.account?.name} ·{" "}
                    {preview.account && text(preview.account.role)}
                    <span className="block text-muted-foreground">
                      {preview.account?.email}
                    </span>
                  </dd>
                </div>
              </dl>
              <p>{text("confirmCopy")}</p>
              <label className="block space-y-2">
                <span>{text("password")}</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  className="input-field w-full"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="btn-primary min-h-[44px] w-full"
                disabled={busy || !password}
              >
                {text(busy ? "busy" : "claim")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
