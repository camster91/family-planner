"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  back: "Back to settings",
  title: "Import family apps",
  description: "Validate an export first, review skipped records, then explicitly approve persistence.",
  source: "Source application",
  file: "Export file",
  chooseFile: "Choose the export file (.json, up to 10 MB)",
  reading: "Reading export file…",
  mapping: "Identity mapping",
  mappingHelp: "Map source child/user IDs to existing household user IDs. Example:",
  validate: "Validate dry run",
  validating: "Validating…",
  preview: "Reconciliation preview",
  result: "Import result",
  confirm: "I reviewed the created, reused, and skipped counts and approve writing these records to this family.",
  persist: "Persist approved import",
  persisting: "Importing…",
  fileTooLarge: "Export files must be 10 MB or smaller.",
  fileUnreadable: "That file could not be read. Choose the export file the other app saved (it ends in .json).",
  fileRequired: "Choose an export file first.",
  mappingInvalid: "Identity mapping must be valid JSON.",
  mappingObject: "Identity mapping must be a JSON object with user IDs as values.",
  previewRequired: "Validate the current file and identity mapping, review the preview, then approve the import.",
  failed: "Could not validate this import. Check the export and try again.",
  writeUnconfirmed: "The import result could not be confirmed. Review existing records before validating and importing again.",
  foreignMapping: "The identity map includes users outside this family. Review the mapping.",
  identityChanged: "Household identity records changed. Review the mapping and validate again.",
  sessionChanged: "Sign in again, then validate and review the import before saving.",
  invalidExport: "This file does not match the selected app’s export format.",
  payloadTooLarge: "The import request exceeds 10 MB. Use a smaller export or mapping.",
};
const es: Record<keyof typeof en, string> = {
  back: "Volver a ajustes",
  title: "Importar apps familiares",
  description: "Valida primero una exportación, revisa los registros omitidos y aprueba expresamente que se guarden.",
  source: "Aplicación de origen",
  file: "Archivo de exportación",
  chooseFile: "Elige el archivo de exportación (.json, hasta 10 MB)",
  reading: "Leyendo archivo de exportación…",
  mapping: "Correspondencia de identidades",
  mappingHelp: "Relaciona los identificadores de niños o usuarios del origen con identificadores de usuarios del hogar. Ejemplo:",
  validate: "Validar sin guardar",
  validating: "Validando…",
  preview: "Vista previa de conciliación",
  result: "Resultado de la importación",
  confirm: "He revisado los recuentos de registros creados, reutilizados y omitidos y apruebo guardar estos registros en esta familia.",
  persist: "Guardar importación aprobada",
  persisting: "Importando…",
  fileTooLarge: "Los archivos de exportación deben tener un tamaño de 10 MB o menos.",
  fileUnreadable: "No se pudo leer el archivo. Elige el archivo de exportación guardado por la otra app (termina en .json).",
  fileRequired: "Elige primero un archivo de exportación.",
  mappingInvalid: "La correspondencia de identidades debe ser JSON válido.",
  mappingObject: "La correspondencia de identidades debe ser un objeto JSON con identificadores de usuario como valores.",
  previewRequired: "Valida el archivo y la correspondencia actuales, revisa la vista previa y aprueba la importación.",
  failed: "No se pudo validar esta importación. Revisa la exportación e inténtalo de nuevo.",
  writeUnconfirmed: "No se pudo confirmar el resultado de la importación. Revisa los registros existentes antes de validar e importar de nuevo.",
  foreignMapping: "La correspondencia incluye usuarios ajenos a esta familia. Revísala.",
  identityChanged: "Las identidades del hogar han cambiado. Revisa la correspondencia y valida de nuevo.",
  sessionChanged: "Vuelve a iniciar sesión y valida y revisa la importación antes de guardar.",
  invalidExport: "El archivo no coincide con el formato de exportación de la app seleccionada.",
  payloadTooLarge: "La solicitud de importación supera los 10 MB. Usa una exportación o correspondencia más pequeña.",
};
export type ImportSettingsError = "fileTooLarge" | "fileUnreadable" | "fileRequired" |
  "mappingInvalid" | "mappingObject" | "previewRequired" | "failed" |
  "writeUnconfirmed" | "foreignMapping" | "identityChanged" | "sessionChanged" | "invalidExport" | "payloadTooLarge";
const messages = { en, es };
export function useImportSettingsText() {
  const { t } = useTranslation();
  return useCallback((key: keyof typeof en) => t(key, undefined, messages), [t]);
}
