/** Copy needed by the always-mounted assistant launcher, kept out of the lazy panel dictionary. */
export const assistantShellMessages = {
  en: {
    loading: "Opening assistant…",
    launcherReport: "Report / Suggest",
    launcherAssistant: "AI assistant",
  },
  es: {
    loading: "Abriendo asistente…",
    launcherReport: "Informar / Sugerir",
    launcherAssistant: "Asistente de IA",
  },
} as const;

export type AssistantShellMessage = keyof typeof assistantShellMessages.en;
