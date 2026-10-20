import {
  expiryFeedback as compactExpiryFeedback,
  inventoryDisplayEnglish,
  inventoryDisplaySpanish,
} from "./inventory-display";

/** Owned presentation only. Private names, units, model text and API refusals stay raw. */
export const inventoryEnglish = {
  cookPresenceOnly:
    "Matches identify foods only. Check amounts, units and condition before cooking.",
  cookMatchDetails: "How these foods matched",
  cookMatchLinked: "Saved ingredient link",
  cookMatchName: "Name match only — confirm the food",
  cookMatchUnknown: "Match details unavailable; check the food and amount.",
  cookComparisonIncomplete:
    "Some saved recipes could not be compared. Review their ingredients in Meals.",
  cookReviewGroceries: "Review recipe groceries",

  stockChangeReviewedDetails: "Reviewed changes",
  stockChangeNotRecorded: "Not recorded",
  stockChangePending: "Check the pending food change before starting another.",
  stockChangeUnknown:
    "This change is not confirmed. Check the same request before leaving or changing this food again. Its original details are kept.",
  stockChangeConfirmed:
    "Confirmed the recorded change for {name}. The list shows current stock.",
  stockChangeNotApplied:
    "This check confirmed that the request did not change stock. The list was refreshed; review it before trying again.",
  stockChangeRemoved:
    "The original food change was recorded, then removed. This check did not recreate it.",
  stockChangeRefused:
    "Food change refused. Check your account, household and inventory access.",
  stockChangeContext:
    "Reopen Inventory to confirm your account and household before changing stock.",
  stockChangeRefresh:
    "Refresh Inventory and review this food before changing it.",
  stockChangeSaving: "Checking food change…",
  stockChangeRecovery: "Confirm food change",

  foodPhotoTitle: "Photo food capture",
  foodPhotoMode: "What are you photographing?",
  foodPhotoFridge: "Fridge",
  foodPhotoPackage: "Package / date",
  foodPhotoReceipt: "Receipt",
  foodPhotoPackageIntro:
    "Photograph one food package or its printed date label. Keep the whole date and food name readable. Dates stay blank until you review them.",
  foodPhotoReceiptIntro:
    "Crop the receipt to food lines first. Cover names, addresses, loyalty numbers and payment details. Purchased amounts are suggestions, not a count of what remains at home.",
  foodPhotoRedacted: "I cropped or covered personal and payment details.",
  foodPhotoReview:
    "Review and tick each item you want. Nothing is preselected. Confirm stock amount and storage yourself; receipt dates never become expiry dates.",
  foodPhotoDropped:
    "{count} unreadable, duplicate or excess suggestions were omitted. Check the photo for anything missing.",
  foodPhotoPages: "Photo review pages",
  foodPhotoPrevious: "Previous",
  foodPhotoNext: "Next",
  foodPhotoPage: "Item {page} of {total}",
  foodPhotoDateKind: "Printed date type",
  foodPhotoPrinted: "Printed date suggestion",
  foodPhotoUseDate: "Use {kind}: {date}",
  foodPhotoUnclearDate:
    "The full date or date type is unclear. Read the label and enter it yourself; no year or shelf life was guessed.",

  scanFood: "Scan food",
  productDetails: "Product details",
  productCode: "Product code (GTIN)",
  packageSize: "Label package size",
  packageNotStock:
    "Package size describes the label; stock amount and dates are recorded separately.",
  barcodeAdded: "Confirmed {count} reviewed food items.",
  intakeContextLoading: "Checking your household before capture…",
  intakeContextFailed:
    "We could not check your household. Your suggestions are kept; retry before adding stock.",
  intakeRetryContext: "Check household again",
  intakeUnknown:
    "The item may have been added. Its reviewed values stay locked. Retry to check the same save before closing or scanning another photo.",
  intakeRefused:
    "This item was not confirmed. Review your account, household and item details before trying again.",
  intakeRemoved:
    "The original saved item was removed. Tick this row only if you deliberately want to add it again.",

  ...inventoryDisplayEnglish,
  scanTitle: "Scan the fridge",
  close: "Close",
  scanIntro:
    "Take a photo of your open fridge, freezer or pantry. We'll suggest what's in it, and you choose what to add.",
  scanPrivacy:
    "The photo is sent to our AI provider ({provider}) to read it. It isn't saved by {brand}.",
  pickPhoto: "Take or choose a photo",
  scanning: "Looking for food in your photo…",
  scanUnavailable:
    "Fridge scan isn't available right now. You can still add items by hand.",
  scanForbidden: "You can't scan the fridge. Ask a parent.",
  scanFailed:
    "Something went wrong while scanning. Try again, or add items by hand.",
  scanNetwork:
    "Couldn't reach the scanner. Check your connection and try again.",
  photoLarge: "That photo is too large. The limit is 8 MB.",
  tryPhoto: "Try another photo",
  anotherPhoto: "Scan another photo",
  scanAllAdded: "Everything from this photo was added.",
  scanEmpty: "No food found in that photo.",
  foundOne:
    "Found {count} item. Check them, untick anything that's wrong, then add.",
  foundMany:
    "Found {count} items. Check them, untick anything that's wrong, then add.",
  suggested: "Suggested items",
  adding: "Adding…",
  addOne: "Add {count} item",
  addMany: "Add {count} items",
  photoAddedOne: "Added {count} item from your photo.",
  photoAddedMany: "Added {count} items from your photo.",
  partialOneOne:
    "Added {count} item. {failed} couldn't be added; check it and try again.",
  partialManyOne:
    "Added {count} items. {failed} couldn't be added; check it and try again.",
  partialOneMany:
    "Added {count} item. {failed} couldn't be added; check them and try again.",
  partialManyMany:
    "Added {count} items. {failed} couldn't be added; check them and try again.",
  enterName: "Enter a name.",
  amountInvalid: "Amount must be a number of 0 or more.",
  fixRows: "Fix the highlighted items, then add again.",
  addFailed: "Could not add this item.",
  addNetwork: "Could not add this item. Check your connection.",
  probablyAdded:
    "This item was probably added on an earlier try. Check your inventory before adding it again.",
  likely: "Likely",
  checkConfidence: "Check this",
  unsure: "Unsure",
  includeName: "Add {name}",
  itemNumber: "item {count}",
  name: "Name",
  amount: "Amount",
  unit: "Unit",
  where: "Where",
  use_by: "Use by",
  best_before: "Best before",
  useSoonAllLocations: "Across all locations",
  locations: "Locations",
  locationCountOne: "{count} item",
  locationCountMany: "{count} items",
  locationCountCappedOne: "At least {count} item",
  locationCountCapped: "At least {count} items",
  locationCountIncomplete: "Count incomplete",
  title: "Food inventory",
  subtitle:
    "What's in the fridge, freezer and pantry, as far as the family has noted it.",
  scanFridge: "Scan fridge",
  addItem: "Add item",
  tryAgain: "Try again",
  offlineWrite:
    "You're offline. Connect to the internet to change the inventory.",
  savedOffline:
    "Showing what was loaded at {time}. Changes need a connection; the list refreshes when you're back online.",
  stale:
    "Couldn't refresh. Showing what was loaded at {time}, which may be out of date.",
  loadFailed: "Couldn't load the inventory",
  connectionRetry: "Check your connection and try again.",
  loadOffline: "The inventory loads when you're back online.",
  loading: "Loading inventory",
  nothingTracked: "Nothing tracked yet",
  emptyWriter:
    "Add what is in your fridge, freezer and pantry. Add a best-before or use-by date to see what to use soon.",
  emptyReader:
    "A parent or teen can add what is in the fridge, freezer and pantry.",
  capped: "Showing the first {count} items.",
  noMatches: "No items match your search.",
  clearSearch: "Clear search",
  pastUseBy: "Past use-by",
  pastSafety: "A use-by date is about safety, so these should not be eaten.",
  nothingSoon: "Nothing to use in the next 3 days.",
  throwAway: "Throw away",
  throwAwayName: "Throw away {name}",
  usedIt: "Used it",
  usedName: "Used {name}",
  threwName: "Threw away {name}",
  usedAmount: "Used {amount} of {name}",
  usedNotice: "Used {name}.",
  threwNotice: "Threw away {name}.",
  usedAmountNotice: "Used {amount} of {name}.",
  undoFailed: "Could not put {name} back. Try again.",
  undoNetwork:
    "Could not put {name} back. Check your connection and try again.",
  undoSuccess: "Put {name} back.",
  manualIntakeContextFailed:
    "Could not confirm your account and household. Keep your draft and reopen Add item when connected.",
  manualIntakeInvalid: "Review the name, amount and dates before saving.",
  manualIntakeUnknown:
    "Save not confirmed. Your details are locked. Check the same save before leaving or adding it again.",
  manualIntakeRefused:
    "Save refused. Check your account, household and inventory access. Your draft is kept.",
  manualIntakeRemoved:
    "The original item was saved and then removed. This check did not add it again. Review before starting a new save.",
  intakeRetry: "Check same save",
  saveFailed: "Could not save. Try again.",
  saveNetwork: "Could not save. Check your connection and try again.",
  searchInventory: "Search the inventory",
  searchName: "Search by name",
  everywhere: "Everywhere",
  category: "Category",
  allCategories: "All categories",
  filterCount: "Showing {shown} of {total} items",
  cook: "What can I cook",
  loadingRecipes: "Loading recipe suggestions",
  recipesFailed: "Couldn't load recipe suggestions.",
  recipesEmptyCapped:
    "No match among the recipes and items checked. You have more recipes or items than we can compare at once, so this may be incomplete.",
  recipesEmpty:
    "No saved recipe matches recorded stock yet. Add food, or save recipes in Meals, to see ideas here.",
  recipesIncomplete:
    "You have more recipes or items than we can compare at once, so this list may be incomplete.",
  haveAllOne: "Found {count} of {count} ingredient in inventory",
  haveAllMany: "Found {count} of {count} ingredients in inventory",
  haveSome: "Found {have} of {total} ingredients in inventory",
  cookSoonOne: " · uses {count} item to use soon",
  cookSoonMany: " · uses {count} items to use soon",
  inStock: "Matched foods: ",
  missing: "No match: ",
  viewRecipe: "View recipe",
  addMissing: "Review {count} unmatched for groceries",
  openedDate: "Opened {date}",
  noAmountDate: "No amount or date",
  nothingFridge: "Nothing in the fridge.",
  nothingFreezer: "Nothing in the freezer.",
  nothingPantry: "Nothing in the pantry.",
  matchesFridge: "No matches in the fridge.",
  matchesFreezer: "No matches in the freezer.",
  matchesPantry: "No matches in the pantry.",
  editName: "Edit {name}",
  itemFallback: "item",
  history: "Recently used or thrown away",
  undone: " · Undone",
  undo: "Undo",
  undoHistory: "Undo: {change}",
  savedName: "Saved {name}.",
  addedName: "Added {name}.",
  usedInvalid:
    "How much you used must be a number more than 0, or leave it empty for all of it.",
  removeConfirm:
    'Remove {name} and its history? Use "Used it" or "Throw away" instead if you want to keep a record.',
  removeFailed: "Could not remove. Try again.",
  removedName: "Removed {name}.",
  removeNetwork: "Could not remove. Check your connection and try again.",
  usedOrThrew: "Used it or threw it away?",
  howMuch: "How much did you use? ",
  emptyAll: "(empty = all of it)",
  allAmount: "All {amount}",
  optional: "(optional)",
  unitExample: "e.g. g, L, pack",
  packDate: "Date on the pack",
  useBySafety: "Use by is about safety: do not eat it after this day.",
  bestBeforeQuality:
    "Best before is about quality: it may still be fine after this day.",
  dateLabel: "{kind} date",
  clearDate: "Clear date",
  noCategory: "No category",
  bought: "Bought",
  opened: "Opened",
  keepItem: "Keep item",
  moreDetails: "Category and purchase dates",
  remove: "Remove",
  saving: "Saving…",
  save: "Save",
  produce: "Produce",
  dairy_eggs: "Dairy & eggs",
  meat_fish: "Meat & fish",
  bakery: "Bakery",
  leftovers: "Leftovers",
  dry_goods: "Dry goods",
  snacks_drinks: "Snacks & drinks",
  condiments: "Sauces & condiments",
  other: "Other",
} as const;
export type InventoryMessage = keyof typeof inventoryEnglish;
export const inventorySpanish: Record<InventoryMessage, string> = {
  cookPresenceOnly:
    "Las coincidencias solo identifican alimentos. Revisa cantidades, unidades y estado antes de cocinar.",
  cookMatchDetails: "Cómo se identificaron estos alimentos",
  cookMatchLinked: "Ingrediente vinculado",
  cookMatchName: "Solo coincide el nombre; confirma el alimento",
  cookMatchUnknown:
    "No hay detalles de la coincidencia; revisa el alimento y la cantidad.",
  cookComparisonIncomplete:
    "No se pudieron comparar algunas recetas guardadas. Revisa sus ingredientes en Comidas.",
  cookReviewGroceries: "Revisar compras de la receta",

  stockChangeReviewedDetails: "Cambios revisados",
  stockChangeNotRecorded: "Sin registrar",
  stockChangePending: "Comprueba el cambio pendiente antes de iniciar otro.",
  stockChangeUnknown:
    "Este cambio no está confirmado. Comprueba la misma solicitud antes de salir o volver a cambiar el alimento. Se conservan los datos originales.",
  stockChangeConfirmed:
    "Se confirmó el cambio registrado de {name}. La lista muestra las existencias actuales.",
  stockChangeNotApplied:
    "Esta comprobación confirmó que la solicitud no cambió las existencias. Se actualizó la lista; revísala antes de otro intento.",
  stockChangeRemoved:
    "El cambio original se registró y luego se eliminó. Esta comprobación no lo volvió a crear.",
  stockChangeRefused:
    "Cambio rechazado. Revisa tu cuenta, hogar y acceso al inventario.",
  stockChangeContext:
    "Vuelve a abrir Inventario para confirmar tu cuenta y hogar antes de cambiar existencias.",
  stockChangeRefresh:
    "Actualiza Inventario y revisa este alimento antes de cambiarlo.",
  stockChangeSaving: "Comprobando cambio de alimento…",
  stockChangeRecovery: "Confirmar cambio de alimento",

  foodPhotoTitle: "Capturar alimentos con foto",
  foodPhotoMode: "¿Qué vas a fotografiar?",
  foodPhotoFridge: "Refrigerador",
  foodPhotoPackage: "Envase / fecha",
  foodPhotoReceipt: "Recibo",
  foodPhotoPackageIntro:
    "Fotografía un envase o su etiqueta de fecha. El nombre y la fecha completa deben ser legibles. Las fechas quedan vacías hasta que las revises.",
  foodPhotoReceiptIntro:
    "Recorta primero el recibo a las líneas de alimentos. Cubre nombres, direcciones, números de fidelidad y datos de pago. Las cantidades compradas son sugerencias, no lo que queda en casa.",
  foodPhotoRedacted: "Recorté o cubrí los datos personales y de pago.",
  foodPhotoReview:
    "Revisa y marca cada alimento que quieras. Ninguno está preseleccionado. Confirma cantidad y lugar; las fechas del recibo nunca se usan como caducidad.",
  foodPhotoDropped:
    "Se omitieron {count} sugerencias ilegibles, repetidas o de más. Revisa si falta algo de la foto.",
  foodPhotoPages: "Páginas de revisión de fotos",
  foodPhotoPrevious: "Anterior",
  foodPhotoNext: "Siguiente",
  foodPhotoPage: "Alimento {page} de {total}",
  foodPhotoDateKind: "Tipo de fecha impresa",
  foodPhotoPrinted: "Sugerencia de fecha impresa",
  foodPhotoUseDate: "Usar {kind}: {date}",
  foodPhotoUnclearDate:
    "La fecha completa o su tipo no está claro. Lee la etiqueta e introdúcela; no se estimó el año ni la vida útil.",

  scanFood: "Escanear alimentos",
  productDetails: "Datos del producto",
  productCode: "Código del producto (GTIN)",
  packageSize: "Tamaño en la etiqueta",
  packageNotStock:
    "El tamaño describe la etiqueta; la cantidad disponible y las fechas se registran por separado.",
  barcodeAdded: "Se confirmaron {count} alimentos revisados.",
  intakeContextLoading: "Comprobando tu hogar antes de capturar…",
  intakeContextFailed:
    "No pudimos comprobar tu hogar. Se conservan las sugerencias; reintenta antes de añadir existencias.",
  intakeRetryContext: "Comprobar hogar otra vez",
  intakeUnknown:
    "El alimento puede haberse añadido. Los valores revisados quedan bloqueados. Reintenta el mismo guardado antes de cerrar o escanear otra foto.",
  intakeRefused:
    "No se confirmó este alimento. Revisa tu cuenta, hogar y los datos antes de reintentar.",
  intakeRemoved:
    "Se eliminó el alimento guardado original. Márcalo solo si quieres añadirlo de nuevo expresamente.",

  ...inventoryDisplaySpanish,
  scanTitle: "Escanear el refrigerador",
  close: "Cerrar",
  scanIntro:
    "Toma una foto del refrigerador, congelador o despensa abiertos. Sugeriremos qué hay y tú eliges qué añadir.",
  scanPrivacy:
    "La foto se envía a nuestro proveedor de IA ({provider}) para leerla. {brand} no la guarda.",
  pickPhoto: "Tomar o elegir una foto",
  scanning: "Buscando alimentos en tu foto…",
  scanUnavailable:
    "El escaneo no está disponible ahora. Puedes añadir los alimentos a mano.",
  scanForbidden:
    "No puedes escanear el refrigerador. Pídele ayuda a un adulto.",
  scanFailed:
    "Algo salió mal al escanear. Inténtalo de nuevo o añade los alimentos a mano.",
  scanNetwork:
    "No pudimos contactar con el escáner. Revisa tu conexión e inténtalo de nuevo.",
  photoLarge: "Esa foto es demasiado grande. El límite es de 8 MB.",
  tryPhoto: "Probar otra foto",
  anotherPhoto: "Escanear otra foto",
  scanAllAdded: "Se añadieron todos los alimentos de esta foto.",
  scanEmpty: "No se encontraron alimentos en esa foto.",
  foundOne:
    "Se encontró {count} alimento. Revísalos, desmarca lo que esté mal y añádelos.",
  foundMany:
    "Se encontraron {count} alimentos. Revísalos, desmarca lo que esté mal y añádelos.",
  suggested: "Alimentos sugeridos",
  adding: "Añadiendo…",
  addOne: "Añadir {count} alimento",
  addMany: "Añadir {count} alimentos",
  photoAddedOne: "Se añadió {count} alimento de tu foto.",
  photoAddedMany: "Se añadieron {count} alimentos de tu foto.",
  partialOneOne:
    "Se añadió {count} alimento. No se pudo añadir {failed}; revísalo e inténtalo de nuevo.",
  partialManyOne:
    "Se añadieron {count} alimentos. No se pudo añadir {failed}; revísalo e inténtalo de nuevo.",
  partialOneMany:
    "Se añadió {count} alimento. No se pudieron añadir {failed}; revísalos e inténtalo de nuevo.",
  partialManyMany:
    "Se añadieron {count} alimentos. No se pudieron añadir {failed}; revísalos e inténtalo de nuevo.",
  enterName: "Escribe un nombre.",
  amountInvalid: "La cantidad debe ser un número igual o mayor que 0.",
  fixRows: "Corrige los alimentos marcados y vuelve a añadirlos.",
  addFailed: "No pudimos añadir este alimento.",
  addNetwork: "No pudimos añadir este alimento. Revisa tu conexión.",
  probablyAdded:
    "Probablemente se añadió este alimento en un intento anterior. Revisa tu inventario antes de añadirlo otra vez.",
  likely: "Probable",
  checkConfidence: "Revisar",
  unsure: "Dudoso",
  includeName: "Añadir {name}",
  itemNumber: "alimento {count}",
  name: "Nombre",
  amount: "Cantidad",
  unit: "Unidad",
  where: "Dónde",
  use_by: "Consumir hasta",
  best_before: "Consumo preferente",
  useSoonAllLocations: "En todas las ubicaciones",
  locations: "Ubicaciones",
  locationCountOne: "{count} alimento",
  locationCountMany: "{count} alimentos",
  locationCountCappedOne: "Al menos {count} alimento",
  locationCountCapped: "Al menos {count} alimentos",
  locationCountIncomplete: "Recuento incompleto",
  title: "Inventario de alimentos",
  subtitle:
    "Lo que hay en el refrigerador, congelador y despensa, según lo que ha anotado la familia.",
  scanFridge: "Escanear refrigerador",
  addItem: "Añadir alimento",
  tryAgain: "Intentar de nuevo",
  offlineWrite:
    "No tienes conexión. Conéctate a internet para cambiar el inventario.",
  savedOffline:
    "Se muestra lo que se cargó a las {time}. Los cambios necesitan conexión; la lista se actualiza cuando vuelves a conectarte.",
  stale:
    "No pudimos actualizar. Se muestra lo que se cargó a las {time}, que puede estar desactualizado.",
  loadFailed: "No pudimos cargar el inventario",
  connectionRetry: "Revisa tu conexión e inténtalo de nuevo.",
  loadOffline: "El inventario se carga cuando vuelves a conectarte.",
  loading: "Cargando inventario",
  nothingTracked: "Aún no hay alimentos registrados",
  emptyWriter:
    "Añade lo que hay en tu refrigerador, congelador y despensa. Añade una fecha de consumo preferente o caducidad para ver qué usar pronto.",
  emptyReader:
    "Un adulto o adolescente puede añadir lo que hay en el refrigerador, congelador y despensa.",
  capped: "Se muestran los primeros {count} alimentos.",
  noMatches: "Ningún alimento coincide con tu búsqueda.",
  clearSearch: "Borrar búsqueda",
  pastUseBy: "Fecha de caducidad pasada",
  pastSafety:
    "La fecha de caducidad indica seguridad, así que estos alimentos no deben comerse.",
  nothingSoon: "No hay nada que usar en los próximos 3 días.",
  throwAway: "Tirar",
  throwAwayName: "Tirar {name}",
  usedIt: "Lo usé",
  usedName: "Usaste {name}",
  threwName: "Tiraste {name}",
  usedAmount: "Usaste {amount} de {name}",
  usedNotice: "Usaste {name}.",
  threwNotice: "Tiraste {name}.",
  usedAmountNotice: "Usaste {amount} de {name}.",
  undoFailed: "No pudimos reponer {name}. Inténtalo de nuevo.",
  undoNetwork:
    "No pudimos reponer {name}. Revisa tu conexión e inténtalo de nuevo.",
  undoSuccess: "Se repuso {name}.",
  manualIntakeContextFailed:
    "No pudimos confirmar tu cuenta y hogar. Conserva el borrador y vuelve a abrir Añadir alimento cuando tengas conexión.",
  manualIntakeInvalid:
    "Revisa el nombre, la cantidad y las fechas antes de guardar.",
  manualIntakeUnknown:
    "Guardado sin confirmar. Tus datos están bloqueados. Comprueba el mismo guardado antes de salir o volver a añadirlo.",
  manualIntakeRefused:
    "Guardado rechazado. Revisa tu cuenta, hogar y acceso al inventario. Se conserva el borrador.",
  manualIntakeRemoved:
    "El alimento original se guardó y luego se eliminó. Esta comprobación no lo añadió de nuevo. Revisa antes de otro guardado.",
  intakeRetry: "Comprobar mismo guardado",
  saveFailed: "No pudimos guardar. Inténtalo de nuevo.",
  saveNetwork: "No pudimos guardar. Revisa tu conexión e inténtalo de nuevo.",
  searchInventory: "Buscar en el inventario",
  searchName: "Buscar por nombre",
  everywhere: "Todos los lugares",
  category: "Categoría",
  allCategories: "Todas las categorías",
  filterCount: "Se muestran {shown} de {total} alimentos",
  cook: "Qué puedo cocinar",
  loadingRecipes: "Cargando sugerencias de recetas",
  recipesFailed: "No pudimos cargar las sugerencias de recetas.",
  recipesEmptyCapped:
    "No hay coincidencias entre las recetas y alimentos revisados. Tienes más recetas o alimentos de los que podemos comparar a la vez, así que esto puede estar incompleto.",
  recipesEmpty:
    "Aún no hay una receta guardada que use lo que tienes. Añade alimentos o guarda recetas en Comidas para ver ideas aquí.",
  recipesIncomplete:
    "Tienes más recetas o alimentos de los que podemos comparar a la vez, así que esta lista puede estar incompleta.",
  haveAllOne: "Se encontró {count} de {count} ingrediente en el inventario",
  haveAllMany:
    "Se encontraron {count} de {count} ingredientes en el inventario",
  haveSome: "Se encontraron {have} de {total} ingredientes en el inventario",
  cookSoonOne: " · usa {count} alimento que hay que usar pronto",
  cookSoonMany: " · usa {count} alimentos que hay que usar pronto",
  inStock: "Alimentos identificados: ",
  missing: "Sin coincidencia: ",
  viewRecipe: "Ver receta",
  addMissing: "Revisar {count} sin coincidencia para la compra",
  openedDate: "Abierto el {date}",
  noAmountDate: "Sin cantidad ni fecha",
  nothingFridge: "No hay nada en el refrigerador.",
  nothingFreezer: "No hay nada en el congelador.",
  nothingPantry: "No hay nada en la despensa.",
  matchesFridge: "No hay coincidencias en el refrigerador.",
  matchesFreezer: "No hay coincidencias en el congelador.",
  matchesPantry: "No hay coincidencias en la despensa.",
  editName: "Editar {name}",
  itemFallback: "alimento",
  history: "Usados o tirados recientemente",
  undone: " · Deshecho",
  undo: "Deshacer",
  undoHistory: "Deshacer: {change}",
  savedName: "Se guardó {name}.",
  addedName: "Se añadió {name}.",
  usedInvalid:
    "La cantidad usada debe ser un número mayor que 0, o déjala vacía si lo usaste todo.",
  removeConfirm:
    '¿Eliminar {name} y su historial? Usa "Lo usé" o "Tirar" si quieres conservar un registro.',
  removeFailed: "No pudimos eliminarlo. Inténtalo de nuevo.",
  removedName: "Se eliminó {name}.",
  removeNetwork:
    "No pudimos eliminarlo. Revisa tu conexión e inténtalo de nuevo.",
  usedOrThrew: "¿Lo usaste o lo tiraste?",
  howMuch: "¿Cuánto usaste? ",
  emptyAll: "(vacío = todo)",
  allAmount: "Todo: {amount}",
  optional: "(opcional)",
  unitExample: "p. ej., g, L, paquete",
  packDate: "Fecha del envase",
  useBySafety: "La caducidad indica seguridad: no lo comas después de ese día.",
  bestBeforeQuality:
    "El consumo preferente indica calidad: puede seguir estando bien después de ese día.",
  dateLabel: "Fecha de {kind}",
  clearDate: "Borrar fecha",
  noCategory: "Sin categoría",
  bought: "Comprado",
  opened: "Abierto",
  keepItem: "Conservar alimento",
  moreDetails: "Categoría y fechas de compra",
  remove: "Eliminar",
  saving: "Guardando…",
  save: "Guardar",
  produce: "Frutas y verduras",
  dairy_eggs: "Lácteos y huevos",
  meat_fish: "Carne y pescado",
  bakery: "Panadería",
  leftovers: "Sobras",
  dry_goods: "Alimentos secos",
  snacks_drinks: "Aperitivos y bebidas",
  condiments: "Salsas y condimentos",
  other: "Otros",
};
export const inventoryMessages = { en: inventoryEnglish, es: inventorySpanish };
export type InventoryFeedback =
  | { raw: string }
  | { key: InventoryMessage; params?: Record<string, string | number> };
export function inventoryFeedback(
  key: InventoryMessage,
  params?: Record<string, string | number>,
): InventoryFeedback {
  return { key, ...(params ? { params } : {}) };
}
/** Legacy exported scan callback remains an English string, interpolated once. */
export function inventoryFeedbackEnglish(feedback: InventoryFeedback): string {
  return "raw" in feedback
    ? feedback.raw
    : inventoryEnglish[feedback.key].replace(/\{(\w+)\}/g, (_, part) =>
        String(feedback.params?.[part] ?? `{${part}}`),
      );
}
export function photoAddedFeedback(count: number): InventoryFeedback {
  return inventoryFeedback(count === 1 ? "photoAddedOne" : "photoAddedMany", {
    count,
  });
}
export function partialScanFeedback(
  count: number,
  failed: number,
): InventoryFeedback {
  return inventoryFeedback(
    count === 1
      ? failed === 1
        ? "partialOneOne"
        : "partialOneMany"
      : failed === 1
        ? "partialManyOne"
        : "partialManyMany",
    { count, failed },
  );
}

/** Translate the canonical helper's returned identity; unknown future values remain raw. */
export function expiryFeedback(text: string): InventoryFeedback {
  return compactExpiryFeedback(text);
}
