import { useTranslation } from '@/i18n'

/** Handoff share and transient-load copy. Household names and notes stay verbatim. */
export const handoffRecoveryEnglish = {
  shareDescription: 'Send this link to {name}. It opens the handoff without signing in.',
  shareClose: 'Close handoff sharing',
  formClose: 'Close handoff form',
  sitterLink: 'Sitter link',
  worksUntil: 'Works until {date}',
  shareAction: 'Share…',
  nativeShareTitle: 'Handoff for {name}',
  expired: 'This link has expired.',
  noLink: 'There is no link yet.',
  makeNewLinkPrompt: 'Make a new link to share.',
  confirmNewLink: 'The link you already sent will stop working. Make a new one?',
  keepCurrentLink: 'Keep current link',
  makeNewLink: 'Make a new link',
  makeLink: 'Make new link',
  making: 'Making…',
  copyFallback: 'Copy the link from the box above',
  copyFailed: "Couldn't copy the link",
  copyFailedMessage: 'Select the link above and copy it.',
  newLinkMade: 'New link made',
  newLinkMadeMessage: 'Copy it and send it to your sitter.',
  newLinkFailed: "Couldn't make a new link",
  publicLoadErrorTitle: 'This handoff could not be loaded',
  publicLoadErrorDescription: 'Check your connection and try again.',
} as const

export type HandoffRecoveryMessage = keyof typeof handoffRecoveryEnglish
export type HandoffRecoveryMessages = Record<HandoffRecoveryMessage, string>

export const handoffRecoverySpanish: HandoffRecoveryMessages = {
  shareDescription: 'Envía este enlace a {name}. Abre la entrega sin iniciar sesión.',
  shareClose: 'Cerrar uso compartido de la entrega',
  formClose: 'Cerrar formulario de entrega',
  sitterLink: 'Enlace para la niñera',
  worksUntil: 'Funciona hasta {date}',
  shareAction: 'Compartir…',
  nativeShareTitle: 'Entrega para {name}',
  expired: 'Este enlace ha caducado.',
  noLink: 'Aún no hay un enlace.',
  makeNewLinkPrompt: 'Crea un enlace nuevo para compartirlo.',
  confirmNewLink: 'El enlace que ya enviaste dejará de funcionar. ¿Crear uno nuevo?',
  keepCurrentLink: 'Conservar enlace actual',
  makeNewLink: 'Crear enlace nuevo',
  makeLink: 'Crear enlace',
  making: 'Creando…',
  copyFallback: 'Copia el enlace del cuadro de arriba',
  copyFailed: 'No se pudo copiar el enlace',
  copyFailedMessage: 'Selecciona el enlace de arriba y cópialo.',
  newLinkMade: 'Enlace nuevo creado',
  newLinkMadeMessage: 'Cópialo y envíalo a la niñera.',
  newLinkFailed: 'No se pudo crear un enlace nuevo',
  publicLoadErrorTitle: 'No se pudo cargar esta entrega',
  publicLoadErrorDescription: 'Revisa tu conexión e inténtalo de nuevo.',
}

export const handoffRecoveryMessages = {
  en: handoffRecoveryEnglish,
  es: handoffRecoverySpanish,
}

export function useHandoffRecoveryText() {
  const { t: translate } = useTranslation()
  return (key: HandoffRecoveryMessage, params?: Record<string, string | number>) =>
    translate(key, params, handoffRecoveryMessages)
}
