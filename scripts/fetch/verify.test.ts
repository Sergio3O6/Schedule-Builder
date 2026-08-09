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

  it('rejects it against the full catalogue, since 291 subjects are absent', async () => {
    // A single-subject file must never be mistaken for a whole-term crawl.
    const report = assessCoverage(stripHeaderRow(await eecsRows()), ['AAAS', 'BIOL', 'EECS'])
    expect(isComplete(report)).toBe(false)
    expect(report.missingSubjects).toEqual(['AAAS', 'BIOL'])
  })
})

describe('truncation', () => {
  it('fails when the alphabetically last subject is empty', () => {
    // The shape a tail-truncating cap actually produces.
    const rows = [...rowsFor(...Array<string>(500).fill('AAAS'))]
    const report = assessCoverage(rows, ['AAAS', 'WOLO'])

    expect(report.lastExpectedSubject).toBe('WOLO')
    expect(report.lastExpectedSubjectRows).toBe(0)
    expect(isComplete(report)).toBe(false)
    expect(describeCoverage(report)).toContain('tail is exactly where a result cap shows')
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
    expect(message).toContain('25 expected subjects absent')
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
