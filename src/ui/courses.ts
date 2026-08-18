/**
 * Sections gathered under the course a student actually picks.
 *
 * A separate module because it is not a component: keeping it in App.tsx costs
 * fast refresh on every edit to it, which is the one thing a UI file should not
 * trade away.
 */

import { splitCourseKey } from '../domain/ids.ts'
import type { CourseKey } from '../domain/ids.ts'
import type { Section } from '../domain/section.ts'

export interface Course {
  readonly key: CourseKey
  readonly number: string
  readonly sections: readonly Section[]
}

/**
 * Sections grouped under the course a student actually picks.
 *
 * Insertion-ordered, so the page follows the bundle, which follows the export.
 * A sort here would be a second opinion about ordering with nothing to base it
 * on — the export is already in catalogue order.
 *
 * The title is not lifted onto the course: sections of one course can carry
 * different titles when they are topics sections, and picking one would state
 * that the others do not exist.
 */
export function groupByCourse(sections: readonly Section[]): readonly Course[] {
  const courses = new Map<CourseKey, Section[]>()
  for (const section of sections) {
    const existing = courses.get(section.courseKey)
    if (existing === undefined) courses.set(section.courseKey, [section])
    else existing.push(section)
  }
  return [...courses.entries()].map(([key, grouped]) => ({
    key,
    number: splitCourseKey(key).number,
    sections: grouped,
  }))
}
