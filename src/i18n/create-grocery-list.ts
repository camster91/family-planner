"use client";

import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
import type { Locale } from "./types";

/**
 * Strings for "Create a grocery list" (CreateGroceryListButton), shown only to a
 * household without any grocery list. The button loads only then, so its copy
 * stays out of the Today board catalog (initial JS budget, #413).
 */
export const createGroceryListEnglish = {
  createGroceryList: "Create a grocery list",
  creatingGroceryList: "Creating the list…",
  createGroceryListFailed: "Could not create the list. Try again.",
} as const;

export type CreateGroceryListMessage = keyof typeof createGroceryListEnglish;

export const createGroceryListSpanish: Record<
  CreateGroceryListMessage,
  string
> = {
  createGroceryList: "Crear una lista de compras",
  creatingGroceryList: "Creando la lista…",
  createGroceryListFailed: "No se pudo crear la lista. Inténtalo de nuevo.",
};

export const createGroceryListMessages: Record<
  Locale,
  Record<CreateGroceryListMessage, string>
> = {
  en: createGroceryListEnglish,
  es: createGroceryListSpanish,
};

export function useCreateGroceryListText() {
  const { t } = useCoreTranslation();
  return useCallback(
    (key: CreateGroceryListMessage, params?: Record<string, string | number>) =>
      t(key, params, createGroceryListMessages),
    [t],
  );
}
