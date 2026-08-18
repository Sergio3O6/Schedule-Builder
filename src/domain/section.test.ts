import { describe, expect, it } from 'vitest'
import {
  CAREER_CODES,
  COMPONENT_CODES,
  CONSENT_CODES,
  parseCareer,
  parseComponent,
  parseConsent,
  parseEnrollable,
  vocabularyLabel,
} from './section.ts'

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
