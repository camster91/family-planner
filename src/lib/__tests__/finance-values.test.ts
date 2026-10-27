/** Source only, UNRUN. No ledger/schema/source approval or currency activation. */
import { readFinanceMinor, readFinanceDecimal, inspectLegacyBudgetMoney, readFinanceDateOnly } from '../finance-values'
it('retains exact minor strings above JavaScript safe integer precision', () => {
  expect(readFinanceMinor('9007199254740993', 'CAD')).toMatchObject({ kind: 'value', value: { currency: 'CAD', minorUnits: '9007199254740993' }, source: { value: '9007199254740993', numericInput: false } })
  expect(readFinanceMinor(9007199254740992, 'CAD')).toEqual({ kind: 'held', reason: 'UNSAFE_NUMBER' })
  expect(readFinanceMinor('9223372036854775807', 'USD')).toMatchObject({ kind: 'value' })
  expect(readFinanceMinor('9223372036854775808', 'USD')).toEqual({ kind: 'held', reason: 'OUT_OF_RANGE' })
})
it('converts decimal text exactly and retains its source spelling', () => {
  expect(readFinanceDecimal('19.99', 'USD')).toMatchObject({ kind: 'value', value: { currency: 'USD', minorUnits: '1999' }, source: { unit: 'major', value: '19.99' } })
  expect(readFinanceDecimal('-0.01', 'CAD')).toMatchObject({ kind: 'value', value: { currency: 'CAD', minorUnits: '-1' } })
  expect(readFinanceDecimal('0', 'USD')).toMatchObject({ kind: 'value', value: { minorUnits: '0' } })
  expect(readFinanceDecimal('92233720368547758.07', 'USD')).toMatchObject({ kind: 'value', value: { minorUnits: '9223372036854775807' } })
  expect(readFinanceDecimal('92233720368547758.08', 'USD')).toEqual({ kind: 'held', reason: 'OUT_OF_RANGE' })
})
it.each(['1,000.00', '$1.00', '1e2', ' 1.00', '1.00 ', '01.00', '.50', '1.', '-0.00'])('holds ambiguous/noncanonical decimal %p', value => {
  expect(readFinanceDecimal(value, 'USD').kind).toBe('held')
})
it('does not infer currency or round excess precision', () => {
  expect(readFinanceDecimal('1.00', undefined)).toEqual({ kind: 'held', reason: 'CURRENCY_REQUIRED' })
  expect(readFinanceDecimal('1.00', '$')).toEqual({ kind: 'held', reason: 'UNSUPPORTED_CURRENCY' })
  expect(readFinanceDecimal('1.00', 'JPY')).toEqual({ kind: 'held', reason: 'UNSUPPORTED_CURRENCY' })
  expect(readFinanceDecimal('1.001', 'USD')).toEqual({ kind: 'held', reason: 'EXCESS_PRECISION' })
  expect(readFinanceDecimal(1.01, 'USD')).toEqual({ kind: 'held', reason: 'INVALID_DECIMAL' })
})
const legacy = { amount: 19.99, denomination: 'USD', direction: 'expense', isTransfer: false, sourceCents: 1999 }
it('produces only a read-only Float candidate with exact preserved cents reconciliation', () => {
  expect(inspectLegacyBudgetMoney(legacy)).toMatchObject({ kind: 'candidate', value: { currency: 'USD', minorUnits: '1999' }, sourceMinorMatch: 'matched', sourceMinor: '1999' })
  expect(inspectLegacyBudgetMoney({ ...legacy, sourceCents: undefined })).toMatchObject({ kind: 'candidate', sourceMinorMatch: 'unavailable' })
  expect(inspectLegacyBudgetMoney({ ...legacy, sourceCents: 2000 })).toEqual({ kind: 'held', reason: 'SOURCE_MINOR_CONFLICT' })
  expect(legacy.amount).toBe(19.99)
})
it('holds transfer/sign/unknown classification, Float noise and denomination conflicts', () => {
  for (const change of [{ amount: -1 }, { amount: 0 }, { amount: NaN }, { amount: Infinity }, { amount: 0.1 + 0.2 }, { amount: 1e18 }, { isTransfer: true }, { isTransfer: undefined }, { direction: 'unknown' }, { denomination: 'CAD' }])
    expect(inspectLegacyBudgetMoney({ ...legacy, ...change }).kind).toBe('held')
})
it('preserves valid calendar days and refuses locale dates/timestamps/rollover without shifting', () => {
  expect(readFinanceDateOnly('2028-02-29')).toMatchObject({ kind: 'day', day: '2028-02-29' })
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '10/25/2026', '2026-10-25T00:00:00-04:00', new Date('2026-10-25T00:00:00Z')])
    expect(readFinanceDateOnly(value)).toEqual({ kind: 'held', reason: 'DATE_MAPPING_REQUIRED' })
})
