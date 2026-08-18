/**
 * The contract between the normalizer and the app.
 *
 * It lives here, on the reading side, because the app is what has to keep
 * working. A generator that owns its own output format can change it and be
 * internally consistent while every consumer breaks; a reader that owns the
 * format makes the generator's job to conform, and `npm run typecheck` says so.
 *
 * Bundles are loaded from disk in development and would be static files in any
 * deployment, so nothing here assumes a server. There is no API.
 */

import { subjectCode, termCode } from '../domain/ids.ts'
import type { SubjectCode, TermCode } from '../domain/ids.ts'
import type { Section } from '../domain/section.ts'

export interface SubjectBundle {
  readonly term: TermCode
  readonly subject: SubjectCode
  /**
   * The epoch every DayOffset in this file is measured from.
   *
   * Carried per file rather than assumed, because the two drifting apart is
   * silent: every partial-term comparison quietly moves and no assertion fires.
   */
  readonly startDate: string
  readonly endDate: string
  readonly sections: readonly Section[]
}

/** Where a subject's bundle lives, encoded the way the normalizer wrote it. */
export function bundleUrl(term: TermCode, subject: SubjectCode): string {
  return `/bundles/${encodeURIComponent(term)}/${encodeURIComponent(subject)}.json`
}

/**
 * How much of a bundle is checked, and why not more.
 *
 * The envelope is validated strictly: it is four fields, it is what every day
 * offset in the file is interpreted against, and a wrong one is wrong silently.
 * Sections are checked only for the shape the app immediately walks — enough
 * that a stale or truncated file fails here, at the point of loading, naming
 * the file, rather than three components deeper as an undefined property.
 *
 * Deliberately not a full schema check. The sections were built by parsers in
 * src/domain that already refused everything malformed, and re-deriving those
 * rules here would put the same invariant in two places to drift apart. What
 * this defends against is a bundle that is stale, truncated, or from another
 * build — not a bundle whose generator lied.
 */
function assertBundle(value: unknown, url: string): SubjectBundle {
  const fail = (why: string): never => {
    throw new Error(`${url} is not a usable bundle: ${why}`)
  }

  if (typeof value !== 'object' || value === null) fail('not an object')
  const raw = value as Record<string, unknown>

  for (const field of ['term', 'subject', 'startDate', 'endDate'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') fail(`${field} is missing`)
  }
  if (!Array.isArray(raw.sections)) fail('sections is not an array')

  const sections = raw.sections as unknown[]
  for (const [index, section] of sections.entries()) {
    if (typeof section !== 'object' || section === null) fail(`section ${index} is not an object`)
    const s = section as Record<string, unknown>
    if (typeof s.classNbr !== 'number') fail(`section ${index} has no class number`)
    if (typeof s.courseKey !== 'string') fail(`section ${index} has no course key`)
    if (!Array.isArray(s.scheduled) || !Array.isArray(s.unscheduled)) {
      // Two arrays, always. The whole point of splitting them is that conflict
      // code can take the scheduled one and be unable to receive a TBA section;
      // a bundle with one array collapses that guarantee back into a check.
      fail(`section ${index} is missing its meeting arrays`)
    }
  }

  return {
    // Re-validated rather than cast: these are the two values every path keys
    // on, and a bundle served from the wrong place is exactly how they go wrong.
    term: termCode(raw.term as string),
    subject: subjectCode(raw.subject as string),
    startDate: raw.startDate as string,
    endDate: raw.endDate as string,
    sections: sections as readonly Section[],
  }
}

/** Just enough of fetch to load a file, so tests need no network. */
export type FetchLike = (url: string) => Promise<{
  readonly ok: boolean
  readonly status: number
  json: () => Promise<unknown>
}>

export async function loadSubject(
  term: TermCode,
  subject: SubjectCode,
  fetchLike: FetchLike = globalThis.fetch,
): Promise<SubjectBundle> {
  const url = bundleUrl(term, subject)
  const response = await fetchLike(url)

  if (!response.ok) {
    // Naming the URL matters more than usual here: the most likely cause is a
    // subject whose bundle was never generated, and the path says which.
    throw new Error(`could not load ${url}: HTTP ${response.status}`)
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    // A dev server answers a missing path with index.html, so a 200 whose body
    // is HTML is the ordinary failure, not a corrupt file.
    throw new Error(`${url} did not contain JSON — is the bundle generated?`)
  }

  const bundle = assertBundle(parsed, url)
  if (bundle.subject !== subject) {
    throw new Error(`${url} contains subject ${bundle.subject}, not ${subject}`)
  }
  return bundle
}
