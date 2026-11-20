"use client";

import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
import type { Locale } from "./types";

/**
 * Strings for the "Add or ask" sheet (QuickAddDialog). The sheet loads on first
 * open, so its copy lives here rather than in the Today board catalog that
 * every cold Today page carries (initial JS budget, #413).
 */
export const quickAddEnglish = {
  quickAddTitle: "What do you want to do?",
  quickAddDescription: "Start something yourself or ask the family assistant.",
  closeQuickAdd: "Close add and ask",
  quickAsk: "Ask the assistant",
  quickAskHint: "Describe it, speak it, or get help choosing.",
  quickAddEmpty: "Nothing is available for this role yet.",
  addEvent: "Add event",
  addChore: "Add chore",
  addList: "New list",
  addMeal: "Plan a meal",
  addPrep: "Plan a prep session",
  addNote: "Add a note",
  importPhoto: "Add from a photo",
} as const;

export type QuickAddMessage = keyof typeof quickAddEnglish;

export const quickAddSpanish: Record<QuickAddMessage, string> = {
  quickAddTitle: "¿Qué quieres hacer?",
  quickAddDescription: "Empieza algo o pídeselo al asistente familiar.",
  closeQuickAdd: "Cerrar añadir y preguntar",
  quickAsk: "Preguntar al asistente",
  quickAskHint: "Descríbelo, dilo o pide ayuda para elegir.",
  quickAddEmpty: "Aún no hay nada disponible para este rol.",
  addEvent: "Añadir evento",
  addChore: "Añadir tarea",
  addList: "Nueva lista",
  addMeal: "Planear una comida",
  addPrep: "Planear una sesión de preparación",
  addNote: "Añadir una nota",
  importPhoto: "Añadir desde una foto",
};

export const quickAddMessages: Record<
  Locale,
  Record<QuickAddMessage, string>
> = {
  en: quickAddEnglish,
  es: quickAddSpanish,
};

export function useQuickAddText() {
  const { t } = useCoreTranslation();
  return useCallback(
    (key: QuickAddMessage, params?: Record<string, string | number>) =>
      t(key, params, quickAddMessages),
    [t],
  );
}
