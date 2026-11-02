import { useTranslation } from "@/i18n";
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
    description: "Calendario familiar compartido con eventos y tareas.",
  },
  lists: {
    title: "Listas",
    description:
      "Listas de compras, pendientes y equipaje que todos pueden editar.",
  },
  family: {
    title: "Familia",
    description:
      "Miembros, roles, códigos de invitación y configuración familiar.",
  },
  meals: {
    title: "Plan de comidas",
    description: "Planifica el desayuno, la comida y la cena de la semana.",
  },
  notes: {
    title: "Notas fijadas",
    description:
      "Notas adhesivas para planes, recogidas escolares y el fin de semana.",
  },
  anniversaries: {
    title: "Cumpleaños y aniversarios",
    description: "Recordatorios para las fechas familiares que se acercan.",
  },
  locations: {
    title: "Ubicaciones",
    description:
      "Guarda las direcciones de casa, escuela y trabajo de la familia.",
  },
  pickups: {
    title: "Recogidas y entregas",
    description: "Coordina quién recoge a los niños y cuándo.",
  },
  allowance: {
    title: "Mesada y deudas",
    description:
      "Controla la mesada semanal y el dinero que se deben los miembros.",
  },
  rewards: {
    title: "Recompensas",
    description:
      "Los niños gastan sus puntos en las recompensas que configures.",
  },
  budget: {
    title: "Presupuesto",
    description:
      "Controla los gastos compartidos y los presupuestos por categoría.",
  },
  projects: {
    title: "Proyectos",
    description: "Planifica viajes, reformas y grandes objetivos familiares.",
  },
  messages: {
    title: "Chat familiar",
    description: "Mensajería integrada para no necesitar otra aplicación.",
  },
  analytics: {
    title: "Análisis",
    description: "Rachas, clasificación y tendencias familiares semanales.",
  },
  wishlist: {
    title: "Lista de deseos",
    description:
      "Lo que quiere la familia. Los niños añaden y los padres hacen seguimiento.",
  },
  travel: {
    title: "Modo viaje",
    description:
      "Silencia tareas no urgentes y ajusta el calendario mientras estás fuera.",
  },
  emergency: {
    title: "Contactos de emergencia",
    description:
      "Tarjeta médica y de emergencias imprimible para cada familiar.",
  },
  handoff: {
    title: "Entrega al cuidador",
    description:
      "Resumen para el cuidador en una pantalla, imprimible y compartible.",
  },
  "sick-days": {
    title: "Días de enfermedad y medicinas",
    description:
      "Controla la enfermedad activa, la temperatura y el horario de medicación.",
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
  const { locale } = useTranslation();
  return (key) => getFeatureDisplayCopy(locale, key);
}
