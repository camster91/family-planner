"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  invited: "You are invited",
  invite: "Join {family} as a {role}.",
  sentTo: "Sent to {email}",
  joining: "Joining...",
  joinEmail: "Join family",
  create: "Create account and join",
  existing: "I already have an account",
  title: "Join a Family",
  description: "Use the in-person code from a parent, or open the link from your invite email.",
  code: "Family Code",
  codeExample: "e.g. K7QM-4XPD-2HNA",
  check: "Check Code",
  checking: "Checking code…",
  hint: "Capitals, spaces and dashes don’t matter.",
  ready: "Ready to join as a child or teen.",
  joinCode: "Join Family",
  joinedEmail: "Joined {family}",
  joinedCode: "Successfully joined {family}!",
  fallbackFamily: "your family",
  navigationPaused: "Navigation was paused. Continue when you’re ready.",
  continue: "Continue",
  continuing: "Continuing…",
  parent: "parent",
  teen: "teen",
  child: "child",
};
const es: Record<keyof typeof en, string> = {
  invited: "Te han invitado",
  invite: "Únete a {family} como {role}.",
  sentTo: "Enviada a {email}",
  joining: "Uniéndote…",
  joinEmail: "Unirse a la familia",
  create: "Crear una cuenta y unirse",
  existing: "Ya tengo una cuenta",
  title: "Unirse a una familia",
  description: "Usa el código que te dé un padre o abre el enlace del correo de invitación.",
  code: "Código de familia",
  codeExample: "p. ej. K7QM-4XPD-2HNA",
  check: "Comprobar código",
  checking: "Comprobando código…",
  hint: "No importan las mayúsculas, los espacios ni los guiones.",
  ready: "Todo listo para unirse como niño o adolescente.",
  joinCode: "Unirse a la familia",
  joinedEmail: "Te has unido a {family}",
  joinedCode: "¡Te has unido a {family}!",
  fallbackFamily: "tu familia",
  navigationPaused: "La navegación se ha pausado. Continúa cuando quieras.",
  continue: "Continuar",
  continuing: "Continuando…",
  parent: "padre o madre",
  teen: "adolescente",
  child: "niño o niña",
};
const messages = { en, es };
export function useJoinFamilyText() {
  const { t } = useTranslation();
  return useCallback((key: keyof typeof en, params?: Record<string, string | number>) => t(key, params, messages), [t]);
}
