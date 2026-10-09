import { loginNoticeFor } from "@/lib/safe-redirect";

/** Presentation only: canonical query precedence and English helper identity stay unchanged. */
export const authEntryEnglish = {
  emailPlaceholder: "you@example.com",
  namePlaceholder: "John Doe",
  showPassword: "Show password",
  hidePassword: "Hide password",
  resend: "Resend verification email",
  sending: "Sending…",
  resendComplete: "Check your email for a verification link.",
  checkEmail: "Check Your Email",
  verificationGuidance:
    "Check your email for a verification link. Open the link to activate your account, then sign in.",
  signIn: "Go to Sign In",
  householdDeleted: "Your household and its accounts have been deleted.",
  accountDeleted: "Your account has been deleted.",
  verified: loginNoticeFor(new URLSearchParams("verified=1"))!.text,
  invalidToken: loginNoticeFor(new URLSearchParams("error=invalid_token"))!
    .text,
  missingToken: loginNoticeFor(new URLSearchParams("error=missing_token"))!
    .text,
  verificationError: loginNoticeFor(new URLSearchParams("error=server"))!.text,
  inviteInvalid: "This invite is invalid or expired",
  inviteLoadFailed: "Could not load invite",
  invitation: "Join {familyName} as a {role}",
  parent: "parent",
  teen: "teen",
  child: "child",
} as const;
export type AuthEntryMessage = keyof typeof authEntryEnglish;
export const authEntrySpanish: Record<AuthEntryMessage, string> = {
  emailPlaceholder: "tu@example.com",
  namePlaceholder: "Nombre de ejemplo",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  resend: "Reenviar correo de verificación",
  sending: "Enviando…",
  resendComplete: "Revisa tu correo para encontrar un enlace de verificación.",
  checkEmail: "Revisa tu correo",
  verificationGuidance:
    "Revisa tu correo para encontrar un enlace de verificación. Abre el enlace para activar tu cuenta y luego inicia sesión.",
  signIn: "Ir a iniciar sesión",
  householdDeleted: "Tu hogar y sus cuentas han sido eliminados.",
  accountDeleted: "Tu cuenta ha sido eliminada.",
  verified: "Tu correo está verificado. Inicia sesión para empezar.",
  invalidToken:
    'Ese enlace de verificación ha caducado o ya se ha usado. Si ya verificaste tu correo, inicia sesión. Si no, inicia sesión y elige "Reenviar correo de verificación".',
  missingToken:
    "Ese enlace de verificación está incompleto. Copia el enlace completo del correo o inicia sesión para obtener uno nuevo.",
  verificationError:
    "No pudimos verificar tu correo ahora. Intenta abrir el enlace de nuevo en un minuto.",
  inviteInvalid: "Esta invitación no es válida o ha caducado",
  inviteLoadFailed: "No pudimos cargar la invitación",
  invitation: "Únete a {familyName} con el rol de {role}",
  parent: "adulto",
  teen: "adolescente",
  child: "niño",
};
export const authEntryMessages = { en: authEntryEnglish, es: authEntrySpanish };
export type AuthEntryFeedback =
  | { raw: string }
  | {
      shared:
        | "auth.loginFailed"
        | "auth.registrationFailed"
        | "auth.unexpectedError"
        | "auth.passwordMismatch"
        | "auth.passwordTooShort";
    }
  | { owned: "inviteInvalid" | "inviteLoadFailed" };
const arrivalKeys = [
  "verified",
  "invalidToken",
  "missingToken",
  "verificationError",
] as const;
export function authEntryArrivalKey(
  text: string,
): AuthEntryMessage | undefined {
  return arrivalKeys.find((key) => authEntryEnglish[key] === text);
}
export function authEntryRoleKey(
  role: string,
): "parent" | "teen" | "child" | undefined {
  return role === "parent" || role === "teen" || role === "child"
    ? role
    : undefined;
}
