/** QA-only template expansion. Interpolate household values AFTER this step. */
const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ACCENTED = 'áƀçďéƒğĥíĵķľḿñóƥɋŕšţúṽŵẋýžÁɃÇĎÉƑĞĤÍĴĶĽḾÑÓƤɊŔŠŢÚṼŴẊÝŽ'

export function pseudolocalizeTemplate(template: string): string {
  if (!template) return template
  let letters = 0
  const transformed = template.split(/(\{\w+\})/g).map((part) => {
    if (/^\{\w+\}$/.test(part)) return part
    return part.replace(/[a-z]/gi, (letter) => {
      const accented = ACCENTED[PLAIN.indexOf(letter)]
      letters += 1
      const repeat = Math.floor(letters * 0.4) > Math.floor((letters - 1) * 0.4)
      return repeat ? accented + accented : accented
    })
  }).join('')
  return `⟦${transformed}⟧`
}

/** Both explicit QA flags are required, including in development builds. */
export function isPseudolocaleEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.I18N_PSEUDO_ENABLED === '1' && env.DESIGN_GALLERY_ENABLED === '1'
}
