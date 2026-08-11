/**
 * Composes the three pieces: build a request, spend a slot on the network only
 * when the cache cannot answer, and write through what comes back.
 *
 * Kept separate from cache.ts so storage never learns about HTTP, and separate
 * from session.ts so the throttle never learns about disks. Resume is the whole
 * reason this layer exists: a rerun over a warm cache must issue zero requests,
 * which is a property of this function and is asserted directly.
 */

import { buildExportUrl } from './request.ts'
import { looksLikeZip, readZipEntries } from '../xlsx/workbook.ts'
import type { CacheKey, RawCache } from './cache.ts'
import type { FetchSession } from './session.ts'

export interface FetchResult {
  readonly bytes: Uint8Array
  /** False means a slot was spent on the network. */
  readonly fromCache: boolean
}

/**
 * KU answered 200, but with something that is not a spreadsheet.
 *
 * `no-classes` is an ordinary outcome, not a fault: 17 of the 292 subjects offer
 * nothing in Fall 2026, and asking for one returns an HTML page reading "No
 * classes were found that meet your search criteria." A per-subject crawl should
 * record those and carry on. `not-an-export` is anything else unrecognized.
 */
export type UnexpectedResponseReason = 'no-classes' | 'not-an-export' | 'incomplete-archive'

export class UnexpectedResponseError extends Error {
  readonly reason: UnexpectedResponseReason
  readonly key: CacheKey

  constructor(reason: UnexpectedResponseReason, key: CacheKey, message: string) {
    super(message)
    this.name = 'UnexpectedResponseError'
    this.reason = reason
    this.key = key
  }
}

/**
 * A cached file that is not a readable archive.
 *
 * Only reachable from an entry written before the completeness check below
 * existed, or from something outside this program corrupting the file. It names
 * the path rather than silently re-fetching: re-fetching would spend a request
 * on KU to paper over local damage, and if the damage recurred it would do so
 * every run.
 */
export class CorruptCacheError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'CorruptCacheError'
    this.path = path
  }
}

/** KU's wording on the empty-results page. */
const NO_CLASSES_MARKER = 'No classes were found'

/**
 * How much of a non-export body to search for the marker.
 *
 * Generous on purpose: the phrase sits 9,314 bytes into KU's 14,872-byte page,
 * well past any reasonable "check the first few KB" window. The bound exists
 * only so a pathologically large wrong response is not decoded in full.
 */
const MARKER_SEARCH_LIMIT = 65_536

function describeScope(key: CacheKey): string {
  return key.subject === undefined ? `term ${key.term}` : `${key.subject} in term ${key.term}`
}

/**
 * Rejects a response that is not an export, before it can reach the cache.
 *
 * This runs on every path, not just the per-subject fallback. A mistyped term
 * returns the same HTML page, and without this check it would be written to
 * disk as __whole-term.xlsx — after which every later run reads the poisoned
 * entry, fails inside the zip parser, and keeps failing until someone deletes
 * the file by hand. Refusing to store it turns a permanent, confusing breakage
 * into one clear error.
 *
 * Two distinct wrong answers are possible and they need different words: a body
 * that was never a spreadsheet, and one that is a spreadsheet we did not receive
 * all of.
 */
function assertIsExport(bytes: Uint8Array, key: CacheKey): void {
  if (looksLikeZip(bytes)) {
    assertArchiveIsComplete(bytes, key)
    return
  }

  const head = new TextDecoder().decode(bytes.subarray(0, MARKER_SEARCH_LIMIT))
  if (head.includes(NO_CLASSES_MARKER)) {
    throw new UnexpectedResponseError(
      'no-classes',
      key,
      `KU reports no classes for ${describeScope(key)}.`,
    )
  }

  throw new UnexpectedResponseError(
    'not-an-export',
    key,
    `Expected a spreadsheet for ${describeScope(key)}, got ${bytes.byteLength} bytes ` +
      'that are not a zip archive. Nothing was cached.',
  )
}

/**
 * Rejects an archive that starts like a zip but does not finish like one.
 *
 * `looksLikeZip` reads four bytes. A connection that drops mid-transfer still
 * delivers `PK\x03\x04`, so those four bytes are satisfied by a download of any
 * length — measured on the real 1.9MB export, a body cut at 50%, 90%, 99% and
 * even 99.9% all passed. The partial file was then written to the cache, where
 * it stayed: the read path returns cached bytes without revalidating, so every
 * later run failed inside the zip parser until someone deleted the file by hand.
 *
 * The index a zip needs sits at the END of the file, so parsing it is exactly
 * the check truncation cannot survive. It costs one inflate of a file we are
 * about to keep forever, on a script that spends 1.5s between requests.
 */
function assertArchiveIsComplete(bytes: Uint8Array, key: CacheKey): void {
  try {
    readZipEntries(bytes)
  } catch (error) {
    throw new UnexpectedResponseError(
      'incomplete-archive',
      key,
      `Received ${bytes.byteLength} bytes for ${describeScope(key)} that begin like a ` +
        `spreadsheet but do not parse as one (${(error as Error).message}). The download ` +
        'was probably cut short. Nothing was cached; rerun to try again.',
    )
  }
}

/**
 * An export's bytes, from disk when possible.
 *
 * Note the ordering: the cache is consulted before the session is touched at
 * all, so a cached key never enters the request queue and never waits out a
 * spacing interval. A warm rerun is therefore fast as well as silent.
 */
export async function fetchExport(
  session: FetchSession,
  cache: RawCache,
  key: CacheKey,
): Promise<FetchResult> {
  const cached = await cache.read(key)
  if (cached !== null) {
    // Checked on the way out as well as on the way in. The write-side check
    // stops new damage; this one is how an entry poisoned by an earlier version
    // gets diagnosed, in one line naming the file, instead of surfacing as a zip
    // parser error several layers up with no indication of which file to remove.
    try {
      readZipEntries(cached)
    } catch (error) {
      const path = cache.pathFor(key)
      throw new CorruptCacheError(
        path,
        `Cached export for ${describeScope(key)} is not a readable archive ` +
          `(${(error as Error).message}). Delete it and rerun:\n  ${path}`,
      )
    }
    return { bytes: cached, fromCache: true }
  }

  const bytes = await session.get(buildExportUrl({ term: key.term, subject: key.subject }))
  assertIsExport(bytes, key)

  // Write through before returning. If the caller crashes mid-crawl, everything
  // already downloaded stays downloaded — that is what makes the run resumable
  // rather than restartable.
  await cache.write(key, bytes)
  return { bytes, fromCache: false }
}
