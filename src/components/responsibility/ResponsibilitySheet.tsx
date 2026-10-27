"use client";
import * as React from "react";
import Link from "next/link";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { Dialog } from "@/components/ui/dialog";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useResponsibilityText } from "@/i18n/responsibility";
import { browserResponsibilityRecovery } from "@/lib/responsibility-browser";
import {
  readResponsibilityContext,
  readResponsibility,
  makeResponsibilityIntent,
  inspectResponsibility,
  sendResponsibility,
  type ResponsibilityDraft,
} from "@/lib/responsibility-client";
import {
  responsibilityCommand,
  sameResponsibilitySubject,
  type ResponsibilityTarget,
} from "@/lib/responsibility";
import type { ResponsibilityView } from "@/lib/responsibility-http-contract";
import type {
  ResponsibilityRecoveryContext,
  ResponsibilityRecoveryEntry,
  responsibilityRecoveryReview,
} from "@/lib/responsibility-recovery";
type Store = ReturnType<typeof browserResponsibilityRecovery>;
type Review = ReturnType<typeof responsibilityRecoveryReview.parse>;
type Preview = {
  draft: ResponsibilityDraft;
  label: string;
  person: string;
  hint: string;
};
const control =
  "min-h-11 rounded-xl px-4 py-2 text-callout font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
const plain = `${control} bg-[var(--surface-fill-secondary)] text-label-primary`;
export default function ResponsibilitySheet({
  target,
  onClose,
  onOpen,
}: {
  target: ResponsibilityTarget;
  onClose: () => void;
  onOpen: (target: ResponsibilityTarget) => void;
}) {
  const copy = useResponsibilityText(),
    locale = useDisplayLocale(),
    router = useDraftAwareRouter();
  const store = React.useRef<Store | null>(null),
    context = React.useRef<ResponsibilityRecoveryContext | null>(null);
  const alive = React.useRef(false),
    epoch = React.useRef(0),
    operation = React.useRef(false);
  const staged = React.useRef<ResponsibilityRecoveryEntry | null>(null),
    storageAction = React.useRef<"stage" | "dismiss" | null>(null);
  const [view, setView] = React.useState<ResponsibilityView | null>(null),
    [fresh, setFresh] = React.useState(false);
  const [busy, setBusy] = React.useState(true),
    [error, setError] = React.useState(false),
    [storageError, setStorageError] = React.useState(false);
  const [entries, setEntries] = React.useState<ResponsibilityRecoveryEntry[]>(
      [],
    ),
    [reviews, setReviews] = React.useState<Record<string, Review>>({});
  const [message, setMessage] = React.useState<
    "unknown" | "refused" | "proof" | null
  >(null);
  const [preview, setPreview] = React.useState<Preview | null>(null),
    [chooser, setChooser] = React.useState<"backup" | "coordinator" | null>(
      null,
    ),
    [query, setQuery] = React.useState(""),
    [forget, setForget] = React.useState<string | null>(null);
  const ownerHeld = React.useRef(false);
  function holdOwner() {
    ownerHeld.current = true;
    setFresh(false);
    setView(null);
    setEntries([]);
    setReviews({});
    setPreview(null);
    setChooser(null);
    setStorageError(true);
  }
  function targetNavigationBlocked() {
    return (
      busy ||
      operation.current ||
      storageAction.current !== null ||
      storageError ||
      ownerHeld.current
    );
  }
  function navigateToTarget(
    href: ResponsibilityView["href"],
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (targetNavigationBlocked()) return;
    void router.push(href).then((allowed) => {
      if (allowed) {
        alive.current = false;
        epoch.current++;
      }
    });
  }
  const current = (version: number) =>
    alive.current && epoch.current === version;
  async function refresh(q = "") {
    const version = epoch.current;
    if (ownerHeld.current) throw new Error("Owner changed");
    setFresh(false);
    const nextContext = await readResponsibilityContext();
    if (!current(version)) return;
    if (
      context.current &&
      (context.current.userId !== nextContext.userId ||
        context.current.familyId !== nextContext.familyId ||
        context.current.role !== nextContext.role)
    ) {
      holdOwner();
      throw new Error("Owner changed");
    }
    context.current = nextContext;
    const next = await readResponsibility(target, nextContext, q);
    if (!current(version)) return;
    setView(next);
    setFresh(true);
    setPreview(null);
  }
  React.useEffect(() => {
    alive.current = true;
    const version = ++epoch.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void (async () => {
      try {
        const initial = await readResponsibilityContext();
        if (!current(version)) return;
        if (
          context.current &&
          (context.current.userId !== initial.userId ||
            context.current.familyId !== initial.familyId ||
            context.current.role !== initial.role)
        ) {
          holdOwner();
          throw new Error("Owner changed");
        }
        context.current = initial;
        if (!store.current)
          store.current = browserResponsibilityRecovery(initial);
        try {
          const rows = await store.current.initialize();
          if (current(version)) {
            setEntries(rows);
            setStorageError(false);
          }
        } catch (caught) {
          if (current(version)) {
            setStorageError(true);
            if (
              caught instanceof OwnedRequestRecoveryError &&
              caught.reason === "OWNER_CHANGED"
            )
              holdOwner();
          }
        }
        // A deleted or newly forbidden target must not hide its saved request.
        // Initialize owned recovery first; current target reads are separate.
        if (current(version)) await refresh();
      } catch {
        if (current(version)) setError(true);
      } finally {
        if (current(version)) setBusy(false);
      }
    })();
    return () => {
      alive.current = false;
      epoch.current++;
      document.body.style.overflow = overflow;
    };
    // The host keys this component by canonical kind/id. Locale changes never
    // recreate the journal, search draft, request key or body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(work: (version: number) => Promise<void>) {
    if (operation.current || !alive.current) return;
    operation.current = true;
    const version = epoch.current;
    setBusy(true);
    setError(false);
    setMessage(null);
    try {
      await work(version);
    } catch (caught) {
      if (current(version)) {
        setError(true);
        if (
          caught instanceof OwnedRequestRecoveryError &&
          caught.reason === "OWNER_CHANGED"
        )
          holdOwner();
        if (store.current?.hasUncertainStorage()) setStorageError(true);
      }
    } finally {
      operation.current = false;
      if (current(version)) setBusy(false);
    }
  }
  async function dismiss(entry: ResponsibilityRecoveryEntry, version: number) {
    if (!store.current || !current(version)) return;
    storageAction.current = "dismiss";
    try {
      await store.current.dismiss(entry.key);
    } catch (caught) {
      if (current(version)) setStorageError(true);
      throw caught;
    }
    storageAction.current = null;
    if (!current(version)) return;
    staged.current = null;
    setEntries((rows) => rows.filter((row) => row.key !== entry.key));
    setReviews((rows) => {
      const next = { ...rows };
      delete next[entry.key];
      return next;
    });
    setForget(null);
  }
  async function confirmed(
    entry: ResponsibilityRecoveryEntry,
    version: number,
  ) {
    if (current(version)) setFresh(false);
    await dismiss(entry, version);
    if (!current(version)) return;
    setMessage("proof");
    await refresh(query);
  }
  async function send(entry: ResponsibilityRecoveryEntry, version: number) {
    if (!store.current || !current(version)) return;
    const result = await store.current.send(
      entry.key,
      true,
      sendResponsibility,
    );
    if (!current(version)) return;
    if (result.kind === "confirmed") await confirmed(entry, version);
    else {
      setFresh(false);
      setMessage(result.kind);
      setReviews((rows) => {
        const next = { ...rows };
        delete next[entry.key];
        return next;
      });
    }
  }
  const disabled =
    busy ||
    !fresh ||
    entries.length > 0 ||
    storageError ||
    !view?.writesEnabled ||
    !context.current?.enabled ||
    ownerHeld.current;
  const choiceRows = (view?.choices ?? []).filter(
    (person) =>
      (chooser !== "coordinator" || person.subject.kind === "account") &&
      !sameResponsibilitySubject(
        person.subject,
        (chooser === "backup"
          ? view?.primary?.member.subject
          : view?.backup?.member.subject) ?? null,
      ),
  );
  function choose(
    draft: ResponsibilityDraft,
    label: string,
    person: string,
    hint = "",
  ) {
    if (disabled) return;
    setPreview({ draft, label, person, hint });
    setChooser(null);
  }
  function commit() {
    if (disabled || !preview || !view || !context.current || !store.current)
      return;
    const chosen = preview,
      snapshot = view,
      owner = context.current;
    void run(async (version) => {
      const entry = makeResponsibilityIntent(chosen.draft, snapshot, owner);
      staged.current = entry;
      setEntries([entry]);
      setPreview(null);
      storageAction.current = "stage";
      try {
        await store.current!.stage(entry);
      } catch (caught) {
        if (current(version)) setStorageError(true);
        throw caught;
      }
      storageAction.current = null;
      // Closing during local persistence must never start a late mutation.
      if (current(version)) await send(entry, version);
    });
  }
  function slot(name: "primary" | "backup") {
    const value = view?.[name],
      subject = value?.member.subject;
    const self =
      subject?.kind === "account" &&
      subject.accountId === context.current?.userId;
    const recorded = view?.role === "parent" && subject?.kind === "profile";
    return (
      <section className="space-y-2 rounded-2xl border border-[var(--surface-separator)] p-4">
        <h3 className="text-footnote font-medium text-label-secondary">
          {name === "primary"
            ? target.kind === "handoff"
              ? copy.coordinator
              : copy.primary
            : copy.backup}
        </h3>
        <p className="break-words font-semibold">
          {value?.member.name || copy.none}
        </p>
        {value && (
          <p className="text-callout">
            {value.statement ? copy[value.statement.decision] : copy.awaiting}
          </p>
        )}
        {value?.statement && (
          <p className="text-footnote text-label-secondary">
            {value.statement.method === "self" ? copy.self : copy.recorded} ·{" "}
            {value.statement.byName} ·{" "}
            <time dateTime={value.statement.at}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(value.statement.at))}
            </time>
          </p>
        )}
        {recorded && (
          <p className="text-footnote text-label-secondary">
            {copy.recordHint}
          </p>
        )}
        {value && (self || recorded) && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={plain}
              disabled={disabled}
              onClick={() =>
                choose(
                  {
                    action: "state-intent",
                    slot: name,
                    decision: "accepted",
                    method: self ? "self" : "parent-recorded",
                  },
                  self ? copy.accept : copy.recordAccept,
                  value.member.name,
                  recorded ? copy.recordHint : copy.self,
                )
              }
            >
              {self ? copy.accept : copy.recordAccept}
            </button>
            <button
              type="button"
              className={plain}
              disabled={disabled}
              onClick={() =>
                choose(
                  {
                    action: "state-intent",
                    slot: name,
                    decision: "declined",
                    method: self ? "self" : "parent-recorded",
                  },
                  self ? copy.decline : copy.recordDecline,
                  value.member.name,
                  recorded ? copy.recordHint : copy.self,
                )
              }
            >
              {self ? copy.decline : copy.recordDecline}
            </button>
          </div>
        )}
        {value?.statement && (self || view?.role === "parent") && (
          <button
            type="button"
            className={plain}
            disabled={disabled}
            onClick={() =>
              choose(
                { action: "clear-statement", slot: name },
                copy.reset,
                value.member.name,
                copy.resetHint,
              )
            }
          >
            {copy.reset}
          </button>
        )}
        {view?.role === "parent" &&
          (name === "backup" || target.kind === "handoff") && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={plain}
                disabled={disabled}
                onClick={() => {
                  setChooser(name === "backup" ? "backup" : "coordinator");
                  setPreview(null);
                }}
              >
                {name === "backup" ? copy.chooseBackup : copy.chooseCoordinator}
              </button>
              {value && (
                <button
                  type="button"
                  className={plain}
                  disabled={disabled}
                  onClick={() =>
                    choose(
                      name === "backup"
                        ? { action: "set-backup", subject: null }
                        : { action: "set-coordinator", subject: null },
                      name === "backup"
                        ? copy.clearBackup
                        : copy.clearCoordinator,
                      value.member.name,
                      copy.namingHint,
                    )
                  }
                >
                  {name === "backup" ? copy.clearBackup : copy.clearCoordinator}
                </button>
              )}
            </div>
          )}
      </section>
    );
  }
  return (
    <Dialog
      open
      title={copy.title}
      description={copy.intro}
      variant="form"
      onClose={() => {
        alive.current = false;
        epoch.current++;
        onClose();
      }}
      closeLabel={copy.close}
      footer={
        preview ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={plain}
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className={`${control} btn-filled`}
              disabled={disabled}
              onClick={commit}
            >
              {copy.confirm}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4" aria-busy={busy}>
        {ownerHeld.current && <p role="alert">{copy.ownerChanged}</p>}
        {view && (
          <div className="space-y-2">
            <h2 className="break-words text-headline font-semibold">
              {view.title}
            </h2>
            <Link
              className={`${plain} ${targetNavigationBlocked() ? "opacity-50" : ""}`}
              href={view.href}
              aria-disabled={targetNavigationBlocked() || undefined}
              tabIndex={targetNavigationBlocked() ? -1 : undefined}
              onClick={(event) => navigateToTarget(view.href, event)}
            >
              {copy.openTarget}
            </Link>
          </div>
        )}
        {busy && <p role="status">{copy.loading}</p>}
        {error && <p role="alert">{copy.error}</p>}
        {message && <p role="status">{copy[message]}</p>}
        <button
          type="button"
          className={plain}
          disabled={busy || ownerHeld.current}
          onClick={() =>
            void run(async () => {
              await refresh(query);
              if (!store.current && context.current) {
                store.current = browserResponsibilityRecovery(context.current);
                try {
                  const rows = await store.current.initialize();
                  if (alive.current) setEntries(rows);
                } catch (caught) {
                  if (alive.current) setStorageError(true);
                  throw caught;
                }
              }
            })
          }
        >
          {copy.reload}
        </button>
        {storageError && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <p>{copy.storage}</p>
            <button
              type="button"
              className={plain}
              disabled={busy || !store.current || ownerHeld.current}
              onClick={() =>
                void run(async (version) => {
                  const journal = store.current!;
                  let rows: ResponsibilityRecoveryEntry[] =
                    journal.hasUncertainStorage()
                      ? await journal.recoverStorage()
                      : await journal.initialize();
                  if (!current(version)) return;
                  // Only an uncertain stage may be restaged. An uncertain deletion that
                  // recovered as empty must not resurrect the old in-memory request.
                  const restage =
                    storageAction.current === "stage" ? staged.current : null;
                  if (restage && !rows.some((row) => row.key === restage.key)) {
                    await journal.stage(restage);
                    if (!current(version)) return;
                    rows = [...rows, restage];
                  }
                  storageAction.current = null;
                  staged.current = null;
                  setEntries(rows);
                  setReviews({});
                  setStorageError(false);
                  setForget(null);
                  await refresh(query);
                })
              }
            >
              {copy.repair}
            </button>
          </div>
        )}
        {entries.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-4">
            <h3 className="font-semibold">{copy.pending}</h3>
            <p className="text-footnote text-label-secondary">
              {copy.pendingHint}
            </p>
            {entries.map((entry) => {
              const command = responsibilityCommand.parse(
                JSON.parse(entry.body),
              );
              const same =
                command.target.kind === target.kind &&
                command.target.id === target.id;
              const review = reviews[entry.key];
              const action =
                command.action === "set-backup"
                  ? command.subject
                    ? copy.chooseBackup
                    : copy.clearBackup
                  : command.action === "set-coordinator"
                    ? command.subject
                      ? copy.chooseCoordinator
                      : copy.clearCoordinator
                    : command.action === "clear-statement"
                      ? copy.reset
                      : command.method === "self"
                        ? command.decision === "accepted"
                          ? copy.accept
                          : copy.decline
                        : command.decision === "accepted"
                          ? copy.recordAccept
                          : copy.recordDecline;
              return (
                <div
                  key={entry.key}
                  className="space-y-2 border-t border-[var(--surface-separator)] pt-3"
                >
                  <p>
                    {copy.kinds[command.target.kind]} · {action}
                    {"slot" in command
                      ? ` · ${command.slot === "backup" ? copy.backup : command.target.kind === "handoff" ? copy.coordinator : copy.primary}`
                      : ""}{" "}
                    ·{" "}
                    <time dateTime={command.issuedAt}>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(command.issuedAt))}
                    </time>
                  </p>
                  {review && <p role="status">{copy.states[review.state]}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={plain}
                      disabled={busy || storageError}
                      onClick={() =>
                        void run(async (version) => {
                          const result = await store.current!.inspect(
                            entry.key,
                            inspectResponsibility,
                          );
                          if (!current(version)) return;
                          setReviews((rows) => ({
                            ...rows,
                            [entry.key]: result,
                          }));
                          if (result.state === "committed")
                            await confirmed(entry, version);
                        })
                      }
                    >
                      {copy.check}
                    </button>
                    {!same && (
                      <button
                        type="button"
                        className={plain}
                        disabled={busy}
                        onClick={() => {
                          alive.current = false;
                          epoch.current++;
                          onOpen(command.target);
                        }}
                      >
                        {copy.other}
                      </button>
                    )}
                    {same && review?.canRetry && (
                      <button
                        type="button"
                        className={plain}
                        disabled={busy || storageError}
                        onClick={() =>
                          void run((version) => send(entry, version))
                        }
                      >
                        {copy.retry}
                      </button>
                    )}
                    <button
                      type="button"
                      className={plain}
                      disabled={busy || storageError}
                      onClick={() => setForget(entry.key)}
                    >
                      {copy.forget}
                    </button>
                  </div>
                  {forget === entry.key && (
                    <div className="space-y-2">
                      <p>{copy.forgetHint}</p>
                      <button
                        type="button"
                        className={plain}
                        disabled={busy}
                        onClick={() => setForget(null)}
                      >
                        {copy.cancel}
                      </button>
                      <button
                        type="button"
                        className={plain}
                        disabled={busy}
                        onClick={() =>
                          void run(async (version) => {
                            await dismiss(entry, version);
                            if (current(version)) {
                              setFresh(false);
                              await refresh(query);
                            }
                          })
                        }
                      >
                        {copy.forgetConfirm}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
        {view && (
          <>
            {!view.active ? (
              <p role="status">{copy.closed}</p>
            ) : (
              (!view.writesEnabled || !context.current?.enabled) && (
                <p role="status">{copy.paused}</p>
              )
            )}
            {view.sourceChanged && <p role="status">{copy.changed}</p>}
            {target.kind === "handoff" && (
              <p className="text-footnote text-label-secondary">
                {copy.coordinatorHint}
              </p>
            )}
            {preview ? (
              <section className="space-y-2 rounded-2xl border border-[var(--surface-separator)] p-4">
                <h3 className="font-semibold">{copy.preview}</h3>
                <p>{preview.label}</p>
                <p className="break-words">{preview.person}</p>
                {preview.hint && (
                  <p className="text-callout text-label-secondary">
                    {preview.hint}
                  </p>
                )}
              </section>
            ) : chooser ? (
              <section className="space-y-3">
                <h3 className="font-semibold">
                  {chooser === "backup"
                    ? copy.chooseBackup
                    : copy.chooseCoordinator}
                </h3>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!busy) void run(() => refresh(query));
                  }}
                >
                  <label className="flex-1 text-footnote">
                    {copy.searchLabel}
                    <input
                      className="mt-1 min-h-11 w-full rounded-xl bg-[var(--surface-fill-secondary)] px-3 text-label-primary"
                      maxLength={100}
                      value={query}
                      disabled={busy}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <button className={plain} disabled={busy} type="submit">
                    {copy.search}
                  </button>
                </form>
                <p className="text-footnote text-label-secondary">
                  {copy.namingHint}
                </p>
                <div className="space-y-1">
                  {choiceRows.slice(0, 12).map((person) => (
                    <button
                      type="button"
                      key={JSON.stringify(person.subject)}
                      className={`${plain} block w-full break-words text-left`}
                      disabled={disabled}
                      onClick={() =>
                        choose(
                          chooser === "backup"
                            ? {
                                action: "set-backup",
                                subject: person.subject,
                              }
                            : {
                                action: "set-coordinator",
                                subject: person.subject as {
                                  kind: "account";
                                  accountId: string;
                                },
                              },
                          chooser === "backup"
                            ? copy.chooseBackup
                            : copy.chooseCoordinator,
                          person.name,
                          copy.namingHint,
                        )
                      }
                    >
                      {person.name}
                    </button>
                  ))}
                </div>
                {choiceRows.length === 0 && <p>{copy.noChoices}</p>}
                {(view.moreChoices || choiceRows.length > 12) && (
                  <p>{copy.more}</p>
                )}
                <button
                  type="button"
                  className={plain}
                  onClick={() => setChooser(null)}
                >
                  {copy.cancel}
                </button>
              </section>
            ) : (
              <div className="space-y-3">
                {slot("primary")}
                {slot("backup")}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
