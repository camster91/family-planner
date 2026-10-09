"use client";
import { useTranslation } from "@/i18n";

/** #415: display only. Section keys are canonical API IDs, never translated values. */
export const storeSectionsEnglish = {
  produce: "Produce",
  bakery: "Bakery",
  dairy_eggs: "Dairy & eggs",
  meat_fish: "Meat & fish",
  frozen: "Frozen",
  pantry: "Pantry",
  snacks_drinks: "Snacks & drinks",
  household: "Household",
  personal_care: "Personal care",
  other: "Other",
  move: "Move",
  moveItem: "Move {item} to another section",
  moveTitle: "Move “{item}”",
  description:
    "Pick the store section. Your household’s lists will use it for this item from now on.",
  sections: "Store sections",
  current: "Current",
  automatic: "Use the automatic section",
  close: "Close",
  sort: "Sort by store section",
  on: "On",
  off: "Off",
  sortOn: "Sort by store section: On",
  sortOff: "Sort by store section: Off",
  learned: "Sections follow the order your household usually shops.",
  grouped: "Items are grouped by store section.",
  added: "Items stay in the order they were added.",
};
export type StoreSectionMessage = keyof typeof storeSectionsEnglish;
export const storeSectionsSpanish: Record<StoreSectionMessage, string> = {
  produce: "Frutas y verduras",
  bakery: "Panadería",
  dairy_eggs: "Lácteos y huevos",
  meat_fish: "Carne y pescado",
  frozen: "Congelados",
  pantry: "Despensa",
  snacks_drinks: "Aperitivos y bebidas",
  household: "Artículos del hogar",
  personal_care: "Cuidado personal",
  other: "Otros",
  move: "Mover",
  moveItem: "Mover {item} a otra sección",
  moveTitle: "Mover “{item}”",
  description:
    "Elige la sección de la tienda. Las listas de tu hogar la usarán para este artículo a partir de ahora.",
  sections: "Secciones de la tienda",
  current: "Actual",
  automatic: "Usar la sección automática",
  close: "Cerrar",
  sort: "Ordenar por sección de la tienda",
  on: "Activado",
  off: "Desactivado",
  sortOn: "Ordenar por sección de la tienda: activado",
  sortOff: "Ordenar por sección de la tienda: desactivado",
  learned: "Las secciones siguen el orden en que suele comprar tu hogar.",
  grouped: "Los artículos se agrupan por sección de la tienda.",
  added: "Los artículos conservan el orden en que se añadieron.",
};
export const storeSectionMessages = {
  en: storeSectionsEnglish,
  es: storeSectionsSpanish,
};

/** Same locale/QA template rules as root messages; this dictionary stays route-owned. */
export function useStoreSectionText() {
  const { t: translate } = useTranslation();
  return (key: StoreSectionMessage, params?: Record<string, string | number>) =>
    translate(key, params, storeSectionMessages);
}
