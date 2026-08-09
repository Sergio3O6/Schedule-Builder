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
import type { CacheKey, RawCache } from './cache.ts'
import type { FetchSession } from './session.ts'

export interface FetchResult {
  readonly bytes: Uint8Array
  /** False means a slot was spent on the network. */
  readonly fromCache: boolean
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

  // Write through before returning. If the caller crashes mid-crawl, everything
  // already downloaded stays downloaded — that is what makes the run resumable
  // rather than restartable.
  await cache.write(key, bytes)
  return { bytes, fromCache: false }
}
