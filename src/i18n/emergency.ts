/** Emergency form/preview copy stays in this route's bundle; stored details stay verbatim. */
import { useCallback } from "react";
import { useTranslation } from "@/i18n";

export const emergencyEnglish = {
  closePreview: "Close card preview",
  selectPreview: "Select a card to preview",
  closeForm: "Close emergency card form",
  nameRequired: "Enter the person’s name.",
  optionalSections:
    "Add only the details your family needs. Open a section to edit it.",
  roleUnavailable:
    "We could not check your editing permissions. Cards are still available to read.",
  deleteConfirmTitle: "Delete emergency card?",
  deleteConfirmDescription:
    "This removes this medical and emergency card from the family. It cannot be undone.",
  closeDelete: "Close delete confirmation",
  groups: {
    person: "Person",
    medical: "Medical details",
    providers: "Doctors and insurance",
    contact: "Emergency contact and notes",
  },
  examples: {
    personName: "e.g. Emma Johnson",
    bloodType: "e.g. O+",
    allergies: "e.g. Known allergies",
    medications: "e.g. Medicine name and dose",
    medicalConditions: "e.g. Known medical conditions",
    doctorName: "e.g. Dr. Smith",
    doctorPhone: "e.g. (555) 123-4567",
    dentistName: "e.g. Dr. Jones",
    dentistPhone: "e.g. (555) 987-6543",
    insuranceProvider: "e.g. Provider name",
    insuranceId: "e.g. Policy or member number",
    emergencyContactName: "e.g. John Doe",
    emergencyContactPhone: "e.g. (555) 321-7890",
    emergencyContactRelation: "e.g. Spouse",
    notes: "Additional details for your family",
  },
} as const;

type Localized<T> = {
  [K in keyof T]: T[K] extends string ? string : Localized<T[K]>;
};
export const emergencySpanish: Localized<typeof emergencyEnglish> = {
  closePreview: "Cerrar vista previa de la tarjeta",
  selectPreview: "Selecciona una tarjeta para ver sus detalles",
  closeForm: "Cerrar formulario de emergencia",
  nameRequired: "Escribe el nombre de la persona.",
  optionalSections:
    "Añade solo lo que tu familia necesita. Abre una sección para editarla.",
  roleUnavailable:
    "No pudimos comprobar tus permisos de edición. Puedes seguir leyendo las tarjetas.",
  deleteConfirmTitle: "¿Eliminar la tarjeta de emergencia?",
  deleteConfirmDescription:
    "Se eliminará esta tarjeta médica y de emergencia de la familia. No se puede deshacer.",
  closeDelete: "Cerrar confirmación de eliminación",
  groups: {
    person: "Persona",
    medical: "Datos médicos",
    providers: "Médicos y seguro",
    contact: "Contacto de emergencia y notas",
  },
  examples: {
    personName: "p. ej. Emma García",
    bloodType: "p. ej. O+",
    allergies: "p. ej. Alergias conocidas",
    medications: "p. ej. Nombre y dosis del medicamento",
    medicalConditions: "p. ej. Condiciones médicas conocidas",
    doctorName: "p. ej. Dra. García",
    doctorPhone: "p. ej. (555) 123-4567",
    dentistName: "p. ej. Dr. López",
    dentistPhone: "p. ej. (555) 987-6543",
    insuranceProvider: "p. ej. Nombre del proveedor",
    insuranceId: "p. ej. Número de póliza o afiliación",
    emergencyContactName: "p. ej. Juan García",
    emergencyContactPhone: "p. ej. (555) 321-7890",
    emergencyContactRelation: "p. ej. Cónyuge",
    notes: "Otros detalles para tu familia",
  },
};
export const emergencyMessages = {
  en: { emergency: emergencyEnglish },
  es: { emergency: emergencySpanish },
};
const owned = new Set(Object.keys(emergencyEnglish));
export function useEmergencyText() {
  const { t } = useTranslation();
  return useCallback(
    (key: string) =>
      key.startsWith("emergency.") && owned.has(key.split(".")[1])
        ? t(key, undefined, emergencyMessages)
        : t(key),
    [t],
  );
}
