import { describe, expect, it } from 'vitest'
import { termCode } from './ids.ts'
import {
  dateSpan,
  dayMaskOverlaps,
  isoDate,
  minuteOfDay,
  parseClockTime,
  parseDateRange,
  parseDayMask,
  spansOverlap,
  termCalendar,
  termYear,
  timeOverlaps,
  toDayOffset,
} from './time.ts'
import type { TermCalendar } from './time.ts'

/** Fall 2026, the modal span of the live export. */
const fall2026 = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

describe('parseDayMask', () => {
  it('reads the two-letter tokens before the single letters', () => {
    // 'Th' must not read as 'T' plus a stray 'h'.
    expect(parseDayMask('TuTh')).toBe(parseDayMask('Tu') | parseDayMask('Th'))
    expect(parseDayMask('Th')).not.toBe(parseDayMask('Tu'))
  })

  it('reads every pattern the live export contains', () => {
    for (const pattern of ['MWF', 'TuTh', 'MW', 'WF', 'M', 'Tu', 'W', 'Th', 'F', 'Sa', 'MTuWThF']) {
      expect(() => parseDayMask(pattern), pattern).not.toThrow()
      expect(parseDayMask(pattern), pattern).toBeGreaterThan(0)
    }
  })

  it('handles weekend classes, which the term really does contain', () => {
    // 410 Saturday rows in Fall 2026.
    expect(parseDayMask('Sa')).not.toBe(0)
    expect(parseDayMask('Su')).not.toBe(0)
    expect(parseDayMask('Sa')).not.toBe(parseDayMask('Su'))
  })

  it('gives every day its own bit', () => {
    const masks = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'].map(parseDayMask)
    expect(new Set(masks).size).toBe(7)
    expect(masks.reduce((a, b) => a | b, 0)).toBe(0b1111111)
  })

  it('treats a blank as no days rather than as an error', () => {
    expect(parseDayMask('')).toBe(0)
    expect(parseDayMask('   ')).toBe(0)
  })

  it('throws on an unrecognized token instead of dropping it', () => {
    // A day we fail to parse is a day the student attends and we never schedule.
    for (const bad of ['MX', 'Q', 'MTWRF']) {
      expect(() => parseDayMask(bad), bad).toThrow(/unrecognized day token/)
    }
  })
})

describe('dayMaskOverlaps', () => {
  it('detects a shared day', () => {
    expect(dayMaskOverlaps(parseDayMask('MWF'), parseDayMask('MW'))).toBe(true)
  })

  it('reports disjoint day sets as clear', () => {
    expect(dayMaskOverlaps(parseDayMask('MWF'), parseDayMask('TuTh'))).toBe(false)
  })

  it('never overlaps with no days at all', () => {
    expect(dayMaskOverlaps(parseDayMask('MWF'), parseDayMask(''))).toBe(false)
  })
})

describe('parseClockTime', () => {
  it('reads the export format', () => {
    expect(parseClockTime('09:00 AM')).toBe(9 * 60)
    expect(parseClockTime('02:00 PM')).toBe(14 * 60)
    expect(parseClockTime('09:50 AM')).toBe(9 * 60 + 50)
    expect(parseClockTime('11:59 PM')).toBe(23 * 60 + 59)
  })

  it('handles the noon and midnight boundaries', () => {
    expect(parseClockTime('12:00 PM')).toBe(12 * 60)
    expect(parseClockTime('12:30 AM')).toBe(30)
  })

  it('parses 12:00 AM as midnight and takes no view on what it means', () => {
    // It is both a real time and the export's "no meeting" marker. Classifying
    // it needs the whole row, so that decision lives in the meeting layer.
    expect(parseClockTime('12:00 AM')).toBe(0)
  })

  it('returns null for values that are not clock times', () => {
    for (const raw of ['APPT', '', '  ', 'TBA', '25:00 AM', '09:60 AM', '00:30 AM']) {
      expect(parseClockTime(raw), raw).toBeNull()
    }
  })
})

describe('timeOverlaps', () => {
  it('lets back-to-back classes coexist', () => {
    // One ends 09:50, the next starts 09:50. Half-open, so no conflict.
    const a = { s: minuteOfDay(9 * 60), e: minuteOfDay(9 * 60 + 50) }
    const b = { s: minuteOfDay(9 * 60 + 50), e: minuteOfDay(10 * 60 + 40) }
    expect(timeOverlaps(a.s, a.e, b.s, b.e)).toBe(false)
  })

  it('catches a one-minute overlap', () => {
    const a = { s: minuteOfDay(540), e: minuteOfDay(591) }
    const b = { s: minuteOfDay(590), e: minuteOfDay(640) }
    expect(timeOverlaps(a.s, a.e, b.s, b.e)).toBe(true)
  })

  it('catches full containment either way round', () => {
    const outer = { s: minuteOfDay(540), e: minuteOfDay(720) }
    const inner = { s: minuteOfDay(600), e: minuteOfDay(660) }
    expect(timeOverlaps(outer.s, outer.e, inner.s, inner.e)).toBe(true)
    expect(timeOverlaps(inner.s, inner.e, outer.s, outer.e)).toBe(true)
  })
})

describe('termYear', () => {
  it('decodes the PeopleSoft 4YYS code', () => {
    expect(termYear(termCode('4269'))).toBe(2026)
    expect(termYear(termCode('4262'))).toBe(2026)
    expect(termYear(termCode('4259'))).toBe(2025)
  })
})

describe('parseDateRange', () => {
  it('reconstructs the year for an ordinary full-term span', () => {
    expect(parseDateRange(fall2026, 'AUG-24', 'DEC-18')).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-12-18',
    })
  })

  it('rolls the end year forward when the span crosses New Year', () => {
    // AUG-13..MAY-26 appears in six live rows. Reconstructing both years as 2026
    // produces an inverted span whose overlap test silently returns false.
    expect(parseDateRange(fall2026, 'AUG-13', 'MAY-26')).toEqual({
      startDate: '2026-08-13',
      endDate: '2027-05-26',
    })
  })

  it('handles a single-day session', () => {
    expect(parseDateRange(fall2026, 'SEP-22', 'SEP-22')).toEqual({
      startDate: '2026-09-22',
      endDate: '2026-09-22',
    })
  })

  it('handles a partial term inside the main one', () => {
    expect(parseDateRange(fall2026, 'OCT-21', 'DEC-18')).toEqual({
      startDate: '2026-10-21',
      endDate: '2026-12-18',
    })
  })

  it('anchors an August start to the previous year under a spring term', () => {
    // A full-year course listed under Spring 2027 begins in the August adjacent
    // to a January start, not eight months after it.
    const spring2027 = termCalendar(termCode('4272'), '2027-01-19', '2027-05-14')
    expect(parseDateRange(spring2027, 'AUG-13', 'MAY-26')).toEqual({
      startDate: '2026-08-13',
      endDate: '2027-05-26',
    })
  })

  it('falls back to the whole term when both dates are blank', () => {
    // 25 live rows have no dates at all. They are unscheduled sections (APPT, no
    // meeting days) that still belong to the term, so the term span is correct.
    expect(parseDateRange(fall2026, '', '')).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-12-18',
    })
    expect(parseDateRange(fall2026, '   ', '  ')).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-12-18',
    })
  })

  it('refuses a half-open range rather than inventing the missing end', () => {
    // Never occurs live — always both blank or neither — so one blank means
    // something changed and guessing would publish a date KU did not.
    expect(() => parseDateRange(fall2026, 'AUG-24', '')).toThrow(/half-open date range/)
    expect(() => parseDateRange(fall2026, '', 'DEC-18')).toThrow(/half-open date range/)
  })

  it('throws on an unparseable date rather than guessing', () => {
    for (const bad of ['AUG', 'XYZ-12', '13-AUG']) {
      expect(() => parseDateRange(fall2026, bad, 'DEC-18'), bad).toThrow()
    }
  })

  it('rejects a day outside any month', () => {
    for (const bad of ['SEP-00', 'SEP-32', 'SEP-99']) {
      expect(() => parseDateRange(fall2026, bad, 'DEC-18'), bad).toThrow(/day out of range/)
    }
  })

  it('rejects a day that does not exist in its own month', () => {
    // Date.parse rolls these over without complaint: SEP-31 becomes October 1st,
    // FEB-30 becomes March 2nd. The section would gain a day it does not run,
    // and the old day-field check — there wasn't one — could not see it.
    for (const bad of ['SEP-31', 'FEB-30', 'APR-31', 'JUN-31']) {
      expect(() => parseDateRange(fall2026, bad, 'DEC-18'), bad).toThrow(/does not exist/)
    }
  })

  it('accepts February 29th in a leap year', () => {
    const spring2028 = termCalendar(termCode('4282'), '2028-01-18', '2028-05-12')
    expect(parseDateRange(spring2028, 'FEB-29', 'MAY-12').startDate).toBe('2028-02-29')
  })

  it('resolves February 29th to the year that has one, rather than rolling to March', () => {
    // The candidate years are 2026, 2027 and 2028 here, and only one of them
    // contains the date. A year that does not is not a candidate.
    const spring2027 = termCalendar(termCode('4272'), '2027-01-19', '2027-05-14')
    expect(parseDateRange(spring2027, 'FEB-29', 'MAY-14').startDate).toBe('2028-02-29')
  })
})

describe('parseDateRange — reconstructing the year from the whole span', () => {
  const spring2027 = termCalendar(termCode('4272'), '2027-01-19', '2027-05-14')
  const summer2027 = termCalendar(termCode('4276'), '2027-06-07', '2027-08-06')

  it('anchors a long span on the term it overlaps, not on the nearer endpoint', () => {
    // The defect: year inference measured only the distance from Begin to the
    // term START, which is right within about six months of it and wrong outside.
    // JUL-06 is 53 days after Spring 2027 ends and 197 days before it begins, so
    // "nearest" chose 2027 — giving 2027-07-06..2028-05-26, a span that overlaps
    // the term it was published under by nothing at all.
    expect(parseDateRange(spring2027, 'JUL-06', 'MAY-26')).toEqual({
      startDate: '2026-07-06',
      endDate: '2027-05-26',
    })
  })

  it('keeps an ordinary summer session inside its own summer', () => {
    expect(parseDateRange(summer2027, 'JUN-08', 'JUL-31')).toEqual({
      startDate: '2027-06-08',
      endDate: '2027-07-31',
    })
  })

  it('places a rotation that ends before the term starts in the adjacent months', () => {
    // 1,010 live rows begin before August in a Fall export — prior-summer
    // rotations, almost all MED. Nothing overlaps, so the nearest year wins.
    expect(parseDateRange(fall2026, 'JUN-01', 'JUL-31')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-07-31',
    })
  })

  it('still reads a full-year span under a spring term as beginning last August', () => {
    expect(parseDateRange(spring2027, 'AUG-13', 'MAY-26')).toEqual({
      startDate: '2026-08-13',
      endDate: '2027-05-26',
    })
  })

  it('produces a span that overlaps the term for every real live shape', () => {
    // Every Begin/End pair in the Fall 2026 export, as distinct shapes. The
    // property that matters is not the exact year but that the section lands
    // where it can conflict with the rest of the term.
    for (const [begin, end] of [
      ['AUG-24', 'DEC-18'],
      ['AUG-13', 'MAY-26'],
      ['AUG-12', 'MAY-26'],
      ['DEC-14', 'JAN-03'],
      ['OCT-21', 'DEC-18'],
      ['SEP-22', 'SEP-22'],
    ] as const) {
      const span = dateSpan(fall2026, begin, end)
      expect(span.endDay, `${begin}..${end}`).toBeGreaterThanOrEqual(span.startDay)
    }
  })
})

describe('termCalendar', () => {
  it('mints the pinned Fall 2026 epoch', () => {
    const cal = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')
    expect(cal.startDate).toBe('2026-08-24')
    expect(cal.endDate).toBe('2026-12-18')
  })

  it('rejects every epoch Date.parse will not read as UTC midnight', () => {
    // The whole defect in one list. Each of these produced NaN or an hour of
    // local-time drift, silently, from a field typed as a plain string.
    for (const bad of ['2026-08-24T00:00:00Z', '2026/08/24', ' 2026-08-24', '2026-8-24', '', 'AUG-24']) {
      expect(() => termCalendar(termCode('4269'), bad, '2026-12-18'), bad).toThrow(
        /not an ISO date/,
      )
    }
  })

  it('validates the end date, not only the start', () => {
    expect(() => termCalendar(termCode('4269'), '2026-08-24', '2026-12-18 ')).toThrow(
      /not an ISO date/,
    )
  })

  it('rejects a date whose month does not exist', () => {
    expect(() => isoDate('2026-13-01')).toThrow(/does not exist/)
    expect(() => isoDate('2026-00-15')).toThrow(/does not exist/)
  })

  it('rejects a term that ends before it starts', () => {
    expect(() => termCalendar(termCode('4269'), '2026-12-18', '2026-08-24')).toThrow(
      /ends before it starts/,
    )
  })

  it('allows a single-day term rather than requiring a strict order', () => {
    expect(() => termCalendar(termCode('4269'), '2026-08-24', '2026-08-24')).not.toThrow()
  })
})

describe('toDayOffset', () => {
  it('puts the term start at zero', () => {
    expect(toDayOffset(fall2026, isoDate('2026-08-24'))).toBe(0)
  })

  it('counts whole days forward', () => {
    expect(toDayOffset(fall2026, isoDate('2026-08-25'))).toBe(1)
    expect(toDayOffset(fall2026, isoDate('2026-12-18'))).toBe(116)
  })

  it('goes negative before the term starts', () => {
    expect(toDayOffset(fall2026, isoDate('2026-08-13'))).toBe(-11)
  })

  it('is unaffected by daylight saving, which falls inside the term', () => {
    // US DST ends 2026-11-01, inside the term.
    //
    // This test used to claim it caught a naive local-time implementation. It
    // does not, and saying so was worse than not testing it: across a DST
    // boundary local midnights are 23 or 25 hours apart, which is 0.96 or 1.04
    // days, and Math.round absorbs every one of them. A local-time version
    // passes this and every other assertion here.
    //
    // What actually keeps the model on UTC is that `Date.parse` reads a bare
    // YYYY-MM-DD as UTC, and isoDate refuses every other spelling — the formats
    // that WOULD parse as local time cannot reach this function.
    const before = toDayOffset(fall2026, isoDate('2026-10-31'))
    const after = toDayOffset(fall2026, isoDate('2026-11-02'))
    expect(after - before).toBe(2)
  })

  it('refuses the date formats that would be read as local time', () => {
    // The real defence, stated as a test rather than as a comment.
    for (const local of ['2026/10/31', '10/31/2026', 'Oct 31 2026']) {
      expect(() => isoDate(local), local).toThrow(/not an ISO date/)
    }
  })

  it('throws on an unparseable epoch instead of returning NaN', () => {
    // The failure in full, if this ever gets past the brand by a cast: every
    // DayOffset becomes NaN; dateSpan's inversion assert stays silent because
    // NaN < NaN is false; spansOverlap then answers false for every pair, so
    // two identical 9am MWF lectures do not conflict — and nothing throws.
    const smuggled = {
      term: termCode('4269'),
      startDate: '2026-08-24T00:00:00Z',
      endDate: '2026-12-18',
    } as unknown as TermCalendar

    expect(() => toDayOffset(smuggled, isoDate('2026-09-01'))).toThrow(/term epoch/)
    expect(() => dateSpan(smuggled, 'AUG-24', 'DEC-18')).toThrow(/term epoch/)
  })

  it('produces finite offsets for the real term, which is what NaN would break', () => {
    const span = dateSpan(fall2026, 'AUG-24', 'DEC-18')
    expect(Number.isFinite(span.startDay)).toBe(true)
    expect(Number.isFinite(span.endDay)).toBe(true)
    expect(spansOverlap(span, span)).toBe(true)
  })
})

describe('dateSpan and spansOverlap', () => {
  const span = (b: string, e: string) => dateSpan(fall2026, b, e)

  it('overlaps when two spans share any day', () => {
    expect(spansOverlap(span('AUG-24', 'DEC-18'), span('OCT-21', 'DEC-18'))).toBe(true)
  })

  it('overlaps on a single shared day, inclusively', () => {
    expect(spansOverlap(span('AUG-24', 'SEP-22'), span('SEP-22', 'DEC-18'))).toBe(true)
  })

  it('does not overlap disjoint spans', () => {
    expect(spansOverlap(span('AUG-24', 'SEP-30'), span('OCT-01', 'DEC-18'))).toBe(false)
  })

  it('makes the year-wrap span overlap the main term, as it must', () => {
    // The bug this guards: both years read as 2026 gives an inverted span that
    // overlaps nothing, so a year-long class conflicts with nothing all term.
    expect(spansOverlap(span('AUG-13', 'MAY-26'), span('AUG-24', 'DEC-18'))).toBe(true)
  })

  it('produces a forward-running span for the year-wrap case', () => {
    const wrapped = span('AUG-13', 'MAY-26')
    expect(wrapped.endDay).toBeGreaterThan(wrapped.startDay)
  })
})
