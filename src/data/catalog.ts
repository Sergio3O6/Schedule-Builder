/**
 * The one file the app loads before the student has done anything.
 *
 * It exists so search can cover all 275 subjects without fetching any of them.
 * 4,412 courses, 174KB, 49KB gzipped — small enough to load eagerly, and it
 * turns "find EECS 168" from a network question into a local one.
 *
 * This is the file where the plan's array-of-arrays wire format actually earns
 * its keep, and the only one. Repeating three key names across 4,412 rows is a
 * third of the payload, and this is the request that blocks first paint. The
 * per-subject bundles deliberately do NOT use it: they are 1.6KB typical, lazy,
 * and the same compaction there would buy nothing while costing readability.
 */

import { courseKey, splitCourseKey, termCode } from '../domain/ids.ts'
import type { CourseKey, SubjectCode, TermCode } from '../domain/ids.ts'

/**
 * One course, on the wire: [key, title, sectionCount].
 *
 * Positional, so the field order is load-bearing and stated once here rather
 * than implied at every read site.
 */
export type CourseRow = readonly [key: string, title: string, sections: number]

export interface CourseEntry {
  readonly key: CourseKey
  readonly subject: SubjectCode
  /** The catalogue number alone, e.g. '168'. Not always numeric. */
  readonly number: string
  readonly title: string
  readonly sectionCount: number
}

export interface Catalog {
  readonly term: TermCode
  readonly startDate: string
  readonly endDate: string
  readonly courses: readonly CourseEntry[]
}

export const CATALOG_URL = (term: TermCode): string => `/bundles/${encodeURIComponent(term)}/index.json`

function assertCatalog(value: unknown, url: string): Catalog {
  const fail = (why: string): never => {
    throw new Error(`${url} is not a usable catalog: ${why}`)
  }

  if (typeof value !== 'object' || value === null) fail('not an object')
  const raw = value as Record<string, unknown>
  for (const field of ['term', 'startDate', 'endDate'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') fail(`${field} is missing`)
  }
  if (!Array.isArray(raw.courses)) fail('courses is not an array')

  const courses = (raw.courses as unknown[]).map((row, index): CourseEntry => {
    if (!Array.isArray(row) || row.length !== 3) fail(`course ${index} is not a 3-field row`)
    const [key, title, sectionCount] = row as unknown[]
    if (typeof key !== 'string' || typeof title !== 'string' || typeof sectionCount !== 'number') {
      fail(`course ${index} has the wrong field types`)
    }
    // Re-validated rather than cast: this is the value every later fetch and
    // every selection is keyed on, and a malformed one would fail much later.
    const parts = splitCourseKey(key as CourseKey)
    return {
      key: courseKey(parts.subject, parts.number),
      subject: parts.subject,
      number: parts.number,
      title: title as string,
      sectionCount: sectionCount as number,
    }
  })

  return {
    term: termCode(raw.term as string),
    startDate: raw.startDate as string,
    endDate: raw.endDate as string,
    courses,
  }
}

export type FetchLike = (url: string) => Promise<{
  readonly ok: boolean
  readonly status: number
  json: () => Promise<unknown>
}>

export async function loadCatalog(
  term: TermCode,
  fetchLike: FetchLike = globalThis.fetch,
): Promise<Catalog> {
  const url = CATALOG_URL(term)
  const response = await fetchLike(url)
  if (!response.ok) throw new Error(`could not load ${url}: HTTP ${response.status}`)

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error(`${url} did not contain JSON — is the catalog generated?`)
  }
  return assertCatalog(parsed, url)
}
