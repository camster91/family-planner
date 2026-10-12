"use client";

import * as React from "react";
import { Wallet, Check, Trash2 } from "lucide-react";
import { LargeHeader } from "@/components/ui/large-header";
import { FeatureGate } from "@/components/ui/feature-gate";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { InsetList, SectionHeader } from "@/components/ui/list-row";
import { useToast } from "@/components/ui/toast";
import { OFFLINE_MESSAGE, responseErrorMessage } from "@/lib/fetch-error";
import { useTranslation } from "@/i18n";
import { allowanceCreateMessages } from "@/i18n/allowance-create";

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

export default function AllowancePage() {
  return (
    <FeatureGate featureKey="allowance">
      <AllowancePageInner />
    </FeatureGate>
  );
}

function AllowancePageInner() {
  const [items, setItems] = React.useState<AllowanceItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  // D5 (#102): teens and children see only their own allowance, read-only.
  // The API filters the rows; the page hides every control that would write.
  // Null until /api/auth/me answers, so the controls never flash for a kid.
  const [role, setRole] = React.useState<string | null>(null);
  const isParent = role === "parent";
  const { locale } = useTranslation();
  const createCopy = allowanceCreateMessages[locale];

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const { addToast } = useToast();
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({
        type: "error",
        title,
        message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE,
      });
    },
    [addToast],
  );

  React.useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/allowance", { cache: "no-store" });
      if (!response.ok) throw new Error("allowance load failed");
      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray((payload as { items?: unknown }).items)
      ) {
        throw new Error("allowance response was invalid");
      }
      setItems((payload as { items: AllowanceItem[] }).items);
    } catch {
      await failed("Couldn't load allowance");
    } finally {
      setLoading(false);
    }
  }, [failed]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function setStatus(
    id: string,
    status: "paid" | "cancelled",
    failure: string,
  ) {
    try {
      const res = await fetch(`/api/allowance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        await failed(failure, res);
        return;
      }
    } catch {
      await failed(failure);
      return;
    }
    load();
  }

  async function markPaid(id: string) {
    await setStatus(id, "paid", "Couldn't mark it paid");
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this allowance?")) return;
    await setStatus(id, "cancelled", "Couldn't cancel the allowance");
  }

  const pending = items.filter((i) => i.status === "pending");
  const paid = items.filter((i) => i.status === "paid").slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting="Family"
        title="Allowance"
        subtitle={
          role === null || isParent
            ? "Track weekly allowance and money owed between members."
            : "Your allowance: what you have coming and what has been paid."
        }
        trailing={
          isParent ? (
            <Link
              href="/dashboard/allowance/create"
              className="btn-tinted min-h-[44px]"
            >
              {createCopy.add}
            </Link>
          ) : null
        }
      />

      {loading ? (
        <div className="list-inset">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="row-apple border-b border-[var(--surface-separator)] last:border-b-0"
            >
              <div className="glyph bg-surface-fill shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full shimmer" />
                <div className="h-2.5 w-48 rounded-full shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          glyphColor="budget"
          title="No allowance yet"
          description={
            role === null || isParent
              ? "Track weekly allowance and money owed between members. Kids can see what they have coming."
              : "Nothing yet. When a parent adds allowance for you, it shows up here."
          }
        />
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <SectionHeader>Pending</SectionHeader>
              <InsetList>
                {pending.map((it, i) => (
                  <AllowanceRow
                    key={it.id}
                    item={it}
                    canManage={isParent}
                    onMarkPaid={markPaid}
                    onCancel={cancel}
                    last={i === pending.length - 1}
                  />
                ))}
              </InsetList>
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <SectionHeader>Recently paid</SectionHeader>
              <InsetList>
                {paid.map((it, i) => (
                  <AllowanceRow
                    key={it.id}
                    item={it}
                    canManage={isParent}
                    onMarkPaid={markPaid}
                    onCancel={cancel}
                    last={i === paid.length - 1}
                  />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AllowanceRow({
  item,
  canManage,
  onMarkPaid,
  onCancel,
  last,
}: {
  item: AllowanceItem;
  canManage: boolean;
  onMarkPaid: (id: string) => void;
  onCancel: (id: string) => void;
  last: boolean;
}) {
  return (
    <div className={last ? "" : "border-b border-[var(--surface-separator)]"}>
      <div className="row-apple">
        <Avatar name={item.to_name || "?"} src={item.to_avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-body text-label-primary">
            ${item.amount.toFixed(2)} → {item.to_name}
          </div>
          <div className="text-footnote text-label-secondary truncate">
            {item.reason ||
              (item.status === "paid" && item.paid_at
                ? `Paid ${new Date(item.paid_at).toLocaleDateString()}`
                : "No reason")}
          </div>
        </div>
        {item.status === "pending" && !canManage && (
          <span className="text-caption-1 font-semibold text-label-secondary uppercase tracking-wide">
            Pending
          </span>
        )}
        {item.status === "pending" && canManage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMarkPaid(item.id)}
              className="inline-flex h-11 w-11 items-center justify-center text-success-text active:opacity-60"
              aria-label="Mark paid"
            >
              <Check className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onCancel(item.id)}
              className="inline-flex h-11 w-11 items-center justify-center text-label-tertiary active:text-[var(--danger-text)]"
              aria-label="Cancel"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {item.status === "paid" && (
          <span className="text-caption-1 font-semibold text-success-text uppercase tracking-wide">
            Paid
          </span>
        )}
        {item.status === "cancelled" && (
          <span className="text-caption-1 font-semibold text-label-tertiary uppercase tracking-wide">
            Cancelled
          </span>
        )}
      </div>
    </div>
  );
}
