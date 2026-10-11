/** Pickups-owned copy. Household titles, locations, notes and member names stay verbatim. */
import { useTranslation } from "@/i18n";

export const pickupsEnglish = {
  greeting: "Family",
  title: "Pickups",
  subtitle: "Coordinate who is doing pickups and when.",
  add: "Add",
  newPickup: "New pickup",
  closeForm: "Close pickup form",
  draftDescription: "Close to return. Your draft will stay here.",
  pendingDescription: "Please wait for this pickup to finish saving.",
  titleLabel: "Title",
  titlePlaceholder: "School pickup",
  when: "When",
  location: "Location",
  locationPlaceholder: "School, 555 King St",
  assignedTo: "Assigned to",
  anyone: "Anyone",
  notes: "Notes",
  notesPlaceholder: "Bring booster seat",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  upcoming: "Upcoming",
  past: "Past",
  emptyTitle: "No pickups yet",
  emptyDescription:
    "Add a pickup and assign a family member to keep your plans together.",
  loadErrorTitle: "Couldn't load pickups",
  loadErrorDescription: "We couldn't load your family's pickups.",
  retry: "Try again",
  refreshing: "Refreshing…",
  addFailed: "Couldn't add the pickup",
  updateFailed: "Couldn't update the pickup",
  tryAgain: "Please try again.",
  networkError: "Check your connection and try again.",
} as const;

export type PickupMessage = keyof typeof pickupsEnglish;
export type PickupMessages = Record<PickupMessage, string>;

export const pickupsSpanish: PickupMessages = {
  greeting: "Familia",
  title: "Recogidas",
  subtitle: "Coordina quién hace las recogidas y cuándo.",
  add: "Añadir",
  newPickup: "Nueva recogida",
  closeForm: "Cerrar formulario de recogida",
  draftDescription: "Cierra para volver. Tu borrador se conservará.",
  pendingDescription: "Espera a que termine de guardarse esta recogida.",
  titleLabel: "Título",
  titlePlaceholder: "Recogida escolar",
  when: "Cuándo",
  location: "Lugar",
  locationPlaceholder: "Escuela, 555 King St",
  assignedTo: "Asignada a",
  anyone: "Cualquiera",
  notes: "Notas",
  notesPlaceholder: "Llevar el asiento elevador",
  cancel: "Cancelar",
  save: "Guardar",
  saving: "Guardando…",
  upcoming: "Próximas",
  past: "Pasadas",
  emptyTitle: "Aún no hay recogidas",
  emptyDescription:
    "Añade una recogida y asigna a un familiar para mantener los planes juntos.",
  loadErrorTitle: "No se pudieron cargar las recogidas",
  loadErrorDescription: "No se pudieron cargar las recogidas de tu familia.",
  retry: "Intentar de nuevo",
  refreshing: "Actualizando…",
  addFailed: "No se pudo añadir la recogida",
  updateFailed: "No se pudo actualizar la recogida",
  tryAgain: "Inténtalo de nuevo.",
  networkError: "Revisa tu conexión e inténtalo de nuevo.",
};

export const pickupsMessages = {
  en: pickupsEnglish,
  es: pickupsSpanish,
};

export function usePickupsText() {
  const { t: translate } = useTranslation();
  return (key: PickupMessage) => translate(key, undefined, pickupsMessages);
}
