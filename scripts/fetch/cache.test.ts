import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RawCache } from './cache.ts'

// Real filesystem against a temp dir: the things worth testing here are path
// construction and atomicity, and a mocked fs would assert neither.
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ku-cache-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('pathFor', () => {
  it('puts a subject under its term', () => {
    const p = new RawCache(root).pathFor({ term: '4269', subject: 'EECS' })
    expect(p).toBe(join(root, '4269', 'EECS.xlsx'))
  })

  it('accepts the real subject alphabet, ampersands and hyphens included', () => {
    const cache = new RawCache(root)
    // Verified against all 292 codes on the live form.
    for (const subject of ['EECS', 'C&PE', 'HP&M', 'LA&S', 'CT-C', 'PM-C']) {
      expect(() => cache.pathFor({ term: '4269', subject })).not.toThrow()
    }
  })

  it('gives the whole-term export a name no subject code can collide with', () => {
    const cache = new RawCache(root)
    const wholeTerm = cache.pathFor({ term: '4269' })
    expect(wholeTerm).toBe(join(root, '4269', '__whole-term.xlsx'))
    // Subject codes are uppercase by construction, so this is unreachable by one.
    expect(wholeTerm).not.toBe(cache.pathFor({ term: '4269', subject: 'ALL' }))
  })

  it('rejects rather than sanitizes a malformed subject', () => {
    const cache = new RawCache(root)
    for (const subject of ['../etc', 'eecs', 'TOOLONGSUBJECT', '', 'A/B', 'A\\B']) {
      expect(() => cache.pathFor({ term: '4269', subject }), subject).toThrow(/malformed subject/)
    }
  })

  it('rejects a malformed term', () => {
    const cache = new RawCache(root)
    for (const term of ['426', '42690', '..', 'FALL']) {
      expect(() => cache.pathFor({ term }), term).toThrow(/malformed term/)
    }
  })
})

describe('round trip', () => {
  it('reads back exactly what was written', async () => {
    const cache = new RawCache(root)
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f])

    await cache.write({ term: '4269', subject: 'EECS' }, bytes)

    expect(await cache.read({ term: '4269', subject: 'EECS' })).toEqual(bytes)
    expect(await cache.has({ term: '4269', subject: 'EECS' })).toBe(true)
  })

  it('creates the term directory on demand', async () => {
    const cache = new RawCache(root)
    await cache.write({ term: '4269', subject: 'BIOL' }, new Uint8Array([1]))
    expect(await readdir(join(root, '4269'))).toContain('BIOL.xlsx')
  })

  it('stores the whole-term export separately from any subject', async () => {
    const cache = new RawCache(root)
    await cache.write({ term: '4269' }, new Uint8Array([1]))
    await cache.write({ term: '4269', subject: 'EECS' }, new Uint8Array([2, 2]))

    expect(await cache.read({ term: '4269' })).toEqual(new Uint8Array([1]))
    expect(await cache.read({ term: '4269', subject: 'EECS' })).toEqual(new Uint8Array([2, 2]))
  })

  it('keeps terms apart', async () => {
    const cache = new RawCache(root)
    await cache.write({ term: '4269', subject: 'EECS' }, new Uint8Array([1]))

    expect(await cache.has({ term: '4259', subject: 'EECS' })).toBe(false)
  })
})

describe('misses', () => {
  it('reports absent for a key never written', async () => {
    const cache = new RawCache(root)
    expect(await cache.has({ term: '4269', subject: 'EECS' })).toBe(false)
    expect(await cache.read({ term: '4269', subject: 'EECS' })).toBeNull()
  })

  it('treats a zero-byte file as absent, not as a hit', async () => {
    // Residue of a failed write. Counting it as cached would resume straight
    // past a hole in the data with nothing reporting a problem.
    const cache = new RawCache(root)
    const path = cache.pathFor({ term: '4269', subject: 'EECS' })
    await cache.write({ term: '4269', subject: 'EECS' }, new Uint8Array([1]))
    await writeFile(path, new Uint8Array())

    expect(await cache.has({ term: '4269', subject: 'EECS' })).toBe(false)
    expect(await cache.read({ term: '4269', subject: 'EECS' })).toBeNull()
  })
})

describe('errors that are not misses', () => {
  it('refuses a malformed key instead of reporting it absent forever', async () => {
    // The defect: a bare catch swallowed pathFor's validation error, so a bad
    // key read as "not cached" — which is an instruction to go and ask KU for
    // it. Every run. The write that would finally object happens after the
    // request has already been spent.
    const cache = new RawCache(root)

    await expect(cache.read({ term: 'FALL', subject: 'EECS' })).rejects.toThrow(/malformed term/)
    await expect(cache.has({ term: 'FALL', subject: 'EECS' })).rejects.toThrow(/malformed term/)
    await expect(cache.read({ term: '4269', subject: '../etc' })).rejects.toThrow(
      /malformed subject/,
    )
    await expect(cache.has({ term: '4269', subject: '../etc' })).rejects.toThrow(
      /malformed subject/,
    )
  })

  it('reports a directory sitting where the file belongs', async () => {
    // Not absence — a broken cache. Silence here resumes past it.
    const cache = new RawCache(root)
    const key = { term: '4269', subject: 'EECS' }
    await mkdir(cache.pathFor(key), { recursive: true })

    await expect(cache.read(key)).rejects.toThrow(/EISDIR/)
    await expect(cache.has(key)).rejects.toThrow(/not a file/)
  })

  it('still reports a genuinely missing file as a miss', async () => {
    // The distinction has to cut both ways, or resume stops working.
    const cache = new RawCache(root)
    expect(await cache.read({ term: '4269', subject: 'BIOL' })).toBeNull()
    expect(await cache.has({ term: '4269', subject: 'BIOL' })).toBe(false)
  })

  it('reports a miss when the term directory does not exist at all', async () => {
    const cache = new RawCache(root)
    expect(await cache.read({ term: '4259' })).toBeNull()
    expect(await cache.has({ term: '4259' })).toBe(false)
  })
})

describe('atomicity', () => {
  it('leaves no temp files behind on success', async () => {
    const cache = new RawCache(root)
    await cache.write({ term: '4269', subject: 'EECS' }, new Uint8Array([1, 2, 3]))

    expect((await readdir(join(root, '4269'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('never blends concurrent writes of the same key into one file', async () => {
    // The temp name used to be ${target}.${pid}.tmp — per process, not per
    // write — so writes of one key shared a path and interleaved into it.
    // Measured with four 4MB payloads: all four writes reported SUCCESS and the
    // published file was a blend of several of them. Every caller was told it
    // worked, and the result passes any check short of reading the bytes.
    //
    // Unique names do not prevent the collision; on Windows a concurrent rename
    // onto a live target fails EPERM outright. What they change is the failure
    // from a corrupt file nobody hears about to a loud one.
    //
    // The payloads are large on purpose. Below about a megabyte a single write
    // usually lands whole and the blend does not reproduce.
    const cache = new RawCache(root)
    const key = { term: '4269', subject: 'EECS' }
    const size = 4 * 1024 * 1024
    const payloads = Array.from({ length: 4 }, (_, i) => new Uint8Array(size).fill(i + 1))

    const results = await Promise.allSettled(payloads.map((bytes) => cache.write(key, bytes)))
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)

    const stored = await cache.read(key)
    expect(stored).not.toBeNull()
    // Exactly one payload, start to finish. A blend fails the uniformity check.
    const first = stored?.[0]
    expect(payloads.some((p) => p[0] === first)).toBe(true)
    expect(stored?.every((b) => b === first)).toBe(true)
    expect(stored?.byteLength).toBe(size)
  })

  it('keeps concurrent writes of different keys entirely apart', async () => {
    // What the per-subject fallback loop actually does, if it is ever needed.
    const cache = new RawCache(root)
    const subjects = ['EECS', 'BIOL', 'MATH', 'C&PE', 'LA&S']

    await Promise.all(
      subjects.map((subject, i) =>
        cache.write({ term: '4269', subject }, new Uint8Array(256).fill(i + 1)),
      ),
    )

    for (const [i, subject] of subjects.entries()) {
      const stored = await cache.read({ term: '4269', subject })
      expect(stored?.every((b) => b === i + 1), subject).toBe(true)
    }
    expect((await readdir(join(root, '4269'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('replaces an existing entry wholesale', async () => {
    const cache = new RawCache(root)
    const key = { term: '4269', subject: 'EECS' }
    await cache.write(key, new Uint8Array([1, 2, 3, 4, 5]))
    await cache.write(key, new Uint8Array([9]))

    expect(await cache.read(key)).toEqual(new Uint8Array([9]))
    expect((await readdir(join(root, '4269'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
