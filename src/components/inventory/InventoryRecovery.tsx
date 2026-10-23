"use client";
import * as React from "react";
import { useTranslation } from "@/i18n";
import { inventoryEnglish, inventorySpanish } from "@/i18n/inventory";
import {
  inventoryRecoveryEnglish,
  inventoryRecoverySpanish,
} from "@/i18n/inventory-recovery";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { browserInventoryRecovery } from "@/lib/inventory-recovery-browser";
import { readInventoryRecoveryReview } from "@/lib/inventory-recovery-client";
import {
  postInventoryIntake,
  type IntakeContext,
  type IntakeIntent,
  type IntakeOutcome,
} from "@/lib/inventory-intake-client";
import {
  postInventoryChange,
  type InventoryChangeIntent,
  type InventoryChangeOutcome,
} from "@/lib/inventory-change-client";
import { inventoryIntakeInput } from "@/lib/inventory-intake-contract";
import { inventoryChangeInput } from "@/lib/inventory-change-contract";
import { restockInput } from "@/lib/inventory-restock-contract";
import {
  postInventoryRestock,
  type RestockIntent,
  type RestockOutcome,
} from "@/lib/inventory-restock-client";
import type { InventoryRecoveryEntry } from "@/lib/inventory-recovery-contract";
import type { InventoryRecoveryReview } from "@/lib/inventory-recovery-review-contract";
type Controller = ReturnType<typeof browserInventoryRecovery>;
type Status = "legacy" | "loading" | "ready" | "paused" | "blocked";
type WriteOutcome = IntakeOutcome | InventoryChangeOutcome | RestockOutcome;
function sendEntry(
  entry: InventoryRecoveryEntry,
  scope?: string,
): Promise<WriteOutcome> {
  return entry.kind === "intake"
    ? postInventoryIntake(entry, scope)
    : entry.kind === "restock"
      ? postInventoryRestock(entry, scope)
      : postInventoryChange(entry, scope);
}
type Recovery = {
  intake: (intent: IntakeIntent) => Promise<IntakeOutcome>;
  change: (intent: InventoryChangeIntent) => Promise<InventoryChangeOutcome>;
  restock: (intent: RestockIntent) => Promise<RestockOutcome>;
  status: Status;
  mountedPending: boolean;
  rows: InventoryRecoveryEntry[];
  busy: boolean;
  review: InventoryRecoveryReview | null;
  selected: string | null;
  check: () => Promise<void>;
  inspect: (key: string) => Promise<void>;
  retry: (key: string) => Promise<boolean>;
  dismiss: (key: string) => Promise<boolean>;
};
const Context = React.createContext<Recovery | null>(null);
export function useInventoryWrites() {
  const recovery = React.useContext(Context);
  return (
    recovery ?? {
      intake: postInventoryIntake,
      change: postInventoryChange,
      restock: postInventoryRestock,
    }
  );
}
function online() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
export function useInventoryRecoveryBlocked() {
  const value = React.useContext(Context);
  return (
    !!value &&
    value.status !== "legacy" &&
    (value.status !== "ready" ||
      value.busy ||
      value.rows.length > 0 ||
      value.mountedPending)
  );
}
export function InventoryRecoveryProvider({
  required,
  original,
  children,
}: {
  required: boolean;
  original?: IntakeContext;
  children: React.ReactNode;
}) {
  const adopted = React.useRef(required);
  adopted.current ||= required;
  const initial = React.useRef(original).current;
  const changed =
    initial?.userId !== original?.userId ||
    initial?.familyId !== original?.familyId;
  const controller = React.useRef<Controller | null>(null);
  const flight = React.useRef(false),
    mounted = React.useRef(false);
  const init = React.useRef<Promise<void> | null>(null);
  const pendingKeys = React.useRef(new Set<string>());
  const [mountedPending, setMountedPending] = React.useState(false);
  const [status, setStatus] = React.useState<Status>(
    required ? "loading" : "legacy",
  );
  const [rows, setRows] = React.useState<InventoryRecoveryEntry[]>([]);
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const [busy, setBusy] = React.useState(false);
  const [review, setReview] = React.useState<InventoryRecoveryReview | null>(
    null,
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  const statusRef = React.useRef(status);
  statusRef.current = changed ? "blocked" : status;
  const failed = () => {
    statusRef.current = "blocked";
    if (mounted.current) {
      setReview(null);
      setStatus("blocked");
    }
  };
  async function check() {
    if (!adopted.current || flight.current) return;
    if (changed || !initial || !online()) {
      failed();
      return;
    }
    flight.current = true;
    setBusy(true);
    setReview(null);
    try {
      const store = (controller.current ??= browserInventoryRecovery(initial));
      const found = store.hasUncertainStorage()
        ? await store.recoverStorage()
        : await store.initialize();
      if (mounted.current) {
        setRows(found);
        rowsRef.current = found;
        pendingKeys.current = new Set(found.map((entry) => entry.key));
        setMountedPending(found.length > 0);
        statusRef.current = store.writesAvailable() ? "ready" : "paused";
        setStatus(statusRef.current);
      }
    } catch {
      failed();
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        setMountedPending(pendingKeys.current.size > 0);
      }
    }
  }
  React.useEffect(() => {
    mounted.current = true;
    if (adopted.current && !init.current) init.current = check();
    return () => {
      mounted.current = false;
    };
  }, [required]); // Original ownership stays captured; page key changes on real owner/role changes.
  const pending = rows.length > 0 || busy || mountedPending;
  usePendingFormNavigationController(pending);
  async function write(
    kind: "intake",
    intent: IntakeIntent,
  ): Promise<IntakeOutcome>;
  async function write(
    kind: "change",
    intent: InventoryChangeIntent,
  ): Promise<InventoryChangeOutcome>;
  async function write(
    kind: "restock",
    intent: RestockIntent,
  ): Promise<RestockOutcome>;
  async function write(
    kind: "intake" | "change" | "restock",
    intent: IntakeIntent,
  ): Promise<WriteOutcome> {
    if (!adopted.current) return sendEntry({ kind, ...intent });
    if (
      changed ||
      statusRef.current !== "ready" ||
      rowsRef.current.length ||
      (pendingKeys.current.size > 0 && !pendingKeys.current.has(intent.key)) ||
      !controller.current ||
      flight.current ||
      !online()
    )
      return { kind: "refused", code: "INVENTORY_RECOVERY_REQUIRED" };
    flight.current = true;
    setBusy(true);
    const wasPending = pendingKeys.current.has(intent.key);
    let staged = false;
    try {
      const store = controller.current;
      pendingKeys.current.add(intent.key);
      await store.stage({ kind, key: intent.key, body: intent.body });
      staged = true;
      const outcome = await store.send(intent.key, true, sendEntry);
      // Unconfirmed/refused requests stay durably present. A later mount reviews them.
      if (
        outcome.kind === "confirmed" ||
        outcome.kind === "removed" ||
        outcome.kind === "not_applied"
      ) {
        await store.dismiss(intent.key);
        pendingKeys.current.delete(intent.key);
      } else if (outcome.kind === "refused") failed();
      return outcome;
    } catch {
      failed();
      if (
        !staged &&
        !wasPending &&
        !controller.current?.hasUncertainStorage()
      ) {
        pendingKeys.current.delete(intent.key);
        return { kind: "refused", code: "INVENTORY_RECOVERY_DRAFT_REFUSED" };
      }
      return { kind: "unknown" };
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        setMountedPending(pendingKeys.current.size > 0);
      }
    }
  }
  async function inspect(key: string) {
    if (!controller.current || flight.current || changed || !online()) return;
    flight.current = true;
    setBusy(true);
    setSelected(key);
    setReview(null);
    try {
      const result = await controller.current.inspect(
        key,
        readInventoryRecoveryReview,
      );
      if (mounted.current) {
        setReview(result);
        statusRef.current = controller.current.writesAvailable()
          ? "ready"
          : "paused";
        setStatus(statusRef.current);
      }
    } catch {
      failed();
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        setMountedPending(pendingKeys.current.size > 0);
      }
    }
  }
  async function dismiss(key: string) {
    if (!controller.current || flight.current || changed || !online())
      return false;
    flight.current = true;
    setBusy(true);
    try {
      await controller.current.dismiss(key);
      pendingKeys.current.delete(key);
      if (mounted.current) {
        const next = rowsRef.current.filter((row) => row.key !== key);
        rowsRef.current = next;
        setRows(next);
        setReview(null);
        setSelected(null);
        statusRef.current = controller.current.writesAvailable()
          ? "ready"
          : "paused";
        setStatus(statusRef.current);
      }
      return true;
    } catch {
      failed();
      return false;
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        setMountedPending(pendingKeys.current.size > 0);
      }
    }
  }
  async function retry(key: string) {
    if (
      !controller.current ||
      flight.current ||
      changed ||
      !online() ||
      selected !== key ||
      statusRef.current !== "ready" ||
      !review?.canRetry
    )
      return false;
    flight.current = true;
    setBusy(true);
    try {
      const outcome = await controller.current.send(key, true, sendEntry);
      if (
        outcome.kind !== "confirmed" &&
        outcome.kind !== "removed" &&
        outcome.kind !== "not_applied"
      ) {
        failed();
        return false;
      }
      await controller.current.dismiss(key);
      pendingKeys.current.delete(key);
      if (mounted.current) {
        const next = rowsRef.current.filter((row) => row.key !== key);
        rowsRef.current = next;
        setRows(next);
        setReview(null);
        setSelected(null);
      }
      return true;
    } catch {
      failed();
      return false;
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        setMountedPending(pendingKeys.current.size > 0);
      }
    }
  }
  return (
    <Context.Provider
      value={{
        intake: (intent) => write("intake", intent),
        change: (intent) => write("change", intent),
        restock: (intent) => write("restock", intent),
        status: changed ? "blocked" : status,
        mountedPending,
        rows,
        busy,
        review: changed ? null : review,
        selected,
        check,
        inspect,
        retry,
        dismiss,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function InventoryRecoveryPanel({
  suspended,
  onChanged,
}: {
  suspended: boolean;
  onChanged: () => void;
}) {
  const value = React.useContext(Context),
    { locale } = useTranslation();
  const c =
    locale === "es" ? inventoryRecoverySpanish : inventoryRecoveryEnglish;
  const [open, setOpen] = React.useState(false),
    [discard, setDiscard] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (
      value &&
      (value.rows.length ||
        value.status === "blocked" ||
        value.status === "paused")
    )
      setOpen(true);
  }, [value?.rows.length, value?.status]);
  if (!value || value.status === "legacy") return null;
  if (value.status === "loading") return <p role="status">{c.loading}</p>;
  if (
    !value.rows.length &&
    value.status === "ready" &&
    !value.busy &&
    !value.mountedPending
  )
    return null;
  const inspect = value.review;
  return (
    <section
      aria-label={c.title}
      className="rounded-2xl bg-fill-tertiary p-4 space-y-3"
      data-testid="inventory-durable-recovery"
    >
      <p role="status">
        {value.status === "paused"
          ? c.paused
          : value.status === "blocked"
            ? c.blocked
            : c.retained}
      </p>
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        onClick={() => setOpen(true)}
      >
        {c.reopen}
      </button>
      <Dialog
        open={open && !suspended}
        onClose={value.busy ? undefined : () => setOpen(false)}
        title={c.title}
        closeLabel={c.close}
        variant="form"
      >
        <div className="space-y-4" aria-busy={value.busy}>
          <p role="status">
            {value.status === "paused"
              ? c.paused
              : value.status === "blocked"
                ? c.failed
                : c.retained}
          </p>
          {!online() && <p>{c.offline}</p>}
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            disabled={value.busy || !online()}
            onClick={() => void value.check()}
          >
            {value.busy ? c.busy : c.storage}
          </button>
          <ul className="space-y-2">
            {value.rows.map((entry, index) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="btn-plain min-h-[44px]"
                  disabled={value.busy || !online()}
                  onClick={() => void value.inspect(entry.key)}
                >
                  {c.review}: {c.change} {index + 1}
                </button>
              </li>
            ))}
          </ul>
          {inspect && (
            <div className="space-y-3" data-testid="inventory-recovered-review">
              <h3 className="text-headline">{inspect.name ?? c.change}</h3>
              <p>
                {inspect.entry.kind === "restock" &&
                inspect.state === "committed" &&
                inspect.receipt &&
                "created" in inspect.receipt &&
                !inspect.receipt.created
                  ? c.restockAlready
                  : c[inspect.state]}
              </p>
              {inspect.targetList && (
                <p>
                  {c.list}: {inspect.targetList.name} ·{" "}
                  <a
                    className="inline-flex min-h-[44px] items-center underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`/dashboard/lists/${encodeURIComponent(inspect.targetList.id)}`}
                  >
                    {c.openList} ↗
                  </a>
                </p>
              )}
              <OriginalValues entry={inspect.entry} />
              {inspect.current && (
                <p>
                  {c.current}: {inspect.current.amount ?? c.unknown}{" "}
                  {inspect.current.unit ?? ""} · {c[inspect.current.location]}
                </p>
              )}
              {inspect.canRetry && value.status === "ready" && (
                <button
                  type="button"
                  className="btn-primary min-h-[44px]"
                  disabled={value.busy || !online()}
                  onClick={() =>
                    void value.retry(inspect.entry.key).then((done) => {
                      if (done) onChanged();
                    })
                  }
                >
                  {c.retry}
                </button>
              )}
              {(inspect.state === "committed" ||
                inspect.state === "removed") && (
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={value.busy || !online()}
                  onClick={() =>
                    void value.dismiss(inspect.entry.key).then((done) => {
                      if (done) onChanged();
                    })
                  }
                >
                  {c.finish}
                </button>
              )}
              <button
                type="button"
                className="btn-plain min-h-[44px]"
                disabled={value.busy}
                onClick={() => setDiscard(inspect.entry.key)}
              >
                {c.discard}
              </button>
            </div>
          )}
        </div>
        <Dialog
          open={discard !== null && !suspended}
          title={c.confirmDiscard}
          onClose={value.busy ? undefined : () => setDiscard(null)}
          closeLabel={c.close}
          role="alertdialog"
        >
          <p>{c.discardExplanation}</p>
          <button
            type="button"
            className="btn-plain min-h-[44px]"
            disabled={value.busy}
            onClick={() => setDiscard(null)}
          >
            {c.cancel}
          </button>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            disabled={value.busy || !online()}
            onClick={() => {
              if (discard)
                void value.dismiss(discard).then((done) => {
                  if (done) {
                    setDiscard(null);
                    onChanged();
                  }
                });
            }}
          >
            {c.confirm}
          </button>
        </Dialog>
      </Dialog>
    </section>
  );
}
function OriginalValues({ entry }: { entry: InventoryRecoveryEntry }) {
  const { locale } = useTranslation(),
    c = locale === "es" ? inventoryRecoverySpanish : inventoryRecoveryEnglish;
  if (entry.kind === "restock") {
    const input = restockInput.parse(JSON.parse(entry.body));
    return (
      <details>
        <summary className="min-h-[44px] cursor-pointer">
          {c.original}: {c.restock}
        </summary>
        <dl>
          <dt>{c.name}</dt>
          <dd>{input.content}</dd>
          <dt>{c.amount}</dt>
          <dd>
            {input.amount} {input.unit ?? ""}
          </dd>
          <dt>{c.similar}</dt>
          <dd>{input.allow_similar ? c.yes : c.no}</dd>
        </dl>
      </details>
    );
  }
  const parsed =
    entry.kind === "intake"
      ? inventoryIntakeInput.parse(JSON.parse(entry.body))
      : inventoryChangeInput.parse(JSON.parse(entry.body));
  const operation = "operation" in parsed ? parsed.operation : null;
  const fields =
    "item" in parsed
      ? parsed.item
      : operation?.kind === "edit"
        ? operation.changes
        : null;
  const values: Array<[string, React.ReactNode]> = [];
  if (fields) {
    if ("name" in fields) values.push([c.name, fields.name]);
    if ("amount" in fields) values.push([c.amount, fields.amount ?? c.unknown]);
    if ("unit" in fields) values.push([c.unit, fields.unit ?? c.unknown]);
    if (fields.location) values.push([c.location, c[fields.location]]);
    if ("expires_on" in fields)
      values.push([c.date, fields.expires_on ?? c.unknown]);
    if (fields.date_kind) values.push([c.dateKind, c[fields.date_kind]]);
    if ("purchased_on" in fields)
      values.push([c.purchased, fields.purchased_on ?? c.unknown]);
    if ("opened_on" in fields)
      values.push([c.opened, fields.opened_on ?? c.unknown]);
    if ("category" in fields)
      values.push([
        c.category,
        fields.category
          ? (locale === "es" ? inventorySpanish : inventoryEnglish)[
              fields.category
            ]
          : c.unknown,
      ]);
  } else if (operation?.kind === "consume")
    values.push([c.amount, operation.amount ?? c.unknown]);
  const action = !operation
    ? c.intake
    : operation.kind === "discard"
      ? c.discardStock
      : c[operation.kind];
  if ("product" in parsed && parsed.product) {
    values.push(
      [c.barcode, parsed.product.barcode],
      [c.brand, parsed.product.brand ?? c.unknown],
      [c.packageSize, parsed.product.package_size ?? c.unknown],
      [c.remember, parsed.product.remember ? c.yes : c.no],
      [
        c.source,
        parsed.product.origin === "open-food-facts"
          ? "Open Food Facts"
          : c.manualSource,
      ],
    );
  } else if ("label" in parsed && parsed.label)
    values.push([c.packageSize, parsed.label.package_size ?? c.unknown]);
  return (
    <details>
      <summary className="min-h-[44px] cursor-pointer">
        {c.original}: {action}
      </summary>
      <dl className="space-y-2">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt className="text-label-secondary">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
