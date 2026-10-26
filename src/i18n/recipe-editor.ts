import { useCallback } from "react";
import { useTranslation } from "@/i18n";

/** Recipe-editor controls and recovery copy. Recipe content stays verbatim. */
export const recipeEditorEnglish = {
  requestTooLarge: "This recipe request is too large. Shorten the text and try again. Your draft is still here.",
  draftRecoveryUnavailable:
    "Saved-work recovery is not enabled here. Saved stores have not been checked. Return to Meals or try again later.",
  draftReviewTitle: "Saved recipe work",
  draftReviewHint:
    "Continue a recipe saved on this device, or check the outcome of an earlier save. Opening this screen does not import or submit anything.",
  draftReviewClosed:
    "No saved recipe work was found for this session on this device. Check your recipe box before starting another save.",
  draftPaused:
    "Draft saving is paused. You can review or close saved work; new changes stay unavailable.",
  draftExpired:
    "This draft or save has passed its retry window. It is kept for review; discard only an unsubmitted draft to start again.",
  draftChecking: "Checking saved work…",
  draftOwnerChanged:
    "Your account or household changed. Reload before opening saved drafts.",
  draftStorageHold:
    "Saved work could not be verified. Keep this screen open and recover storage before continuing.",
  draftFound:
    "An unfinished recipe is saved on this device. Restore it to replace this editor, or discard it to use the current import.",
  draftRestore: "Restore saved draft",
  draftDiscard: "Discard draft",
  draftDiscardConfirm:
    "Discard this saved recipe draft and any unsaved edits? This cannot be undone.",
  draftSaving: "Saving draft on this device…",
  draftSaved: "Draft saved on this device.",
  draftSubmitted:
    "This exact save is kept on this device. Check its result or retry the same save; it will keep the original request key.",
  draftInspect: "Check save status",
  draftFinish: "Finish this review",
  draftCloseKeep: "Close and keep saved work",
  draftRecipeBox: "Open recipe box",
  draftRecover: "Recover saved work",
  draftCommitted: "The recipe was saved and is still in your recipe box.",
  draftRemoved:
    "The recipe was saved, then removed. Retrying will not recreate it. This review is kept.",
  draftOpaque:
    "The save completed, but its current recipe could not be verified. This review is kept.",
  draftAbsent:
    "No receipt is currently available. You may check the same save again within its retry window.",
  draftPending:
    "The original save is still being processed. Check again later.",
  draftRefused:
    "Access or the request could not be verified. This saved request stays locked.",
  draftSourceRefused:
    "This source is already saved. Open the saved recipe, or return to the draft after checking that this attempt created nothing.",
  draftReturn: "Return to editable draft",

  sourceLink: "Original source ↗",
  sourceCopy: "Save a separate copy of this source",
  sourceExists:
    "This source is already saved. Open it to view or edit, or choose a separate copy.",
  openExisting: "Open saved recipe: {title}",
  sourceCheckUnavailable:
    "We could not finish checking older imports. Keep this draft; check your recipe box, or deliberately choose a separate copy.",
  revisionConflict:
    "This recipe changed elsewhere. Your edits are kept here. Close and reload the saved recipe before applying them again.",
  uncertainCreate:
    "The recipe may have been saved. Check its original status without sending it again. These fields stay locked; closing keeps the server result unchanged.",
  retryCreate: "Retry original save",
  inspectCreate: "Check original save",
  moreRecovery: "More recovery options",
  openRecipeBox: "Open recipe box",
  receiptPresent: "Your original save is confirmed. Open your recipe box to find it.",
  receiptRemoved: "Your original save committed, but its recipe is no longer available here.",
  receiptUnknown: "A save was recorded, but the original recipe cannot be confirmed. Keep this request.",
  receiptAbsent: "No matching receipt was found. This does not confirm whether the recipe saved; your original request stays locked.",
  receiptPending: "The original save is still being confirmed. Check again in a moment.",
  receiptExpired: "The receipt has expired. Check your recipe box; do not repeat this old request as a new save.",
  receiptRefused: "This check could not confirm the original save. Your request stays locked.",
  receiptUnavailable: "Could not check the original save. Your request is kept; try checking again.",
  expiredCreate:
    "This save is too old to retry safely. Close and check your recipe box before making a separate new recipe.",
  contentTooLong:
    "Keep the title within 200 characters, description within 2,000 and method within 20,000. Edit the imported text; nothing has been saved or removed.",
  newRecipe: "New recipe",
  recipeDetails: "Recipe details",
  recipeName: "Recipe name",
  baseServings: "Base servings",
  servingsHint:
    "The ingredient amounts below make this many servings (1–100). Review portions again when adding groceries.",
  description: "Description",
  method: "Method",
  prepMinutes: "Prep (min)",
  cookMinutes: "Cook (min)",
  ingredientsOptional: "Ingredients (optional)",
  ingredientsOrderHint:
    "Saved ingredients are displayed by name. Line entry order is not saved.",
  ingredientGroup: "Ingredient {number}",
  amount: "Amount",
  unit: "Unit",
  ingredient: "Ingredient",
  ingredientNote: "Ingredient note",
  removeIngredient: "Remove ingredient {number}",
  addIngredient: "Add ingredient",
  cancel: "Cancel",
  saving: "Saving…",
  saveRecipe: "Save recipe",
  emptyTitle: "Give the recipe a name.",
  invalidServings: "Base servings must be a whole number from 1 to 100.",
  invalidTimes: "Times must be whole minutes, up to 1440.",
  existingIngredientName:
    "Keep an ingredient name, or use Remove ingredient to remove the line.",
  invalidAmount: "Amount for “{name}” must be a number from 0 to 100000.",
  tooManyIngredients: "A recipe can have at most 100 ingredients.",
  uncertain:
    "The recipe may have been saved, but we couldn’t confirm it. Close this editor and reload recipes to check before creating or saving again.",
  rejected: "The recipe was not accepted. Check your entries and permissions.",
} as const;

export type RecipeEditorMessage = keyof typeof recipeEditorEnglish;

export const recipeEditorSpanish: Record<RecipeEditorMessage, string> = {
  requestTooLarge: "La solicitud de receta es demasiado grande. Acorta el texto y vuelve a intentarlo. Tu borrador sigue aquí.",
  draftRecoveryUnavailable:
    "La recuperación no está habilitada aquí. No se han consultado los almacenes guardados. Vuelve a Comidas o inténtalo más tarde.",
  draftReviewTitle: "Trabajo de recetas guardado",
  draftReviewHint:
    "Continúa una receta guardada en este dispositivo o comprueba un guardado anterior. Abrir esta pantalla no importa ni envía nada.",
  draftReviewClosed:
    "No se encontró trabajo de recetas para esta sesión en este dispositivo. Revisa tus recetas antes de iniciar otro guardado.",
  draftPaused:
    "Los borradores están en pausa. Puedes revisar o cerrar el trabajo guardado; los nuevos cambios no están disponibles.",
  draftExpired:
    "Este borrador o guardado ha superado el plazo. Se conserva para revisión; descarta solo un borrador sin enviar para empezar de nuevo.",
  draftChecking: "Comprobando el trabajo guardado…",
  draftOwnerChanged:
    "Tu cuenta o tu hogar ha cambiado. Recarga antes de abrir los borradores guardados.",
  draftStorageHold:
    "No se pudo verificar el trabajo guardado. Mantén esta pantalla abierta y recupera el almacenamiento antes de continuar.",
  draftFound:
    "Hay una receta sin terminar guardada en este dispositivo. Restáurala para reemplazar este editor o descártala para usar la importación actual.",
  draftRestore: "Restaurar borrador guardado",
  draftDiscard: "Descartar borrador",
  draftDiscardConfirm:
    "¿Descartar este borrador y los cambios sin guardar? No se puede deshacer.",
  draftSaving: "Guardando el borrador en este dispositivo…",
  draftSaved: "Borrador guardado en este dispositivo.",
  draftSubmitted:
    "Este guardado exacto se conserva en este dispositivo. Comprueba el resultado o repite el mismo guardado; mantendrá la clave de solicitud original.",
  draftInspect: "Comprobar estado del guardado",
  draftFinish: "Finalizar esta revisión",
  draftCloseKeep: "Cerrar y conservar el trabajo",
  draftRecipeBox: "Abrir recetas guardadas",
  draftRecover: "Recuperar trabajo guardado",
  draftCommitted: "La receta se guardó y sigue en tus recetas.",
  draftRemoved:
    "La receta se guardó y después se eliminó. Repetir no la volverá a crear. Se conserva esta revisión.",
  draftOpaque:
    "El guardado terminó, pero no se pudo verificar la receta actual. Se conserva esta revisión.",
  draftAbsent:
    "No hay un comprobante disponible ahora. Puedes comprobar el mismo guardado dentro del plazo para reintentar.",
  draftPending:
    "El guardado original sigue en proceso. Vuelve a comprobarlo más tarde.",
  draftRefused:
    "No se pudo verificar el acceso o la solicitud. La solicitud guardada sigue bloqueada.",
  draftSourceRefused:
    "Esta fuente ya está guardada. Abre la receta existente o vuelve al borrador tras comprobar que este intento no creó nada.",
  draftReturn: "Volver al borrador editable",

  sourceLink: "Fuente original ↗",
  sourceCopy: "Guardar una copia separada de esta fuente",
  sourceExists:
    "Esta fuente ya está guardada. Ábrela para ver o editar, o elige una copia separada.",
  openExisting: "Abrir receta guardada: {title}",
  sourceCheckUnavailable:
    "No pudimos terminar de comprobar las importaciones antiguas. Conserva el borrador y revisa tus recetas, o elige una copia separada.",
  revisionConflict:
    "La receta cambió en otro lugar. Tus cambios se conservan aquí. Cierra y vuelve a cargar la receta antes de aplicarlos de nuevo.",
  uncertainCreate:
    "La receta puede haberse guardado. Comprueba su estado original sin enviarla de nuevo. Los campos siguen bloqueados; cerrar no cambia el resultado del servidor.",
  retryCreate: "Reintentar guardado original",
  inspectCreate: "Comprobar guardado original",
  moreRecovery: "Más opciones de recuperación",
  openRecipeBox: "Abrir recetas guardadas",
  receiptPresent: "El guardado original está confirmado. Búscalo en tus recetas guardadas.",
  receiptRemoved: "El guardado original se completó, pero la receta ya no está disponible aquí.",
  receiptUnknown: "Se registró un guardado, pero no se puede confirmar la receta original. Conserva esta solicitud.",
  receiptAbsent: "No se encontró el comprobante. Esto no confirma si se guardó la receta; la solicitud original sigue bloqueada.",
  receiptPending: "El guardado original aún se está confirmando. Vuelve a comprobarlo en un momento.",
  receiptExpired: "El comprobante caducó. Revisa tus recetas; no repitas esta solicitud antigua como un guardado nuevo.",
  receiptRefused: "No se pudo confirmar el guardado original. La solicitud sigue bloqueada.",
  receiptUnavailable: "No se pudo comprobar el guardado original. La solicitud se conserva; vuelve a comprobarlo.",
  expiredCreate:
    "Este guardado es demasiado antiguo para repetirlo con seguridad. Cierra y revisa las recetas guardadas antes de crear otra receta.",
  contentTooLong:
    "El título admite 200 caracteres; la descripción, 2.000; y los pasos, 20.000. Edita el texto importado; no se ha guardado ni eliminado nada.",
  newRecipe: "Nueva receta",
  recipeDetails: "Detalles de la receta",
  recipeName: "Nombre de la receta",
  baseServings: "Porciones base",
  servingsHint:
    "Las cantidades corresponden a estas porciones (1–100). Revisa las porciones al añadir a la compra.",
  description: "Descripción",
  method: "Preparación",
  prepMinutes: "Preparación (min)",
  cookMinutes: "Cocción (min)",
  ingredientsOptional: "Ingredientes (opcional)",
  ingredientsOrderHint:
    "Los ingredientes guardados se muestran por nombre. El orden de las líneas no se guarda.",
  ingredientGroup: "Ingrediente {number}",
  amount: "Cantidad",
  unit: "Unidad",
  ingredient: "Ingrediente",
  ingredientNote: "Nota del ingrediente",
  removeIngredient: "Quitar ingrediente {number}",
  addIngredient: "Añadir ingrediente",
  cancel: "Cancelar",
  saving: "Guardando…",
  saveRecipe: "Guardar receta",
  emptyTitle: "Escribe un nombre para la receta.",
  invalidServings:
    "Las porciones base deben ser un número entero del 1 al 100.",
  invalidTimes: "Los tiempos deben ser minutos enteros, hasta 1440.",
  existingIngredientName:
    "Escribe el nombre de un ingrediente o usa Quitar ingrediente para eliminar la línea.",
  invalidAmount: "La cantidad de «{name}» debe ser un número del 0 al 100000.",
  tooManyIngredients: "Una receta puede tener como máximo 100 ingredientes.",
  uncertain:
    "Es posible que la receta se haya guardado, pero no pudimos confirmarlo. Cierra este editor y vuelve a cargar las recetas antes de crear o guardar otra vez.",
  rejected: "No se aceptó la receta. Revisa los datos y tus permisos.",
};

export const recipeEditorMessages = {
  en: recipeEditorEnglish,
  es: recipeEditorSpanish,
};

export function useRecipeEditorText() {
  const { t: translate } = useTranslation();
  return useCallback(
    (key: RecipeEditorMessage, params?: Record<string, string | number>) =>
      translate(key, params, recipeEditorMessages),
    [translate],
  );
}
