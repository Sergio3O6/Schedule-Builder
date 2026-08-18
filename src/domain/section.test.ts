import { describe, expect, it } from 'vitest'
import {
  CAREER_CODES,
  COMPONENT_CODES,
  CONSENT_CODES,
  isVariableCredit,
  parseCareer,
  parseComponent,
  parseConsent,
  parseCredits,
  parseEnrollable,
  parseEnrollment,
  parseTitle,
  parseTopic,
  sectionsConflict,
  vocabularyLabel,
} from './section.ts'
import type { Section } from './section.ts'
import { classNbr, courseKey, sectionNumber, termCode } from './ids.ts'
import { classifyMeeting } from './meeting.ts'
import type { ScheduledMeeting } from './meeting.ts'
import { dateSpan, parseClockTime, parseDayMask, termCalendar } from './time.ts'

describe('the measured alphabets', () => {
  it('carries every component code the full term contains', () => {
    // Sixteen. The three-subject probe that preceded the whole-term crawl found
    // ten; RSC and STU are three rows between them, which is the tail a probe
    // misses and a closed union would have died on.
    expect(COMPONENT_CODES).toHaveLength(16)
    for (const code of ['LEC', 'IND', 'RSH', 'CLN', 'THE', 'LAB', 'LBN', 'FLD'] as const) {
      expect(COMPONENT_CODES).toContain(code)
    }
    for (const rare of ['RSC', 'STU'] as const) expect(COMPONENT_CODES).toContain(rare)
  })

  it('carries all six careers, including the four the filter drops', () => {
    // MED, GRDK, UGDK and LAW are filtered out downstream, but they must parse:
    // the filter reads this value to make its decision.
    expect([...CAREER_CODES].sort()).toEqual(['GRDK', 'GRDL', 'LAW', 'MED', 'UGDK', 'UGDL'])
  })

  it('carries all three consent values', () => {
    expect([...CONSENT_CODES].sort()).toEqual(['Department', 'Instructor', 'None'])
  })

  it('lists each vocabulary without duplicates', () => {
    for (const codes of [COMPONENT_CODES, CAREER_CODES, CONSENT_CODES]) {
      expect(new Set(codes).size).toBe(codes.length)
    }
  })
})

describe('parsing a known code', () => {
  it('recognises every component in the list', () => {
    for (const code of COMPONENT_CODES) {
      expect(parseComponent(code)).toEqual({ kind: 'known', code })
    }
  })

  it('recognises every career and consent in the list', () => {
    for (const code of CAREER_CODES) expect(parseCareer(code)).toEqual({ kind: 'known', code })
    for (const code of CONSENT_CODES) expect(parseConsent(code)).toEqual({ kind: 'known', code })
  })

  it('trims the padding the export puts on its cells', () => {
    expect(parseComponent('  LEC  ')).toEqual({ kind: 'known', code: 'LEC' })
  })

  it('answers with the canonical spelling regardless of case', () => {
    // If KU's generator ever changes its mind about capitalisation, every row
    // in the file would otherwise move into the `other` arm while every value
    // in it stayed perfectly recognisable to a human.
    expect(parseComponent('lec')).toEqual({ kind: 'known', code: 'LEC' })
    expect(parseConsent('INSTRUCTOR')).toEqual({ kind: 'known', code: 'Instructor' })
    expect(parseConsent('none')).toEqual({ kind: 'known', code: 'None' })
    expect(parseCareer('ugdl')).toEqual({ kind: 'known', code: 'UGDL' })
  })
})

describe('parsing a code the vocabulary does not contain', () => {
  it('keeps the row instead of failing the run', () => {
    // The whole point of the open union: a code nobody anticipated costs one
    // section its nice label, not the rebuild.
    expect(parseComponent('QQQ')).toEqual({ kind: 'other', raw: 'QQQ' })
    expect(parseCareer('DENT')).toEqual({ kind: 'other', raw: 'DENT' })
    expect(parseConsent('Advisor')).toEqual({ kind: 'other', raw: 'Advisor' })
  })

  it('preserves the raw text exactly, so the code is reportable', () => {
    // A normalizer's job on an unknown value is to tell someone. It cannot do
    // that from a value that has been normalised into anonymity.
    expect(parseComponent('  Studio-B  ')).toEqual({ kind: 'other', raw: 'Studio-B' })
  })

  it('never throws on any single character', () => {
    for (let c = 33; c < 127; c++) {
      const raw = String.fromCharCode(c)
      expect(() => parseComponent(raw), raw).not.toThrow()
    }
  })
})

describe('a blank value', () => {
  it('is refused rather than degraded to an unknown code', () => {
    // An unknown code means the vocabulary grew, which is expected. An absent
    // value means a column this model depends on stopped being published.
    // {kind:'other', raw:''} would report success while saying nothing.
    for (const blank of ['', '   ', '\t']) {
      expect(() => parseComponent(blank), blank).toThrow(/component is blank/)
      expect(() => parseCareer(blank), blank).toThrow(/academic career is blank/)
      expect(() => parseConsent(blank), blank).toThrow(/consent is blank/)
    }
  })
})

describe('vocabularyLabel', () => {
  it('gives an unknown code a name to display', () => {
    expect(vocabularyLabel(parseComponent('LEC'))).toBe('LEC')
    expect(vocabularyLabel(parseComponent('QQQ'))).toBe('QQQ')
  })
})

describe('parseEnrollable', () => {
  it('reads both answers the export gives', () => {
    expect(parseEnrollable('Yes')).toBe(true)
    expect(parseEnrollable('No')).toBe(false)
    expect(parseEnrollable(' yes ')).toBe(true)
    expect(parseEnrollable('NO')).toBe(false)
  })

  it('refuses a third answer rather than guessing one', () => {
    // Closed on purpose, unlike the three vocabularies above. Defaulting to
    // true offers sections nobody can register for; defaulting to false hides
    // the 16,906 that anybody can. There is no safe guess, so there is no guess.
    for (const bad of ['', 'Y', 'true', 'Maybe', '1']) {
      expect(() => parseEnrollable(bad), bad).toThrow(/neither Yes nor No/)
    }
  })
})

describe('parseCredits', () => {
  it('reads a fixed credit value', () => {
    expect(parseCredits('3.0', '3.0')).toEqual({ min: 3, max: 3 })
  })

  it('keeps a range as a range', () => {
    // 8,378 of 17,338 rows — nearly half the file — publish a Min below their
    // Max. Collapsing that would state a credit total the student has not
    // chosen yet, for half the catalogue.
    expect(parseCredits('1.0', '6.0')).toEqual({ min: 1, max: 6 })
    expect(isVariableCredit(parseCredits('1.0', '6.0'))).toBe(true)
    expect(isVariableCredit(parseCredits('3.0', '3.0'))).toBe(false)
  })

  it('keeps the fractional hours 22 rows really use', () => {
    expect(parseCredits('0.25', '0.25')).toEqual({ min: 0.25, max: 0.25 })
    expect(parseCredits('0.5', '1.5')).toEqual({ min: 0.5, max: 1.5 })
  })

  it('accepts a zero-credit section as a real value', () => {
    // 89 rows have Max 0.0 and 363 have Min 0.0. Treating zero as missing
    // would silently drop them or invent hours they do not carry.
    expect(parseCredits('0.0', '0.0')).toEqual({ min: 0, max: 0 })
    expect(parseCredits('0.0', '3.0')).toEqual({ min: 0, max: 3 })
  })

  it('spans the full measured range', () => {
    // Min runs to 14 and Max to 16 in the live export.
    expect(parseCredits('14.0', '16.0')).toEqual({ min: 14, max: 16 })
  })

  it('refuses an inverted range', () => {
    // Holds in all 17,338 rows today. If it stops holding, the range is empty
    // and everything that renders or sums it is showing nonsense.
    expect(() => parseCredits('6.0', '1.0')).toThrow(/minimum credit hours exceeds maximum/)
  })

  it('refuses negative credit', () => {
    expect(() => parseCredits('-1.0', '3.0')).toThrow(/minimum credit hours is negative/)
    expect(() => parseCredits('0.0', '-3.0')).toThrow(/maximum credit hours is negative/)
  })

  it('refuses a blank, which would otherwise read as zero credit', () => {
    expect(() => parseCredits('', '3.0')).toThrow(/minimum credit hours is not a decimal/)
  })
})

describe('parseEnrollment', () => {
  const raw = {
    cap: '30.0',
    enrolled: '10.0',
    seatsAvailable: '20.0',
    waitCap: '0.0',
    waitTotal: '0.0',
  }

  it('reads the five counts', () => {
    expect(parseEnrollment(raw)).toEqual({
      cap: 30,
      enrolled: 10,
      seatsAvailable: 20,
      waitCap: 0,
      waitTotal: 0,
    })
  })

  it('accepts negative seats available, because the feed publishes them', () => {
    // 431 rows are negative, down to -104. Clamping to zero would report a
    // full section as merely full, losing how far past its cap it is.
    expect(parseEnrollment({ ...raw, seatsAvailable: '-104.0' }).seatsAvailable).toBe(-104)
  })

  it('accepts enrolment above the cap without complaint', () => {
    // 375 rows do this. Reserved capacity and permission overrides produce it
    // legitimately; refusing it would reject real sections.
    expect(() => parseEnrollment({ ...raw, cap: '10.0', enrolled: '30.0' })).not.toThrow()
  })

  it('does not require the three numbers to reconcile', () => {
    // cap - enrolled === seatsAvailable fails in 1,048 rows. Each column is a
    // separate thing KU published, snapshot at its own moment.
    const odd = parseEnrollment({ ...raw, cap: '30.0', enrolled: '10.0', seatsAvailable: '5.0' })
    expect(odd).toMatchObject({ cap: 30, enrolled: 10, seatsAvailable: 5 })
  })

  it('refuses a negative count in the fields that cannot be negative', () => {
    expect(() => parseEnrollment({ ...raw, cap: '-1.0' })).toThrow(/enrollment cap is negative/)
    expect(() => parseEnrollment({ ...raw, enrolled: '-1.0' })).toThrow(/total enrolled is negative/)
    expect(() => parseEnrollment({ ...raw, waitTotal: '-1.0' })).toThrow(
      /waitlist total is negative/,
    )
  })

  it('refuses a fractional headcount', () => {
    expect(() => parseEnrollment({ ...raw, enrolled: '10.5' })).toThrow(
      /total enrolled is not an integer/,
    )
  })

  it('names the column it rejected, since all five look alike', () => {
    expect(() => parseEnrollment({ ...raw, waitCap: 'x' })).toThrow(/waitlist cap/)
  })
})

describe('parseTitle and parseTopic', () => {
  it('reads a title through unchanged', () => {
    expect(parseTitle('Arabic and Islamic Studies')).toBe('Arabic and Islamic Studies')
  })

  it('strips the zero-width space hiding in the one non-ASCII cell', () => {
    // GEOL 591's topic has U+200B between 'Quantitat' and 'ive' — the only
    // non-ASCII character in all 17,338 rows. It is invisible on screen and it
    // defeats any search for 'Quantitative'.
    expect(parseTopic('Quantitat\u200Bive Geosci for Grads')).toBe('Quantitative Geosci for Grads')
  })

  it('collapses the runs of internal spaces 59 titles carry', () => {
    expect(parseTitle('Intro  to   Biology')).toBe('Intro to Biology')
  })

  it('leaves case, punctuation and abbreviation alone', () => {
    // The feed truncates titles to 30 characters, so they are already
    // abbreviations. Improving them would be inventing course names.
    expect(parseTitle('Intro Comp Sci & Prog I')).toBe('Intro Comp Sci & Prog I')
  })

  it('treats a blank topic as absent', () => {
    expect(parseTopic('')).toBeNull()
    expect(parseTopic('  \u200B ')).toBeNull()
  })

  it('refuses a blank title, which never occurs in the export', () => {
    expect(() => parseTitle('   ')).toThrow(/course title is blank/)
  })
})

describe('sectionsConflict', () => {
  const fall = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')
  const scheduled = (days: string, start: string, end: string): ScheduledMeeting => {
    const m = classifyMeeting({
      days: parseDayMask(days),
      start: parseClockTime(start),
      end: parseClockTime(end),
      rawStart: start,
      span: dateSpan(fall, 'AUG-24', 'DEC-18'),
      place: { campus: 'LAWRENCE', room: null },
    })
    if (m.kind !== 'scheduled') throw new Error('fixture is not scheduled')
    return m
  }

  const section = (meetings: readonly ScheduledMeeting[]): Section => ({
    classNbr: classNbr('17939'),
    courseKey: courseKey('EECS', ' 168'),
    number: sectionNumber('1000'),
    title: 'Programming I',
    topic: null,
    component: parseComponent('LEC'),
    career: parseCareer('UGDL'),
    consent: parseConsent('None'),
    credits: parseCredits('4.0', '4.0'),
    enrollable: true,
    combSectId: null,
    enrollment: parseEnrollment({
      cap: '30.0',
      enrolled: '10.0',
      seatsAvailable: '20.0',
      waitCap: '0.0',
      waitTotal: '0.0',
    }),
    instructors: [],
    scheduled: meetings,
    unscheduled: [],
  })

  it('reports a collision between overlapping meetings', () => {
    const a = section([scheduled('MWF', '09:00 AM', '09:50 AM')])
    const b = section([scheduled('MWF', '09:30 AM', '10:20 AM')])
    expect(sectionsConflict(a, b)).toBe(true)
  })

  it('lets back-to-back classes stand', () => {
    const a = section([scheduled('MWF', '09:00 AM', '09:50 AM')])
    const b = section([scheduled('MWF', '09:50 AM', '10:40 AM')])
    expect(sectionsConflict(a, b)).toBe(false)
  })

  it('checks every meeting pattern, not just the first', () => {
    // 459 class numbers carry a genuine second pattern — a lecture that meets
    // MWF and also Th. Comparing only the first would miss half of them.
    const a = section([scheduled('MWF', '09:00 AM', '09:50 AM'), scheduled('Th', '02:00 PM', '03:50 PM')])
    const b = section([scheduled('Th', '03:00 PM', '04:00 PM')])
    expect(sectionsConflict(a, b)).toBe(true)
  })

  it('makes a section with nothing scheduled conflict with nothing', () => {
    // No special case required: the empty array is the correct representation,
    // and 7,746 rows across the term need it.
    const tba = section([])
    expect(sectionsConflict(tba, section([scheduled('MWF', '09:00 AM', '09:50 AM')]))).toBe(false)
    expect(sectionsConflict(tba, tba)).toBe(false)
  })
})
