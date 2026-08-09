import { describe, expect, it } from 'vitest'
import {
  describeDrift,
  diffSubjects,
  hasDrift,
  parseSubjectCodes,
  SUBJECT_CODES,
} from './subjects.ts'

describe('SUBJECT_CODES', () => {
  it('holds the 292 codes the coverage assertion depends on', () => {
    expect(SUBJECT_CODES).toHaveLength(292)
  })

  it('is sorted and free of duplicates, so drift diffs stay readable', () => {
    expect([...SUBJECT_CODES]).toEqual([...SUBJECT_CODES].sort())
    expect(new Set(SUBJECT_CODES).size).toBe(SUBJECT_CODES.length)
  })

  it('stores ampersand codes decoded, not as HTML entities', () => {
    // The form serves C&amp;PE. Storing that verbatim would match nothing.
    for (const code of ['C&PE', 'C&T', 'HP&M', 'LA&S', 'P&TX', 'W&P']) {
      expect(SUBJECT_CODES).toContain(code)
    }
    expect(SUBJECT_CODES.some((c) => c.includes('&amp;'))).toBe(false)
  })

  it('includes the hyphenated codes', () => {
    for (const code of ['CT-C', 'HU-C', 'LD-C', 'PM-C']) {
      expect(SUBJECT_CODES).toContain(code)
    }
  })

  it('stays inside the alphabet the cache will accept as a filename', () => {
    // RawCache validates against exactly this shape; a code outside it would
    // blow up mid-crawl rather than here.
    for (const code of SUBJECT_CODES) {
      expect(code, code).toMatch(/^[A-Z&-]{1,8}$/)
    }
  })
})

describe('parseSubjectCodes', () => {
  const form = (options: string) =>
    `<select id="classesSearchSubject" name="x">${options}</select>`

  it('reads codes from the subject dropdown', () => {
    expect(
      parseSubjectCodes(form('<option value="EECS">EECS</option><option value="BIOL">B</option>')),
    ).toEqual(['BIOL', 'EECS'])
  })

  it('decodes HTML entities', () => {
    expect(parseSubjectCodes(form('<option value="C&amp;PE">x</option>'))).toEqual(['C&PE'])
  })

  it('drops the empty placeholder option', () => {
    expect(parseSubjectCodes(form('<option value="">Select</option><option value="ART">A</option>'))).toEqual(
      ['ART'],
    )
  })

  it('ignores other dropdowns on the page', () => {
    // The page also carries term, career, school and department selects. A loose
    // scan would fold those codes into the catalogue.
    const page = `
      <select id="classesSearchTerm"><option value="4269">Fall 2026</option></select>
      ${form('<option value="EECS">EECS</option>')}
      <select id="classesSearchSchool"><option value="ENGR">Engineering</option></select>`
    expect(parseSubjectCodes(page)).toEqual(['EECS'])
  })

  it('throws when the form markup has changed', () => {
    expect(() => parseSubjectCodes('<html>no such select</html>')).toThrow(/markup has changed/)
  })

  it('deduplicates and sorts', () => {
    expect(
      parseSubjectCodes(form('<option value="B">b</option><option value="A">a</option><option value="B">b</option>')),
    ).toEqual(['A', 'B'])
  })
})

describe('diffSubjects', () => {
  it('finds nothing when the catalogue is unchanged', () => {
    const drift = diffSubjects(['A', 'B'], ['A', 'B'])
    expect(hasDrift(drift)).toBe(false)
  })

  it('reports a subject KU added, which crawling would otherwise skip', () => {
    const drift = diffSubjects(['A'], ['A', 'NEW'])
    expect(drift.added).toEqual(['NEW'])
    expect(drift.removed).toEqual([])
    expect(hasDrift(drift)).toBe(true)
  })

  it('reports a subject KU removed, which crawling would 404', () => {
    const drift = diffSubjects(['A', 'GONE'], ['A'])
    expect(drift.removed).toEqual(['GONE'])
    expect(hasDrift(drift)).toBe(true)
  })

  it('reports both directions at once', () => {
    const drift = diffSubjects(['A', 'GONE'], ['A', 'NEW'])
    expect(drift.added).toEqual(['NEW'])
    expect(drift.removed).toEqual(['GONE'])
  })
})

describe('describeDrift', () => {
  it('names the codes and the file to edit', () => {
    const message = describeDrift(diffSubjects(['A', 'GONE'], ['A', 'NEW']))
    expect(message).toContain('NEW')
    expect(message).toContain('GONE')
    expect(message).toContain('scripts/fetch/subjects.ts')
  })
})

describe('round trip', () => {
  it('parses back exactly the committed list from a rebuilt form', () => {
    // Guards the encode/decode pair: if either side of the entity handling
    // regresses, the ampersand codes stop matching and drift fires spuriously.
    const options = SUBJECT_CODES.map(
      (c) => `<option value="${c.replace(/&/g, '&amp;')}">${c}</option>`,
    ).join('')
    const parsed = parseSubjectCodes(`<select id="classesSearchSubject">${options}</select>`)

    expect(parsed).toEqual([...SUBJECT_CODES])
    expect(hasDrift(diffSubjects(SUBJECT_CODES, parsed))).toBe(false)
  })
})
