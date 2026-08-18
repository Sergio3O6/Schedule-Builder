import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import { assertColumnLayout, cell, columnOf, FIELDS } from './columns.ts'
import type { SheetRow } from '../xlsx/workbook.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')

/** The real header row, read from a real export. */
const realHeader = (): SheetRow => {
  const rows = readWorkbook(new Uint8Array(readFileSync(FIXTURE)))
  const header = rows[0]
  if (header === undefined) throw new Error('fixture has no rows')
  return header
}

const edited = (header: SheetRow, changes: Record<string, string | null>): SheetRow => {
  const copy = new Map(header)
  for (const [column, value] of Object.entries(changes)) {
    if (value === null) copy.delete(column)
    else copy.set(column, value)
  }
  return copy
}

describe('assertColumnLayout', () => {
  it('accepts the header a real export actually carries', () => {
    expect(() => assertColumnLayout(realHeader())).not.toThrow()
  })

  it('covers all 32 columns, including the ones nothing reads', () => {
    // A gap in the map is exactly where an inserted column slips through.
    expect(FIELDS).toHaveLength(32)
    expect(columnOf('subject')).toBe('A')
    expect(columnOf('csWaitTotal')).toBe('AF')
  })

  it('refuses a renamed column', () => {
    const header = edited(realHeader(), { G: 'Sec nbr' })
    expect(() => assertColumnLayout(header)).toThrow(/G: expected "Sec\. nbr", found "Sec nbr"/)
  })

  it('names every shifted column, not just the first', () => {
    // An inserted column shifts everything after it. Failing on the first
    // would describe a 20-column problem as a 1-column problem and send the
    // reader looking in the wrong place.
    const real = realHeader()
    const shifted = new Map(real)
    shifted.set('N', 'Consent')
    shifted.set('O', 'Enrollable')
    shifted.set('P', 'Instructor')
    const message = (() => {
      try {
        assertColumnLayout(shifted)
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toContain('N: expected "Component"')
    expect(message).toContain('O: expected "Consent"')
    expect(message).toContain('P: expected "Enrollable"')
  })

  it('refuses a column that has gone missing', () => {
    expect(() => assertColumnLayout(edited(realHeader(), { AB: null }))).toThrow(
      /AB: expected "Comb Sect ID", found ""/,
    )
  })

  it('reports a column appended past the end', () => {
    // Harmless to the fields before it, but still a change in the export we
    // should see rather than discover later.
    expect(() => assertColumnLayout(edited(realHeader(), { AG: 'Something New' }))).toThrow(
      /AG: unexpected column "Something New"/,
    )
  })

  it('says what to do about it', () => {
    expect(() => assertColumnLayout(edited(realHeader(), { A: 'Subject' }))).toThrow(
      /scripts\/normalize\/columns\.ts/,
    )
  })

  it('tolerates padding in the header text', () => {
    expect(() => assertColumnLayout(edited(realHeader(), { A: '  Course  ' }))).not.toThrow()
  })
})

describe('cell', () => {
  it('reads a field by meaning rather than by letter', () => {
    const rows = readWorkbook(new Uint8Array(readFileSync(FIXTURE)))
    const first = rows[1]
    if (first === undefined) throw new Error('fixture has no data rows')
    expect(cell(first, 'subject')).toBe('EECS')
    expect(cell(first, 'number').trim()).not.toBe('')
  })

  it('treats an absent cell as empty, because a spreadsheet omits blanks', () => {
    expect(cell(new Map(), 'topic')).toBe('')
  })
})
