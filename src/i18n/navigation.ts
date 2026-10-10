/** Shared navigation presentation; route and authorization policy stay in nav-items. */
export const navigationEnglish = {
  mainNavigation: "Main navigation",
  tabs: "Tabs",
  home: "{brand} home",
  today: "Today",
  calendar: "Calendar",
  meals: "Meals",
  lists: "Lists",
  family: "Family",
  emergency: "Emergency",
  search: "Search",
  searchLoading: "Loading search…",
  searchLoadFailed: "Could not load search.",
  retry: "Try again",
  notifications: "Notifications",
  userMenu: "User menu",
  user: "User",
  parent: "Parent",
  child: "Child",
  teen: "Teen",
  todayBoard: "Today board",
  inventory: "Food inventory",
  messages: "Messages",
  settings: "Settings",
  help: "Help",
  deleteAccount: "Delete my account",
  signOut: "Sign Out",
  notificationDescription:
    "Choose what you hear about. Each switch saves straight away.",
  close: "Close",
} as const;
export type NavigationMessage = keyof typeof navigationEnglish;
export const navigationSpanish: Record<NavigationMessage, string> = {
  mainNavigation: "Navegación principal",
  tabs: "Pestañas",
  home: "Inicio de {brand}",
  today: "Hoy",
  calendar: "Calendario",
  meals: "Comidas",
  lists: "Listas",
  family: "Familia",
  emergency: "Emergencia",
  search: "Buscar",
  searchLoading: "Cargando búsqueda…",
  searchLoadFailed: "No se pudo cargar la búsqueda.",
  retry: "Intentar de nuevo",
  notifications: "Notificaciones",
  userMenu: "Menú de usuario",
  user: "Usuario",
  parent: "Madre o padre",
  child: "Niño o niña",
  teen: "Adolescente",
  todayBoard: "Panel de hoy",
  inventory: "Inventario de alimentos",
  messages: "Mensajes",
  settings: "Ajustes",
  help: "Ayuda",
  deleteAccount: "Eliminar mi cuenta",
  signOut: "Cerrar sesión",
  notificationDescription:
    "Elige de qué quieres recibir avisos. Cada cambio se guarda inmediatamente.",
  close: "Cerrar",
};
export const navigationMessages = {
  en: navigationEnglish,
  es: navigationSpanish,
};
const tabKeys: Readonly<Record<string, NavigationMessage>> = {
  "/dashboard": "today",
  "/dashboard/today": "today",
  "/dashboard/calendar": "calendar",
  "/dashboard/meals": "meals",
  "/dashboard/lists": "lists",
  "/dashboard/family": "family",
  "/dashboard/emergency": "emergency",
};
/** Identity comes from the canonical href, never the English display label. */
export function navigationTabKey(href: string): NavigationMessage | null {
  return Object.hasOwn(tabKeys, href) ? tabKeys[href] : null;
}
