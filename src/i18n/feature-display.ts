import { useCoreTranslation } from "@/i18n/core";
import { FEATURES, type FeatureKey } from "@/lib/features";
import type { Locale } from "./types";

export interface FeatureDisplayCopy {
  title: string;
  description: string;
}

export interface FeatureOffDisplayCopy {
  title: string;
  description: string;
  askParent: string;
  openFeatures: string;
}

export type FeatureDisplayCopyMap = Record<FeatureKey, FeatureDisplayCopy>;
export type FeatureDisplayResolver = (key: FeatureKey) => FeatureDisplayCopy;

/**
 * English stays derived from the registry so keys, routes and presentation
 * metadata cannot drift apart. Translated copy belongs in this display map;
 * the feature registry remains the source of truth for behaviour.
 */
export const featureDisplayEnglish: FeatureDisplayCopyMap = FEATURES.reduce(
  (copy, feature) => {
    copy[feature.key] = {
      title: feature.title,
      description: feature.description,
    };
    return copy;
  },
  {} as FeatureDisplayCopyMap,
);

export const featureDisplaySpanish: FeatureDisplayCopyMap = {
  chores: {
    title: "Tareas",
    description: "Asigna tareas y mira lo que está hecho.",
  },
  calendar: {
    title: "Calendario",
    description: "Un calendario familiar para eventos y tareas.",
  },
  lists: {
    title: "Listas",
    description:
      "Listas de compras, pendientes y equipaje que todos pueden editar.",
  },
  family: {
    title: "Familia",
    description:
      "Miembros de la familia y cómo invitar a más personas.",
  },
  meals: {
    title: "Plan de comidas",
    description: "Planifica el desayuno, la comida y la cena de la semana.",
  },
  notes: {
    title: "Notas fijadas",
    description:
      "Notas cortas que todos pueden ver, como en el frigorífico.",
  },
  anniversaries: {
    title: "Cumpleaños y aniversarios",
    description: "Recordatorios para las fechas familiares que se acercan.",
  },
  locations: {
    title: "Ubicaciones",
    description:
      "Guarda las direcciones de casa, escuela y trabajo.",
  },
  pickups: {
    title: "Recogidas y entregas",
    description: "Planifica quién recoge a los niños y cuándo.",
  },
  allowance: {
    title: "Mesada y deudas",
    description:
      "Controla la mesada y el dinero que se deben unos a otros.",
  },
  rewards: {
    title: "Recompensas",
    description:
      "Los niños cambian sus puntos por recompensas que eliges.",
  },
  budget: {
    title: "Presupuesto",
    description:
      "Controla los gastos de la familia y pon presupuestos.",
  },
  projects: {
    title: "Proyectos",
    description: "Planifica viajes, trabajos en casa y grandes metas familiares.",
  },
  messages: {
    title: "Chat familiar",
    description: "Envía mensajes a tu familia dentro de la aplicación.",
  },
  analytics: {
    title: "Análisis",
    description: "Mira las rachas y cómo fue la semana.",
  },
  wishlist: {
    title: "Lista de deseos",
    description:
      "Los niños añaden lo que quieren. Los padres llevan la cuenta.",
  },
  travel: {
    title: "Modo viaje",
    description:
      "Silencia lo que no es urgente y mueve las tareas mientras estás fuera.",
  },
  emergency: {
    title: "Contactos de emergencia",
    description:
      "Una tarjeta con datos médicos y de emergencia para cada persona.",
  },
  handoff: {
    title: "Entrega al cuidador",
    description:
      "Una página para el cuidador que puedes imprimir o compartir.",
  },
  "sick-days": {
    title: "Días de enfermedad y medicinas",
    description:
      "Controla quién está enfermo, su temperatura y cuándo tocan las medicinas.",
  },
  gamification: {
    title: "Puntos y rachas",
    description:
      "Puntos por tareas, niveles, rachas y una clasificación familiar.",
  },
  inventory: {
    title: "Inventario de alimentos",
    description:
      "Controla lo que hay en el frigorífico, congelador y despensa, y qué conviene usar pronto.",
  },
};

export const featureDisplayMessages: Record<Locale, FeatureDisplayCopyMap> = {
  en: featureDisplayEnglish,
  es: featureDisplaySpanish,
};

const featureOffMessages: Record<Locale, Omit<FeatureOffDisplayCopy, "title">> = {
  en: {
    description:
      "{title} is turned off for your family. You can turn it on in Features settings.",
    askParent: "{title} is turned off for your family. Ask a parent to turn it on.",
    openFeatures: "Open Features",
  },
  es: {
    description:
      "La función «{title}» está desactivada para tu familia. Puedes activarla en la configuración de funciones.",
    askParent:
      "La función «{title}» está desactivada para tu familia. Pide a un padre que la active.",
    openFeatures: "Abrir funciones",
  },
};

export function getFeatureDisplayCopy(
  locale: Locale,
  key: FeatureKey,
): FeatureDisplayCopy {
  return featureDisplayMessages[locale][key];
}

export function getFeatureDisplayMap(locale: Locale): FeatureDisplayCopyMap {
  return featureDisplayMessages[locale];
}

export function getFeatureOffCopy(
  locale: Locale,
  title: string,
): FeatureOffDisplayCopy {
  const copy = featureOffMessages[locale];
  return {
    title: locale === "es" ? `Función desactivada: ${title}` : `${title} is off`,
    description: copy.description.replace("{title}", title),
    askParent: copy.askParent.replace("{title}", title),
    openFeatures: copy.openFeatures,
  };
}

export function useFeatureDisplayCopy(): FeatureDisplayResolver {
  const { locale } = useCoreTranslation();
  return (key) => getFeatureDisplayCopy(locale, key);
}
