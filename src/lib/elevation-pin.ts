/**
 * Parent tablet elevation PIN rules (SHARED_DEVICE.md §6.1, O-1 confirmed).
 *
 * Exactly 6 digits. The 20 most guessable patterns are refused: every
 * repeated digit (000000…999999), every ascending run (012345…456789) and
 * every descending run (987654…543210), plus a few well-known pairs/patterns.
 */

const PIN_PATTERN = /^\d{6}$/

const ASCENDING = '0123456789'
const DESCENDING = '9876543210'

function commonPins(): Set<string> {
  const set = new Set<string>()
  for (let d = 0; d <= 9; d++) set.add(String(d).repeat(6))
  for (let i = 0; i + 6 <= 10; i++) {
    set.add(ASCENDING.slice(i, i + 6))
    set.add(DESCENDING.slice(i, i + 6))
  }
  for (const pin of ['123123', '121212', '112233', '123321', '111222', '696969', '159753', '147258', '101010', '789456']) {
    set.add(pin)
  }
  return set
}

export const COMMON_PINS: ReadonlySet<string> = commonPins()

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin)
}

/** True when the PIN is well-formed and not on the common list. */
export function isAcceptablePin(pin: unknown): pin is string {
  return isValidPinFormat(pin) && !COMMON_PINS.has(pin)
}
