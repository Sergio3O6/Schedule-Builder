import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import { buildSections } from './rows.ts'
import { termCode } from '../../src/domain/ids.ts'
import { termCalendar } from '../../src/domain/time.ts'
import type { SheetRow } from '../xlsx/workbook.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const fall = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

/** A row in the export's own shape, defaults matching a plain lecture. */
const row = (over: Partial<Record<string, string>> = {}): SheetRow =>
  new Map(
    Object.entries({
      A: 'EECS',
      B: ' 168',
      C: '000125',
      D: 'Programming I',
      E: '',
      F: '17939',
      G: '1000',
      H: '4.0',
      I: '4.0',
      J: '20.0',
      K: '10.0',
      L: '30.0',
      M: 'UGDL',
      N: 'LEC',
      O: 'None',
      P: 'Yes',
      Q: '',
      R: '09:00 AM',
      S: '09:50 AM',
      T: 'MWF',
      U: 'AUG-24',
      V: 'DEC-18',
      W: 'LAWRENCE',
      X: '',
      Y: '0.0',
      Z: '0.0',
      AA: '0.0',
      AB: '0.0',
      AC: '0.0',
      AD: '0.0',
      AE: '0.0',
      AF: '0.0',
      ...over,
    }),
  )

describe('buildSections', () => {
  it('turns one row into one section with every field parsed', () => {
    const [section] = buildSections([row()], fall)
    expect(section).toMatchObject({
      classNbr: 17939,
      courseKey: 'EECS|168',
      number: '1000',
      title: 'Programming I',
      topic: null,
      component: { kind: 'known', code: 'LEC' },
      career: { kind: 'known', code: 'UGDL' },
      credits: { min: 4, max: 4 },
      enrollable: true,
      combSectId: null,
      instructors: [],
    })
    expect(section?.scheduled).toHaveLength(1)
    expect(section?.unscheduled).toHaveLength(0)
  })

  it('unions the meetings of one class number into one section', () => {
    // 459 class numbers carry a genuine second pattern — a lecture that meets
    // MWF and also Th. Taking one row per class number drops it, and a student
    // misses a class they have to attend.
    const sections = buildSections(
      [row(), row({ T: 'Th', R: '02:00 PM', S: '03:50 PM' })],
      fall,
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]?.scheduled).toHaveLength(2)
  })

  it('drops a verbatim duplicate rather than rendering it twice', () => {
    // 129 class numbers repeat a row exactly — BAND 402 publishes the same
    // meeting five times, which is five identical blocks on one calendar square.
    const sections = buildSections([row(), row(), row()], fall)
    expect(sections[0]?.scheduled).toHaveLength(1)
  })

  it('keeps two different meetings that merely share a time', () => {
    const sections = buildSections([row(), row({ W: 'EDWARDS' })], fall)
    expect(sections[0]?.scheduled).toHaveLength(2)
  })

  it('separates different class numbers', () => {
    const sections = buildSections([row(), row({ F: '17940', G: '1010' })], fall)
    expect(sections).toHaveLength(2)
  })

  it('keeps the export order, so an unchanged rebuild is identical', () => {
    const sections = buildSections([row({ F: '3' }), row({ F: '1' }), row({ F: '2' })], fall)
    expect(sections.map((s) => s.classNbr)).toEqual([3, 1, 2])
  })

  it('files an unscheduled meeting in the array conflict code cannot see', () => {
    const [section] = buildSections([row({ R: 'APPT', S: '', T: '' })], fall)
    expect(section?.scheduled).toHaveLength(0)
    expect(section?.unscheduled).toEqual([expect.objectContaining({ reason: 'appointment' })])
  })

  it('refuses a class number that disagrees with itself', () => {
    // Measured true across every multi-row class number with zero exceptions,
    // but it is upstream's invariant and the whole grouping rests on it.
    // Silently keeping the first row's title would be exactly the wrong answer.
    expect(() => buildSections([row(), row({ D: 'Programming II' })], fall)).toThrow(
      /17939 disagrees with itself on title \(column D\)/,
    )
  })

  it('checks identity fields the section itself never reads', () => {
    // The identity set is everything that is not a meeting column, derived by
    // subtraction — so a column added to columns.ts is guarded by default.
    expect(() => buildSections([row(), row({ C: '000999' })], fall)).toThrow(
      /disagrees with itself on courseNbr/,
    )
    expect(() => buildSections([row(), row({ AC: '5.0' })], fall)).toThrow(
      /disagrees with itself on csEnrollCap/,
    )
  })

  it('lets the meeting columns differ, which is the point of grouping', () => {
    for (const change of [{ T: 'TuTh' }, { U: 'OCT-21' }, { W: 'ONLINC' }]) {
      expect(() => buildSections([row(), row(change)], fall)).not.toThrow()
    }
  })

  it('refuses a row with no class number', () => {
    expect(() => buildSections([row({ F: '   ' })], fall)).toThrow(/no class number/)
  })

  it('assembles a real single-subject export', async () => {
    const rows = readWorkbook(new Uint8Array(await readFile(FIXTURE))).slice(1)
    const sections = buildSections(rows, fall)

    expect(rows).toHaveLength(423)
    expect(sections.length).toBeLessThan(rows.length)
    expect(sections.every((s) => s.courseKey.startsWith('EECS|'))).toBe(true)
    // Every meeting is accounted for: nothing is dropped except duplicates.
    const meetings = sections.reduce((n, s) => n + s.scheduled.length + s.unscheduled.length, 0)
    expect(meetings).toBeGreaterThan(0)
    expect(meetings).toBeLessThanOrEqual(rows.length)
  })
})
