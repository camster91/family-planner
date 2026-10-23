import { useCoreI18n } from "@/i18n/core";

/** Launcher and loading copy only; full editor dictionaries stay with their sheets. */
export const reviewInboxShellMessages = {
  en: {
    title: "Review inbox",
  },
  es: {
    title: "Bandeja de revisión",
  },
};
export function useReviewInboxShellText() {
  return reviewInboxShellMessages[useCoreI18n().locale];
}
