import type { Locale } from "./types";

export const allowanceEnglish = {
  family: "Family",
  title: "Allowance",
  subtitle: "Track allowance and money owed between members.",
  ownSubtitle: "Your allowance: what you have coming and what has been paid.",
  empty: "No allowance yet",
  emptyParent:
    "Add allowance for a family member. They can see what they have coming.",
  emptyMember: "When a parent adds allowance for you, it shows up here.",
  pending: "Pending",
  paid: "Paid",
  recentlyPaid: "Recently paid",
  cancelled: "Cancelled",
  noReason: "No reason",
  markPaid: "Mark paid",
  cancelAction: "Cancel allowance",
  keep: "Keep allowance",
  cancelConfirm: "Cancel this allowance?",
  cancelDescription:
    "This marks the allowance below as cancelled. Its record stays in your family history.",
  close: "Close cancellation confirmation",
  cancelling: "Cancelling…",
  updating: "Updating…",
  cancelFailed:
    "We couldn't confirm the cancellation. Refresh to check its status, or try again.",
  paidFailed:
    "We couldn't confirm the payment status. Refresh to check before trying again.",
  loadFailed:
    "Couldn't load allowance. Your last loaded records are still shown.",
  roleFailed:
    "Couldn't check your editing permissions. You can still read your allowance.",
  retry: "Try again",
  refresh: "Refresh allowance",
  refreshing: "Refreshing…",
} as const;
export type AllowanceCopy = Record<keyof typeof allowanceEnglish, string>;
const es: AllowanceCopy = {
  family: "Familia",
  title: "Asignaciones",
  subtitle:
    "Lleva el control de las asignaciones y del dinero pendiente entre familiares.",
  ownSubtitle:
    "Tus asignaciones: lo que vas a recibir y lo que ya se ha pagado.",
  empty: "Todavía no hay asignaciones",
  emptyParent:
    "Añade una asignación para un familiar. Podrá ver lo que va a recibir.",
  emptyMember:
    "Cuando un padre o madre añada una asignación para ti, aparecerá aquí.",
  pending: "Pendientes",
  paid: "Pagada",
  recentlyPaid: "Pagadas recientemente",
  cancelled: "Canceladas",
  noReason: "Sin motivo",
  markPaid: "Marcar como pagada",
  cancelAction: "Cancelar asignación",
  keep: "Mantener asignación",
  cancelConfirm: "¿Cancelar esta asignación?",
  cancelDescription:
    "La asignación que aparece abajo se marcará como cancelada. El registro se conserva en el historial familiar.",
  close: "Cerrar confirmación de cancelación",
  cancelling: "Cancelando…",
  updating: "Actualizando…",
  cancelFailed:
    "No pudimos confirmar la cancelación. Actualiza para comprobar su estado o inténtalo de nuevo.",
  paidFailed:
    "No pudimos confirmar el estado del pago. Actualiza para comprobarlo antes de intentarlo de nuevo.",
  loadFailed:
    "No se pudieron cargar las asignaciones. Se conservan los últimos registros cargados.",
  roleFailed:
    "No pudimos comprobar tus permisos de edición. Puedes seguir leyendo tus asignaciones.",
  retry: "Intentar de nuevo",
  refresh: "Actualizar asignaciones",
  refreshing: "Actualizando…",
};
export const allowanceMessages: Record<Locale, AllowanceCopy> = {
  en: allowanceEnglish,
  es,
};
