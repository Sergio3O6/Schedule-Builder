import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bundleUrl, loadSubject } from './bundle.ts'
import { subjectCode, termCode } from '../domain/ids.ts'
import { termCalendar } from '../domain/time.ts'
import { readWorkbook } from '../../scripts/xlsx/workbook.ts'
import { buildSections } from '../../scripts/normalize/rows.ts'
import { bundleSubject, bytesOf } from '../../scripts/normalize/bundle.ts'
import type { FetchLike } from './bundle.ts'

const term = termCode('4269')
const eecs = subjectCode('EECS')
const fall = termCalendar(term, '2026-08-24', '2026-12-18')

/**
 * A bundle built by the real normalizer from the real export fixture.
 *
 * Generated rather than committed as a snapshot, for two reasons. A snapshot
 * only proves the loader can read what the generator produced on the day it was
 * captured; running both sides proves they still agree. And it keeps the
 * generated output out of git, where 227KB of derived JSON would sit next to
 * the 51KB source it came from.
 */
const realBundle = async (): Promise<unknown> => {
  const rows = readWorkbook(
    new Uint8Array(await readFile(resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx'))),
  ).slice(1)
  const bundle = bundleSubject(buildSections(rows, fall), eecs, fall)
  return JSON.parse(new TextDecoder().decode(bytesOf(bundle))) as unknown
}

const serving = (body: unknown, ok = true, status = 200): FetchLike => {
  return () => Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
}

const servingText = (): FetchLike => () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.reject(new Error('Unexpected token <')),
  })

describe('bundleUrl', () => {
  it('encodes the subjects that carry an ampersand', () => {
    // Must agree with the filename the normalizer writes, or six subjects 404.
    expect(bundleUrl(term, subjectCode('C&PE'))).toBe('/bundles/4269/C%26PE.json')
  })

  it('leaves ordinary codes readable', () => {
    expect(bundleUrl(term, eecs)).toBe('/bundles/4269/EECS.json')
  })
})

describe('loadSubject', () => {
  it('loads a bundle the normalizer actually produced', async () => {
    const bundle = await loadSubject(term, eecs, serving(await realBundle()))

    expect(bundle.term).toBe('4269')
    expect(bundle.subject).toBe('EECS')
    expect(bundle.startDate).toBe('2026-08-24')
    expect(bundle.sections.length).toBeGreaterThan(300)
    expect(bundle.sections.every((s) => s.courseKey.startsWith('EECS|'))).toBe(true)
  })

  it('keeps the two meeting arrays separate', async () => {
    // The guarantee this whole model rests on: conflict code takes the
    // scheduled array and cannot receive a TBA section.
    const bundle = await loadSubject(term, eecs, serving(await realBundle()))
    const withMeetings = bundle.sections.find((s) => s.scheduled.length > 0)
    expect(withMeetings?.scheduled[0]).toMatchObject({ kind: 'scheduled' })
  })

  it('names the file when the request fails', async () => {
    // The likely cause is a subject whose bundle was never generated, and the
    // path is what says which.
    await expect(loadSubject(term, eecs, serving(null, false, 404))).rejects.toThrow(
      /could not load \/bundles\/4269\/EECS\.json: HTTP 404/,
    )
  })

  it('recognises a dev server answering with index.html', async () => {
    // A missing path returns 200 and HTML, which is the ordinary failure here
    // rather than a corrupt file — the message should say so.
    await expect(loadSubject(term, eecs, servingText())).rejects.toThrow(
      /did not contain JSON — is the bundle generated\?/,
    )
  })

  it('refuses a bundle serving the wrong subject', async () => {
    // A stale path or a copied file: the envelope is right, the contents are
    // someone else's, and every course key would be silently foreign.
    const bundle = (await realBundle()) as Record<string, unknown>
    await expect(
      loadSubject(term, subjectCode('MATH'), serving({ ...bundle, subject: 'EECS' })),
    ).rejects.toThrow(/contains subject EECS, not MATH/)
  })

  it('refuses an envelope missing the epoch its offsets mean nothing without', async () => {
    const bundle = (await realBundle()) as Record<string, unknown>
    const withoutEpoch = { ...bundle }
    delete withoutEpoch.startDate
    await expect(loadSubject(term, eecs, serving(withoutEpoch))).rejects.toThrow(
      /startDate is missing/,
    )
  })

  it('refuses a truncated or foreign shape rather than failing three layers later', async () => {
    for (const [body, message] of [
      [null, /not an object/],
      ['a string', /not an object/],
      [{ term: '4269', subject: 'EECS', startDate: 'x', endDate: 'y' }, /sections is not an array/],
    ] as const) {
      await expect(loadSubject(term, eecs, serving(body))).rejects.toThrow(message)
    }
  })

  it('refuses a section missing the fields the app walks', async () => {
    const envelope = { term: '4269', subject: 'EECS', startDate: 'x', endDate: 'y' }
    await expect(
      loadSubject(term, eecs, serving({ ...envelope, sections: [{ classNbr: 1 }] })),
    ).rejects.toThrow(/section 0 has no course key/)
    await expect(
      loadSubject(
        term,
        eecs,
        serving({ ...envelope, sections: [{ classNbr: 1, courseKey: 'EECS|1', scheduled: [] }] }),
      ),
    ).rejects.toThrow(/section 0 is missing its meeting arrays/)
  })

  it('re-validates the term and subject rather than trusting them', async () => {
    const bundle = (await realBundle()) as Record<string, unknown>
    await expect(
      loadSubject(term, eecs, serving({ ...bundle, term: 'FALL' })),
    ).rejects.toThrow(/malformed term code/)
  })
})
