import { locationsEnglish, locationsSpanish } from '../locations'

const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort()

it('keeps Locations EN/ES copy keys and placeholders aligned', () => {
  expect(Object.keys(locationsSpanish).sort()).toEqual(Object.keys(locationsEnglish).sort())

  for (const [key, english] of Object.entries(locationsEnglish)) {
    const spanish = locationsSpanish[key as keyof typeof locationsSpanish]
    expect(english.trim()).not.toBe('')
    expect(spanish.trim()).not.toBe('')
    expect(placeholders(spanish)).toEqual(placeholders(english))
  }
})
