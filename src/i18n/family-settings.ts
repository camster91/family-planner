"use client";
import { useTranslation } from "@/i18n";
const en = {
  title: "Household settings",
  loading: "Loading…",
  loadFailed: "Could not load household settings. Your household is unchanged.",
  retry: "Try again",
  noFamily: "Choose your household",
  noFamilyHelp: "Create a household or join one with an invitation.",
  create: "Create household",
  join: "Join household",
  familyName: "Family name",
  placeholder: "e.g. The Smith Family",
  saving: "Saving…",
  save: "Save changes",
  saved: "Family name saved.",
  failed: "Could not save the family name. Your entry is still here.",
  parentOnly: "A parent can change household settings.",
  board: "Today board and shared screen",
  boardHelp: "Member colours, weather and calm-screen settings.",
  deletion: "Account and household deletion",
  deletionHelp:
    "Review which account or household data will be removed before confirming.",
  delete: "Review deletion…",
} as const;
const es: Record<keyof typeof en, string> = {
  title: "Ajustes del hogar",
  loading: "Cargando…",
  loadFailed: "No se pudieron cargar los ajustes. Tu hogar no ha cambiado.",
  retry: "Intentar de nuevo",
  noFamily: "Elige tu hogar",
  noFamilyHelp: "Crea un hogar o únete con una invitación.",
  create: "Crear hogar",
  join: "Unirse a un hogar",
  familyName: "Nombre de la familia",
  placeholder: "p. ej., La familia García",
  saving: "Guardando…",
  save: "Guardar cambios",
  saved: "Nombre de la familia guardado.",
  failed: "No se pudo guardar el nombre. Tu entrada sigue aquí.",
  parentOnly: "Un padre o una madre puede cambiar los ajustes del hogar.",
  board: "Panel de Hoy y pantalla compartida",
  boardHelp: "Colores de los familiares, tiempo y pantalla tranquila.",
  deletion: "Eliminar la cuenta o el hogar",
  deletionHelp:
    "Revisa qué datos de la cuenta o del hogar se eliminarán antes de confirmar.",
  delete: "Revisar eliminación…",
};
export function useFamilySettingsText() {
  const { locale } = useTranslation();
  return (key: keyof typeof en) => (locale === "es" ? es : en)[key];
}
