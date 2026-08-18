/**
 * The eagerly-loaded index of every course in the term.
 *
 * Built from the same sections the bundles are built from, so a course can
 * never appear in the index without its bundle containing it — the two are one
 * pass over one array rather than two derivations that can disagree.
 */

import { splitCourseKey } from '../../src/domain/ids.ts'
import type { Catalog, CourseRow } from '../../src/data/catalog.ts'
import type { Section } from '../../src/domain/section.ts'
import type { TermCalendar } from '../../src/domain/time.ts'

export type { Catalog, CourseRow }

/** The index, on the wire: rows of [key, title, sectionCount]. */
export interface CatalogFile {
  readonly term: string
  readonly startDate: string
  readonly endDate: string
  readonly courses: readonly CourseRow[]
}

/**
 * Which title represents a course.
 *
 * Sections of one course can disagree — a topics course carries a different
 * title per topic — so this takes the most common one, and the first of those
 * on a tie so the output is deterministic. The index is a finding aid, not a
 * record: the bundle carries every section's own title, and that is what the
 * course page shows.
 */
function representativeTitle(sections: readonly Section[]): string {
  const counts = new Map<string, number>()
  for (const section of sections) counts.set(section.title, (counts.get(section.title) ?? 0) + 1)

  let best = ''
  let bestCount = 0
  for (const [title, count] of counts) {
    if (count > bestCount) {
      best = title
      bestCount = count
    }
  }
  return best
}

export function buildCatalog(
  sections: readonly Section[],
  calendar: TermCalendar,
): CatalogFile {
  const byCourse = new Map<string, Section[]>()
  for (const section of sections) {
    const existing = byCourse.get(section.courseKey)
    if (existing === undefined) byCourse.set(section.courseKey, [section])
    else existing.push(section)
  }

  // Sorted by subject then number, so the index reads like a catalogue and a
  // rebuild of unchanged data is byte-identical. The bundles keep the export's
  // order because that is the order a course's sections are listed in; an index
  // spanning 275 subjects has no such natural order to preserve.
  const courses = [...byCourse.entries()]
    .map(([key, grouped]): CourseRow => [key, representativeTitle(grouped), grouped.length])
    .sort(([a], [b]) => {
      const left = splitCourseKey(a as never)
      const right = splitCourseKey(b as never)
      return left.subject === right.subject
        ? left.number.localeCompare(right.number)
        : left.subject.localeCompare(right.subject)
    })

  return {
    term: calendar.term,
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    courses,
  }
}

export function catalogBytes(catalog: CatalogFile): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(catalog)}\n`)
}
