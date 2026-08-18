import { describe, expect, it } from 'vitest'
import { termCode } from '../../src/domain/ids.ts'
import { describeCalendar, deriveTermCalendar, modalDateSpan } from './calendar.ts'
import type { RawDateSpan } from './calendar.ts'

const fall = termCode('4269')

/** n rows of the same span, the way the export repeats them. */
const many = (begin: string, end: string, n: number): RawDateSpan[] =>
  Array.from({ length: n }, () => ({ begin, end }))

describe('modalDateSpan', () => {
  it('finds the span the most rows share', () => {
    const spans = [...many('AUG-24', 'DEC-18', 10), ...many('OCT-21', 'DEC-18', 3)]
    expect(modalDateSpan(spans)).toMatchObject({ begin: 'AUG-24', end: 'DEC-18', rows: 10 })
  })

  it('votes on the pair, never on the two dates separately', () => {
    // Here the most common Begin is OCT-21 (5) and the most common End is
    // DEC-18 (5), but OCT-21..DEC-18 is a span no row has. Two independent
    // modes would pin the epoch to a term that does not exist.
    const spans = [
      ...many('OCT-21', 'NOV-14', 5),
      ...many('AUG-24', 'DEC-18', 4),
      ...many('SEP-01', 'DEC-18', 1),
    ]
    expect(modalDateSpan(spans)).toMatchObject({ begin: 'OCT-21', end: 'NOV-14', rows: 5 })
  })

  it('does not let an undated row vote', () => {
    // 25 live rows publish neither date. They belong to the term but say
    // nothing about where it starts.
    const spans = [...many('', '', 50), ...many('AUG-24', 'DEC-18', 3)]
    expect(modalDateSpan(spans)).toMatchObject({ begin: 'AUG-24', rows: 3, voted: 3 })
  })

  it('does not let a half-dated row vote either', () => {
    const spans = [...many('AUG-24', '', 50), ...many('AUG-24', 'DEC-18', 2)]
    expect(modalDateSpan(spans).voted).toBe(2)
  })

  it('refuses a tie rather than pinning the epoch on iteration order', () => {
    const spans = [...many('AUG-24', 'DEC-18', 4), ...many('JAN-20', 'MAY-15', 4)]
    expect(() => modalDateSpan(spans)).toThrow(/no single term span/)
  })

  it('refuses a file where nothing is dated', () => {
    expect(() => modalDateSpan(many('', '', 10))).toThrow(/no row carries both/)
    expect(() => modalDateSpan([])).toThrow(/no row carries both/)
  })

  it('reports the share so a human can judge it', () => {
    const spans = [...many('AUG-24', 'DEC-18', 3), ...many('OCT-21', 'DEC-18', 1)]
    expect(modalDateSpan(spans)).toMatchObject({ rows: 3, voted: 4 })
  })
})

describe('deriveTermCalendar', () => {
  it('reconstructs the Fall 2026 term from its own rows', () => {
    const calendar = deriveTermCalendar(fall, many('AUG-24', 'DEC-18', 5))
    expect(calendar).toMatchObject({ startDate: '2026-08-24', endDate: '2026-12-18' })
  })

  it('carries a full-year term into the next year', () => {
    // A term that starts in August and ends in May is a full-year span, not an
    // inverted one — the failure mode the epoch exists to prevent.
    const calendar = deriveTermCalendar(fall, many('AUG-13', 'MAY-26', 5))
    expect(calendar).toMatchObject({ startDate: '2026-08-13', endDate: '2027-05-26' })
  })

  it('reads the year from the term code, not from the clock', () => {
    const spring = deriveTermCalendar(termCode('4272'), many('JAN-20', 'MAY-15', 2))
    expect(spring).toMatchObject({ startDate: '2027-01-20', endDate: '2027-05-15' })
  })

  it('refuses a date that does not exist', () => {
    expect(() => deriveTermCalendar(fall, many('FEB-30', 'MAY-26', 2))).toThrow(/does not exist/)
  })

  it('refuses an unparseable date rather than guessing one', () => {
    expect(() => deriveTermCalendar(fall, many('AUGUST 24', 'DEC-18', 2))).toThrow(
      /unparseable date/,
    )
  })
})

describe('describeCalendar', () => {
  it('states the span and how much of the file agrees', () => {
    const modal = modalDateSpan([...many('AUG-24', 'DEC-18', 3), ...many('OCT-21', 'DEC-18', 1)])
    expect(describeCalendar(fall, modal)).toBe(
      'Term 4269: AUG-24..DEC-18 on 3 of 4 dated rows (75.0%)',
    )
  })
})
