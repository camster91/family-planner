"use client";
import { useCoreTranslation } from "@/i18n/core";
const toastMessages = {
  en: { undo: "Undo", dismiss: "Dismiss" },
  es: { undo: "Deshacer", dismiss: "Descartar aviso" },
};
export function useToastCopy() {
  const { t } = useCoreTranslation();
  return (key: "undo" | "dismiss") => t(key, undefined, toastMessages);
}
export function UndoLabel() {
  const copy = useToastCopy();
  return <>{copy("undo")}</>;
}
