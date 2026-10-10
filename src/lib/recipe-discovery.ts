/** Public recipe metadata only. Never execute publisher HTML. */
export interface OnlineRecipe {
  title: string; description: string; instructions: string;
  ingredientLines: string[]; source: string; servings: number | null; prep_time: number | null; cook_time: number | null;
}
export function publicRecipeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || raw.length > 1500) return null
    url.hash = ''
    return url.toString()
  } catch { return null }
}
function text(value: unknown, max = 20000): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity] ?? entity).trim().slice(0, max)
}
function minutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const n = Number(match[1] || 0) * 60 + Number(match[2] || 0)
  return n <= 1440 ? n : null
}
export function extractOnlineRecipe(html: string, source: string): OnlineRecipe | null {
  const url = publicRecipeUrl(source)
  if (!url || html.length > 2 * 1024 * 1024) return null
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)
  let inspected = 0
  function find(value: unknown, depth = 0): Record<string, unknown> | null {
    if (++inspected > 2000 || depth > 12 || !value || typeof value !== 'object') return null
    if (Array.isArray(value)) { for (const entry of value) { const hit = find(entry, depth + 1); if (hit) return hit } return null }
    const object = value as Record<string, unknown>
    const types = Array.isArray(object['@type']) ? object['@type'] : [object['@type']]
    if (types.includes('Recipe') && text(object.name, 200)) return object
    for (const child of Object.values(object)) { const hit = find(child, depth + 1); if (hit) return hit }
    return null
  }
  function steps(value: unknown, depth = 0): string[] {
    if (depth > 8) return []
    if (typeof value === 'string') return [text(value)]
    if (Array.isArray(value)) return value.slice(0, 100).flatMap(entry => steps(entry, depth + 1))
    if (!value || typeof value !== 'object') return []
    const object = value as Record<string, unknown>
    return object.itemListElement ? steps(object.itemListElement, depth + 1) : [text(object.text)]
  }
  for (const script of scripts) {
    try {
      const recipe = find(JSON.parse(script[1]))
      if (!recipe) continue
      const ingredientLines = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.slice(0, 100).map(line => text(line, 500)).filter(Boolean) : []
      const yieldText = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield
      const yieldMatch = typeof yieldText === 'number' ? [String(yieldText), String(yieldText)] : typeof yieldText === 'string' ? /^(?:Serves\s+)?(\d+)(?:\s+(?:servings|people))?$/i.exec(yieldText.trim()) : null
      const servings = yieldMatch && Number(yieldMatch[1]) >= 1 && Number(yieldMatch[1]) <= 100 ? Number(yieldMatch[1]) : null
      return { servings, title: text(recipe.name, 200), description: text(recipe.description, 400), instructions: steps(recipe.recipeInstructions).filter(Boolean).join('\n\n').slice(0, 14000), ingredientLines, source: url, prep_time: minutes(recipe.prepTime), cook_time: minutes(recipe.cookTime) }
    } catch { /* Another JSON-LD block may contain the recipe. */ }
  }
  return null
}
export const recipeSources = [
  { name: 'BBC Good Food', search: 'https://www.bbcgoodfood.com/search?q=' },
  { name: 'Allrecipes', search: 'https://www.allrecipes.com/search?q=' },
  { name: 'Serious Eats', search: 'https://www.seriouseats.com/search?q=' },
] as const

/** Search result titles/links only; publisher content stays at its source. */
export function extractRecipeLinks(html: string, searchUrl: string): Array<{ title: string; url: string }> {
  if (html.length > 2 * 1024 * 1024) return []
  const host = new URL(searchUrl).hostname.replace(/^www\./, '')
  const results = new Map<string, { title: string; url: string }>()
  for (const anchor of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    try {
      const link = new URL(anchor[1].replace(/&amp;/g, '&'), searchUrl)
      if (link.hostname.replace(/^www\./, '') !== host || link.protocol !== 'https:' || link.username || link.password) continue
      if (!(/\/recipes?\/[^/]+/.test(link.pathname) || /-recipe(?:-\d+)?$/.test(link.pathname))) continue
      const title = text(anchor[2], 200).replace(/\s+/g, ' ').trim()
      if (!title || title.length < 3) continue
      link.search = ''; link.hash = ''
      const url = link.toString()
      if (!results.has(url)) results.set(url, { title, url })
      if (results.size >= 24) break
    } catch { /* Skip invalid publisher links. */ }
  }
  return [...results.values()]
}
