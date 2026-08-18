import { describe, expect, it } from 'vitest'
import { parseDecimal, parseIntegral } from './number.ts'

describe('parseDecimal', () => {
  it('reads the float-formatted integers the export writes', () => {
    // Every numeric cell in the file looks like this, whatever it means.
    expect(parseDecimal('3.0', 'x')).toBe(3)
    expect(parseDecimal('4950.0', 'x')).toBe(4950)
    expect(parseDecimal('0.0', 'x')).toBe(0)
  })

  it('keeps the fractions that are really in the data', () => {
    // 22 rows carry fractional credit hours. An integral-only parser would
    // round a quarter-hour course to zero or to one, both of them wrong.
    expect(parseDecimal('0.25', 'x')).toBe(0.25)
    expect(parseDecimal('1.5', 'x')).toBe(1.5)
  })

  it('reads a negative, because one column really goes negative', () => {
    // 431 rows report negative Seats avl, down to -104.
    expect(parseDecimal('-104.0', 'x')).toBe(-104)
  })

  it('trims the padding the export puts on its cells', () => {
    expect(parseDecimal('  20.0  ', 'x')).toBe(20)
  })

  it('refuses everything Number() would have accepted silently', () => {
    // Each of these produces a plausible-looking number with no complaint:
    // 19306, 10000, 0, Infinity. None can be a real value in any column.
    for (const bad of ['0x4B6A', '1e4', '', '   ', 'Infinity', 'NaN', '1_000', '.5', '5.']) {
      expect(() => parseDecimal(bad, 'seats'), bad).toThrow(/seats is not a decimal number/)
    }
  })

  it('names the column in the message, since nine of them look alike', () => {
    expect(() => parseDecimal('x', 'wait total')).toThrow(/wait total is not a decimal number/)
  })
})

describe('parseIntegral', () => {
  it('accepts a whole number however it is spelled', () => {
    expect(parseIntegral('17939', 'x')).toBe(17939)
    expect(parseIntegral('17939.0', 'x')).toBe(17939)
  })

  it('refuses a fraction rather than rounding it away', () => {
    // parseInt would answer 0 here, which is the id of nothing and the count
    // of nothing — a wrong answer that looks like a real one.
    expect(() => parseIntegral('0.5', 'class number')).toThrow(/class number is not an integer/)
  })

  it('refuses a value too large to survive the round trip', () => {
    expect(() => parseIntegral('9007199254740993', 'x')).toThrow(/too large to represent exactly/)
  })

  it('rejects the same non-decimals parseDecimal does', () => {
    for (const bad of ['0x4B6A', '1e4', '']) {
      expect(() => parseIntegral(bad, 'x'), bad).toThrow(/not a decimal number/)
    }
  })
})
