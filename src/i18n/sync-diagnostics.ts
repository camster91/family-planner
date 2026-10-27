"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
export const syncDiagnosticsEnglish = {
  title: "Trouble syncing?",
  description: "View counts of waiting changes, successful sends, failures and conflicts on this browser. No names, item text, account IDs or passwords are included. Nothing is sent automatically. Counts reset when this app session closes or you sign out; they are not a history of all your devices.",
  view: "View sync details",
  refresh: "Refresh sync details",
  queuedOne: "{count} queued change.",
  queuedMany: "{count} queued changes.",
  sentOne: "{count} successful send.",
  sentMany: "{count} successful sends.",
  failedOne: "{count} unsuccessful send.",
  failedMany: "{count} unsuccessful sends.",
  conflicts: "Conflicts: {count}.",
  durable: "Queued changes are saved on this browser.",
  memory: "Changes are only in memory. Keep this page open until they sync.",
  support: "Report for support",
  copy: "Copy sync report",
  unavailable: "Open a grocery list first, then return here. Sync details are available only for this open app session.",
  copied: "Copied. Nothing was sent. You can choose whether to share this report with support.",
  copyFailed: "Could not copy. You can select the report below and copy it yourself.",
};
export const syncDiagnosticsSpanish: Record<keyof typeof syncDiagnosticsEnglish, string> = {
  title: "¿Problemas de sincronización?",
  description: "Consulta el número de cambios pendientes, envíos correctos, fallos y conflictos en este navegador. No se incluyen nombres, texto de elementos, identificadores de cuentas ni contraseñas. No se envía nada automáticamente. Los recuentos se reinician al cerrar esta sesión de la app o cerrar sesión; no son un historial de todos tus dispositivos.",
  view: "Ver detalles de sincronización",
  refresh: "Actualizar detalles de sincronización",
  queuedOne: "{count} cambio pendiente.",
  queuedMany: "{count} cambios pendientes.",
  sentOne: "{count} envío correcto.",
  sentMany: "{count} envíos correctos.",
  failedOne: "{count} envío fallido.",
  failedMany: "{count} envíos fallidos.",
  conflicts: "Conflictos: {count}.",
  durable: "Los cambios pendientes están guardados en este navegador.",
  memory: "Los cambios solo están en la memoria. Mantén esta página abierta hasta que se sincronicen.",
  support: "Informe para soporte",
  copy: "Copiar informe de sincronización",
  unavailable: "Abre primero una lista de compras y vuelve aquí. Los detalles de sincronización solo están disponibles en esta sesión abierta de la app.",
  copied: "Copiado. No se ha enviado nada. Puedes decidir si compartes este informe con soporte.",
  copyFailed: "No se pudo copiar. Puedes seleccionar el informe de abajo y copiarlo manualmente.",
};
const messages = { en: syncDiagnosticsEnglish, es: syncDiagnosticsSpanish };
export type SyncDiagnosticsMessage = "unavailable" | "copied" | "copyFailed";
export function useSyncDiagnosticsText() {
  const { t } = useTranslation();
  return useCallback((key: keyof typeof syncDiagnosticsEnglish, params?: Record<string, string | number>) =>
    t(key, params, messages), [t]);
}
