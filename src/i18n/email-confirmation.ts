import { VERIFY_MESSAGES } from "@/lib/verify-email";

/** Route-owned presentation; shared verification outcomes and token policy stay canonical. */
export const emailConfirmationEnglish = {
  title: "Confirm your email",
  instruction: "Press the button to finish setting up your {brand} account.",
  missing:
    "That verification link is incomplete. Copy the whole link from the email, or sign in to get a new one.",
  confirming: "Confirming…",
  confirm: "Confirm my email",
  signIn: "Go to sign in",
  loading: "Loading...",
  ...VERIFY_MESSAGES,
} as const;
export type EmailConfirmationMessage = keyof typeof emailConfirmationEnglish;
export const emailConfirmationSpanish: Record<
  EmailConfirmationMessage,
  string
> = {
  title: "Confirma tu correo",
  instruction:
    "Pulsa el botón para terminar de configurar tu cuenta de {brand}.",
  missing:
    "Ese enlace de verificación está incompleto. Copia el enlace completo del correo o inicia sesión para obtener uno nuevo.",
  confirming: "Confirmando…",
  confirm: "Confirmar mi correo",
  signIn: "Ir a iniciar sesión",
  loading: "Cargando...",
  already_verified: "Tu correo ya está verificado. Puedes iniciar sesión.",
  invalid:
    'Ese enlace de verificación ha caducado o no es válido. Inicia sesión y elige "Reenviar correo de verificación" para obtener uno nuevo.',
  rate_limited: "Demasiados intentos. Espera un poco e inténtalo de nuevo.",
  error:
    "No pudimos confirmar tu correo ahora. Inténtalo de nuevo en un minuto.",
};
export const emailConfirmationMessages = {
  en: emailConfirmationEnglish,
  es: emailConfirmationSpanish,
};
