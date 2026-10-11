import { useTranslation } from "@/i18n";

export const moreEnglish = {
  title: "More",
  choresOnly: "Chores, and anything else you turn on, lives here.",
  withOneFeature: "Chores and one more feature your family uses.",
  withFeatures: "Chores and {count} more features your family uses.",
  listLabel: "Features",
  settingsTitle: "Turn features on or off",
  settingsDescription: "Add allowance, pickups, sick days and more",
} as const;

export type MoreMessage = keyof typeof moreEnglish;
export type MoreMessages = Record<MoreMessage, string>;

export const moreSpanish: MoreMessages = {
  title: "Más",
  choresOnly: "Las tareas y todo lo que actives aparecen aquí.",
  withOneFeature: "Las tareas y una función más que usa tu familia.",
  withFeatures: "Las tareas y {count} funciones más que usa tu familia.",
  listLabel: "Funciones",
  settingsTitle: "Activar o desactivar funciones",
  settingsDescription: "Añade mesada, recogidas, días de enfermedad y más",
};

export const moreMessages = { en: moreEnglish, es: moreSpanish };

export function useMoreText() {
  const { t: translate } = useTranslation();
  return (key: MoreMessage, params?: Record<string, string | number>) =>
    translate(key, params, moreMessages);
}
