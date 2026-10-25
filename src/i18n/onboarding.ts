"use client";

import { useCallback } from "react";
import { useTranslation } from "@/i18n";
import type { Locale } from "./types";

export const onboardingEnglish = {
  setupInviteTitle: "Invite your family",
  setupInviteHint: "Send a link or share your family code",
  setupChoreTitle: "Add your first chore",
  setupChoreHint: "Pick a job and who does it",
  setupEventTitle: "Add an event",
  setupEventHint: "Put something on the family calendar",
  setupHidden: "Get started hidden",
  setupProgress: "{done} of {total} done. A few steps to set up your household.",
  setupHideLabel: "Hide get started",
  setupHide: "Hide",
  setupSteps: "Setup steps",
  setupTodo: "To do: ",
  setupDone: "Done",
  welcomeTitle: "Welcome to Herewoven",
  welcomeDescription:
    "Create a shared place for your household. You can add people now or come back later.",
  getStarted: "Get started",
  createTitle: "Create your family",
  createDescription:
    "Choose a name for your household. Next, you can add everyone who shares it.",
  familyNameLabel: "Family name",
  familyNamePlaceholder: "e.g. The Smith Family",
  createFamily: "Create family",
  creatingFamily: "Creating family…",
  progressLabel: "Onboarding progress",
  joinPrompt: "Already have a family code or invite?",
  joinExisting: "Join an existing family",
  addEveryoneTitle: "Add everyone in your family",
  addEveryoneDescription:
    "Choose how each person will use Herewoven. You can invite an account, add a shared-screen profile when supported, or finish later.",
  accountOptionTitle: "Their own account or phone",
  accountOptionDescription:
    "Send an email invite for a login, or use the in-person code on another phone. Choose a parent, teen, or child role.",
  addAccount: "Invite an account",
  openFullInvitePage: "Open the full invite page",
  profileOptionTitle: "Shared household screen",
  profileOptionDescription:
    "For someone without an email or personal device. This creates a name-only presentation profile with no login or invitation; it never grants parent access.",
  profileUnavailable:
    "Shared-screen profiles are unavailable on this server. Use an account invite instead.",
  profileChecking: "Checking shared-screen support…",
  checkAgain: "Check again",
  finishLater: "Finish later",
  continueToToday: "Continue to Today",
  peopleAddedOne: "{count} household person added",
  peopleAddedMany: "{count} household people added",
  accountInviteTitle: "Invite someone with an account",
  accountInviteDescription:
    "They will receive a one-time link and create their own login. This sends an email.",
  emailLabel: "Email",
  emailPlaceholder: "alex@example.com",
  roleLabel: "Role",
  roleChild: "Child",
  roleTeen: "Teen",
  roleParent: "Parent",
  sendInvite: "Send invite",
  sendingInvite: "Sending invite…",
  inviteSent: "Invite sent. You can add another person.",
  inviteError: "Could not send the invite. Your entry is still here.",
  rosterRefreshing: "Refreshing the household roster…",
  rosterStale: "Saved. The roster is not current yet; your changes are safe.",
  retryRoster: "Refresh roster",
  close: "Close",
  createError: "Could not create your family. Please try again.",
  invalidResponse: "The server returned an unexpected family response.",
  reconcileFound: "Your family was created. Continue adding people below.",
  reconcileUnknown:
    "We could not confirm whether your family was created. Your name is still here; try again when ready.",
} as const;

export const onboardingSpanish = {
  setupInviteTitle: "Invita a tu familia",
  setupInviteHint: "Envía un enlace o comparte el código familiar",
  setupChoreTitle: "Añade tu primera tarea",
  setupChoreHint: "Elige una tarea y quién la hace",
  setupEventTitle: "Añade un evento",
  setupEventHint: "Pon algo en el calendario familiar",
  setupHidden: "Primeros pasos ocultos",
  setupProgress: "{done} de {total} completados. Unos pasos para configurar tu hogar.",
  setupHideLabel: "Ocultar primeros pasos",
  setupHide: "Ocultar",
  setupSteps: "Pasos de configuración",
  setupTodo: "Pendiente: ",
  setupDone: "Completado",
  welcomeTitle: "Te damos la bienvenida a Herewoven",
  welcomeDescription:
    "Crea un lugar compartido para tu hogar. Puedes añadir personas ahora o volver más tarde.",
  getStarted: "Empezar",
  createTitle: "Crea tu familia",
  createDescription:
    "Elige un nombre para tu hogar. Después podrás añadir a todas las personas que lo comparten.",
  familyNameLabel: "Nombre de la familia",
  familyNamePlaceholder: "p. ej., La familia García",
  createFamily: "Crear familia",
  creatingFamily: "Creando familia…",
  progressLabel: "Progreso de incorporación",
  joinPrompt: "¿Ya tienes un código o una invitación?",
  joinExisting: "Unirse a una familia existente",
  addEveryoneTitle: "Añade a todas las personas de tu familia",
  addEveryoneDescription:
    "Elige cómo usará Herewoven cada persona. Puedes invitar una cuenta, añadir un perfil para una pantalla compartida cuando esté disponible o terminar más tarde.",
  accountOptionTitle: "Su propia cuenta o teléfono",
  accountOptionDescription:
    "Envía una invitación por correo para crear un inicio de sesión o usa el código en otro teléfono. Elige el rol de padre o madre, adolescente o niño o niña.",
  addAccount: "Invitar una cuenta",
  openFullInvitePage: "Abrir la página completa de invitaciones",
  profileOptionTitle: "Pantalla compartida del hogar",
  profileOptionDescription:
    "Para alguien sin correo electrónico o dispositivo personal. Crea un perfil de presentación con solo nombre, sin inicio de sesión ni invitación; nunca concede acceso de padre o madre.",
  profileUnavailable:
    "Los perfiles para pantallas compartidas no están disponibles en este servidor. Usa una invitación con cuenta.",
  profileChecking: "Comprobando la compatibilidad con pantallas compartidas…",
  checkAgain: "Comprobar de nuevo",
  finishLater: "Terminar más tarde",
  continueToToday: "Continuar a Hoy",
  peopleAddedOne: "{count} persona del hogar añadida",
  peopleAddedMany: "{count} personas del hogar añadidas",
  accountInviteTitle: "Invita a alguien con una cuenta",
  accountInviteDescription:
    "Recibirá un enlace de un solo uso y creará su propio inicio de sesión. Esto envía un correo electrónico.",
  emailLabel: "Correo electrónico",
  emailPlaceholder: "alex@example.com",
  roleLabel: "Rol",
  roleChild: "Niño o niña",
  roleTeen: "Adolescente",
  roleParent: "Padre o madre",
  sendInvite: "Enviar invitación",
  sendingInvite: "Enviando invitación…",
  inviteSent: "Invitación enviada. Puedes añadir a otra persona.",
  inviteError: "No se pudo enviar la invitación. Tus datos siguen aquí.",
  rosterRefreshing: "Actualizando la lista del hogar…",
  rosterStale: "Guardado. La lista aún no está actualizada; tus cambios están a salvo.",
  retryRoster: "Actualizar la lista",
  close: "Cerrar",
  createError: "No se pudo crear la familia. Inténtalo de nuevo.",
  invalidResponse: "El servidor devolvió una respuesta de familia inesperada.",
  reconcileFound: "Tu familia se creó. Sigue añadiendo personas abajo.",
  reconcileUnknown:
    "No pudimos confirmar si se creó tu familia. El nombre sigue aquí; inténtalo de nuevo cuando quieras.",
} as const;

export type OnboardingMessage = keyof typeof onboardingEnglish;
export const onboardingMessages: Record<
  Locale,
  Record<OnboardingMessage, string>
> = {
  en: onboardingEnglish,
  es: onboardingSpanish,
};

export function useOnboardingText() {
  const { t } = useTranslation();
  return useCallback((key: OnboardingMessage, params?: Record<string, string | number>) =>
    t(key, params, onboardingMessages), [t]);
}
