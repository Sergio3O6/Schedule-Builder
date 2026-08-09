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
import { looksLikeZip } from '../xlsx/workbook.ts'
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
export class UnexpectedResponseError extends Error {
  readonly reason: 'no-classes' | 'not-an-export'
  readonly key: CacheKey

  constructor(reason: 'no-classes' | 'not-an-export', key: CacheKey, message: string) {
    super(message)
    this.name = 'UnexpectedResponseError'
    this.reason = reason
    this.key = key
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
 */
function assertIsExport(bytes: Uint8Array, key: CacheKey): void {
  if (looksLikeZip(bytes)) return

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
  if (cached !== null) return { bytes: cached, fromCache: true }

  const bytes = await session.get(buildExportUrl({ term: key.term, subject: key.subject }))
  assertIsExport(bytes, key)

  // Write through before returning. If the caller crashes mid-crawl, everything
  // already downloaded stays downloaded — that is what makes the run resumable
  // rather than restartable.
  await cache.write(key, bytes)
  return { bytes, fromCache: false }
}
