import type { Locale } from "./types";

export const allowanceCreateEnglish = {
  back: "Back to Allowance",
  add: "Add",
  title: "New allowance",
  sheetTitle: "New allowance",
  closeLabel: "Close and return",
  subtitle: "Set an allowance for a member of your family.",
  refusalTitle: "Only a parent can create allowance",
  refusalDescription: "Ask a parent to add allowance for your family.",
  forLabel: "For",
  loadingMembers: "Loading family members…",
  rosterError: "Couldn't load family members. Try again.",
  tryAgain: "Try again",
  noMembers: "No household members are available.",
  memberPlaceholder: "Choose a family member",
  amount: "Amount",
  amountPlaceholder: "10.00",
  reason: "Reason",
  reasonPlaceholder: "Weekly allowance",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  createError: "Couldn't add the allowance. Check the details and try again.",
  networkError: "Check your connection and try again.",
  permissionError: "Only a parent can add allowance.",
  draftDescription: "Close to return. Unsaved changes will be cleared.",
  pendingDescription: "Please wait for saving to finish.",
} as const;

export type AllowanceCreateMessage = keyof typeof allowanceCreateEnglish;

export const allowanceCreateSpanish: Record<AllowanceCreateMessage, string> = {
  back: "Volver a Asignación",
  add: "Añadir",
  title: "Nueva asignación",
  sheetTitle: "Nueva asignación",
  closeLabel: "Cerrar y volver",
  subtitle: "Establece una asignación para un miembro de tu familia.",
  refusalTitle: "Solo un padre o madre puede crear asignaciones",
  refusalDescription:
    "Pide a un padre o madre que añada una asignación para tu familia.",
  forLabel: "Para",
  loadingMembers: "Cargando familiares…",
  rosterError: "No se pudieron cargar los familiares. Inténtalo de nuevo.",
  tryAgain: "Intentar de nuevo",
  noMembers: "No hay familiares disponibles.",
  memberPlaceholder: "Elige un familiar",
  amount: "Cantidad",
  amountPlaceholder: "10.00",
  reason: "Motivo",
  reasonPlaceholder: "Asignación semanal",
  cancel: "Cancelar",
  save: "Guardar",
  saving: "Guardando…",
  createError:
    "No se pudo añadir la asignación. Revisa los datos e inténtalo de nuevo.",
  networkError: "Revisa tu conexión e inténtalo de nuevo.",
  permissionError: "Solo un padre o madre puede añadir asignaciones.",
  draftDescription: "Cierra para volver. Los cambios sin guardar se borrarán.",
  pendingDescription: "Espera a que termine de guardarse.",
};

export const allowanceCreateMessages: Record<
  Locale,
  Record<AllowanceCreateMessage, string>
> = {
  en: allowanceCreateEnglish,
  es: allowanceCreateSpanish,
};
