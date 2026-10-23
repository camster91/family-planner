"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
export const deviceManagementEnglish = {
  devices: "Devices",
  settings: "Settings",
  tablets: "Tablets",
  pairTablet: "Pair a tablet",
  intro:
    "Shared tablets show your family's Today board. They never hold anyone's account, and a parent unlocks parent mode on them with a tablet PIN.",
  loadFailed: "Could not load your tablets.",
  retry: "Try again",
  loadingTablets: "Loading tablets",
  noTablets: "No tablets yet.",
  noTabletsHelp: "Pair a tablet to show today's plan on the fridge.",
  active: "Active",
  expired: "Expired",
  removed: "Removed",
  removedNeutral: "removed",
  notSeen: "Not seen yet",
  activeNow: "Active now",
  seenMinutes: "Seen {count} minutes ago",
  seenHour: "Seen {count} hour ago",
  seenHours: "Seen {count} hours ago",
  seenDay: "Seen {count} day ago",
  seenDays: "Seen {count} days ago",
  notSeenDays: "Not seen for {count} days",
  reasonParent: "removed by a parent",
  reasonLost: "lost",
  reasonReplaced: "replaced",
  reasonReuse: "a copied sign-in was detected",
  by: " by {name}",
  auditPaired: "Paired{by}",
  auditRenamed: "Renamed{by}",
  auditRemoved: "Removed{by} ({reason})",
  auditReuse: "A copied sign-in was detected, so the tablet was disconnected",
  auditStarted: "Parent mode started{by}{method}",
  withPassword: " with a password",
  withPin: " with a PIN",
  auditEnded: "Parent mode ended{by}",
  auditLocked: "Parent mode locked after wrong attempts{actor}",
  auditRenameTablet: "Renamed on the tablet{by}",
  auditRemoveTablet: "Removed on the tablet{by}",
  auditParentAction: "Parent action on the tablet{by}",
  auditMemberAction: "Family member action{by}",
  auditClaimed: "Pairing code entered on the tablet",
  auditConfirmed: "Pairing confirmed{by}",
  auditCancelled: "Pairing cancelled",
  auditUnknown: "Tablet activity",
  activityFailed: "Could not load recent activity.",
  activityLoading: "Loading activity",
  activityEmpty: "No activity yet.",
  recentActivity: "Recent activity",
  android: "Android app",
  browser: "Web browser",
  paired: "Paired {date}",
  version: "Version {version}",
  removedOn: "Removed {date}",
  expiredHelp:
    "It has not connected for 30 days. Remove it and pair it again to use it.",
  rename: "Rename",
  replace: "Replace",
  removeTablet: "Remove tablet",
  renameDone: "Renamed to {label}.",
  removeDone:
    "{label} was removed. It stops showing your family's information the next time it connects.",
  renameTitle: "Rename tablet",
  nameLength: "Use 1 to 40 characters.",
  nameLengthLong: "Use 1 to 40 characters for the name.",
  tooManyChanges: "Too many changes. Try again later.",
  renameFailed: "Could not rename the tablet.",
  removeFailed: "Could not remove the tablet.",
  unreachable: "Could not reach {brand}. Try again.",
  tabletName: "Tablet name",
  saveName: "Save name",
  cancel: "Cancel",
  removeTitle: "Remove {label}?",
  removeTitleEmpty: "Remove tablet?",
  removeDescription:
    "It stops showing your family's information the next time it connects. To use it again, pair it again.",
  reason: "Reason (optional)",
  lost: "Lost or stolen",
  replaced: "Replaced",
  other: "Other",
  close: "Close",
  endedExpired:
    "This code expired before the tablet connected. Get a new code to try again.",
  endedCancelled: "This pairing was cancelled. Get a new code to try again.",
  endedDenied:
    "Pairing cancelled. The tablet that typed the code can't connect.",
  endedMismatch:
    "Too many wrong numbers, so this pairing was cancelled. If it wasn't your tablet, nothing was connected.",
  kitchen: "Kitchen tablet",
  limitRemove:
    'This household already has 5 tablets (or codes waiting). Tick "Remove" above, or remove a tablet first.',
  limit:
    "This household already has 5 tablets (or codes waiting). Remove one first.",
  replaceMissing:
    "{label} is no longer in your household. Close this and pair a tablet instead.",
  replaceRemoved:
    "{label} was already removed. Close this and pair a tablet instead.",
  pairRate: "Too many pairing codes. Try again in {wait}.",
  createFailed: "Could not create a code. Try again.",
  digitsRequired: "Type the 4 digits shown on the tablet.",
  digitsFew: "That number doesn't match the tablet. A few tries left.",
  digitsOne: "That number doesn't match the tablet. {count} try left.",
  digitsMany: "That number doesn't match the tablet. {count} tries left.",
  confirmFailed: "Could not confirm. Try again.",
  replaceTitle: "Replace {label}",
  codeTitle: "Enter this code on the tablet",
  confirmTitle: "Type the number shown on the tablet",
  connecting: "Connecting",
  connected: "Tablet connected",
  stopped: "Pairing stopped",
  pairHelp:
    "The tablet shows your family's Today board. It never holds anyone's account.",
  removeOld: "Remove {label} when the new one is connected",
  getCode: "Get a code",
  openOnTablet: "On the tablet, open {url} and type this code.",
  expires: "Expires in {countdown}",
  waiting: "Waiting for the tablet",
  confirmHelp:
    "A tablet entered your code. It now shows a 4-digit number. Type it here to connect it. If you can't see that tablet, it isn't yours.",
  number: "Number on the tablet",
  connect: "Connect tablet",
  notMine: "This isn't my tablet",
  connectingHelp: "Confirmed. Waiting for the tablet to finish connecting.",
  connectedHelp: "{label} is connected and showing today's board.",
  oldRemoved: " {label} was removed.",
  oldRemoveRetry:
    "{label} still could not be removed. Try again, or remove it from the list.",
  oldNotRemoved:
    "{label} was not removed. Remove it now so it stops showing your family's information.",
  removeLabel: "Remove {label}",
  done: "Done",
  newCode: "Get a new code",
  waitMinute: "about a minute",
  waitMinutes: "about {count} minutes",
  waitHours: "about {count} hours",
  noHousehold: "Join or create a household to pair a family tablet.",
} as const;
export type DeviceMessage = keyof typeof deviceManagementEnglish;
export const deviceManagementSpanish: Record<DeviceMessage, string> = {
  devices: "Dispositivos",
  settings: "Ajustes",
  tablets: "Tabletas",
  pairTablet: "Vincular una tableta",
  intro:
    "Las tabletas compartidas muestran el panel de Hoy del hogar. Nunca contienen una cuenta personal. Un padre o una madre desbloquea el modo parental con un PIN.",
  loadFailed: "No se pudieron cargar tus tabletas.",
  retry: "Intentar de nuevo",
  loadingTablets: "Cargando tabletas",
  noTablets: "Todavía no hay tabletas.",
  noTabletsHelp:
    "Vincula una tableta para mostrar el plan de hoy en la nevera.",
  active: "Activo",
  expired: "Caducado",
  removed: "Eliminado",
  removedNeutral: "eliminado",
  notSeen: "Todavía no se ha conectado",
  activeNow: "Activo ahora",
  seenMinutes: "Visto hace {count} minutos",
  seenHour: "Visto hace {count} hora",
  seenHours: "Visto hace {count} horas",
  seenDay: "Visto hace {count} día",
  seenDays: "Visto hace {count} días",
  notSeenDays: "Sin conexión desde hace {count} días",
  reasonParent: "eliminado por un padre o una madre",
  reasonLost: "perdido",
  reasonReplaced: "sustituido",
  reasonReuse: "se detectó una sesión copiada",
  by: " por {name}",
  auditPaired: "Vinculado{by}",
  auditRenamed: "Renombrado{by}",
  auditRemoved: "Eliminado{by} ({reason})",
  auditReuse: "Se detectó una sesión copiada y se desconectó la tableta",
  auditStarted: "Modo parental iniciado{by}{method}",
  withPassword: " con contraseña",
  withPin: " con PIN",
  auditEnded: "Modo parental finalizado{by}",
  auditLocked: "Modo parental bloqueado tras intentos incorrectos{actor}",
  auditRenameTablet: "Renombrado en la tableta{by}",
  auditRemoveTablet: "Eliminado en la tableta{by}",
  auditParentAction: "Acción parental en la tableta{by}",
  auditMemberAction: "Acción de un familiar{by}",
  auditClaimed: "Código introducido en la tableta",
  auditConfirmed: "Vinculación confirmada{by}",
  auditCancelled: "Vinculación cancelada",
  auditUnknown: "Actividad de la tableta",
  activityFailed: "No se pudo cargar la actividad reciente.",
  activityLoading: "Cargando actividad",
  activityEmpty: "Todavía no hay actividad.",
  recentActivity: "Actividad reciente",
  android: "App de Android",
  browser: "Navegador web",
  paired: "Vinculado el {date}",
  version: "Versión {version}",
  removedOn: "Eliminado el {date}",
  expiredHelp:
    "No se ha conectado en 30 días. Elimínalo y vuelve a vincularlo para usarlo.",
  rename: "Cambiar nombre",
  replace: "Sustituir",
  removeTablet: "Eliminar tableta",
  renameDone: "Nombre cambiado a {label}.",
  removeDone:
    "{label} se eliminó. Dejará de mostrar información del hogar cuando vuelva a conectarse.",
  renameTitle: "Cambiar nombre de la tableta",
  nameLength: "Usa entre 1 y 40 caracteres.",
  nameLengthLong: "Usa entre 1 y 40 caracteres para el nombre.",
  tooManyChanges: "Demasiados cambios. Inténtalo más tarde.",
  renameFailed: "No se pudo cambiar el nombre de la tableta.",
  removeFailed: "No se pudo eliminar la tableta.",
  unreachable: "No se pudo conectar con {brand}. Inténtalo de nuevo.",
  tabletName: "Nombre de la tableta",
  saveName: "Guardar nombre",
  cancel: "Cancelar",
  removeTitle: "¿Eliminar {label}?",
  removeTitleEmpty: "¿Eliminar tableta?",
  removeDescription:
    "Dejará de mostrar información del hogar cuando vuelva a conectarse. Para usarla otra vez, vuelve a vincularla.",
  reason: "Motivo (opcional)",
  lost: "Perdido o robado",
  replaced: "Sustituido",
  other: "Otro",
  close: "Cerrar",
  endedExpired:
    "El código caducó antes de que se conectara la tableta. Obtén otro para intentarlo de nuevo.",
  endedCancelled:
    "Se canceló la vinculación. Obtén otro código para intentarlo de nuevo.",
  endedDenied:
    "Vinculación cancelada. La tableta que introdujo el código no puede conectarse.",
  endedMismatch:
    "Se canceló la vinculación por demasiados números incorrectos. Si no era tu tableta, no se conectó nada.",
  kitchen: "Tableta de la cocina",
  limitRemove:
    "Este hogar ya tiene 5 tabletas o códigos pendientes. Marca «Eliminar» arriba o elimina una tableta primero.",
  limit:
    "Este hogar ya tiene 5 tabletas o códigos pendientes. Elimina una primero.",
  replaceMissing:
    "{label} ya no pertenece a tu hogar. Cierra y vincula una tableta.",
  replaceRemoved: "{label} ya se eliminó. Cierra y vincula una tableta.",
  pairRate: "Demasiados códigos de vinculación. Inténtalo en {wait}.",
  createFailed: "No se pudo crear un código. Inténtalo de nuevo.",
  digitsRequired: "Escribe los 4 dígitos de la tableta.",
  digitsFew: "El número no coincide con la tableta. Quedan algunos intentos.",
  digitsOne: "El número no coincide con la tableta. Queda {count} intento.",
  digitsMany: "El número no coincide con la tableta. Quedan {count} intentos.",
  confirmFailed: "No se pudo confirmar. Inténtalo de nuevo.",
  replaceTitle: "Sustituir {label}",
  codeTitle: "Introduce este código en la tableta",
  confirmTitle: "Escribe el número que muestra la tableta",
  connecting: "Conectando",
  connected: "Tableta conectada",
  stopped: "Vinculación detenida",
  pairHelp:
    "La tableta muestra el panel de Hoy del hogar. Nunca contiene una cuenta personal.",
  removeOld: "Eliminar {label} cuando se conecte la nueva",
  getCode: "Obtener un código",
  openOnTablet: "En la tableta, abre {url} e introduce este código.",
  expires: "Caduca en {countdown}",
  waiting: "Esperando a la tableta",
  confirmHelp:
    "Una tableta introdujo tu código y muestra un número de 4 dígitos. Escríbelo aquí para conectarla. Si no puedes ver esa tableta, no es la tuya.",
  number: "Número en la tableta",
  connect: "Conectar tableta",
  notMine: "Esta no es mi tableta",
  connectingHelp:
    "Confirmado. Esperando a que la tableta termine de conectarse.",
  connectedHelp: "{label} está conectada y muestra el panel de Hoy.",
  oldRemoved: " Se eliminó {label}.",
  oldRemoveRetry:
    "Todavía no se pudo eliminar {label}. Inténtalo de nuevo o elimínala de la lista.",
  oldNotRemoved:
    "{label} no se eliminó. Elimínala ahora para que deje de mostrar información del hogar.",
  removeLabel: "Eliminar {label}",
  done: "Listo",
  newCode: "Obtener otro código",
  waitMinute: "aproximadamente un minuto",
  waitMinutes: "aproximadamente {count} minutos",
  waitHours: "aproximadamente {count} horas",
  noHousehold:
    "Únete a un hogar o crea uno para vincular una tableta familiar.",
};
export type DeviceText = (
  key: DeviceMessage,
  params?: Record<string, string | number>,
) => string;
export type DeviceFeedback = {
  key: DeviceMessage;
  params?: Record<string, string | number>;
  retryAfter?: number | null;
};
function format(value: string, params?: Record<string, string | number>) {
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(params?.[name] ?? match),
  );
}
export const englishDeviceText: DeviceText = (key, params) =>
  format(deviceManagementEnglish[key], params);
export function useDeviceText(): DeviceText {
  const { locale } = useTranslation();
  return useCallback(
    (key, params) =>
      format(
        (locale === "es" ? deviceManagementSpanish : deviceManagementEnglish)[
          key
        ],
        params
          ? Object.fromEntries(
              Object.entries(params).map(([name, value]) => [
                name,
                typeof value === "number"
                  ? new Intl.NumberFormat(locale).format(value)
                  : value,
              ]),
            )
          : undefined,
      ),
    [locale],
  );
}
