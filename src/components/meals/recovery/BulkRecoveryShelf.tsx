"use client";
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { prepCommand } from "@/lib/meal-prep-recovery/contract";
import type { BulkRecovery } from "./useBulkRecovery";
export function BulkRecoveryShelf({
  recovery,
  onRestore,
  restoreError,
  onReloadStored,
  onBackHandler,
}: {
  recovery: BulkRecovery;
  onRestore: () => void;
  restoreError: boolean;
  onReloadStored: () => void;
  onBackHandler?: (handler: () => boolean) => void;
}) {
  const { locale } = useTranslation(),
    es = locale === "es";
  const [position, setPosition] = React.useState(0),
    [forget, setForget] = React.useState<string | null>(null),
    [acknowledged, setAcknowledged] = React.useState(false),
    [reload, setReload] = React.useState(false);
  const prompt = React.useRef({ forget, reload });
  prompt.current = { forget, reload };
  React.useEffect(() => {
    onBackHandler?.(() => {
      if (prompt.current.forget === null && !prompt.current.reload)
        return false;
      setForget(null);
      setReload(false);
      return true;
    });
    return () => onBackHandler?.(() => false);
  }, [onBackHandler]);
  if (recovery.mode === "legacy") return null;
  const requests = recovery.rows.filter((row) => row.kind === "meal-prep"),
    index = Math.min(position, Math.max(0, requests.length - 1)),
    entry = requests[index];
  const proof = entry && recovery.inspections[entry.key],
    known = entry && (recovery.confirmed[entry.key] ?? proof?.receipt);
  const copy = (en: string, spanish: string) => (es ? spanish : en);
  const command = entry ? prepCommand.parse(JSON.parse(entry.body)) : null;
  const actionCode =
    command?.kind === "action" ? command.input.action : "create";
  const action = {
    create: copy("Prep session", "Sesión de preparación"),
    allocate: copy("Planned portions", "Porciones planificadas"),
    eaten: copy("Eaten portions", "Porciones consumidas"),
    prepared: copy("Mark prepared", "Marcar como preparado"),
    "undo-eaten": copy("Undo eaten portions", "Deshacer porciones consumidas"),
    "next-prep": copy("Next prep date", "Próxima preparación"),
  }[actionCode];
  return (
    <>
      <section
        aria-label={copy("Saved bulk work", "Trabajo de preparación guardado")}
        className="rounded-xl border border-[var(--surface-separator)] p-3 space-y-3"
      >
        <h3 className="font-semibold">
          {copy("Saved bulk work", "Trabajo de preparación guardado")}
        </h3>
        {recovery.mode === "loading" && !recovery.issue && (
          <p role="status">
            {copy(
              "Checking private recovery…",
              "Comprobando recuperación privada…",
            )}
          </p>
        )}
        {recovery.issue && (
          <div role="status" className="space-y-2">
            <p>
              {recovery.issue === "owner"
                ? copy(
                    "Your account or household changed. Reopen Meals in the current household; original saved work is kept.",
                    "Tu cuenta o tu hogar han cambiado. Vuelve a abrir Comidas en el hogar actual; se conserva el trabajo original.",
                  )
                : copy(
                    "Saved work needs attention. New saves stay blocked until storage and the current account can be checked.",
                    "El trabajo guardado necesita atención. Los nuevos guardados quedan bloqueados hasta comprobar el almacenamiento y la cuenta actual.",
                  )}
            </p>
            {recovery.issue === "storage" ? (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={recovery.busy}
                onClick={() => void recovery.repair()}
              >
                {copy(
                  "Repair exact storage change",
                  "Reparar el cambio exacto",
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={recovery.busy || recovery.privacyHold}
                onClick={() => {
                  if (recovery.mode === "loading") {
                    void recovery.load();
                    return;
                  }
                  setAcknowledged(false);
                  setReload(true);
                }}
              >
                {recovery.mode === "loading"
                  ? copy("Retry recovery read", "Reintentar lectura")
                  : copy(
                      "Reload stored copy…",
                      "Volver a cargar la copia guardada…",
                    )}
              </button>
            )}
          </div>
        )}
        {recovery.mode === "owned" && !recovery.context?.enabled && (
          <p>
            {copy(
              "New bulk saves are paused. Existing receipts can still be inspected.",
              "Los nuevos guardados están en pausa. Aún se pueden comprobar los recibos existentes.",
            )}
          </p>
        )}
        {recovery.draft && (
          <div className="space-y-2">
            <p>
              {copy(
                "An editable draft is saved on this device.",
                "Hay un borrador editable guardado en este dispositivo.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={
                  recovery.busy ||
                  recovery.active ||
                  recovery.held ||
                  !recovery.context?.enabled
                }
                onClick={onRestore}
              >
                {copy("Continue saved draft", "Continuar borrador guardado")}
              </button>
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={recovery.busy || recovery.active}
                onClick={() => {
                  setAcknowledged(false);
                  setForget(
                    recovery.rows.find(
                      (row) => row.kind === "local-prep-draft",
                    )!.key,
                  );
                }}
              >
                {copy("Remove local draft…", "Quitar borrador local…")}
              </button>
            </div>
          </div>
        )}
        {restoreError && (
          <p role="status">
            {copy(
              "The original target could not be restored. The draft is kept; no other dish was opened.",
              "No se pudo recuperar el destino original. Se conserva el borrador; no se abrió otro plato.",
            )}
          </p>
        )}
        {entry && (
          <article className="space-y-2">
            <p className="font-semibold">
              {action} · {index + 1}/{requests.length}
            </p>
            <p>
              {known
                ? copy(
                    "Save confirmed. Records may have changed since then.",
                    "Guardado confirmado. Los registros pueden haber cambiado después.",
                  )
                : copy(
                    "Outcome unconfirmed. Missing or expired receipts do not prove the save failed.",
                    "Resultado sin confirmar. Que el recibo falte o venza no demuestra que fallara el guardado.",
                  )}
            </p>
            {proof && !known && (
              <p className="text-footnote">
                {proof.state === "expired"
                  ? copy(
                      "The original retry window ended.",
                      "Terminó el plazo original para reintentar.",
                    )
                  : proof.state === "pending"
                    ? copy(
                        "The original request may still be running.",
                        "La solicitud original puede seguir ejecutándose.",
                      )
                    : proof.state === "ready"
                      ? copy(
                          "Only this exact saved request may be retried.",
                          "Solo se puede reintentar esta solicitud exacta.",
                        )
                      : copy(
                          "Current authority or receipt availability needs review.",
                          "Hay que revisar los permisos actuales o la disponibilidad del recibo.",
                        )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={recovery.busy || recovery.privacyHold}
                onClick={() => void recovery.inspect(entry.key)}
              >
                {copy("Inspect receipt", "Comprobar recibo")}
              </button>
              {proof?.retryEligible && !known && (
                <button
                  type="button"
                  className="btn-filled min-h-[44px]"
                  disabled={
                    recovery.busy || recovery.held || !recovery.context?.enabled
                  }
                  onClick={() => void recovery.retry(entry.key)}
                >
                  {copy("Retry exact request", "Reintentar solicitud exacta")}
                </button>
              )}
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={recovery.busy || recovery.active}
                onClick={() => {
                  if (known) void recovery.dismiss(entry.key);
                  else {
                    setAcknowledged(false);
                    setForget(entry.key);
                  }
                }}
              >
                {known
                  ? copy("Dismiss saved receipt", "Quitar recibo guardado")
                  : copy("Forget local request…", "Olvidar solicitud local…")}
              </button>
            </div>
            {requests.length > 1 && (
              <div className="flex justify-between items-center gap-2">
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={recovery.busy || index === 0}
                  onClick={() => setPosition(index - 1)}
                >
                  {copy("Previous", "Anterior")}
                </button>
                <span aria-live="polite">
                  {index + 1}/{requests.length}
                </span>
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={recovery.busy || index + 1 === requests.length}
                  onClick={() => setPosition(index + 1)}
                >
                  {copy("Next", "Siguiente")}
                </button>
              </div>
            )}
          </article>
        )}
        {recovery.mode === "owned" &&
          !recovery.draft &&
          requests.length === 0 && (
            <p className="text-footnote text-label-secondary">
              {copy(
                "Bulk drafts and pending saves will stay on this device until you explicitly remove them.",
                "Los borradores y guardados pendientes permanecerán en este dispositivo hasta que los quites.",
              )}
            </p>
          )}
      </section>
      <Dialog
        open={forget !== null || reload}
        role="alertdialog"
        title={
          reload
            ? copy("Reload stored copy?", "¿Cargar la copia guardada?")
            : copy("Remove local work?", "¿Quitar trabajo local?")
        }
        onClose={() => {
          setForget(null);
          setReload(false);
        }}
        closeLabel={copy("Keep work", "Conservar trabajo")}
      >
        <p>
          {reload
            ? copy(
                "Unsaved changes in this open form will be replaced by the stored copy. Saved requests and server records are not removed.",
                "La copia guardada reemplazará los cambios sin guardar de este formulario. No se quitan las solicitudes guardadas ni los registros del servidor.",
              )
            : copy(
                "This removes local work only. An unconfirmed request may already have saved. No server records are undone.",
                "Esto solo quita trabajo local. Una solicitud sin confirmar puede haberse guardado. No se deshacen registros del servidor.",
              )}
        </p>
        <label className="flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {copy("I understand", "Entiendo")}
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => {
              setForget(null);
              setReload(false);
            }}
          >
            {copy("Keep work", "Conservar trabajo")}
          </button>
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            disabled={!acknowledged || recovery.busy}
            onClick={() => {
              const key = forget;
              setForget(null);
              if (reload) {
                setReload(false);
                onReloadStored();
              } else if (key) void recovery.dismiss(key);
            }}
          >
            {reload
              ? copy("Reload stored copy", "Cargar copia guardada")
              : copy("Remove locally", "Quitar localmente")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
