/**
 * Says why a form's main button is still greyed out, so a disabled button is
 * never a silent dead end. `missing` holds short phrases such as "a title".
 *
 *   missingFieldsHint(['a title', 'a due date']) → "Add a title and a due date first."
 */
export function missingFieldsHint(missing: string[]): string | null {
  if (missing.length === 0) return null
  if (missing.length === 1) return `Add ${missing[0]} first.`
  const head = missing.slice(0, -1).join(', ')
  return `Add ${head} and ${missing[missing.length - 1]} first.`
}
