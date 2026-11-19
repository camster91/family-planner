"use client";

import { useCallback } from "react";
import { useTranslation } from "@/i18n";

/**
 * The "Have a family code?" way in, shown on the landing page, sign-in and
 * sign-up, and the join page's sign-up offer for a signed-out person.
 */
const en = {
  haveCode: "Have a family code?",
  joinYourFamily: "Join your family",
  createAccountToJoin: "Create an account",
  joinAfterSignUp:
    "After you confirm your email and sign in, you come back here to join with this code.",
} as const;

const es: Record<keyof typeof en, string> = {
  haveCode: "¿Tienes un código de familia?",
  joinYourFamily: "Únete a tu familia",
  createAccountToJoin: "Crear una cuenta",
  joinAfterSignUp:
    "Después de confirmar tu correo e iniciar sesión, volverás aquí para unirte con este código.",
};

export type FamilyCodeEntryMessage = keyof typeof en;
export const familyCodeEntryMessages = { en, es };

export function useFamilyCodeEntryText() {
  const { t } = useTranslation();
  return useCallback(
    (key: FamilyCodeEntryMessage, params?: Record<string, string | number>) =>
      t(key, params, familyCodeEntryMessages),
    [t],
  );
}
