import { useCallback } from "react";
import { useTranslation } from "@/i18n";

/** Explore-page controls and safe recovery copy. Recipe/source content stays verbatim. */
export const recipeExploreEnglish = {
  favoritesOnly: "Household favorites",
  reviewCopy: "Review a separate copy",
  searchSaved: "Search saved recipes",
  clearSavedFilters: "Clear filters",
  savedFilters: "More filters",
  ingredientFilter: "Contains ingredient",
  maxPrepFilter: "Prep at most (minutes)",
  servingsFilter: "Serves at least",
  savedFiltersHint:
    "Searches your whole household recipe box. Ingredient matching uses reviewed ingredient rows; unknown prep times are excluded when a prep limit is set.",
  backToMeals: "← Meals",
  title: "Explore recipes",
  subtitle:
    "Find something to cook. Keep your favourites in your household recipe box.",
  findOnline: "Find online",
  searchPrompt: "What would you like to cook?",
  searchPlaceholder: "Chicken, pasta, quick dinners…",
  source: "Source",
  searching: "Searching…",
  searchRecipes: "Search recipes",
  searchFailed: "We couldn’t search that source. Try again.",
  searchNetworkError:
    "We couldn’t reach the recipe search. Check your connection and try again.",
  noSearchResults:
    "No recipe links were available here. Try the source search below.",
  readRecipe: "Read recipe",
  openOriginal: "Open original ↗",
  showMore: "Show more recipes",
  searchSource: "Search {source} ↗",
  directSearchHint:
    "You can also search directly on these sites. Copy any recipe link below to read and save it here.",
  saveFromLink: "Save from a link",
  recipeLink: "Recipe link",
  recipeLinkPlaceholder: "https://…",
  reading: "Reading…",
  invalidLink: "Paste a public HTTPS recipe link.",
  readFailed: "We couldn’t read that recipe. Check the link and try again.",
  readNetworkError:
    "We couldn’t reach that recipe. Check your connection and try again.",
  recipeBox: "Your recipe box",
  libraryLoading: "Loading recipes…",
  libraryError: "We couldn’t load saved recipes. Try again.",
  noSavedSearch: "No saved recipes match this search.",
  noSaved: "Save a recipe from a link, or add one while planning a meal.",
  readyToUse: "Ready to use when adding a meal",
  tryAgain: "Try again",
  loadMore: "Load more recipes",
  closeRecipe: "Close recipe",
  reviewBeforeSaving:
    "Review before saving. Original ingredient quantities are kept in the directions; add ingredient rows below to use the grocery tools.",
  openSavedRecipe: "Open saved recipe",
  reviewAndSave: "Review and save",
  recipeReader: "Recipe reader",
  viewOriginalHere: "View original here",
  sourceLabel: "Source: {host}",
  embeddedNotice:
    "Some sites block embedded viewing. Use Open original if the page is blank.",
  ingredients: "Ingredients",
  directions: "Directions",
  directionsUnavailable:
    "Directions were not available. Open the original recipe.",
  originalRecipeFrame: "Original recipe: {title}",
} as const;

export type RecipeExploreMessage = keyof typeof recipeExploreEnglish;

export const recipeExploreSpanish: Record<RecipeExploreMessage, string> = {
  favoritesOnly: "Favoritas del hogar",
  reviewCopy: "Revisar una copia separada",
  searchSaved: "Buscar recetas guardadas",
  clearSavedFilters: "Borrar filtros",
  savedFilters: "Más filtros",
  ingredientFilter: "Contiene ingrediente",
  maxPrepFilter: "Preparación máxima (minutos)",
  servingsFilter: "Porciones mínimas",
  savedFiltersHint:
    "Busca en todas las recetas del hogar. Los ingredientes se comparan con filas revisadas; los tiempos desconocidos se excluyen al establecer un límite.",
  backToMeals: "← Comidas",
  title: "Explorar recetas",
  subtitle:
    "Encuentra algo para cocinar. Guarda tus favoritas en la caja de recetas de tu familia.",
  findOnline: "Buscar en línea",
  searchPrompt: "¿Qué te gustaría cocinar?",
  searchPlaceholder: "Pollo, pasta, cenas rápidas…",
  source: "Fuente",
  searching: "Buscando…",
  searchRecipes: "Buscar recetas",
  searchFailed: "No se pudo buscar en esa fuente. Inténtalo de nuevo.",
  searchNetworkError:
    "No se pudo conectar con la búsqueda de recetas. Revisa tu conexión e inténtalo de nuevo.",
  noSearchResults:
    "No hay enlaces de recetas disponibles aquí. Prueba la búsqueda de la fuente.",
  readRecipe: "Leer receta",
  openOriginal: "Abrir original ↗",
  showMore: "Mostrar más recetas",
  searchSource: "Buscar en {source} ↗",
  directSearchHint:
    "También puedes buscar directamente en estos sitios. Copia aquí el enlace de cualquier receta para leerla y guardarla.",
  saveFromLink: "Guardar desde un enlace",
  recipeLink: "Enlace de receta",
  recipeLinkPlaceholder: "https://…",
  reading: "Leyendo…",
  invalidLink: "Pega un enlace público de receta HTTPS.",
  readFailed:
    "No se pudo leer esa receta. Revisa el enlace e inténtalo de nuevo.",
  readNetworkError:
    "No se pudo conectar con esa receta. Revisa tu conexión e inténtalo de nuevo.",
  recipeBox: "Tu caja de recetas",
  libraryLoading: "Cargando recetas…",
  libraryError:
    "No se pudieron cargar las recetas guardadas. Inténtalo de nuevo.",
  noSavedSearch: "Ninguna receta guardada coincide con esta búsqueda.",
  noSaved:
    "Guarda una receta desde un enlace o agrega una mientras planificas una comida.",
  readyToUse: "Lista para usar al agregar una comida",
  tryAgain: "Intentar de nuevo",
  loadMore: "Cargar más recetas",
  closeRecipe: "Cerrar receta",
  reviewBeforeSaving:
    "Revísala antes de guardarla. Las cantidades originales se conservan en las instrucciones; agrega filas de ingredientes para usar las herramientas de compras.",
  openSavedRecipe: "Abrir receta guardada",
  reviewAndSave: "Revisar y guardar",
  recipeReader: "Lector de recetas",
  viewOriginalHere: "Ver original aquí",
  sourceLabel: "Fuente: {host}",
  embeddedNotice:
    "Algunos sitios bloquean la vista integrada. Usa Abrir original si la página aparece en blanco.",
  ingredients: "Ingredientes",
  directions: "Instrucciones",
  directionsUnavailable:
    "No hay instrucciones disponibles. Abre la receta original.",
  originalRecipeFrame: "Receta original: {title}",
};

export const recipeExploreMessages = {
  en: recipeExploreEnglish,
  es: recipeExploreSpanish,
};

export function useRecipeExploreText() {
  const { t: translate } = useTranslation();
  return useCallback(
    (key: RecipeExploreMessage, params?: Record<string, string | number>) =>
      translate(key, params, recipeExploreMessages),
    [translate],
  );
}
