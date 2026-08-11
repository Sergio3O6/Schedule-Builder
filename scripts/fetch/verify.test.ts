import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import type { SheetRow } from '../xlsx/workbook.ts'
import { SUBJECT_CODES } from './subjects.ts'
import { assessCoverage, describeCoverage, isComplete, stripHeaderRow } from './verify.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const eecsRows = async () => readWorkbook(new Uint8Array(await readFile(FIXTURE)))

/** Rows carrying only the subject column, which is all these checks read. */
const rowsFor = (...subjects: string[]): SheetRow[] =>
  subjects.map((s) => new Map([['A', s]]))

/** The real catalogue, sorted as assessCoverage sorts it. */
const CATALOGUE = [...SUBJECT_CODES].sort()

/** The 17 codes that offered no classes in Fall 2026, verified against the export. */
const REALLY_EMPTY = [
  'AECL', 'AECR', 'AESP', 'BCRS', 'BSCI', 'CEAS', 'CT-C', 'CZCH', 'HU-C',
  'IPHI', 'LD-C', 'MBIO', 'OTMS', 'PM-C', 'TIB', 'TURK', 'WOLO',
]

/**
 * A whole-term export covering `present`, with EECS padded past its 400-row
 * floor so the floor check never masks what a test is actually asserting.
 */
const exportCovering = (present: readonly string[]): SheetRow[] =>
  rowsFor(...Array<string>(423).fill('EECS'), ...present.filter((s) => s !== 'EECS'))

describe('stripHeaderRow', () => {
  it('drops KU real header row', async () => {
    const all = await eecsRows()
    expect(stripHeaderRow(all)).toHaveLength(all.length - 1)
  })

  it('leaves the first data row intact', async () => {
    expect(stripHeaderRow(await eecsRows())[0]?.get('A')).toBe('EECS')
  })

  it('refuses an export whose header has moved', () => {
    // If the header shifts, every column letter in this project is suspect.
    expect(() => stripHeaderRow(rowsFor('EECS'))).toThrow(/unexpected header/)
  })

  it('refuses an empty export', () => {
    expect(() => stripHeaderRow([])).toThrow(/no header row/)
  })
})

describe('assessCoverage against the real EECS export', () => {
  it('counts the verified 423 rows under one subject', async () => {
    const report = assessCoverage(stripHeaderRow(await eecsRows()), ['EECS'])
    expect(report.totalRows).toBe(423)
    expect(report.rowsBySubject.get('EECS')).toBe(423)
  })

  it('accepts it as complete when EECS is all that was expected', async () => {
    const report = assessCoverage(stripHeaderRow(await eecsRows()), ['EECS'])
    expect(isComplete(report)).toBe(true)
    expect(describeCoverage(report)).toContain('PASS')
  })

  it('rejects it when everything absent sorts after EECS', async () => {
    // A single-subject file must never be mistaken for a whole-term crawl: the
    // catalogue stops a third of the way through, which is the cap signature.
    const report = assessCoverage(stripHeaderRow(await eecsRows()), ['EECS', 'MATH', 'WOLO'])
    expect(report.looksTruncated).toBe(true)
    expect(report.tailCoverage).toBeCloseTo(1 / 3)
    expect(isComplete(report)).toBe(false)
    expect(report.missingSubjects).toEqual(['MATH', 'WOLO'])
  })
})

describe('truncation against the real 292-code catalogue', () => {
  it('rejects a cap that stops mid-alphabet even though an empty subject sorts early', () => {
    // The regression. Measured on the live export: a 9,999-row cap returns 156
    // subjects and stops at MATH. Every other check passes it — 57% of subjects
    // present clears the 0.5 ratio floor, 9,999 is not round, EECS is intact —
    // so the tail test is the only thing standing between this and a PASS.
    //
    // AECL is deliberately absent too. It is one of the 17 genuinely empty codes
    // and sorts second, which is exactly what defeated the previous predicate:
    // "every missing subject sorts after every present one" is false the moment
    // one scattered gap exists, however much of the tail is gone.
    const cut = CATALOGUE.indexOf('MATH') + 1
    const present = CATALOGUE.slice(0, cut).filter((s) => s !== 'AECL')
    const report = assessCoverage(exportCovering(present), SUBJECT_CODES)

    expect(report.lastPresentSubject).toBe('MATH')
    expect(report.firstMissingSubject).toBe('AECL')
    expect(report.tailCoverage).toBeCloseTo(0.572, 3)
    expect(report.looksTruncated).toBe(true)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toContain('what a result cap looks like')

    // The other three checks really do pass, so this is not passing by accident.
    expect(report.presentSubjectRatio).toBeGreaterThan(0.5)
    expect(report.suspiciouslyRoundTotal).toBe(false)
    expect(report.floorSubjectRows).toBeGreaterThanOrEqual(400)
  })

  it('accepts the real Fall 2026 coverage: 275 of 292, WOLO the only code past the end', () => {
    const present = CATALOGUE.filter((s) => !REALLY_EMPTY.includes(s))
    const report = assessCoverage(exportCovering(present), SUBJECT_CODES)

    expect(report.rowsBySubject.size).toBe(275)
    expect(report.lastPresentSubject).toBe('WGSS')
    expect(report.absentTailLength).toBe(1)
    expect(report.tailCoverage).toBeCloseTo(291 / 292, 4)
    expect(report.looksTruncated).toBe(false)
    expect(isComplete(report)).toBe(true)
  })

  it('rejects a cap that lands inside the last 10% of the alphabet', () => {
    // A 16,000-row cap: 253 of 275 subjects, stopping at SW. Only 338 rows short
    // of the full file, and still caught.
    const present = CATALOGUE.slice(0, CATALOGUE.indexOf('SW') + 1)
    const report = assessCoverage(exportCovering(present), SUBJECT_CODES)

    expect(report.tailCoverage).toBeCloseTo(0.914, 3)
    expect(report.looksTruncated).toBe(true)
  })

  it('states its own blind spot: a cap in the last 2% is not detectable here', () => {
    // 17,000 rows of 17,338 stops at VNCL, coverage 0.983. Documented rather
    // than pretended away — no coverage test can see a cap this shallow.
    const present = CATALOGUE.slice(0, CATALOGUE.indexOf('VNCL') + 1)
    const report = assessCoverage(exportCovering(present), SUBJECT_CODES)

    expect(report.tailCoverage).toBeGreaterThan(0.95)
    expect(report.looksTruncated).toBe(false)
  })
})

describe('truncation', () => {
  it('fails when the catalogue stops near the front', () => {
    // The shape a tail-truncating cap actually produces.
    const report = assessCoverage(rowsFor(...Array<string>(500).fill('AAAS')), [
      'AAAS',
      'MATH',
      'WOLO',
    ])

    expect(report.lastPresentSubject).toBe('AAAS')
    expect(report.firstMissingSubject).toBe('MATH')
    expect(report.looksTruncated).toBe(true)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toContain('what a result cap looks like')
  })

  it('accepts gaps scattered through the alphabet as empty subjects', () => {
    // The real Fall 2026 shape: 17 of 292 codes offer no classes, spread from
    // AECL to WOLO. Requesting one individually returns KU's "no classes" page.
    const present = ['AAAS', 'BIOL', 'EECS', 'MATH', 'WGSS']
    const rows = rowsFor(
      ...Array<string>(500).fill('EECS'),
      ...present.filter((s) => s !== 'EECS'),
    )
    const report = assessCoverage(rows, [...present, 'AECL', 'CZCH', 'WOLO'])

    expect(report.missingSubjects).toEqual(['AECL', 'CZCH', 'WOLO'])
    expect(report.firstMissingSubject).toBe('AECL')
    expect(report.lastPresentSubject).toBe('WGSS')
    // The gaps are interior, so the file still reaches the end of the alphabet.
    // Only WOLO sorts past the last present code — not a tail worth the name.
    expect(report.absentTailLength).toBe(1)
    expect(report.looksTruncated).toBe(false)
    expect(isComplete(report)).toBe(true)
    expect(describeCoverage(report)).toContain('offering no classes this term')
  })

  it('fails when nothing came back at all', () => {
    const report = assessCoverage([], ['AAAS', 'EECS'])
    expect(report.looksTruncated).toBe(true)
    expect(isComplete(report)).toBe(false)
  })

  it('fails when most of the catalogue is missing, however the gaps fall', () => {
    // The tail test cannot see this and is not meant to: the file reaches WGSS,
    // so coverage is 99.7% and nothing was cut off the end — but only two of 292
    // subjects came back. Broken in a way no cap explains, caught by the ratio.
    const report = assessCoverage(exportCovering(['EECS', 'WGSS']), SUBJECT_CODES)

    expect(report.looksTruncated).toBe(false)
    expect(report.presentSubjectRatio).toBeCloseTo(2 / 292, 4)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toContain('0.7% of expected subjects')
  })

  it('accepts the real Fall 2026 shape: 275 of 292, gaps not at the tail', () => {
    // 'M' codes are missing and 'S' codes present, so the gaps sort before the
    // last present subject — scattered, exactly as the live data came back.
    const present = ['EECS', ...Array.from({ length: 274 }, (_, i) => `S${String(i).padStart(3, '0')}`)]
    const missing = Array.from({ length: 17 }, (_, i) => `M${String(i).padStart(3, '0')}`)

    const report = assessCoverage(rowsFor(...Array<string>(500).fill('EECS'), ...present), [
      ...present,
      ...missing,
    ])

    expect(report.missingSubjects).toHaveLength(17)
    expect(report.looksTruncated).toBe(false)
    expect(report.presentSubjectRatio).toBeCloseTo(275 / 292, 2)
    expect(isComplete(report)).toBe(true)
  })

  it('flags a suspiciously round total even when coverage looks fine', () => {
    const rows = rowsFor(...Array<string>(10000).fill('EECS'))
    const report = assessCoverage(rows, ['EECS'])

    expect(report.suspiciouslyRoundTotal).toBe(true)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toMatch(/round enough to be a configured cap/)
  })

  it('flags a round cap that counted the header row it emitted', () => {
    // 9,999 data rows means 10,000 rows in the file. The count reaching this
    // function is post-stripHeaderRow, so a cap set at a round number lands here
    // one short of round and used to slip through.
    const report = assessCoverage(rowsFor(...Array<string>(9999).fill('EECS')), ['EECS'])
    expect(report.suspiciouslyRoundTotal).toBe(true)
    expect(isComplete(report)).toBe(false)
  })

  it('does not flag an ordinary total', () => {
    const report = assessCoverage(rowsFor(...Array<string>(9998).fill('EECS')), ['EECS'])
    expect(report.suspiciouslyRoundTotal).toBe(false)
  })

  it('does not flag the real 17,338-row total', () => {
    const report = assessCoverage(rowsFor(...Array<string>(17338).fill('EECS')), ['EECS'])
    expect(report.suspiciouslyRoundTotal).toBe(false)
  })

  it('fails when the floor subject comes back thin', () => {
    const report = assessCoverage(rowsFor(...Array<string>(12).fill('EECS')), ['EECS'])
    expect(report.floorSubjectRows).toBe(12)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toMatch(/below the 400 floor/)
  })
})

describe('missing subjects', () => {
  it('lists them sorted', () => {
    const report = assessCoverage(rowsFor('EECS'), ['ZZZZ', 'AAAS', 'EECS'])
    expect(report.missingSubjects).toEqual(['AAAS', 'ZZZZ'])
  })

  it('truncates a long list in the report but still states the count', () => {
    const expected = Array.from({ length: 25 }, (_, i) => `S${String(i).padStart(2, '0')}`)
    const message = describeCoverage(assessCoverage(rowsFor('EECS'), [...expected, 'EECS']))
    expect(message).toContain('25 subjects absent')
    expect(message).toContain('+15 more')
  })
})

describe('unexpected subjects', () => {
  it('warns without failing, since extra data is not missing data', () => {
    const rows = rowsFor(...Array<string>(500).fill('EECS'), 'SURPRISE')
    const report = assessCoverage(rows, ['EECS'])

    expect(report.unexpectedSubjects).toEqual(['SURPRISE'])
    expect(isComplete(report)).toBe(true)
    expect(describeCoverage(report)).toContain('WARN')
  })
})

describe('blank subject cells', () => {
  it('ignores them rather than counting a phantom subject', () => {
    const rows: SheetRow[] = [...rowsFor(...Array<string>(500).fill('EECS')), new Map([['A', '']])]
    const report = assessCoverage(rows, ['EECS'])

    expect(report.rowsBySubject.has('')).toBe(false)
    expect(report.totalRows).toBe(501)
  })
})
