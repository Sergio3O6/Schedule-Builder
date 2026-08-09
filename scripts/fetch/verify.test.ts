import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import type { SheetRow } from '../xlsx/workbook.ts'
import { assessCoverage, describeCoverage, isComplete, stripHeaderRow } from './verify.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const eecsRows = async () => readWorkbook(new Uint8Array(await readFile(FIXTURE)))

/** Rows carrying only the subject column, which is all these checks read. */
const rowsFor = (...subjects: string[]): SheetRow[] =>
  subjects.map((s) => new Map([['A', s]]))

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
    // A single-subject file must never be mistaken for a whole-term crawl: here
    // the missing codes form an unbroken tail, which is the cap signature.
    const report = assessCoverage(stripHeaderRow(await eecsRows()), ['EECS', 'MATH', 'WOLO'])
    expect(report.looksTruncated).toBe(true)
    expect(isComplete(report)).toBe(false)
    expect(report.missingSubjects).toEqual(['MATH', 'WOLO'])
  })
})

describe('truncation', () => {
  it('fails when the missing subjects form an unbroken alphabetical tail', () => {
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
    // AECL sorts before WGSS, so no cap could have produced this.
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
    // The tail test alone cannot see this: one subject out of many, with gaps on
    // both sides of it, is not a truncation signature but is plainly broken.
    const report = assessCoverage(rowsFor(...Array<string>(500).fill('EECS')), [
      'AAAS',
      'BIOL',
      'EECS',
      'MATH',
      'WOLO',
    ])

    expect(report.looksTruncated).toBe(false)
    expect(report.presentSubjectRatio).toBeCloseTo(0.2)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toContain('20.0% of expected subjects')
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

  it('does not flag an ordinary total', () => {
    const report = assessCoverage(rowsFor(...Array<string>(9999).fill('EECS')), ['EECS'])
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
