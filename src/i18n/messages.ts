/** Messages-owned copy. Household messages and member names remain verbatim. */
import { useTranslation } from '@/i18n'

export const messagesEnglish = {
  title: 'Family messages',
  subtitle: '{count} family members',
  threadLabel: 'Messages thread',
  loadErrorTitle: "Couldn't load messages",
  loadErrorDescription: "We couldn't load your family's messages.",
  retry: 'Try again',
  refreshing: 'Refreshing…',
  emptyTitle: 'No messages yet',
  emptyDescription: 'Start a private conversation with your family.',
  loadEarlier: 'Load earlier messages',
  loadingEarlier: 'Loading earlier messages…',
  earlierError: "Couldn't load earlier messages. Try again.",
  dateLabel: 'Sent {date}',
  you: 'You',
  messageTextLabel: 'Message text',
  messagePlaceholder: 'Message your family',
  send: 'Send',
  sending: 'Sending message…',
  sendNetworkError: "Couldn't send your message. Check your connection and try again.",
  sendFailed: "Couldn't send your message. Try again.",
  sendUnconfirmed: 'Your message was not confirmed. Try again.',
  readUpdating: 'Updating read status…',
  readError: "Couldn't update read status.",
  retryRead: 'Mark as read',
} as const

export type MessagesMessage = keyof typeof messagesEnglish

export const messagesSpanish: Record<MessagesMessage, string> = {
  title: 'Mensajes familiares',
  subtitle: '{count} familiares',
  threadLabel: 'Conversación familiar',
  loadErrorTitle: 'No se pudieron cargar los mensajes',
  loadErrorDescription: 'No se pudieron cargar los mensajes de tu familia.',
  retry: 'Intentar de nuevo',
  refreshing: 'Actualizando…',
  emptyTitle: 'Aún no hay mensajes',
  emptyDescription: 'Inicia una conversación privada con tu familia.',
  loadEarlier: 'Cargar mensajes anteriores',
  loadingEarlier: 'Cargando mensajes anteriores…',
  earlierError: 'No se pudieron cargar los mensajes anteriores. Inténtalo de nuevo.',
  dateLabel: 'Enviado {date}',
  you: 'Tú',
  messageTextLabel: 'Texto del mensaje',
  messagePlaceholder: 'Escribe a tu familia',
  send: 'Enviar',
  sending: 'Enviando mensaje…',
  sendNetworkError: 'No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo.',
  sendFailed: 'No se pudo enviar el mensaje. Inténtalo de nuevo.',
  sendUnconfirmed: 'No se confirmó el mensaje. Inténtalo de nuevo.',
  readUpdating: 'Actualizando el estado de lectura…',
  readError: 'No se pudo actualizar el estado de lectura.',
  retryRead: 'Marcar como leído',
}

export const messagesMessages = {
  en: messagesEnglish,
  es: messagesSpanish,
}

export function useMessagesText() {
  const { t: translate } = useTranslation()
  return (key: MessagesMessage, params?: Record<string, string | number>) =>
    translate(key, params, messagesMessages)
}
