// Required text fields must reject whitespace-only input. With zod 3,
// `.min(1).trim()` checks the length BEFORE trimming, so "   " passed and was
// saved as an empty name or title (an empty chore on the kid's list, a nameless
// family). `.trim().min(1)` trims first.
import {
  createChoreSchema,
  createEventSchema,
  createFamilySchema,
  loginSchema,
  registerSchema,
  updateUserSchema,
} from '@/lib/validations'

describe('required text is trimmed before its length check', () => {
  it('registration refuses a blank name and keeps a padded one trimmed', () => {
    const base = { email: 'a@example.test', password: 'long-enough-1' }
    expect(registerSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
    const ok = registerSchema.safeParse({ ...base, name: '  Sam  ' })
    expect(ok.success && ok.data.name).toBe('Sam')
  })

  it('a family, chore, event or profile name cannot be blank', () => {
    expect(createFamilySchema.safeParse({ name: ' \t ' }).success).toBe(false)
    expect(
      createChoreSchema.safeParse({ title: '   ', assigned_to: 'u1', due_date: '2026-10-01' }).success
    ).toBe(false)
    expect(createEventSchema.safeParse({ title: '  ', start_time: '2026-10-01T10:00:00Z' }).success).toBe(false)
    expect(updateUserSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('emails are trimmed; registration also lower-cases', () => {
    const login = loginSchema.safeParse({ email: ' Sam@Example.test ', password: 'x' })
    expect(login.success && login.data.email).toBe('Sam@Example.test')
    const reg = registerSchema.safeParse({ email: ' Sam@Example.test ', password: 'long-enough-1', name: 'Sam' })
    expect(reg.success && reg.data.email).toBe('sam@example.test')
  })
})

describe('profile age', () => {
  it.each([30, '30', ' 7 ', '', null])('accepts %p', (age) => {
    expect(updateUserSchema.safeParse({ age }).success).toBe(true)
  })

  it.each(['abc', '1e9', '0', '151', '-3', 999])('refuses %p', (age) => {
    expect(updateUserSchema.safeParse({ age }).success).toBe(false)
  })
})
