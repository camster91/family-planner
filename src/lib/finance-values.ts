/** FIN-0 pure proposed value bridge. No storage, promotion, locale inference or FX. */
import { parseDateOnly } from '@/lib/dates'
export const FINANCE_VALUE_PROTOCOL = 'herewoven.finance-value.v1'
/** Proposed first mapping vocabulary; activation/review remains separate. */
export const FINANCE_DENOMINATIONS = { USD: 2, CAD: 2 } as const
export type FinanceCurrency = keyof typeof FINANCE_DENOMINATIONS
export type FinanceMoney = Readonly<{ currency: FinanceCurrency; minorUnits: string }>
export type FinanceValueHold = { kind: 'held'; reason:
  'CURRENCY_REQUIRED' | 'UNSUPPORTED_CURRENCY' | 'INVALID_MINOR_UNITS' | 'INVALID_DECIMAL' |
  'EXCESS_PRECISION' | 'OUT_OF_RANGE' | 'UNSAFE_NUMBER' | 'LEGACY_DENOMINATION_CONFLICT' |
  'LEGACY_CLASSIFICATION_REQUIRED' | 'TRANSFER_REVIEW_REQUIRED' | 'LEGACY_DIRECTION_REQUIRED' |
  'SIGNED_OR_ZERO_LEGACY_AMOUNT' | 'SOURCE_MINOR_CONFLICT' | 'DATE_MAPPING_REQUIRED' }
export type FinanceMoneyRead = FinanceValueHold | { kind: 'value'; protocol: typeof FINANCE_VALUE_PROTOCOL; value: FinanceMoney;
  source: { unit: 'minor' | 'major'; value: string; numericInput: boolean } }
/** Symmetric signed-64-bit bound for a future minor-unit store; no table is added. */
const MAX_MINOR = BigInt('9223372036854775807')
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER)
const held = (reason: FinanceValueHold['reason']): FinanceValueHold => ({ kind: 'held', reason })
function currency(value: unknown): FinanceCurrency | FinanceValueHold {
  if (value === undefined || value === null || value === '') return held('CURRENCY_REQUIRED')
  if (value === 'USD' || value === 'CAD') return value
  return held('UNSUPPORTED_CURRENCY')
}
function inRange(value: bigint) { return value >= -MAX_MINOR && value <= MAX_MINOR }
/** Source numeric cents must be safe integers; strings retain values above 2^53. */
export function readFinanceMinor(raw: unknown, denomination: unknown): FinanceMoneyRead {
  const code = currency(denomination)
  if (typeof code !== 'string') return code
  const numericInput = typeof raw === 'number'
  if (numericInput && (!Number.isSafeInteger(raw) || Object.is(raw, -0))) return held('UNSAFE_NUMBER')
  const value = numericInput ? String(raw) : raw
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,18})$/.test(value) || value === '-0') return held('INVALID_MINOR_UNITS')
  if (!inRange(BigInt(value))) return held('OUT_OF_RANGE')
  return { kind: 'value', protocol: FINANCE_VALUE_PROTOCOL, value: { currency: code, minorUnits: value }, source: { unit: 'minor', value, numericInput } }
}
/** Exact decimal TEXT only. Never parseFloat, multiply a float, trim or round. */
export function readFinanceDecimal(raw: unknown, denomination: unknown): FinanceMoneyRead {
  const code = currency(denomination)
  if (typeof code !== 'string') return code
  if (typeof raw !== 'string' || raw.length > 23 || !/^-?(0|[1-9][0-9]{0,18})(\.[0-9]+)?$/.test(raw)) return held('INVALID_DECIMAL')
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const [whole, fraction = ''] = unsigned.split('.')
  const exponent = FINANCE_DENOMINATIONS[code]
  if (fraction.length > exponent) return held('EXCESS_PRECISION')
  const units = BigInt(whole) * BigInt(10 ** exponent) + BigInt(fraction.padEnd(exponent, '0'))
  if (negative && units === BigInt(0)) return held('INVALID_DECIMAL')
  const minor = negative ? -units : units
  if (!inRange(minor)) return held('OUT_OF_RANGE')
  return { kind: 'value', protocol: FINANCE_VALUE_PROTOCOL, value: { currency: code, minorUnits: minor.toString() }, source: { unit: 'major', value: raw, numericInput: false } }
}
export type LegacyBudgetMoneyCandidate = FinanceValueHold | { kind: 'candidate'; protocol: typeof FINANCE_VALUE_PROTOCOL;
  value: FinanceMoney; direction: 'income' | 'expense'; decimalSpelling: string;
  sourceMinorMatch: 'matched' | 'unavailable'; sourceMinor: string | null }
/**
 * Read-only compatibility candidate for existing USD Float budgets. The shortest
 * JS decimal spelling is inspected, not claimed to be original export bytes or
 * exact binary arithmetic. Retained cents must agree if present. Every candidate
 * still needs approved source/identity/currency/date/whole-record review.
 */
export function inspectLegacyBudgetMoney(input: {
  amount: unknown; denomination: unknown; direction: unknown; isTransfer: unknown; sourceCents?: unknown;
}): LegacyBudgetMoneyCandidate {
  const code = currency(input.denomination)
  if (typeof code !== 'string') return code
  if (code !== 'USD') return held('LEGACY_DENOMINATION_CONFLICT') // Do not relabel existing USD as CAD.
  if (input.isTransfer === true) return held('TRANSFER_REVIEW_REQUIRED')
  if (input.isTransfer !== false) return held('LEGACY_CLASSIFICATION_REQUIRED')
  if (input.direction !== 'income' && input.direction !== 'expense') return held('LEGACY_DIRECTION_REQUIRED')
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) return held('UNSAFE_NUMBER')
  if (input.amount <= 0 || Object.is(input.amount, -0)) return held('SIGNED_OR_ZERO_LEGACY_AMOUNT')
  const decimalSpelling = String(input.amount)
  const amount = readFinanceDecimal(decimalSpelling, code)
  if (amount.kind === 'held') return amount
  if (BigInt(amount.value.minorUnits) > MAX_SAFE_MINOR) return held('UNSAFE_NUMBER')
  let sourceMinor: string | null = null
  if (input.sourceCents !== undefined) {
    const source = readFinanceMinor(input.sourceCents, code)
    if (source.kind === 'held') return source
    if (source.value.minorUnits !== amount.value.minorUnits) return held('SOURCE_MINOR_CONFLICT')
    sourceMinor = source.source.value
  }
  return { kind: 'candidate', protocol: FINANCE_VALUE_PROTOCOL, value: amount.value, direction: input.direction, decimalSpelling,
    sourceMinorMatch: sourceMinor === null ? 'unavailable' : 'matched', sourceMinor }
}
/** Uses the canonical calendar parser; never truncate a timestamp or infer a zone. */
export function readFinanceDateOnly(raw: unknown): FinanceValueHold | { kind: 'day'; protocol: typeof FINANCE_VALUE_PROTOCOL; day: string } {
  if (typeof raw !== 'string' || !parseDateOnly(raw)) return held('DATE_MAPPING_REQUIRED')
  return { kind: 'day', protocol: FINANCE_VALUE_PROTOCOL, day: raw }
}
