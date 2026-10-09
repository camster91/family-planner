/** Shared browser-network banner only; useOnline and recovery timer are unchanged. */
export const offlineBannerEnglish = {
  offline:
    "You're offline. Some things may not load or save until you're back online.",
  back: "Back online.",
} as const;
export type OfflineBannerMessage = keyof typeof offlineBannerEnglish;
export const offlineBannerSpanish: Record<OfflineBannerMessage, string> = {
  offline:
    "Sin conexión. Algunas funciones podrían no cargar ni guardar hasta que vuelva la conexión.",
  back: "Conexión restablecida.",
};
export const offlineBannerMessages = {
  en: offlineBannerEnglish,
  es: offlineBannerSpanish,
};
