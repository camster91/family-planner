/** Static capture-recovery controls. Titles and saved content remain verbatim. */
export const captureEnglish = {
  openQuickAdd: "Open quick add",
  quickAdd: "Quick add",
  quickAddDescription:
    "Add an event, task, or grocery item by typing or taking a photo.",
  closeQuickAdd: "Close quick add",
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
  openQuickAdd: "Abrir adición rápida",
  quickAdd: "Adición rápida",
  quickAddDescription:
    "Añade un evento, una tarea o un artículo de supermercado escribiendo o tomando una foto.",
  closeQuickAdd: "Cerrar adición rápida",
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
