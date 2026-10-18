"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  title: "Add family",
  description: "Choose how each person will use herewoven.",
  emailChoice: "Their own account",
  emailHelp: "Invite by email so they can sign in on their own device.",
  profileChoice: "Shared household screen",
  profileHelp:
    "Add a name without an email or login. A profile never grants parent access.",
  separate:
    "Profiles and accounts are separate. Sending an invite does not link or replace an existing profile.",
  invite: "Invite by email",
  inviteTitle: "Invite a family member",
  inviteDescription:
    "They get a one-time link. Choose whether they join as a parent, teen or child.",
  email: "Email",
  role: "Role",
  child: "Child",
  teen: "Teen",
  parent: "Parent",
  send: "Send invite",
  sending: "Sending…",
  close: "Close",
  sent: "Invite sent to {email}",
  sendFailed:
    "Could not confirm the invite. Your entry is still here. Check pending invites before sending again.",
  pending: "Pending invitations",
  none: "No pending invitations",
  expires: "{role} · expires {date}",
  revoke: "Cancel invite for {email}",
  revokeFailed: "Could not cancel that invite. Try again.",
  inPerson: "In person instead",
  codeHelp:
    "For another phone in the room. This code does not choose a role — they join as a child or teen.",
  copied: "Copied",
  copyCode: "Copy code",
  copyLink: "Copy link",
  codeLabel: "Family code",
  linkLabel: "Join link",
  copyFailed: "Could not copy. Select the text and copy it yourself.",
  loading: "Loading…",
  loadFailed: "Could not load family invitations. Try again.",
  retry: "Try again",
  parentOnly: "A parent can add family members.",
  rotate: "Get a new family code",
  rotateHelp:
    "The old code stops working right away. People who already joined stay in the family.",
  rotateTitle: "Get a new family code?",
  rotateDescription: "Anyone you still want to join will need the new code.",
  keepCode: "Keep the current code",
  newCode: "Get a new code",
  rotating: "Making a new code…",
  rotated: "New code ready. The old code no longer works.",
  rotateFailed:
    "Could not confirm the new code. Refresh invitations before sharing a code.",
  rosterStale: "Your invite was sent. Refresh to update pending invitations.",
} as const;
const es: Record<keyof typeof en, string> = {
  title: "Añadir familia",
  description: "Elige cómo usará herewoven cada persona.",
  emailChoice: "Su propia cuenta",
  emailHelp:
    "Invita por correo para que pueda iniciar sesión en su dispositivo.",
  profileChoice: "Pantalla compartida del hogar",
  profileHelp:
    "Añade un nombre sin correo ni inicio de sesión. Un perfil nunca concede acceso de padre o madre.",
  separate:
    "Los perfiles y las cuentas son distintos. Enviar una invitación no vincula ni sustituye un perfil existente.",
  invite: "Invitar por correo",
  inviteTitle: "Invitar a un familiar",
  inviteDescription:
    "Recibirá un enlace de un solo uso. Elige si se une como padre o madre, adolescente o niño o niña.",
  email: "Correo electrónico",
  role: "Rol",
  child: "Niño o niña",
  teen: "Adolescente",
  parent: "Padre o madre",
  send: "Enviar invitación",
  sending: "Enviando…",
  close: "Cerrar",
  sent: "Invitación enviada a {email}",
  sendFailed:
    "No se pudo confirmar la invitación. Tu entrada sigue aquí. Revisa las invitaciones pendientes antes de enviarla otra vez.",
  pending: "Invitaciones pendientes",
  none: "No hay invitaciones pendientes",
  expires: "{role} · vence el {date}",
  revoke: "Cancelar invitación para {email}",
  revokeFailed: "No se pudo cancelar la invitación. Inténtalo de nuevo.",
  inPerson: "En persona",
  codeHelp:
    "Para otro teléfono en la misma habitación. Este código no elige un rol: se une como niño o niña o adolescente.",
  copied: "Copiado",
  copyCode: "Copiar código",
  copyLink: "Copiar enlace",
  codeLabel: "Código familiar",
  linkLabel: "Enlace para unirse",
  copyFailed: "No se pudo copiar. Selecciona el texto y cópialo manualmente.",
  loading: "Cargando…",
  loadFailed: "No se pudieron cargar las invitaciones. Inténtalo de nuevo.",
  retry: "Intentar de nuevo",
  parentOnly: "Un padre o una madre puede añadir familiares.",
  rotate: "Obtener otro código familiar",
  rotateHelp:
    "El código anterior deja de funcionar de inmediato. Quienes ya se unieron siguen en la familia.",
  rotateTitle: "¿Obtener otro código familiar?",
  rotateDescription: "Quienes aún quieran unirse necesitarán el nuevo código.",
  keepCode: "Mantener el código actual",
  newCode: "Obtener otro código",
  rotating: "Creando otro código…",
  rotated: "Nuevo código listo. El anterior ya no funciona.",
  rotateFailed:
    "No se pudo confirmar el nuevo código. Actualiza las invitaciones antes de compartir un código.",
  rosterStale:
    "Tu invitación se envió. Actualiza para ver las invitaciones pendientes.",
};
export function useFamilyInviteText() {
  const { locale } = useTranslation();
  return useCallback(
    (key: keyof typeof en, params?: Record<string, string>) => {
      const value: string = (locale === "es" ? es : en)[key];
      return value.replace(
        /\{(\w+)\}/g,
        (match, name: string) => params?.[name] ?? match,
      );
    },
    [locale],
  );
}
