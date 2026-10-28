"use client";

import * as React from "react";
import { Wallet, Check, Trash2 } from "lucide-react";
import Link from "next/link";
import { LargeHeader } from "@/components/ui/large-header";
import { FeatureGate } from "@/components/ui/feature-gate";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { InsetList, SectionHeader } from "@/components/ui/list-row";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useTranslation } from "@/i18n";
import { allowanceCreateMessages } from "@/i18n/allowance-create";
import { allowanceMessages, type AllowanceCopy } from "@/i18n/allowance";

interface AllowanceItem {
  id: string;
  amount: number;
  reason?: string | null;
  status: "pending" | "paid" | "cancelled";
  scheduled_for?: string | null;
  paid_at?: string | null;
  from_user_id: string;
  to_user_id: string;
  from_name?: string;
  to_name?: string;
  to_avatar?: string | null;
  created_at: string;
}
function isItem(value: unknown): value is AllowanceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as AllowanceItem;
  return (
    typeof item.id === "string" &&
    !!item.id &&
    typeof item.amount === "number" &&
    Number.isFinite(item.amount) &&
    ["pending", "paid", "cancelled"].includes(item.status) &&
    typeof item.from_user_id === "string" &&
    typeof item.to_user_id === "string" &&
    [
      "reason",
      "scheduled_for",
      "paid_at",
      "from_name",
      "to_name",
      "to_avatar",
    ].every((key) => {
      const field = (item as unknown as Record<string, unknown>)[key];
      return field === undefined || field === null || typeof field === "string";
    })
  );
}
export default function AllowancePage() {
  return (
    <FeatureGate featureKey="allowance">
      <AllowancePageInner />
    </FeatureGate>
  );
}
function AllowancePageInner() {
  const { locale } = useTranslation();
  const copy = allowanceMessages[locale];
  const [items, setItems] = React.useState<AllowanceItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [role, setRole] = React.useState<string | null>(null);
  const [roleError, setRoleError] = React.useState(false);
  const [roleLoading, setRoleLoading] = React.useState(false);
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<
    "paid" | "cancelled" | null
  >(null);
  const mutationRef = React.useRef(false);
  const readRef = React.useRef(0);
  const roleReadRef = React.useRef(0);
  const addRef = React.useRef<HTMLAnchorElement>(null);
  const keepRef = React.useRef<HTMLButtonElement>(null);
  const isParent = role === "parent";
  const target = items.find(
    (item) => item.id === cancelId && item.status === "pending",
  );
  usePendingFormNavigationController(pendingId !== null);
  React.useEffect(() => {
    if (cancelId && !target && !pendingId) {
      setCancelId(null);
      setActionError(null);
      setTimeout(() => addRef.current?.focus(), 0);
    }
  }, [cancelId, target, pendingId]);

  const loadRole = React.useCallback(async () => {
    const read = ++roleReadRef.current;
    setRoleLoading(true);
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("Role unavailable");
      const data = await response.json();
      if (!["parent", "teen", "child"].includes(data?.user?.role))
        throw new Error("Invalid role");
      if (read !== roleReadRef.current) return;
      setRole(data.user.role);
      setRoleError(false);
    } catch {
      if (read !== roleReadRef.current) return;
      setRole(null);
      setRoleError(true);
    } finally {
      if (read === roleReadRef.current) setRoleLoading(false);
    }
  }, []);
  const load = React.useCallback(async () => {
    const read = ++readRef.current;
    setLoading(true);
    try {
      const response = await fetch("/api/allowance", { cache: "no-store" });
      if (!response.ok) throw new Error("Load unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.items) || !data.items.every(isItem))
        throw new Error("Invalid list");
      if (read !== readRef.current) return false;
      setItems(data.items);
      setLoadError(false);
      setActionError(null);
      return true;
    } catch {
      if (read === readRef.current) setLoadError(true);
      return false;
    } finally {
      if (read === readRef.current) setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void loadRole();
    void load();
    return () => {
      readRef.current += 1;
      roleReadRef.current += 1;
    };
  }, [loadRole, load]);
  const close = () => {
    if (!mutationRef.current) {
      setCancelId(null);
      setActionError(null);
    }
  };
  async function setStatus(id: string, status: "paid" | "cancelled") {
    if (
      !isParent ||
      mutationRef.current ||
      !items.some((item) => item.id === id && item.status === "pending")
    )
      return;
    mutationRef.current = true;
    setPendingId(id);
    setActionError(null);
    // An older read must not overwrite the canonical mutation receipt.
    readRef.current += 1;
    setLoading(false);
    try {
      const response = await fetch(`/api/allowance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Status refused");
      const { allowance } = await response.json();
      if (
        !isItem(allowance) ||
        allowance.id !== id ||
        allowance.status !== status ||
        !(status === "cancelled"
          ? allowance.paid_at === null
          : typeof allowance.paid_at === "string" &&
            Number.isFinite(Date.parse(allowance.paid_at)))
      )
        throw new Error("Unconfirmed status");
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, status: allowance.status, paid_at: allowance.paid_at }
            : item,
        ),
      );
      setLoadError(false);
      if (status === "cancelled") setCancelId(null);
      // The completed row loses its action buttons for both statuses.
      setTimeout(() => addRef.current?.focus(), 0);
    } catch {
      setActionError(status);
    } finally {
      mutationRef.current = false;
      setPendingId(null);
    }
  }
  const pending = items.filter((item) => item.status === "pending");
  const paid = items.filter((item) => item.status === "paid").slice(0, 10);
  const cancelled = items
    .filter((item) => item.status === "cancelled")
    .slice(0, 10);
  const rows = (list: AllowanceItem[]) => (
    <InsetList>
      {list.map((item, index) => (
        <AllowanceRow
          key={item.id}
          item={item}
          copy={copy}
          locale={locale}
          canManage={isParent}
          busy={pendingId !== null}
          onMarkPaid={(id) => void setStatus(id, "paid")}
          onCancel={(id) => {
            if (mutationRef.current) return;
            setActionError(null);
            setCancelId(id);
          }}
          last={index === list.length - 1}
        />
      ))}
    </InsetList>
  );
  const refresh = async () => {
    if (!mutationRef.current) await load();
  };
  const errorText =
    actionError === "cancelled" ? copy.cancelFailed : copy.paidFailed;
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting={copy.family}
        title={copy.title}
        subtitle={
          role === "teen" || role === "child" ? copy.ownSubtitle : copy.subtitle
        }
        trailing={
          isParent ? (
            <Link
              ref={addRef}
              href="/dashboard/allowance/create"
              className="btn-tinted min-h-[44px]"
            >
              {allowanceCreateMessages[locale].add}
            </Link>
          ) : null
        }
      />
      {roleError && (
        <div
          role="alert"
          className="rounded-xl bg-[var(--surface-fill-secondary)] p-4 text-body"
        >
          <p>{copy.roleFailed}</p>
          <button
            type="button"
            disabled={roleLoading}
            className="btn-tinted min-h-11 mt-2"
            onClick={() => void loadRole()}
          >
            {copy.retry}
          </button>
        </div>
      )}
      {(loadError || (actionError && !cancelId)) && (
        <div
          role="alert"
          className="rounded-xl bg-[var(--surface-fill-secondary)] p-4 text-body"
        >
          <p>{loadError ? copy.loadFailed : errorText}</p>
          <button
            type="button"
            disabled={loading || pendingId !== null}
            className="btn-tinted min-h-11 mt-2"
            onClick={() => void refresh()}
          >
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="list-inset" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="row-apple">
              <div className="glyph bg-surface-fill shimmer" />
              <div className="h-3 w-32 rounded-full shimmer" />
            </div>
          ))}
        </div>
      ) : items.length === 0 && !loadError ? (
        <EmptyState
          icon={Wallet}
          glyphColor="budget"
          title={copy.empty}
          description={isParent ? copy.emptyParent : copy.emptyMember}
        />
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <SectionHeader>{copy.pending}</SectionHeader>
              {rows(pending)}
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <SectionHeader>{copy.recentlyPaid}</SectionHeader>
              {rows(paid)}
            </section>
          )}
          {cancelled.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-subhead font-semibold">
                {copy.cancelled} ({cancelled.length})
              </summary>
              {rows(cancelled)}
            </details>
          )}
        </>
      )}
      <Dialog
        open={isParent && !!target}
        role="alertdialog"
        initialFocusRef={keepRef}
        title={copy.cancelConfirm}
        description={copy.cancelDescription}
        closeLabel={copy.close}
        onClose={pendingId ? undefined : close}
      >
        {target && (
          <div className="space-y-4">
            <p className="break-words text-body font-semibold">
              ${target.amount.toFixed(2)} → {target.to_name}
            </p>
            {target.reason && (
              <p className="break-words text-body text-label-secondary">
                {target.reason}
              </p>
            )}
            {(actionError || loadError) && (
              <div role="alert" className="text-body text-danger-text">
                <p>{loadError ? copy.loadFailed : errorText}</p>
                <button
                  type="button"
                  className="btn-tinted min-h-11 mt-2"
                  disabled={loading || pendingId !== null}
                  onClick={() => void refresh()}
                >
                  {loading ? copy.refreshing : copy.refresh}
                </button>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={pendingId !== null}
                ref={keepRef}
                onClick={close}
              >
                {copy.keep}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-full bg-danger-fill px-4 py-2 text-subhead font-semibold text-white disabled:opacity-50"
                disabled={pendingId !== null || loading}
                onClick={() => void setStatus(target.id, "cancelled")}
              >
                {pendingId ? copy.cancelling : copy.cancelAction}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
function AllowanceRow({
  item,
  canManage,
  busy,
  onMarkPaid,
  onCancel,
  last,
  copy,
  locale,
}: {
  item: AllowanceItem;
  canManage: boolean;
  busy: boolean;
  onMarkPaid: (id: string) => void;
  onCancel: (id: string) => void;
  last: boolean;
  copy: AllowanceCopy;
  locale: string;
}) {
  const paidDate =
    item.paid_at && !Number.isNaN(Date.parse(item.paid_at))
      ? new Date(item.paid_at).toLocaleDateString(locale)
      : null;
  return (
    <div className={last ? "" : "border-b border-[var(--surface-separator)]"}>
      <div className="row-apple">
        <Avatar name={item.to_name || "?"} src={item.to_avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-body text-label-primary break-words">
            ${item.amount.toFixed(2)} → {item.to_name}
          </div>
          <div className="text-footnote text-label-secondary break-words">
            {item.reason ||
              (item.status === "paid" && paidDate
                ? `${copy.paid} ${paidDate}`
                : copy.noReason)}
          </div>
        </div>
        {item.status === "pending" && !canManage && (
          <span className="text-caption-1 font-semibold text-label-secondary">
            {copy.pending}
          </span>
        )}
        {item.status === "pending" && canManage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onMarkPaid(item.id)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-success-text disabled:opacity-50"
              aria-label={copy.markPaid}
            >
              <Check className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel(item.id)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-danger-text disabled:opacity-50"
              aria-label={copy.cancelAction}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {item.status === "paid" && (
          <span className="text-caption-1 font-semibold text-success-text">
            {copy.paid}
          </span>
        )}
        {item.status === "cancelled" && (
          <span className="text-caption-1 font-semibold text-label-secondary">
            {copy.cancelled}
          </span>
        )}
      </div>
    </div>
  );
}
