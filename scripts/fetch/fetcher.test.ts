import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RawCache } from './cache.ts'
import { FetchSession } from './session.ts'
import type { FetchLike, ResponseLike } from './session.ts'
import { fetchExport, UnexpectedResponseError } from './fetcher.ts'

/** The real page KU served for WOLO, a subject with no Fall 2026 classes. */
const NO_CLASSES_PAGE = resolve(process.cwd(), 'tests/fixtures/no-classes-page.html')

/** A minimal but genuine zip header, so the guard sees a plausible export. */
const zipBytes = (payload = 'rest of the archive') =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(payload)])

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ku-fetcher-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const clock = () => {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

/** Counts outbound requests. The count is the point of most of these tests. */
function countingFetch(status = 200, body: Uint8Array = zipBytes()) {
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    const response: ResponseLike = {
      status,
      headers: { get: () => null },
      arrayBuffer: async () => body.slice().buffer,
    }
    return response
  }
  return { fetch, urls }
}

describe('cold cache', () => {
  it('fetches, writes through, and reports the network was used', async () => {
    const c = clock()
    const { fetch, urls } = countingFetch()
    const cache = new RawCache(root)
    const session = new FetchSession({ fetch, sleep: c.sleep, now: c.now })

    const result = await fetchExport(session, cache, { term: '4269', subject: 'EECS' })

    expect(result.fromCache).toBe(false)
    expect(urls).toHaveLength(1)
    // The bytes are on disk, not merely in hand.
    expect(await cache.read({ term: '4269', subject: 'EECS' })).toEqual(result.bytes)
  })

  it('requests the URL with the inverted flags pinned safe', async () => {
    const c = clock()
    const { fetch, urls } = countingFetch()
    const session = new FetchSession({ fetch, sleep: c.sleep, now: c.now })

    await fetchExport(session, new RawCache(root), { term: '4269', subject: 'EECS' })

    const params = new URL(urls[0] ?? '').searchParams
    expect(params.get('searchClosed')).toBe('false')
    expect(params.get('searchShortClasses')).toBe('false')
    expect(params.get('searchHonorsClasses')).toBe('false')
    expect(params.get('oneRowLimit')).toBe('false')
    expect(params.get('searchSubject')).toBe('EECS')
    expect(params.get('searchTerm')).toBe('4269')
  })
})

describe('resume', () => {
  it('makes zero outbound requests on a warm rerun', async () => {
    // This is the guarantee the whole cache exists to provide.
    const c = clock()
    const { fetch, urls } = countingFetch()
    const cache = new RawCache(root)
    const session = new FetchSession({ fetch, sleep: c.sleep, now: c.now })
    const key = { term: '4269', subject: 'EECS' }

    const first = await fetchExport(session, cache, key)
    expect(urls).toHaveLength(1)

    const second = await fetchExport(session, cache, key)

    expect(urls).toHaveLength(1) // unchanged: nothing left the machine
    expect(second.fromCache).toBe(true)
    expect(second.bytes).toEqual(first.bytes)
  })

  it('resumes across a fresh session and cache, as a rerun of the script would', async () => {
    const warm = clock()
    const warmFetch = countingFetch()
    await fetchExport(
      new FetchSession({ fetch: warmFetch.fetch, sleep: warm.sleep, now: warm.now }),
      new RawCache(root),
      { term: '4269', subject: 'EECS' },
    )
    expect(warmFetch.urls).toHaveLength(1)

    // Simulate running the script again: new objects, same directory on disk.
    const rerun = clock()
    const rerunFetch = countingFetch()
    const result = await fetchExport(
      new FetchSession({ fetch: rerunFetch.fetch, sleep: rerun.sleep, now: rerun.now }),
      new RawCache(root),
      { term: '4269', subject: 'EECS' },
    )

    expect(rerunFetch.urls).toEqual([])
    expect(result.fromCache).toBe(true)
  })

  it('spends no spacing delay on a cache hit', async () => {
    // The cache is consulted before the queue, so a warm rerun is fast as well
    // as silent — 292 cached subjects must not take 292 x 1.5s to skip.
    const c = clock()
    const { fetch } = countingFetch()
    const cache = new RawCache(root)
    const session = new FetchSession({ minSpacingMs: 1500, fetch, sleep: c.sleep, now: c.now })
    const key = { term: '4269', subject: 'EECS' }

    await fetchExport(session, cache, key)
    const afterFirst = c.now()
    await fetchExport(session, cache, key)

    expect(c.now()).toBe(afterFirst)
  })

  it('still fetches subjects that are not cached yet', async () => {
    const c = clock()
    const { fetch, urls } = countingFetch()
    const cache = new RawCache(root)
    const session = new FetchSession({ fetch, sleep: c.sleep, now: c.now })

    await fetchExport(session, cache, { term: '4269', subject: 'EECS' })
    await fetchExport(session, cache, { term: '4269', subject: 'BIOL' })
    await fetchExport(session, cache, { term: '4269', subject: 'EECS' })

    expect(urls).toHaveLength(2)
  })
})

describe('responses that are not exports', () => {
  it('recognizes KU real "no classes" page and never caches it', async () => {
    // KU answers an empty search with HTTP 200 and HTML, so the status code
    // alone cannot distinguish this from a successful export.
    const page = new Uint8Array(await readFile(NO_CLASSES_PAGE))
    const c = clock()
    const { fetch } = countingFetch(200, page)
    const cache = new RawCache(root)
    const key = { term: '4269', subject: 'WOLO' }

    await expect(
      fetchExport(new FetchSession({ fetch, sleep: c.sleep, now: c.now }), cache, key),
    ).rejects.toThrow(UnexpectedResponseError)

    expect(await cache.has(key)).toBe(false)
  })

  it('classifies it as no-classes, an ordinary outcome rather than a fault', async () => {
    const page = new Uint8Array(await readFile(NO_CLASSES_PAGE))
    const c = clock()
    const { fetch } = countingFetch(200, page)

    await fetchExport(new FetchSession({ fetch, sleep: c.sleep, now: c.now }), new RawCache(root), {
      term: '4269',
      subject: 'WOLO',
    }).then(
      () => expect.unreachable('should have thrown'),
      (e: unknown) => {
        expect(e).toBeInstanceOf(UnexpectedResponseError)
        expect((e as UnexpectedResponseError).reason).toBe('no-classes')
        expect((e as UnexpectedResponseError).message).toContain('WOLO')
      },
    )
  })

  it('rejects any other non-zip payload without caching it', async () => {
    const c = clock()
    const { fetch } = countingFetch(200, new TextEncoder().encode('<html>gateway timeout</html>'))
    const cache = new RawCache(root)
    const key = { term: '4269', subject: 'EECS' }

    await fetchExport(new FetchSession({ fetch, sleep: c.sleep, now: c.now }), cache, key).then(
      () => expect.unreachable('should have thrown'),
      (e: unknown) => {
        expect((e as UnexpectedResponseError).reason).toBe('not-an-export')
      },
    )

    expect(await cache.has(key)).toBe(false)
  })

  it('keeps a bad whole-term response from poisoning the cache for every later run', async () => {
    // The failure this prevents: HTML stored as __whole-term.xlsx, after which
    // every rerun reads the poisoned entry and fails inside the zip parser.
    const page = new Uint8Array(await readFile(NO_CLASSES_PAGE))
    const cache = new RawCache(root)
    const key = { term: '9999' }

    const bad = clock()
    const badFetch = countingFetch(200, page)
    await expect(
      fetchExport(new FetchSession({ fetch: badFetch.fetch, sleep: bad.sleep, now: bad.now }), cache, key),
    ).rejects.toThrow(UnexpectedResponseError)

    // A later good response is still able to land, because nothing was stored.
    const good = clock()
    const goodFetch = countingFetch(200, zipBytes())
    const result = await fetchExport(
      new FetchSession({ fetch: goodFetch.fetch, sleep: good.sleep, now: good.now }),
      cache,
      key,
    )

    expect(result.fromCache).toBe(false)
    expect(await cache.has(key)).toBe(true)
  })
})

describe('failures', () => {
  it('caches nothing when the request fails', async () => {
    // A cached failure would be indistinguishable from real data on the rerun.
    const c = clock()
    const { fetch } = countingFetch(500)
    const cache = new RawCache(root)
    const session = new FetchSession({ fetch, sleep: c.sleep, now: c.now })
    const key = { term: '4269', subject: 'EECS' }

    await expect(fetchExport(session, cache, key)).rejects.toThrow()

    expect(await cache.has(key)).toBe(false)
  })
})
