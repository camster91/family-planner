/** Static capture-recovery controls. Titles and saved content remain verbatim. */
export const captureEnglish = {
  needsAttention: "Needs attention",
  previousAddHint:
    "A previous add may have completed. Check its status before making a new preview.",
  checkStatus: "Check status",
  checkStatusFor: "Check status for {title}",
  checking: "Checking…",
  retry: "Retry",
  retryFor: "Retry {title}",
} as const;

export type CaptureMessage = keyof typeof captureEnglish;

export const captureSpanish: Record<CaptureMessage, string> = {
  needsAttention: "Requiere atención",
  previousAddHint:
    "Es posible que una adición anterior se haya completado. Consulta su estado antes de crear una vista previa nueva.",
  checkStatus: "Consultar estado",
  checkStatusFor: "Consultar estado de {title}",
  checking: "Consultando…",
  retry: "Reintentar",
  retryFor: "Reintentar {title}",
};

export const captureMessages = {
  en: captureEnglish,
  es: captureSpanish,
};
