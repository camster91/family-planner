/** Handoff-owned destructive confirmation and recovery copy. Names stay verbatim. */
import { useTranslation } from "@/i18n";

export const handoffEnglish = {
  sitterPlaceholder: "e.g. Sarah",
  bedtimesPlaceholder: "e.g. Emma: 8pm, Max: 8:30pm",
  snacksPlaceholder: "e.g. Snacks in the pantry, fruit in the fridge",
  pickupPlaceholder: "e.g. Grandma Jane, Uncle Bob",
  codeWordsPlaceholder: "e.g. Code word for emergencies: PINEAPPLE",
  petCarePlaceholder: "e.g. Dog: walk at 7pm, cat: no special care",
  emergencyPlaceholder: "Allergies, medical info, emergency contacts...",
  houseNotesPlaceholder: "e.g. Thermostat, TV codes, alarm code...",
  notesPlaceholder: "Any other notes for the sitter...",

  deleteTitle: "Remove “{name}”?",
  deleteDescription:
    "This permanently removes “{name}” and invalidates its shared sitter link.",
  deleteFailed: "The handoff could not be removed. Try again.",
  deleteNetworkError:
    "The handoff could not be removed. Check your connection and try again.",
  deleteClose: "Close handoff removal confirmation",
  deleting: "Removing…",
} as const;

export type HandoffMessage = keyof typeof handoffEnglish;

export const handoffSpanish: Record<HandoffMessage, string> = {
  sitterPlaceholder: "p. ej., Sara",
  bedtimesPlaceholder: "p. ej., Emma: 20:00, Max: 20:30",
  snacksPlaceholder: "p. ej., meriendas en la despensa, fruta en la nevera",
  pickupPlaceholder: "p. ej., abuela Ana, tío Roberto",
  codeWordsPlaceholder: "p. ej., palabra clave para emergencias: PIÑA",
  petCarePlaceholder: "p. ej., perro: paseo a las 19:00; gato: sin cuidados especiales",
  emergencyPlaceholder: "Alergias, información médica, contactos de emergencia...",
  houseNotesPlaceholder: "p. ej., termostato, códigos de TV y alarma...",
  notesPlaceholder: "Otras notas para quien cuida a los niños...",

  deleteTitle: "¿Quitar «{name}»?",
  deleteDescription:
    "Esto quitará permanentemente «{name}» e invalidará su enlace compartido para la niñera.",
  deleteFailed: "No se pudo quitar la entrega. Inténtalo de nuevo.",
  deleteNetworkError:
    "No se pudo quitar la entrega. Revisa tu conexión e inténtalo de nuevo.",
  deleteClose: "Cerrar confirmación para quitar la entrega",
  deleting: "Quitando…",
};

export const handoffMessages = {
  en: handoffEnglish,
  es: handoffSpanish,
};

export function useHandoffText() {
  const { t: translate } = useTranslation();
  return (key: HandoffMessage, params?: Record<string, string | number>) =>
    translate(key, params, handoffMessages);
}
