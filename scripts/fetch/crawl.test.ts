import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RawCache } from './cache.ts'
import { crawlWholeTerm, describePlan } from './crawl.ts'
import { FetchSession } from './session.ts'
import type { FetchLike, ResponseLike } from './session.ts'
import { SEARCH_FORM_URL, SUBJECT_CODES } from './subjects.ts'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/eecs-4269.xlsx')

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ku-crawl-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const clock = () => {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

/** A form page listing exactly the codes given. */
const formHtml = (codes: readonly string[]) =>
  `<html><select id="classesSearchSubject">${codes
    .map((c) => `<option value="${c.replace(/&/g, '&amp;')}">${c}</option>`)
    .join('')}</select></html>`

/** Routes the form URL to HTML and everything else to the export bytes. */
function routed(html: string, exportBytes: Uint8Array) {
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    const body: Uint8Array = url.startsWith(SEARCH_FORM_URL)
      ? new TextEncoder().encode(html)
      : exportBytes
    const response: ResponseLike = {
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => body.slice().buffer,
    }
    return response
  }
  return { fetch, urls }
}

const session = (fetch: FetchLike) => {
  const c = clock()
  return new FetchSession({ fetch, sleep: c.sleep, now: c.now })
}

describe('describePlan', () => {
  it('states the exact request count before anything is sent', () => {
    const plan = describePlan('4269')
    expect(plan).toContain('exactly 2 requests')
    expect(plan).toContain(SEARCH_FORM_URL)
    expect(plan).toContain('searchTerm=4269')
    expect(plan).toContain('no requests will be made')
  })

  it('shows the export URL with the inverted flags pinned safe', () => {
    const plan = describePlan('4269')
    expect(plan).toContain('searchClosed=false')
    expect(plan).toContain('oneRowLimit=false')
  })
})

describe('catalogue drift gate', () => {
  it('refuses to crawl when KU added a subject', async () => {
    const { fetch, urls } = routed(formHtml([...SUBJECT_CODES, 'NEWSUBJ']), new Uint8Array())

    await expect(
      crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' }),
    ).rejects.toThrow(/NEWSUBJ/)

    // The point of the ordering: the expensive export was never requested.
    expect(urls).toEqual([SEARCH_FORM_URL])
  })

  it('refuses to crawl when KU removed a subject', async () => {
    const { fetch, urls } = routed(formHtml(SUBJECT_CODES.slice(1)), new Uint8Array())

    await expect(
      crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' }),
    ).rejects.toThrow(/Removed upstream/)
    expect(urls).toHaveLength(1)
  })

  it('names the file to edit', async () => {
    const { fetch } = routed(formHtml([...SUBJECT_CODES, 'NEWSUBJ']), new Uint8Array())

    await expect(
      crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' }),
    ).rejects.toThrow(/scripts\/fetch\/subjects\.ts/)
  })

  it('proceeds when the catalogue is unchanged', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const { fetch, urls } = routed(formHtml(SUBJECT_CODES), bytes)

    await crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' })

    expect(urls).toHaveLength(2)
  })
})

describe('coverage outcome', () => {
  it('reports incomplete when the export covers only one subject', async () => {
    // The EECS fixture standing in for a capped whole-term response: 423 rows,
    // one subject, 291 missing. Exactly the shape a truncated export has.
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const { fetch } = routed(formHtml(SUBJECT_CODES), bytes)

    const outcome = await crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' })

    expect(outcome.complete).toBe(false)
    expect(outcome.report.rowsBySubject.get('EECS')).toBe(423)
    expect(outcome.report.missingSubjects.length).toBe(SUBJECT_CODES.length - 1)
  })

  it('counts the requests it actually made', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const { fetch } = routed(formHtml(SUBJECT_CODES), bytes)

    const outcome = await crawlWholeTerm(session(fetch), new RawCache(root), { term: '4269' })

    expect(outcome.requestsMade).toBe(2)
    expect(outcome.fromCache).toBe(false)
  })

  it('writes the export through to the cache', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const { fetch } = routed(formHtml(SUBJECT_CODES), bytes)
    const cache = new RawCache(root)

    await crawlWholeTerm(session(fetch), cache, { term: '4269' })

    expect(await cache.has({ term: '4269' })).toBe(true)
  })
})

describe('rerun', () => {
  it('re-requests only the form, never the export, on a warm cache', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const cache = new RawCache(root)

    const first = routed(formHtml(SUBJECT_CODES), bytes)
    await crawlWholeTerm(session(first.fetch), cache, { term: '4269' })
    expect(first.urls).toHaveLength(2)

    const second = routed(formHtml(SUBJECT_CODES), bytes)
    const outcome = await crawlWholeTerm(session(second.fetch), cache, { term: '4269' })

    expect(second.urls).toEqual([SEARCH_FORM_URL])
    expect(outcome.fromCache).toBe(true)
    expect(outcome.requestsMade).toBe(1)
  })
})

describe('logging', () => {
  it('reports progress through the injected logger', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const { fetch } = routed(formHtml(SUBJECT_CODES), bytes)
    const lines: string[] = []

    await crawlWholeTerm(session(fetch), new RawCache(root), {
      term: '4269',
      log: (m) => lines.push(m),
    })

    expect(lines.join('\n')).toContain('292 subjects, unchanged')
  })
})
