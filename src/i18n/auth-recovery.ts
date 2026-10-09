/** Route-owned recovery presentation; canonical token/password/API contracts stay unchanged. */
export const authRecoveryEnglish = {
  checkEmail: "Check Your Email",
  emailBefore: "If an account exists with",
  emailAfter: ", you'll receive a password reset link.",
  emailPlaceholder: "you@example.com",
  invalidTitle: "Invalid Link",
  invalidBody: "This password reset link is invalid or has expired.",
  resetSuccess: "Your password has been reset successfully.",
  showPassword: "Show password",
  hidePassword: "Hide password",
  loading: "Loading...",
} as const;
export type AuthRecoveryMessage = keyof typeof authRecoveryEnglish;
export const authRecoverySpanish: Record<AuthRecoveryMessage, string> = {
  checkEmail: "Revisa tu correo",
  emailBefore: "Si existe una cuenta con",
  emailAfter: ", recibirás un enlace para restablecer tu contraseña.",
  emailPlaceholder: "tu@example.com",
  invalidTitle: "Enlace no válido",
  invalidBody:
    "Este enlace para restablecer la contraseña no es válido o ha caducado.",
  resetSuccess: "Tu contraseña se ha restablecido correctamente.",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  loading: "Cargando...",
};
export const authRecoveryMessages = {
  en: authRecoveryEnglish,
  es: authRecoverySpanish,
};
/** Owned errors keep semantic identity so delayed feedback follows the mounted locale. */
export type RecoveryFeedback =
  | {
      kind: "owned";
      key:
        | "common.error"
        | "auth.unexpectedError"
        | "auth.passwordMismatch"
        | "auth.passwordTooShort";
    }
  | { kind: "raw"; text: string };
