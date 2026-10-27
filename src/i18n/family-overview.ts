"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";

export const familyOverviewEnglish = {
  title: "Your family",
  memberOne: "{count} member",
  memberMany: "{count} members",
  accountMemberOne: "{count} account member",
  accountMemberMany: "{count} account members",
  profileOne: "{count} household profile",
  profileMany: "{count} household profiles",
  addMember: "Invite member",
  settings: "Settings",
  people: "People in your household",
  account: "Account member",
  profileAccount: "No login account",
  profilesHeading: "Household profiles",
  profilesDescription:
    "People who use shared household surfaces without their own login account.",
  profilesLoadFailed: "Household profiles could not be loaded.",
  retryProfiles: "Retry profiles",
  you: "You",
  loading: "Loading…",
  loadFailed: "Couldn't load your family",
  retryDescription: "Check your connection and try again.",
  tryAgain: "Try again",
  emptyTitle: "No family members yet",
  emptyDescription:
    "Invite family members to join your family and start organizing together.",
  inviteMembers: "Invite members",
  chooseHousehold: "Choose your household",
  chooseHouseholdDescription:
    "Create a household or join one with an invitation.",
  createHousehold: "Create household",
  joinHousehold: "Join household",
  remove: "Remove",
  removeAria: "Remove {name} from household",
  removeTitle: "Remove {name}?",
  removeTitleFallback: "Remove member?",
  removeDescription:
    "They will be signed out everywhere and can no longer see this household. Their account is not deleted. Chores they had not finished go to you to hand on; everything else stays with the household.",
  cancel: "Cancel",
  close: "Close",
  removing: "Removing…",
  removeConfirm: "Remove from household",
  removeFailed: "Could not remove them. Please try again.",
  removeNetwork: "Could not remove them. Check your connection and try again.",
  removed: "{name} was removed from the household.",
  removedWithTablets:
    "{name} was removed from the household. Tablets they set up were signed out; a parent can pair them again.",
  household: "Household",
  emergency: "Emergency",
  emergencyDescription: "Contacts and medical info for everyone",
  moreEmpty: "Chores and features you turn on",
  moreOne: "Chores and {count} more feature",
  moreMany: "Chores and {count} more features",
} as const;
export type FamilyOverviewMessage = keyof typeof familyOverviewEnglish;
export const familyOverviewSpanish: Record<FamilyOverviewMessage, string> = {
  title: "Tu familia",
  memberOne: "{count} miembro",
  memberMany: "{count} miembros",
  accountMemberOne: "{count} miembro con cuenta",
  accountMemberMany: "{count} miembros con cuenta",
  profileOne: "{count} perfil del hogar",
  profileMany: "{count} perfiles del hogar",
  addMember: "Invitar a alguien",
  settings: "Ajustes",
  people: "Personas de tu hogar",
  account: "Miembro con cuenta",
  profileAccount: "Sin cuenta de inicio de sesión",
  profilesHeading: "Perfiles del hogar",
  profilesDescription:
    "Personas que usan las superficies compartidas del hogar sin su propia cuenta.",
  profilesLoadFailed: "No se pudieron cargar los perfiles del hogar.",
  retryProfiles: "Reintentar perfiles",
  you: "Tú",
  loading: "Cargando…",
  loadFailed: "No se pudo cargar tu familia",
  retryDescription: "Comprueba la conexión e inténtalo de nuevo.",
  tryAgain: "Reintentar",
  emptyTitle: "Aún no hay miembros",
  emptyDescription: "Invita a tu familia para empezar a organizarse juntos.",
  inviteMembers: "Invitar a miembros",
  chooseHousehold: "Elige tu hogar",
  chooseHouseholdDescription: "Crea un hogar o únete a uno con una invitación.",
  createHousehold: "Crear un hogar",
  joinHousehold: "Unirse a un hogar",
  remove: "Quitar",
  removeAria: "Quitar a {name} del hogar",
  removeTitle: "¿Quitar a {name}?",
  removeTitleFallback: "¿Quitar a este miembro?",
  removeDescription:
    "Se cerrarán sus sesiones y ya no podrá ver este hogar. Su cuenta no se eliminará. Las tareas pendientes pasarán a ti para reasignarlas; todo lo demás seguirá en el hogar.",
  cancel: "Cancelar",
  close: "Cerrar",
  removing: "Quitando…",
  removeConfirm: "Quitar del hogar",
  removeFailed: "No se pudo quitar a esta persona. Inténtalo de nuevo.",
  removeNetwork:
    "No se pudo quitar a esta persona. Comprueba la conexión e inténtalo de nuevo.",
  removed: "Se quitó a {name} del hogar.",
  removedWithTablets:
    "Se quitó a {name} del hogar. Se cerró la sesión de las tabletas que configuró; un padre o una madre puede volver a vincularlas.",
  household: "Hogar",
  emergency: "Emergencias",
  emergencyDescription: "Contactos e información médica de todos",
  moreEmpty: "Tareas y funciones que actives",
  moreOne: "Tareas y {count} función más",
  moreMany: "Tareas y {count} funciones más",
};
export const familyOverviewMessages = {
  en: familyOverviewEnglish,
  es: familyOverviewSpanish,
};
export type FamilyFeedback =
  | { raw: string }
  | { key: FamilyOverviewMessage; params?: Record<string, string | number> };
export function useFamilyOverviewText() {
  const { t } = useTranslation();
  return useCallback(
    (key: FamilyOverviewMessage, params?: Record<string, string | number>) =>
      t(key, params, familyOverviewMessages),
    [t],
  );
}
