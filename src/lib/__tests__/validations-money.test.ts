import { createAllowanceSchema, createTransactionSchema, updateTransactionSchema } from '@/lib/validations'

const tx = (amount: unknown) => createTransactionSchema.safeParse({ amount, type: 'expense' })
const allowance = (amount: unknown) => createAllowanceSchema.safeParse({ to_user_id: 'child-a', amount })

describe('money validation', () => {
  it('accepts ordinary transaction amounts', () => {
    for (const amount of [0.01, 19.99, 1200, 100_000_000]) expect(tx(amount).success).toBe(true)
  })

  it('refuses negative, zero, oversized and over-precise transaction amounts', () => {
    // The direction of a transaction comes from `type`, never a negative sign.
    for (const amount of [-500, -0.01, 0, 0.001, 19.999, 100_000_000.01, 1e20, Infinity]) {
      expect(tx(amount).success).toBe(false)
    }
    expect(updateTransactionSchema.safeParse({ transactionId: 't1', amount: -5 }).success).toBe(false)
  })

  it('accepts ordinary allowance amounts', () => {
    for (const amount of [0.25, 5, 12.5, 1_000_000]) expect(allowance(amount).success).toBe(true)
  })

  it('refuses over-precise and oversized allowance amounts', () => {
    for (const amount of [0.001, 2.345, 1_000_000.01, 1e300]) expect(allowance(amount).success).toBe(false)
  })
})
