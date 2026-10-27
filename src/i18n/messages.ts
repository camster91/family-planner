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
  historyUnavailable: 'This server shows recent messages only. Earlier history needs a server update.',
  contextChanged: 'Reload messages to confirm your current household before continuing.',
  reloadMessages: 'Reload messages',
  writeUnavailable: 'Sending needs an updated server. Your draft stays here.',
  dateLabel: 'Sent {date}',
  you: 'You',
  messageTextLabel: 'Message text',
  messagePlaceholder: 'Message your family',
  send: 'Send',
  sending: 'Sending message…',
  sendNetworkError: "Couldn't send your message. Check your connection and try again.",
  sendFailed: "Couldn't send your message. Try again.",
  sendUnconfirmed: 'Your message was not confirmed. Try again.',
  sendWindowClosed: 'This send can no longer be safely retried. Your draft stays here. Check the conversation for the original message and check your device clock before starting a new send.',
  startNewAfterReview: 'I checked — allow a new send',
  readUpdating: 'Updating read status…',
  readError: "Couldn't update read status.",
  retryRead: 'Mark as read',
  linkPickup: 'Link a pickup',
  noPickup: 'No pickup linked',
  pickupContext: 'Pickup',
  pickupDateLabel: 'Pickup time: {date}',
  addPhoto: 'Add a photo',
  removePhoto: 'Remove photo',
  photoAttachment: 'Attached photo',
  photoUploadFailed: "Couldn't add that photo. Try again.",
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
  historyUnavailable: 'Este servidor solo muestra mensajes recientes. El historial anterior necesita una actualización del servidor.',
  contextChanged: 'Vuelve a cargar los mensajes para confirmar tu hogar actual antes de continuar.',
  reloadMessages: 'Volver a cargar mensajes',
  writeUnavailable: 'Para enviar se necesita un servidor actualizado. Tu borrador permanece aquí.',
  dateLabel: 'Enviado {date}',
  you: 'Tú',
  messageTextLabel: 'Texto del mensaje',
  messagePlaceholder: 'Escribe a tu familia',
  send: 'Enviar',
  sending: 'Enviando mensaje…',
  sendNetworkError: 'No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo.',
  sendFailed: 'No se pudo enviar el mensaje. Inténtalo de nuevo.',
  sendUnconfirmed: 'No se confirmó el mensaje. Inténtalo de nuevo.',
  sendWindowClosed: 'Este envío ya no se puede reintentar de forma segura. Tu borrador permanece aquí. Busca el mensaje original en la conversación y comprueba el reloj de tu dispositivo antes de iniciar otro envío.',
  startNewAfterReview: 'Ya comprobé — permitir otro envío',
  readUpdating: 'Actualizando el estado de lectura…',
  readError: 'No se pudo actualizar el estado de lectura.',
  retryRead: 'Marcar como leído',
  linkPickup: 'Vincular una recogida',
  noPickup: 'Sin recogida vinculada',
  pickupContext: 'Recogida',
  pickupDateLabel: 'Hora de recogida: {date}',
  addPhoto: 'Añadir una foto',
  removePhoto: 'Quitar foto',
  photoAttachment: 'Foto adjunta',
  photoUploadFailed: 'No se pudo añadir esa foto. Inténtalo de nuevo.',
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
