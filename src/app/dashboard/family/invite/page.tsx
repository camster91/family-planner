"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Check, Mail, X, RefreshCw } from "lucide-react";
import { LargeHeader } from "@/components/ui/large-header";
import { Dialog } from "@/components/ui/dialog";
import { ProfileSetupPanel } from "@/components/family/ProfileSetupPanel";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { FAMILY_CODE_LENGTH, formatFamilyCode } from "@/lib/family-code";
import { useFamilyInviteText } from "@/i18n/family-invite";
import { useDisplayLocale } from "@/components/ui/use-display-locale";

type InviteRole = "child" | "teen" | "parent";
type PendingInvite = {
  id: string;
  email: string;
  role: InviteRole;
  expires_at: string;
};
function isRole(value: unknown): value is InviteRole {
  return value === "child" || value === "teen" || value === "parent";
}
function isInvite(value: unknown): value is PendingInvite {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.email === "string" &&
    isRole(row.role) &&
    typeof row.expires_at === "string" &&
    Number.isFinite(Date.parse(row.expires_at))
  );
}
function codeToCopy(code: string) {
  return code.length === FAMILY_CODE_LENGTH ? formatFamilyCode(code) : code;
}

export default function InviteMemberPage() {
  const text = useFamilyInviteText();
  const locale = useDisplayLocale();
  const [familyCode, setFamilyCode] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "forbidden"
  >("loading");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("child");
  const [busy, setBusy] = useState<"send" | "rotate" | string | null>(null);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [confirmNewCode, setConfirmNewCode] = useState(false);
  usePendingFormNavigationController(busy !== null);

  const showCode = useCallback((code: string) => {
    setFamilyCode(code);
    setInviteLink(
      `${window.location.origin}/join?code=${encodeURIComponent(code)}`,
    );
  }, []);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setState("loading");
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = await meRes.json();
      if (sequence !== loadSequence.current) return;
      if (!meRes.ok || !meData?.user || !isRole(meData.user.role))
        throw new Error();
      if (meData.user.role !== "parent") {
        setState("forbidden");
        return;
      }
      const [familyRes, inviteRes] = await Promise.all([
        fetch("/api/family", { cache: "no-store" }),
        fetch("/api/family/invites", { cache: "no-store" }),
      ]);
      const [familyData, inviteData] = await Promise.all([
        familyRes.json(),
        inviteRes.json(),
      ]);
      if (sequence !== loadSequence.current) return;
      const code: unknown = familyData?.family?.invite_code;
      if (
        !familyRes.ok ||
        !inviteRes.ok ||
        typeof code !== "string" ||
        !code ||
        !Array.isArray(inviteData?.invites) ||
        !inviteData.invites.every(isInvite)
      )
        throw new Error();
      showCode(code);
      setInvites(inviteData.invites);
      setState("ready");
    } catch {
      if (sequence === loadSequence.current) setState("error");
    }
  }, [showCode]);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [load]);

  const start = (action: string) => {
    if (busyRef.current || state !== "ready") return false;
    busyRef.current = true;
    setBusy(action);
    setError(null);
    setMessage(null);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    setBusy(null);
  };
  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail || !start("send")) return;
    try {
      const res = await fetch("/api/family/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, role }),
      });
      const body = await res.json();
      if (
        !res.ok ||
        body?.success !== true ||
        !body.invite ||
        typeof body.invite.email !== "string" ||
        !isRole(body.invite.role) ||
        typeof body.invite.expires_at !== "string" ||
        !Number.isFinite(Date.parse(body.invite.expires_at)) ||
        body.invite.email.toLowerCase() !== targetEmail.toLowerCase() ||
        body.invite.role !== role
      )
        throw new Error();
      setEmail("");
      setInviteOpen(false);
      setMessage(text("sent", { email: body.invite.email }));
      // Send receipts intentionally omit database IDs. Re-read the canonical list.
      void load();
    } catch {
      setError(text("sendFailed"));
    } finally {
      finish();
    }
  };
  const handleRevoke = async (id: string) => {
    if (!start(id)) return;
    try {
      const res = await fetch(`/api/family/invites/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setInvites((current) => current.filter((invite) => invite.id !== id));
    } catch {
      setError(text("revokeFailed"));
    } finally {
      finish();
    }
  };
  const handleNewCode = async () => {
    if (!start("rotate")) return;
    try {
      const res = await fetch("/api/family/invite-code", { method: "POST" });
      const body = await res.json();
      if (!res.ok || typeof body?.inviteCode !== "string" || !body.inviteCode)
        throw new Error();
      showCode(body.inviteCode);
      setConfirmNewCode(false);
      setMessage(text("rotated"));
    } catch {
      // A lost response may have rotated the code. Disable sharing until a fresh read.
      setFamilyCode("");
      setInviteLink("");
      setError(text("rotateFailed"));
      setConfirmNewCode(false);
      setState("error");
    } finally {
      finish();
    }
  };
  const copy = async (kind: "code" | "link", value: string) => {
    if (!value || busyRef.current || state !== "ready") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(text("copyFailed"));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-20">
      <LargeHeader title={text("title")} subtitle={text("description")} />
      {message && (
        <p
          role="status"
          className="rounded-xl bg-[var(--success-tint)] p-4 text-success-text [overflow-wrap:anywhere]"
        >
          {message}
        </p>
      )}
      {error && !inviteOpen && (
        <p
          role="alert"
          className="rounded-xl bg-[var(--danger-tint)] p-4 text-[var(--danger-text)]"
        >
          {error}
        </p>
      )}
      {state === "loading" && <p role="status">{text("loading")}</p>}
      {state === "forbidden" && <p role="status">{text("parentOnly")}</p>}
      {state === "error" && (
        <div role="alert" className="card-apple space-y-3 p-5">
          <p>{text("loadFailed")}</p>
          <button
            className="btn-tinted min-h-[44px]"
            onClick={() => void load()}
          >
            {text("retry")}
          </button>
        </div>
      )}
      {state === "ready" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="card-apple space-y-3 p-5">
              <h2 className="text-title-3 text-label-primary">
                {text("emailChoice")}
              </h2>
              <p className="text-subhead text-label-secondary">
                {text("emailHelp")}
              </p>
              <button
                type="button"
                disabled={busy !== null}
                className="btn-filled min-h-[44px] w-full"
                onClick={() => {
                  setError(null);
                  setInviteOpen(true);
                }}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                {text("invite")}
              </button>
            </section>
            <section className="card-apple space-y-3 p-5">
              <h2 className="text-title-3 text-label-primary">
                {text("profileChoice")}
              </h2>
              <p className="text-subhead text-label-secondary">
                {text("profileHelp")}
              </p>
              <ProfileSetupPanel />
            </section>
          </div>
          <p className="text-footnote text-label-secondary">
            {text("separate")}
          </p>
          <section
            className="card-apple space-y-3 p-5"
            aria-labelledby="pending-invites"
          >
            <h2
              id="pending-invites"
              className="text-title-3 text-label-primary"
            >
              {text("pending")}
            </h2>
            {!invites.length ? (
              <p className="text-subhead text-label-secondary">
                {text("none")}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--surface-separator)]">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-medium [overflow-wrap:anywhere]">
                        {invite.email}
                      </p>
                      <p className="text-footnote text-label-secondary">
                        {text("expires", {
                          role: text(invite.role),
                          date: new Date(invite.expires_at).toLocaleDateString(
                            locale,
                          ),
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void handleRevoke(invite.id)}
                      className="btn-plain min-h-[44px] min-w-[44px] shrink-0"
                      aria-label={text("revoke", { email: invite.email })}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <details className="card-apple p-5">
            <summary className="min-h-[44px] cursor-pointer content-center text-body font-semibold">
              {text("inPerson")}
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-subhead text-label-secondary">
                {text("codeHelp")}
              </p>
              <label className="block text-footnote text-label-secondary">
                {text("codeLabel")}
                <input
                  readOnly
                  value={codeToCopy(familyCode)}
                  className="input-apple mt-1 font-mono"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !familyCode}
                onClick={() => void copy("code", codeToCopy(familyCode))}
                className="btn-tinted min-h-[44px]"
              >
                {copied === "code" ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Copy aria-hidden="true" className="h-4 w-4" />
                )}
                {text(copied === "code" ? "copied" : "copyCode")}
              </button>
              <label className="block text-footnote text-label-secondary">
                {text("linkLabel")}
                <input
                  readOnly
                  value={inviteLink}
                  className="input-apple mt-1"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !inviteLink}
                onClick={() => void copy("link", inviteLink)}
                className="btn-tinted min-h-[44px]"
              >
                {text(copied === "link" ? "copied" : "copyLink")}
              </button>
              <p className="text-footnote text-label-secondary">
                {text("rotateHelp")}
              </p>
              <button
                type="button"
                disabled={busy !== null || !familyCode}
                onClick={() => {
                  setError(null);
                  setConfirmNewCode(true);
                }}
                className="btn-ghost min-h-[44px]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {text("rotate")}
              </button>
            </div>
          </details>
        </>
      )}
      <Dialog
        open={inviteOpen}
        onClose={busy !== null ? undefined : () => setInviteOpen(false)}
        title={text("inviteTitle")}
        description={text("inviteDescription")}
        closeLabel={text("close")}
        variant="form"
        footer={
          <button
            type="submit"
            form="family-invite-form"
            disabled={busy !== null || state !== "ready" || !email.trim()}
            className="btn-filled min-h-[44px] w-full"
          >
            {text(busy === "send" ? "sending" : "send")}
          </button>
        }
      >
        <form
          id="family-invite-form"
          onSubmit={handleSend}
          className="space-y-4"
        >
          {error && (
            <p role="alert" className="text-[var(--danger-text)]">
              {error}
            </p>
          )}
          <fieldset disabled={busy !== null} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="label-apple">
                {text("email")}
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input-apple"
                placeholder="alex@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="label-apple">
                {text("role")}
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) => {
                  if (isRole(event.target.value)) setRole(event.target.value);
                }}
                className="input-apple"
              >
                {(["child", "teen", "parent"] as const).map((option) => (
                  <option key={option} value={option}>
                    {text(option)}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        </form>
      </Dialog>
      <Dialog
        open={confirmNewCode}
        onClose={busy !== null ? undefined : () => setConfirmNewCode(false)}
        title={text("rotateTitle")}
        description={text("rotateDescription")}
        closeLabel={text("close")}
        role="alertdialog"
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirmNewCode(false)}
            className="btn-ghost min-h-[44px] flex-1"
          >
            {text("keepCode")}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleNewCode()}
            className="btn-filled min-h-[44px] flex-1"
          >
            {text(busy === "rotate" ? "rotating" : "newCode")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
