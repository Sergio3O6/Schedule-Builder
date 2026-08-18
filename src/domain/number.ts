/**
 * Numbers as this export writes them.
 *
 * Every numeric cell arrives float-formatted, whatever it means: '3.0' credit
 * hours, '4950.0' for a cross-listing id, '20.0' seats, '0.0' for absent.
 *
 * Neither obvious parse is safe. parseInt reads '4950.0' as 4950 by luck and
 * '0.5' as 0 by accident. Number() accepts a great deal more than this data
 * ever contains, and silently: '0x4B6A' becomes 19306, '1e4' becomes 10000, ''
 * becomes 0, and 'Infinity' parses. None can be a real value in any column, and
 * each would arrive looking like a plausible number.
 *
 * So every numeric column passes one gate — a plain decimal — and then whatever
 * that particular column additionally requires.
 */

const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/

/** A plain decimal. Fractions are allowed; credit hours really are 0.25. */
export function parseDecimal(raw: string, what: string): number {
  const text = raw.trim()
  if (!DECIMAL_PATTERN.test(text)) {
    throw new Error(`${what} is not a decimal number: ${JSON.stringify(raw)}`)
  }
  return Number(text)
}

/** A decimal that must be whole, e.g. an id or a headcount. */
export function parseIntegral(raw: string, what: string): number {
  const value = parseDecimal(raw, what)
  if (!Number.isInteger(value)) {
    throw new Error(`${what} is not an integer: ${JSON.stringify(raw)}`)
  }
  // Past 2^53 the parse is lossy, so the value read back is not the value sent.
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${what} is too large to represent exactly: ${JSON.stringify(raw)}`)
  }
  return value
}
