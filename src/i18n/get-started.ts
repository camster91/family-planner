"use client";

import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
import type { Locale } from "./types";

/**
 * The Today "Get started" card's own strings. Kept apart from the onboarding
 * flow catalog so the card's lazy chunk on the Today board does not carry
 * every create-family and add-people message too (initial JS budget, #413).
 */
export const getStartedEnglish = {
  setupInviteTitle: "Invite your family",
  setupInviteHint: "Send a link or share your family code",
  setupChoreTitle: "Add your first chore",
  setupChoreHint: "Pick a job and who does it",
  setupEventTitle: "Add an event",
  setupEventHint: "Put something on the family calendar",
  setupCalendarTitle: "Connect your calendar",
  setupCalendarHint: "Bring in a Google, Outlook or school calendar",
  setupHidden: "Get started hidden",
  setupProgress:
    "{done} of {total} done. A few steps to set up your household.",
  setupHideLabel: "Hide get started",
  setupHide: "Hide",
  setupSteps: "Setup steps",
  setupTodo: "To do: ",
  setupDone: "Done",
  getStarted: "Get started",
} as const;

export type GetStartedMessage = keyof typeof getStartedEnglish;

export const getStartedSpanish: Record<GetStartedMessage, string> = {
  setupInviteTitle: "Invita a tu familia",
  setupInviteHint: "Envía un enlace o comparte el código familiar",
  setupChoreTitle: "Añade tu primera tarea",
  setupChoreHint: "Elige una tarea y quién la hace",
  setupEventTitle: "Añade un evento",
  setupEventHint: "Pon algo en el calendario familiar",
  setupCalendarTitle: "Conecta tu calendario",
  setupCalendarHint: "Trae un calendario de Google, Outlook o de la escuela",
  setupHidden: "Primeros pasos ocultos",
  setupProgress:
    "{done} de {total} completados. Unos pasos para configurar tu hogar.",
  setupHideLabel: "Ocultar primeros pasos",
  setupHide: "Ocultar",
  setupSteps: "Pasos de configuración",
  setupTodo: "Pendiente: ",
  setupDone: "Completado",
  getStarted: "Empezar",
};

export const getStartedMessages: Record<
  Locale,
  Record<GetStartedMessage, string>
> = {
  en: getStartedEnglish,
  es: getStartedSpanish,
};

export function useGetStartedText() {
  const { t } = useCoreTranslation();
  return useCallback(
    (key: GetStartedMessage, params?: Record<string, string | number>) =>
      t(key, params, getStartedMessages),
    [t],
  );
}
