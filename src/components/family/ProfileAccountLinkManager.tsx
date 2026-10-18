"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  readHouseholdProfiles,
  type HouseholdProfile,
} from "@/lib/household-profile-types";
import type { ProfileLinkReceipt } from "@/lib/profile-account-link-contract";
import { useProfileLinkText } from "@/i18n/profile-account-link";
import {
  requestProfileLink,
  oneLink,
  linkErrorKey,
} from "./profile-link-client";

type IssueDraft = {
  memberId: string;
  revision: number;
  key: string;
  token: string;
};
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export default function ProfileAccountLinkManager({
  onLinked,
}: {
  onLinked?: () => void | Promise<void>;
}) {
  const { text, locale } = useProfileLinkText();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<HouseholdProfile[]>([]);
  const [links, setLinks] = useState<ProfileLinkReceipt[]>([]);
  const [selected, setSelected] = useState("");
  const [review, setReview] = useState<ProfileLinkReceipt | null>(null);
  const [share, setShare] = useState<{ id: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof linkErrorKey> | null>(
    null,
  );
  const [notice, setNotice] = useState<
    "success" | "revoked" | "copied" | "copyError" | null
  >(null);
  const loadSequence = useRef(0);
  const pending = useRef(false);
  // Retain the exact token/key on an ambiguous response, never persist it.
  const issueDraft = useRef<IssueDraft | null>(null);
  usePendingFormNavigationController(busy);
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await requestProfileLink();
      const response = await fetch("/api/family/profiles", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const roster = readHouseholdProfiles(body);
      if (!response.ok || !roster) throw new Error("Invalid profile roster");
      if (sequence !== loadSequence.current) return;
      setSupported(true);
      setLinks(rows);
      setProfiles(roster.filter((row) => !row.archived_at));
      setShare((current) =>
        current &&
        rows.some((row) => row.id === current.id && row.state === "pending")
          ? current
          : null,
      );
      setSelected((value) =>
        roster.some((row) => row.id === value && !row.archived_at) ? value : "",
      );
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      const key = linkErrorKey(cause);
      if (key === "unsupported") {
        setSupported(false);
        issueDraft.current = null;
        setShare(null);
      } else setError(key);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, []);
  function replace(row: ProfileLinkReceipt) {
    setLinks((current) => [
      row,
      ...current.filter((item) => item.id !== row.id),
    ]);
  }
  async function issue() {
    const profile = profiles.find((row) => row.id === selected);
    if (pending.current || !profile) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (
        !issueDraft.current ||
        issueDraft.current.memberId !== profile.id ||
        issueDraft.current.revision !== profile.revision
      )
        issueDraft.current = {
          memberId: profile.id,
          revision: profile.revision,
          key: newIdempotencyKey(),
          token: newToken(),
        };
      const draft = issueDraft.current;
      const row = oneLink(
        await requestProfileLink({ action: "issue", ...draft }),
        { memberId: profile.id },
      );
      if (!["pending", "claimed"].includes(row.state))
        throw new Error("Unexpected issue receipt");
      replace(row);
      if (row.state === "pending")
        setShare({
          id: row.id,
          url: `${window.location.origin}/dashboard/profile-link#token=${draft.token}`,
        });
      else {
        issueDraft.current = null;
        setShare(null);
      }
    } catch (cause) {
      setError(linkErrorKey(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function change(row: ProfileLinkReceipt, action: "approve" | "revoke") {
    if (pending.current || (action === "approve" && !row.account)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = oneLink(
        await requestProfileLink({
          action,
          id: row.id,
          revision: row.revision,
        }),
        {
          id: row.id,
          memberId: row.memberId,
          state: action === "approve" ? "linked" : "revoked",
        },
      );
      if (
        next.revision <= row.revision ||
        (action === "approve" && next.account?.id !== row.account?.id)
      )
        throw new Error("Unexpected confirmation receipt");
      replace(next);
      setReview(null);
      if (share?.id === row.id) {
        setShare(null);
        issueDraft.current = null;
      }
      setNotice(action === "approve" ? "success" : "revoked");
      if (action === "approve") {
        setProfiles((current) =>
          current.filter((profile) => profile.id !== row.memberId),
        );
        setSelected("");
        try {
          await onLinked?.();
        } catch {
          /* Linking is already confirmed; roster can be refreshed separately. */
        }
      }
    } catch (cause) {
      setError(linkErrorKey(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setNotice("copied");
    } catch {
      setNotice("copyError");
    }
  }
  if (supported === false) return null;
  return (
    <>
      <button
        className="btn-secondary min-h-[44px]"
        onClick={() => {
          setOpen(true);
          if (!loading) void load();
        }}
      >
        {text("title")}
      </button>
      <Dialog
        open={open}
        onClose={
          busy
            ? undefined
            : () => {
                setOpen(false);
                setReview(null);
              }
        }
        title={text("title")}
        closeLabel={text("close")}
        description={text("intro")}
        variant="form"
      >
        <div className="space-y-5 min-w-0">
          <p className="text-muted-foreground">{text("steps")}</p>
          {notice && <p role="status">{text(notice)}</p>}
          {error && <p role="alert">{text(error)}</p>}
          <button
            className="btn-secondary min-h-[44px]"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            {text(loading ? "loading" : "retry")}
          </button>
          {share && (
            <div className="space-y-2 rounded-[var(--radius-lg)] border border-border p-3">
              <label className="block space-y-2">
                <span>{text("share")}</span>
                <input
                  readOnly
                  type="text"
                  className="input-field w-full"
                  value={share.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p className="text-muted-foreground">{text("shareHelp")}</p>
              <button
                className="btn-secondary min-h-[44px]"
                onClick={() => void copyLink()}
              >
                {text("copy")}
              </button>
            </div>
          )}
          {!loading && supported && (
            <>
              {profiles.length ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void issue();
                  }}
                >
                  <label className="block space-y-2">
                    <span>{text("profile")}</span>
                    <select
                      className="input-field w-full"
                      value={selected}
                      required
                      disabled={busy}
                      onChange={(event) => {
                        setSelected(event.target.value);
                        setError(null);
                      }}
                    >
                      <option value="">{text("choose")}</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {text(profile.role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn-primary min-h-[44px]"
                    type="submit"
                    disabled={!selected || busy}
                  >
                    {text(busy ? "busy" : "create")}
                  </button>
                </form>
              ) : (
                <p>{text("noProfiles")}</p>
              )}
              <h2 className="font-display text-title-3">{text("recent")}</h2>
              {links.length ? (
                <ul className="divide-y divide-border">
                  {links.map((row) => (
                    <li key={row.id} className="space-y-2 py-3 break-words">
                      <p className="font-medium">
                        {row.profileName} · {text(row.profileRole)}
                      </p>
                      <p>
                        {text(row.state)}
                        {row.account ? ` · ${row.account.name}` : ""}
                      </p>
                      <p className="text-muted-foreground">
                        {text("expires")}{" "}
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(row.expiresAt))}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {row.state === "claimed" && row.account && (
                          <button
                            className="btn-primary min-h-[44px]"
                            disabled={busy}
                            onClick={() => {
                              setReview(row);
                              setError(null);
                            }}
                          >
                            {text("approve")}
                          </button>
                        )}
                        {!["linked", "revoked"].includes(row.state) && (
                          <button
                            className="btn-secondary min-h-[44px]"
                            disabled={busy}
                            onClick={() => void change(row, "revoke")}
                          >
                            {text("revoke")}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{text("empty")}</p>
              )}
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(review)}
        title={text("confirmTitle")}
        description={text("confirmCopy")}
        onClose={busy ? undefined : () => setReview(null)}
        closeLabel={text("close")}
        variant="form"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              {text("cancel")}
            </button>
            <button
              className="btn-primary min-h-[44px]"
              disabled={busy || !review?.account}
              onClick={() => review && void change(review, "approve")}
            >
              {text(busy ? "busy" : "approveFinal")}
            </button>
          </div>
        }
      >
        {error && <p role="alert">{text(error)}</p>}
        {review && (
          <dl className="space-y-3 break-words">
            <div>
              <dt>{text("history")}</dt>
              <dd>
                {review.profileName} · {text(review.profileRole)}
              </dd>
            </div>
            <div>
              <dt>{text("account")}</dt>
              <dd>
                {review.account?.name} ·{" "}
                {review.account && text(review.account.role)}
              </dd>
            </div>
          </dl>
        )}
      </Dialog>
    </>
  );
}
