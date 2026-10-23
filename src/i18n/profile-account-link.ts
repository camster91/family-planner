"use client";
import { useTranslation } from "@/i18n";
const en = {
  title: "Link a profile to an account",
  close: "Close",
  intro:
    "Keep this person's profile and chore history when they start using their own account.",
  steps:
    "First invite them to this household and ask them to verify their email. Share a one-use link. They sign in, open it, and confirm with their password. A parent then approves the account shown here.",
  noProfiles: "No unlinked profiles available.",
  profile: "Profile",
  choose: "Choose a person",
  create: "Create one-use link",
  retry: "Refresh",
  loading: "Loading profile links…",
  error:
    "Could not confirm this request. Your changes have not been confirmed. Refresh or retry.",
  unsupported: "Profile account linking is not available on this server yet.",
  conflict: "This profile or link changed. Refresh and review it again.",
  proof:
    "Verify your email and confirm your current password before continuing. Your account must already belong to this household with the same role.",
  share: "One-use link",
  shareHelp:
    "Share privately with this person. Sign in first, then open the link. Links expire after 24 hours. If you lose this link, revoke it below and create another.",
  copy: "Copy link",
  copied: "Link copied",
  copyError: "Copy failed. Select and copy the link instead.",
  recent: "Recent profile links",
  empty: "No links waiting for confirmation.",
  pending: "Waiting for account owner",
  claimed: "Ready for parent approval",
  linked: "Account linked",
  revoked: "Link revoked",
  expired: "Link expired",
  unavailable: "Link unavailable",
  expires: "Expires",
  approve: "Approve account",
  revoke: "Revoke link",
  confirmTitle: "Confirm this is the same person",
  confirmCopy:
    "The profile and account below will represent one person. Profile and chore history stay in place. Account permissions, names and earned points stay unchanged.",
  account: "Signed-in account",
  history: "Profile and history",
  cancel: "Cancel",
  approveFinal: "Yes, link this account",
  success: "Account linked. The profile and chore history were preserved.",
  claimTitle: "Use your account with an existing profile",
  claimIntro:
    "Only continue if this profile is yours. A parent will review your account before the link is completed.",
  missing:
    "Open the original private link after signing in to the invited household. For privacy, a refreshed page does not keep the link code.",
  review: "Review profile",
  password: "Your current password",
  claim: "Confirm this is my profile",
  waiting:
    "Your confirmation was saved. A parent can now approve your account. You can close this page.",
  busy: "Saving…",
  child: "Child",
  teen: "Teen",
  parent: "Parent",
};
const es: Record<keyof typeof en, string> = {
  title: "Vincular un perfil a una cuenta",
  close: "Cerrar",
  intro:
    "Conserva el perfil y el historial de tareas cuando esta persona empiece a usar su propia cuenta.",
  steps:
    "Primero invítala a este hogar y pídele que verifique su correo. Comparte un enlace de un solo uso. Debe iniciar sesión, abrirlo y confirmar con su contraseña. Después, un adulto aprueba la cuenta que aparece aquí.",
  noProfiles: "No hay perfiles sin vincular.",
  profile: "Perfil",
  choose: "Elige una persona",
  create: "Crear enlace de un solo uso",
  retry: "Actualizar",
  loading: "Cargando enlaces de perfiles…",
  error:
    "No pudimos confirmar esta solicitud. Los cambios no están confirmados. Actualiza o vuelve a intentarlo.",
  unsupported:
    "La vinculación de perfiles aún no está disponible en este servidor.",
  conflict: "Este perfil o enlace cambió. Actualiza y revísalo de nuevo.",
  proof:
    "Verifica tu correo y confirma tu contraseña actual. Tu cuenta ya debe pertenecer a este hogar con el mismo rol.",
  share: "Enlace de un solo uso",
  shareHelp:
    "Compártelo en privado con esta persona. Debe iniciar sesión antes de abrirlo. Caduca en 24 horas. Si lo pierdes, revócalo abajo y crea otro.",
  copy: "Copiar enlace",
  copied: "Enlace copiado",
  copyError: "No se pudo copiar. Selecciona y copia el enlace.",
  recent: "Enlaces de perfiles recientes",
  empty: "No hay enlaces esperando confirmación.",
  pending: "Esperando al titular de la cuenta",
  claimed: "Listo para aprobación",
  linked: "Cuenta vinculada",
  revoked: "Enlace revocado",
  expired: "Enlace caducado",
  unavailable: "Enlace no disponible",
  expires: "Caduca",
  approve: "Aprobar cuenta",
  revoke: "Revocar enlace",
  confirmTitle: "Confirma que es la misma persona",
  confirmCopy:
    "Este perfil y esta cuenta representarán a una sola persona. Se conservan el perfil y el historial de tareas. Los permisos, nombres y puntos ganados de la cuenta no cambian.",
  account: "Cuenta con sesión iniciada",
  history: "Perfil e historial",
  cancel: "Cancelar",
  approveFinal: "Sí, vincular esta cuenta",
  success:
    "Cuenta vinculada. Se conservaron el perfil y el historial de tareas.",
  claimTitle: "Usar tu cuenta con un perfil existente",
  claimIntro:
    "Continúa solo si este perfil es tuyo. Un adulto revisará tu cuenta antes de completar la vinculación.",
  missing:
    "Abre el enlace privado original después de iniciar sesión en el hogar al que te invitaron. Por privacidad, al actualizar la página no se conserva el código.",
  review: "Revisar perfil",
  password: "Tu contraseña actual",
  claim: "Confirmar que es mi perfil",
  waiting:
    "Se guardó tu confirmación. Un adulto ya puede aprobar tu cuenta. Puedes cerrar esta página.",
  busy: "Guardando…",
  child: "Niño/a",
  teen: "Adolescente",
  parent: "Adulto",
};
export function useProfileLinkText() {
  const { locale } = useTranslation();
  const copy = locale === "es" ? es : en;
  return { text: (key: keyof typeof en) => copy[key], locale };
}
