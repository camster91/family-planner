import { extractOnlineRecipe, publicRecipeUrl, extractRecipeLinks } from '../recipe-discovery'
const html = (recipe: unknown) => `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`
it('extracts a graph recipe and nested steps without HTML execution or quantity invention', () => {
 const recipe = extractOnlineRecipe(html({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: '<b>Soup</b>', recipeIngredient: ['½ cup rice', 'Salt to taste'], recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ text: '<p>Stir &amp; simmer.</p>' }] }], prepTime: 'PT1H15M' }] }), 'https://example.org/soup#recipe')!
 expect(recipe).toMatchObject({ title: 'Soup', ingredientLines: ['½ cup rice', 'Salt to taste'], instructions: 'Stir & simmer.', prep_time: 75, cook_time: null, source: 'https://example.org/soup' })
})
it('skips malformed JSON and finds recipe in next block', () => {
 expect(extractOnlineRecipe('<script type="application/ld+json">broken</script>'+html({ '@type': 'Recipe', name: 'Pasta' }), 'https://example.org/pasta')?.title).toBe('Pasta')
})
it('bounds imported text and refuses non-recipes, credentials, oversized pages and unsafe schemes', () => {
 expect(extractOnlineRecipe(html({ '@type': 'Article', name: 'Article' }), 'https://example.org')).toBeNull()
 expect(extractOnlineRecipe('a'.repeat(2 * 1024 * 1024 + 1), 'https://example.org')).toBeNull()
 for (const url of ['javascript:alert(1)', 'http://example.org', 'https://user:pass@example.org']) expect(publicRecipeUrl(url)).toBeNull()
 const recipe = extractOnlineRecipe(html({ '@type': 'Recipe', name: 'a'.repeat(250), recipeInstructions: 'b'.repeat(30000), cookTime: 'PT999H' }), 'https://example.org')!
 expect(recipe.title).toHaveLength(200); expect(recipe.instructions).toHaveLength(14000); expect(recipe.cook_time).toBeNull()
})

it('extracts unique same-publisher recipe links, refusing foreign and unsafe anchors', () => {
 const html = '<a href="/recipes/soup"><h2>Soup &amp; rice</h2></a><a href="/recipes/soup">Duplicate</a><a href="https://evil.example/recipes/soup">Other site</a><a href="javascript:alert(1)">Unsafe</a><a href="/about">About</a>'
 expect(extractRecipeLinks(html, 'https://www.bbcgoodfood.com/search?q=rice')).toEqual([{ title: 'Soup & rice', url: 'https://www.bbcgoodfood.com/recipes/soup' }])
})
