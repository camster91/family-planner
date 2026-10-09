"use client";
import { useTranslation } from "@/i18n";
const toastMessages = {
  en: { undo: "Undo", dismiss: "Dismiss" },
  es: { undo: "Deshacer", dismiss: "Descartar aviso" },
};
export function useToastCopy() {
  const { t } = useTranslation();
  return (key: "undo" | "dismiss") => t(key, undefined, toastMessages);
}
export function UndoLabel() {
  const copy = useToastCopy();
  return <>{copy("undo")}</>;
}
