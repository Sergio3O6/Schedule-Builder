import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CATALOG_URL, loadCatalog } from './catalog.ts'
import { termCode } from '../domain/ids.ts'
import { termCalendar } from '../domain/time.ts'
import { readWorkbook } from '../../scripts/xlsx/workbook.ts'
import { buildSections } from '../../scripts/normalize/rows.ts'
import { buildCatalog, catalogBytes } from '../../scripts/normalize/catalog.ts'
import type { FetchLike } from './catalog.ts'

const term = termCode('4269')
const fall = termCalendar(term, '2026-08-24', '2026-12-18')

/** Built by the real normalizer, so this tests the contract, not a snapshot. */
const realCatalog = async (): Promise<unknown> => {
  const rows = readWorkbook(
    new Uint8Array(await readFile(resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx'))),
  ).slice(1)
  const built = buildCatalog(buildSections(rows, fall), fall)
  return JSON.parse(new TextDecoder().decode(catalogBytes(built))) as unknown
}

const serving = (body: unknown, ok = true, status = 200): FetchLike => () =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) })

describe('CATALOG_URL', () => {
  it('sits beside the bundles it indexes', () => {
    expect(CATALOG_URL(term)).toBe('/bundles/4269/index.json')
  })
})

describe('loadCatalog', () => {
  it('reads what the normalizer wrote', async () => {
    const catalog = await loadCatalog(term, serving(await realCatalog()))

    expect(catalog.term).toBe('4269')
    expect(catalog.startDate).toBe('2026-08-24')
    expect(catalog.courses.length).toBeGreaterThan(0)
  })

  it('splits each key so the app never parses one itself', async () => {
    const catalog = await loadCatalog(term, serving(await realCatalog()))
    const first = catalog.courses[0]

    expect(first?.subject).toBe('EECS')
    expect(first?.number).not.toContain('|')
    expect(first?.key).toBe(`EECS|${first?.number}`)
    expect(first?.sectionCount).toBeGreaterThan(0)
  })

  it('re-validates every key rather than trusting the file', async () => {
    // This is the value every later fetch and every selection is keyed on, so
    // a malformed one caught here beats one caught three layers later.
    await expect(
      loadCatalog(
        term,
        serving({ term: '4269', startDate: 'x', endDate: 'y', courses: [['not a key', 'T', 1]] }),
      ),
    ).rejects.toThrow(/not a course key/)
  })

  it('refuses a row with the wrong shape', async () => {
    const envelope = { term: '4269', startDate: 'x', endDate: 'y' }
    await expect(
      loadCatalog(term, serving({ ...envelope, courses: [['EECS|168', 'Programming I']] })),
    ).rejects.toThrow(/course 0 is not a 3-field row/)
    await expect(
      loadCatalog(term, serving({ ...envelope, courses: [['EECS|168', 'Programming I', '5']] })),
    ).rejects.toThrow(/course 0 has the wrong field types/)
  })

  it('refuses an envelope with no epoch', async () => {
    await expect(
      loadCatalog(term, serving({ term: '4269', endDate: 'y', courses: [] })),
    ).rejects.toThrow(/startDate is missing/)
  })

  it('names the file and says what to run when it is missing', async () => {
    await expect(loadCatalog(term, serving(null, false, 404))).rejects.toThrow(
      /could not load \/bundles\/4269\/index\.json: HTTP 404/,
    )
  })

  it('recognises a dev server answering with index.html', async () => {
    const html: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('<')) })
    await expect(loadCatalog(term, html)).rejects.toThrow(/is the catalog generated\?/)
  })
})
