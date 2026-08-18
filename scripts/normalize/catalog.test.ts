import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readWorkbook } from '../xlsx/workbook.ts'
import { buildSections } from './rows.ts'
import { buildCatalog, catalogBytes } from './catalog.ts'
import { termCode } from '../../src/domain/ids.ts'
import { termCalendar } from '../../src/domain/time.ts'
import type { Section } from '../../src/domain/section.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')
const fall = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

const eecs = async (): Promise<readonly Section[]> =>
  buildSections(readWorkbook(new Uint8Array(await readFile(FIXTURE))).slice(1), fall)

describe('buildCatalog', () => {
  it('has one row per course, not per section', async () => {
    const sections = await eecs()
    const catalog = buildCatalog(sections, fall)

    expect(catalog.courses.length).toBeGreaterThan(0)
    expect(catalog.courses.length).toBeLessThan(sections.length)
    expect(new Set(catalog.courses.map(([key]) => key)).size).toBe(catalog.courses.length)
  })

  it('counts every section of each course', async () => {
    const sections = await eecs()
    const catalog = buildCatalog(sections, fall)
    const counted = catalog.courses.reduce((n, [, , count]) => n + count, 0)
    // Nothing is dropped between the bundles and the index they advertise.
    expect(counted).toBe(sections.length)
  })

  it('carries the epoch, so a client can read offsets before fetching a bundle', async () => {
    expect(buildCatalog(await eecs(), fall)).toMatchObject({
      term: '4269',
      startDate: '2026-08-24',
      endDate: '2026-12-18',
    })
  })

  it('sorts by subject then number, so a rebuild is byte-identical', async () => {
    const sections = await eecs()
    const forward = buildCatalog(sections, fall)
    const reversed = buildCatalog([...sections].reverse(), fall)
    expect(catalogBytes(reversed)).toEqual(catalogBytes(forward))
  })

  it('picks the most common title when a course disagrees with itself', async () => {
    // Topics courses carry a different title per topic. The index is a finding
    // aid; the bundle keeps every section's own title for the course page.
    const [base] = await eecs()
    if (base === undefined) throw new Error('fixture has no sections')
    const sections: Section[] = [
      { ...base, classNbr: 1 as typeof base.classNbr, title: 'Special Topics: Robotics' },
      { ...base, classNbr: 2 as typeof base.classNbr, title: 'Special Topics: Compilers' },
      { ...base, classNbr: 3 as typeof base.classNbr, title: 'Special Topics: Compilers' },
    ]
    expect(buildCatalog(sections, fall).courses[0]?.[1]).toBe('Special Topics: Compilers')
  })

  it('is a compact positional row, which is what the eager file is for', async () => {
    const text = new TextDecoder().decode(catalogBytes(buildCatalog(await eecs(), fall)))
    // Three key names repeated across thousands of rows is a third of this
    // payload, and this is the request that blocks first paint.
    expect(text).not.toContain('"title"')
    expect(text).toMatch(/\[\["EECS\|\d+","/)
  })
})
