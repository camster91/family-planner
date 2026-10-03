import { missingFieldsHint } from '../form-hints'

describe('missingFieldsHint', () => {
  it('is null when nothing is missing', () => {
    expect(missingFieldsHint([])).toBeNull()
  })

  it('names one, two or more missing fields in plain words', () => {
    expect(missingFieldsHint(['a title'])).toBe('Add a title first.')
    expect(missingFieldsHint(['a title', 'a due date'])).toBe('Add a title and a due date first.')
    expect(missingFieldsHint(['a title', 'a due date', 'who does it'])).toBe(
      'Add a title, a due date and who does it first.'
    )
  })
})
