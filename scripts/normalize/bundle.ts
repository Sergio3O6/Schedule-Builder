/**
 * What the app loads.
 *
 * One file per subject, because students search by subject and there is no
 * reason to ship all 292 to someone looking at EECS. The bundle carries the
 * term calendar alongside the sections: every DayOffset in it is measured from
 * that epoch, so a file that did not name its own origin would be a set of
 * integers with no meaning, and a client guessing the epoch would be wrong in a
 * way nothing throws on.
 *
 * Plain JSON, not the array-of-arrays wire format the plan specifies. That
 * format exists to strip repeated key names, which is most of the payload
 * before gzip — a real saving against a real budget. It is deferred here on
 * purpose: it is a format the loader depends on, so it should be chosen against
 * a measured payload rather than an assumed one, and this file is what produces
 * the first measurement. `bytesOf` exists to take it.
 */

import { splitCourseKey } from '../../src/domain/ids.ts'
import type { SubjectCode, TermCode } from '../../src/domain/ids.ts'
import type { Section } from '../../src/domain/section.ts'
import type { TermCalendar } from '../../src/domain/time.ts'

export interface SubjectBundle {
  readonly term: TermCode
  readonly subject: SubjectCode
  /**
   * The epoch every DayOffset in this file is measured from.
   *
   * Written here rather than assumed by the client because the two drifting
   * apart is silent: every partial-term comparison quietly moves and no
   * assertion fires. Carried per file, so a stale cached bundle cannot be read
   * against a newer term's origin.
   */
  readonly startDate: string
  readonly endDate: string
  readonly sections: readonly Section[]
}

/** The sections of one subject, in the export's own order. */
export function sectionsForSubject(
  sections: readonly Section[],
  subject: SubjectCode,
): readonly Section[] {
  return sections.filter((section) => splitCourseKey(section.courseKey).subject === subject)
}

/**
 * Every subject present, sorted.
 *
 * Sorted so the index a rebuild produces is byte-identical when nothing
 * changed — an unsorted set would reorder on any upstream reshuffle and turn a
 * no-op rebuild into a diff nobody can read.
 */
export function subjectsIn(sections: readonly Section[]): readonly SubjectCode[] {
  const seen = new Set<SubjectCode>()
  for (const section of sections) seen.add(splitCourseKey(section.courseKey).subject)
  return [...seen].sort()
}

export function bundleSubject(
  sections: readonly Section[],
  subject: SubjectCode,
  calendar: TermCalendar,
): SubjectBundle {
  return {
    term: calendar.term,
    subject,
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    sections: sectionsForSubject(sections, subject),
  }
}

/**
 * The bundle's bytes, and the only place its encoding is decided.
 *
 * No pretty-printing: whitespace is a third of a JSON payload of this shape and
 * nothing reads these by eye. A trailing newline so the files behave in a
 * terminal and in git.
 */
export function bytesOf(bundle: SubjectBundle): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(bundle)}\n`)
}
