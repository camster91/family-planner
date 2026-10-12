/** Messages-owned loading and recovery copy. User messages and member names stay verbatim. */
import { useTranslation } from "@/i18n";

export const messagesEnglish = {
  loadErrorTitle: "Couldn't load messages",
  loadErrorDescription: "We couldn't load your family's messages.",
  retry: "Try again",
  refreshing: "Refreshing…",
} as const;

export type MessagesMessage = keyof typeof messagesEnglish;

export const messagesSpanish: Record<MessagesMessage, string> = {
  loadErrorTitle: "No se pudieron cargar los mensajes",
  loadErrorDescription: "No se pudieron cargar los mensajes de tu familia.",
  retry: "Intentar de nuevo",
  refreshing: "Actualizando…",
};

export const messagesMessages = {
  en: messagesEnglish,
  es: messagesSpanish,
};

export function useMessagesText() {
  const { t: translate } = useTranslation();
  return (key: MessagesMessage) => translate(key, undefined, messagesMessages);
}
