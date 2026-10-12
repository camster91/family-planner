import type { Locale } from "./types";

export const rewardCreateEnglish = {
  back: "Back to Rewards",
  title: "New Reward",
  sheetTitle: "New Reward",
  closeLabel: "Close and return",
  subtitle: "Create a reward for your family.",
  refusalTitle: "Only a parent can create rewards",
  refusalDescription: "Ask a parent to create a reward for your family.",
  name: "Name",
  namePlaceholder: "e.g., Extra Video Game Time",
  description: "Description",
  optional: "(optional)",
  descriptionPlaceholder: "e.g., 30 minutes of extra gaming on the weekend",
  cost: "Cost in points",
  points: "points",
  icon: "Icon",
  iconOption: "Choose reward icon {icon}",
  create: "Create Reward",
  creating: "Creating...",
  createError:
    "We couldn't create that reward. Check the details and try again.",
  networkError: "Check your connection and try again.",
  permissionError: "Only a parent can create rewards.",
  draftDescription: "Close to return. Unsaved changes will be cleared.",
  pendingDescription: "Please wait for saving to finish.",
} as const;

export type RewardCreateMessage = keyof typeof rewardCreateEnglish;

export const rewardCreateSpanish: Record<RewardCreateMessage, string> = {
  back: "Volver a Recompensas",
  title: "Nueva recompensa",
  sheetTitle: "Nueva recompensa",
  closeLabel: "Cerrar y volver",
  subtitle: "Crea una recompensa para tu familia.",
  refusalTitle: "Solo un padre o madre puede crear recompensas",
  refusalDescription:
    "Pide a un padre o madre que cree una recompensa para tu familia.",
  name: "Nombre",
  namePlaceholder: "p. ej., Tiempo extra de videojuegos",
  description: "Descripción",
  optional: "(opcional)",
  descriptionPlaceholder:
    "p. ej., 30 minutos de videojuegos extra el fin de semana",
  cost: "Costo en puntos",
  points: "puntos",
  icon: "Icono",
  iconOption: "Elegir icono de recompensa {icon}",
  create: "Crear recompensa",
  creating: "Creando...",
  createError:
    "No se pudo crear la recompensa. Revisa los datos e inténtalo de nuevo.",
  networkError: "Revisa tu conexión e inténtalo de nuevo.",
  permissionError: "Solo un padre o madre puede crear recompensas.",
  draftDescription: "Cierra para volver. Los cambios sin guardar se borrarán.",
  pendingDescription: "Espera a que termine de guardarse.",
};

export const rewardCreateMessages: Record<
  Locale,
  Record<RewardCreateMessage, string>
> = {
  en: rewardCreateEnglish,
  es: rewardCreateSpanish,
};
