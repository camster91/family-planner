import { createChoreSchema, updateChoreSchema } from '@/lib/validations'

// The chore create/edit forms send `description: null` when the field is empty.
describe('chore description accepts null from the forms', () => {
  const base = { title: 'Feed the cat', assigned_to: 'user-1', due_date: '2026-01-05' }

  it('create accepts null and missing descriptions', () => {
    expect(createChoreSchema.safeParse({ ...base, description: null }).success).toBe(true)
    expect(createChoreSchema.safeParse(base).success).toBe(true)
  })

  it('update accepts null to clear the description', () => {
    const parsed = updateChoreSchema.safeParse({ choreId: 'c1', description: null })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.description).toBeNull()
  })

  it('still rejects over-long descriptions', () => {
    expect(createChoreSchema.safeParse({ ...base, description: 'x'.repeat(1001) }).success).toBe(false)
  })
})
