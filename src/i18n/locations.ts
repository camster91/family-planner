/** Locations-owned confirmation and recovery copy. Household labels stay verbatim. */
import { useTranslation } from '@/i18n'

export const locationsEnglish = {
  greeting: 'Family',
  pageTitle: 'Locations',
  pageSubtitle: 'Save the places your family goes — home, school, work.',
  add: 'Add',
  newTitle: 'New location',
  editTitle: 'Edit location',
  formDescription: 'Save a private place for your family.',
  closeForm: 'Close location form',
  label: 'Label',
  labelPlaceholder: 'Home, School, Work…',
  address: 'Address',
  addressPlaceholder: '123 Main St',
  cancel: 'Cancel',
  save: 'Save',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  retrySave: 'Try again',
  saveFailed: 'The location could not be saved. Try again.',
  saveNetworkError: 'The location could not be saved. Check your connection and try again.',
  emptyTitle: 'No locations yet',
  emptyDescription: 'Add Home, School, Work, or any place the family goes regularly.',
  primarySection: 'Home',
  otherSection: 'Other places',
  editButton: 'Edit {label}',
  loadToastTitle: "Couldn't load locations",
  saveToastTitle: "Couldn't save the location",
  loadErrorTitle: 'Couldn\'t load locations',
  loadErrorDescription: 'We couldn\'t load your family\'s saved places.',
  retry: 'Try again',
  refreshing: 'Refreshing…',
  removeTitle: 'Remove “{label}”?',
  removeDescription:
    'This permanently removes “{label}” from the family’s saved places.',
  removeFailed: 'The location could not be removed. Try again.',
  removeNetworkError:
    'The location could not be removed. Check your connection and try again.',
  removeClose: 'Close location removal confirmation',
  removeButton: 'Remove {label}',
  removing: 'Removing…',
} as const

export type LocationsMessage = keyof typeof locationsEnglish

export const locationsSpanish: Record<LocationsMessage, string> = {
  greeting: 'Familia',
  pageTitle: 'Lugares',
  pageSubtitle: 'Guarda los lugares a los que va tu familia: casa, escuela, trabajo.',
  add: 'Añadir',
  newTitle: 'Nuevo lugar',
  editTitle: 'Editar lugar',
  formDescription: 'Guarda un lugar privado para tu familia.',
  closeForm: 'Cerrar formulario de lugares',
  label: 'Nombre',
  labelPlaceholder: 'Casa, escuela, trabajo…',
  address: 'Dirección',
  addressPlaceholder: '123 Calle Principal',
  cancel: 'Cancelar',
  save: 'Guardar',
  saveChanges: 'Guardar cambios',
  saving: 'Guardando…',
  retrySave: 'Intentar de nuevo',
  saveFailed: 'No se pudo guardar el lugar. Inténtalo de nuevo.',
  saveNetworkError: 'No se pudo guardar el lugar. Revisa tu conexión e inténtalo de nuevo.',
  emptyTitle: 'Aún no hay lugares',
  emptyDescription: 'Añade Casa, escuela, trabajo o cualquier lugar al que vaya la familia.',
  primarySection: 'Casa',
  otherSection: 'Otros lugares',
  editButton: 'Editar {label}',
  loadToastTitle: 'No se pudieron cargar los lugares',
  saveToastTitle: 'No se pudo guardar el lugar',
  loadErrorTitle: 'No se pudieron cargar los lugares',
  loadErrorDescription: 'No se pudieron cargar los lugares guardados de tu familia.',
  retry: 'Intentar de nuevo',
  refreshing: 'Actualizando…',
  removeTitle: '¿Quitar «{label}»?',
  removeDescription:
    'Esto quitará permanentemente «{label}» de los lugares guardados de la familia.',
  removeFailed: 'No se pudo quitar el lugar. Inténtalo de nuevo.',
  removeNetworkError:
    'No se pudo quitar el lugar. Revisa tu conexión e inténtalo de nuevo.',
  removeClose: 'Cerrar confirmación para quitar el lugar',
  removeButton: 'Quitar {label}',
  removing: 'Quitando…',
}

export const locationsMessages = {
  en: locationsEnglish,
  es: locationsSpanish,
}

export function useLocationsText() {
  const { t: translate } = useTranslation()
  return (key: LocationsMessage, params?: Record<string, string | number>) =>
    translate(key, params, locationsMessages)
}
