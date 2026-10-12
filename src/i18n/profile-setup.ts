"use client";

import { useTranslation } from "@/i18n";
import type { Locale } from "./types";

export const profileSetupEnglish = {
  addWithoutEmail: "Add a household profile",
  profileSetupTitle: "Add someone without an account",
  profileSetupDescription:
    "Create a name-only presentation profile for someone in your household. This does not create a login or send an invitation, and it never grants parent access.",
  nameLabel: "Name",
  namePlaceholder: "e.g. Jamie",
  roleLabel: "Role",
  ageLabel: "Age (optional)",
  roleChild: "Child",
  roleTeen: "Teen",
  roleParent: "Parent",
  saveProfile: "Save profile",
  savingProfile: "Saving profile…",
  addAnother: "Add another profile",
  savedProfiles: "Household profiles",
  archivedProfile: "Archived",
  noProfiles: "No profiles yet",
  loading: "Loading profiles…",
  loadingProfiles: "Loading household profiles…",
  retry: "Try again",
  close: "Close",
  finishLater: "Finish later",
  continueToToday: "Continue to Today",
  unsupportedTitle: "Profiles are unavailable here",
  unsupportedDescription:
    "This server does not support name-only profiles yet. Use an account invitation instead.",
  inviteInstead: "Invite with an account",
  loadError: "Profiles could not be loaded. Your household is unchanged.",
  saveError: "The profile could not be saved. Check your connection and try again.",
  networkError: "Check your connection and try again. Your entry is still here.",
  invalidResponse: "The server returned an unsupported profile response.",
  profileSaved: "Profile saved.",
  profileTargets: "Household profiles",
  profileTargetOnce: "Profiles support one-off chores only.",
  profileTargetUnsupported:
    "This server cannot create a profile chore yet. Your chore details are still here; try again later or choose an account.",
  profileTargetError:
    "The profile chore could not be created. Your details are still here; check your connection and try again.",
  profileTargetRefresh: "That profile is no longer available. Refresh profiles and choose again.",
  profileTargetUnavailable: "Name-only profiles are unavailable on this server.",
} as const;

export const profileSetupSpanish = {
  addWithoutEmail: "Añadir un perfil del hogar",
  profileSetupTitle: "Añadir a alguien sin cuenta",
  profileSetupDescription:
    "Crea un perfil de presentación con solo nombre para alguien de tu hogar. No crea un inicio de sesión ni envía una invitación, y nunca concede acceso de padre o madre.",
  nameLabel: "Nombre",
  namePlaceholder: "p. ej., Jamie",
  roleLabel: "Rol",
  ageLabel: "Edad (opcional)",
  roleChild: "Niño o niña",
  roleTeen: "Adolescente",
  roleParent: "Padre o madre",
  saveProfile: "Guardar perfil",
  savingProfile: "Guardando perfil…",
  addAnother: "Añadir otro perfil",
  savedProfiles: "Perfiles del hogar",
  archivedProfile: "Archivado",
  noProfiles: "Todavía no hay perfiles",
  loading: "Cargando perfiles…",
  loadingProfiles: "Cargando perfiles del hogar…",
  retry: "Intentar de nuevo",
  close: "Cerrar",
  finishLater: "Terminar más tarde",
  continueToToday: "Continuar a Hoy",
  unsupportedTitle: "Los perfiles no están disponibles aquí",
  unsupportedDescription:
    "Este servidor todavía no admite perfiles con solo nombre. Usa una invitación con cuenta.",
  inviteInstead: "Invitar con una cuenta",
  loadError: "No se pudieron cargar los perfiles. Tu hogar no ha cambiado.",
  saveError: "No se pudo guardar el perfil. Comprueba la conexión e inténtalo de nuevo.",
  networkError: "Comprueba la conexión e inténtalo de nuevo. Tu entrada sigue aquí.",
  invalidResponse: "El servidor devolvió una respuesta de perfil no compatible.",
  profileSaved: "Perfil guardado.",
  profileTargets: "Perfiles del hogar",
  profileTargetOnce: "Los perfiles solo admiten tareas únicas.",
  profileTargetUnsupported:
    "Este servidor todavía no puede crear una tarea para un perfil. Tus datos siguen aquí; inténtalo más tarde o elige una cuenta.",
  profileTargetError:
    "No se pudo crear la tarea del perfil. Tus datos siguen aquí; comprueba la conexión e inténtalo de nuevo.",
  profileTargetRefresh: "Ese perfil ya no está disponible. Actualiza los perfiles y elige de nuevo.",
  profileTargetUnavailable: "Los perfiles con solo nombre no están disponibles en este servidor.",
} as const;

export type ProfileSetupMessage = keyof typeof profileSetupEnglish;
export const profileSetupMessages: Record<Locale, Record<ProfileSetupMessage, string>> = {
  en: profileSetupEnglish,
  es: profileSetupSpanish,
};

export function useProfileSetupText() {
  const { locale } = useTranslation();
  return (key: ProfileSetupMessage) => profileSetupMessages[locale][key];
}
