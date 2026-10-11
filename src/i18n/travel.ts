import { useTranslation } from "@/i18n";

/** Travel-owned presentation copy. Dates, destinations, chore titles, and member names stay verbatim. */
export const travelEnglish = {
  title: "Travel Mode",
  subtitle: "Coordinate your family while away",
  travelMode: "Travel Mode",
  on: "On",
  off: "Off",
  turnOn: "Turn on travel mode",
  turnOff: "Turn off travel mode",
  destination: "Destination",
  destinationPlaceholder: "e.g. Costa Rica",
  startDate: "Start date",
  endDate: "End date",
  awayBanner: "Away until {date}",
  whileAway: "While away",
  pendingChores: "Pending chores in travel window",
  noPendingChores: "No pending chores during this period",
  choresLoading: "Loading chores for this trip…",
  choresLoadErrorTitle: "Pending chores are unavailable",
  choresLoadErrorDescription: "We couldn't load the chores for this trip.",
  retryChores: "Try again",
  shiftedTo: "shifted to {date}",
  save: "Save",
  saving: "Saving…",
  refreshing: "Refreshing…",
  emptyState: "Not traveling. Turn on travel mode when you are away.",
  loadErrorTitle: "Travel mode is unavailable",
  loadErrorDescription: "We couldn't load your travel settings.",
  retry: "Try again",
  toggleFailed: "Couldn't change travel mode",
  detailsFailed: "Couldn't save the trip details",
  writeUnconfirmedTitle: "We couldn't confirm the change",
  writeUnconfirmedDescription: "The current state is unknown. Check it before trying again.",
  checkCurrentState: "Check current state",
  checkingState: "Checking current state…",
  networkError: "Check your connection and try again.",
  unassigned: "Unassigned",
} as const;

export type TravelMessage = keyof typeof travelEnglish;
export type TravelMessages = Record<TravelMessage, string>;

export const travelSpanish: TravelMessages = {
  title: "Modo Viaje",
  subtitle: "Coordina a tu familia mientras están fuera",
  travelMode: "Modo Viaje",
  on: "Activado",
  off: "Desactivado",
  turnOn: "Activar modo viaje",
  turnOff: "Desactivar modo viaje",
  destination: "Destino",
  destinationPlaceholder: "p. ej., Costa Rica",
  startDate: "Fecha de inicio",
  endDate: "Fecha de fin",
  awayBanner: "Fuera hasta el {date}",
  whileAway: "Mientras están fuera",
  pendingChores: "Tareas pendientes durante el viaje",
  noPendingChores: "No hay tareas pendientes durante este periodo",
  choresLoading: "Cargando tareas del viaje…",
  choresLoadErrorTitle: "No se pueden cargar las tareas pendientes",
  choresLoadErrorDescription: "No se pudieron cargar las tareas de este viaje.",
  retryChores: "Intentar de nuevo",
  shiftedTo: "reprogramada para el {date}",
  save: "Guardar",
  saving: "Guardando…",
  refreshing: "Actualizando…",
  emptyState: "No están viajando. Activa el modo viaje cuando estén fuera.",
  loadErrorTitle: "El modo viaje no está disponible",
  loadErrorDescription: "No se pudieron cargar los ajustes de viaje.",
  retry: "Intentar de nuevo",
  toggleFailed: "No se pudo cambiar el modo viaje",
  detailsFailed: "No se pudieron guardar los detalles del viaje",
  writeUnconfirmedTitle: "No pudimos confirmar el cambio",
  writeUnconfirmedDescription: "El estado actual no está confirmado. Compruébalo antes de intentarlo de nuevo.",
  checkCurrentState: "Comprobar estado actual",
  checkingState: "Comprobando estado actual…",
  networkError: "Revisa tu conexión e inténtalo de nuevo.",
  unassigned: "Sin asignar",
};

export const travelMessages = {
  en: travelEnglish,
  es: travelSpanish,
};

export function useTravelText() {
  const { t: translate } = useTranslation();
  return (key: TravelMessage, params?: Record<string, string | number>) =>
    translate(key, params, travelMessages);
}
