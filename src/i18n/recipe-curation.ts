import { useTranslation } from "@/i18n";
const en = {
  organize: "Organize recipe",
  title: "Favorite and collections",
  favorite: "Household favorite",
  help: "These choices are shared with your household. Choose up to eight collections.",
  collections: "Collections",
  all: "All collections",
  manage: "Manage collections",
  newCollection: "New collection",
  name: "Collection name",
  create: "Create collection",
  rename: "Rename",
  remove: "Delete collection",
  removeHelp: "Delete this collection? Its recipes stay in your recipe box.",
  confirmRemove: "Yes, delete collection",
  cancel: "Cancel",
  close: "Close",
  save: "Save choices",
  saving: "Saving…",
  loading: "Loading…",
  refresh: "Refresh current settings",
  retry: "Try again",
  empty: "No collections yet. Create one from your recipe box.",
  missing: "Unavailable collection",
  readError: "Could not load current settings. Your choices are kept.",
  writeError:
    "The result could not be confirmed, or the saved settings changed. Your choices are kept. Refresh current settings and review before saving again.",
  refreshed:
    "Current settings refreshed. Review your draft choices before saving.",
  saved: "Saved to your household recipe box.",
  current: "Your choices already match the current settings.",
  limit: "Choose up to eight collections.",
  missingHelp:
    "Remove unavailable collections from your choices before saving.",
  renameHint:
    "Renaming changes this collection for everyone. Deleting a collection keeps its recipes.",
};
const es: Record<keyof typeof en, string> = {
  organize: "Organizar receta",
  title: "Favorita y colecciones",
  favorite: "Favorita del hogar",
  help: "Estas opciones se comparten con tu hogar. Elige hasta ocho colecciones.",
  collections: "Colecciones",
  all: "Todas las colecciones",
  manage: "Gestionar colecciones",
  newCollection: "Nueva colección",
  name: "Nombre de la colección",
  create: "Crear colección",
  rename: "Cambiar nombre",
  remove: "Eliminar colección",
  removeHelp: "¿Eliminar esta colección? Sus recetas se conservarán.",
  confirmRemove: "Sí, eliminar colección",
  cancel: "Cancelar",
  close: "Cerrar",
  save: "Guardar opciones",
  saving: "Guardando…",
  loading: "Cargando…",
  refresh: "Actualizar opciones actuales",
  retry: "Reintentar",
  empty: "Aún no hay colecciones. Crea una desde tus recetas guardadas.",
  missing: "Colección no disponible",
  readError:
    "No pudimos cargar las opciones actuales. Tus elecciones se conservan.",
  writeError:
    "No pudimos confirmar el resultado o las opciones cambiaron. Tus elecciones se conservan. Actualiza y revisa antes de guardar de nuevo.",
  refreshed:
    "Opciones actuales actualizadas. Revisa tus elecciones antes de guardar.",
  saved: "Guardado en las recetas del hogar.",
  current: "Tus elecciones ya coinciden con las opciones actuales.",
  limit: "Elige hasta ocho colecciones.",
  missingHelp: "Quita las colecciones no disponibles antes de guardar.",
  renameHint:
    "Cambiar el nombre afecta a todos. Eliminar una colección conserva sus recetas.",
};
export function useRecipeCurationText() {
  const { locale } = useTranslation();
  return locale === "es" ? es : en;
}
