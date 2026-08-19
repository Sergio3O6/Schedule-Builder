/**
 * Choosing one unit per course so that nothing collides.
 *
 * This is a constraint problem, and a small one: a student takes four to six
 * courses, and the biggest course in the term (NURS 475) offers 240 units. The
 * naive product of six such courses is 10^14, which is why the search is
 * ordered and pruned rather than enumerated — but the instance is small enough
 * that nothing cleverer than forward checking is warranted, and anything
 * cleverer would be harder to explain to the next reader than the problem
 * deserves.
 *
 * ## Two failures worth designing against
 *
 * "No schedule works" is the answer a student is most likely to get and the
 * least useful thing to tell them. It is almost never true that everything is
 * impossible; it is nearly always two specific courses that cannot coexist. So
 * a failed solve reports the blocking PAIRS, and an empty course — one with no
 * units at all — is reported separately, because those are different problems
 * with different fixes.
 *
 * "400 schedules work" is the other failure, and is not solved here. Ranking
 * lives in preferences.ts; this module's job ends at correctness, and it caps
 * results only so that enumeration terminates.
 */

import { unitsConflict } from './unit.ts'
import type { CourseKey } from './ids.ts'
import type { Unit } from './unit.ts'

/** One course and everything a student could pick for it. */
export interface CourseOptions {
  readonly courseKey: CourseKey
  readonly units: readonly Unit[]
}

/** One unit per requested course, guaranteed mutually compatible. */
export interface Schedule {
  /** In the caller's course order, not the order the search happened to use. */
  readonly units: readonly Unit[]
}

export interface SolveResult {
  readonly schedules: readonly Schedule[]
  /**
   * True when the cap stopped enumeration early, so `schedules` is a sample of
   * the solution space rather than all of it. A ranking applied downstream is
   * then ranking a sample, which is worth saying out loud.
   */
  readonly truncated: boolean
  /** Courses with no unit at all. Nothing can be solved while one is present. */
  readonly empty: readonly CourseKey[]
  /**
   * Pairs of courses where every unit of one collides with every unit of the
   * other, computed only when nothing solved. This is the actionable half of a
   * failure: the student has to drop or defer one of the two.
   *
   * A pair being absent does not prove the rest are jointly satisfiable —
   * three courses can be pairwise fine and impossible together. Reporting only
   * what was actually established beats inventing a culprit.
   */
  readonly blockers: readonly (readonly [CourseKey, CourseKey])[]
}

export interface SolveOptions {
  /** How many schedules to return. The default is far past what anyone reads. */
  readonly limit?: number
  /**
   * A ceiling on search steps, so a pathological input cannot hang the tab.
   * Reaching it is reported as truncation, never as "no schedule exists".
   */
  readonly maxSteps?: number
}

const DEFAULT_LIMIT = 200
const DEFAULT_MAX_STEPS = 200_000

/** Every unit of `a` collides with every unit of `b`. */
function mutuallyExclusive(a: CourseOptions, b: CourseOptions): boolean {
  for (const left of a.units) {
    for (const right of b.units) {
      if (!unitsConflict(left, right)) return false
    }
  }
  return true
}

function findBlockers(courses: readonly CourseOptions[]): (readonly [CourseKey, CourseKey])[] {
  const pairs: (readonly [CourseKey, CourseKey])[] = []
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i]
      const b = courses[j]
      if (a === undefined || b === undefined) continue
      if (a.units.length > 0 && b.units.length > 0 && mutuallyExclusive(a, b)) {
        pairs.push([a.courseKey, b.courseKey])
      }
    }
  }
  return pairs
}

/**
 * Every way to take the requested courses at once, up to a cap.
 *
 * Courses are searched fewest-options-first, because the course with three
 * units decides the shape of the schedule far more than the one with forty, and
 * discovering an impossibility at depth 1 costs a fraction of discovering it at
 * depth 5.
 *
 * Forward checking is what makes that ordering pay. After a unit is chosen,
 * every course still to be decided is filtered to the units that survive it; if
 * any of them is emptied, the branch is abandoned immediately rather than after
 * descending into it. The filtered domains are then what the deeper levels
 * iterate, so the pruning compounds instead of being recomputed.
 */
export function solveSchedules(
  courses: readonly CourseOptions[],
  options: SolveOptions = {},
): SolveResult {
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS

  const empty = courses.filter((course) => course.units.length === 0).map((c) => c.courseKey)
  if (empty.length > 0) return { schedules: [], truncated: false, empty, blockers: [] }
  if (courses.length === 0) return { schedules: [], truncated: false, empty: [], blockers: [] }

  // Remember where each course sat so results can be handed back in the order
  // the student added them, regardless of what order the search wanted.
  const position = new Map(courses.map((course, index) => [course.courseKey, index]))
  const ordered = [...courses].sort((a, b) => a.units.length - b.units.length)

  const schedules: Schedule[] = []
  const chosen: Unit[] = []
  let steps = 0
  let truncated = false

  const search = (depth: number, domains: readonly (readonly Unit[])[]): void => {
    if (truncated) return
    if (depth === ordered.length) {
      const units = [...chosen].sort(
        (a, b) => (position.get(a.courseKey) ?? 0) - (position.get(b.courseKey) ?? 0),
      )
      schedules.push({ units })
      if (schedules.length >= limit) truncated = true
      return
    }

    for (const unit of domains[depth] ?? []) {
      if (++steps > maxSteps) {
        truncated = true
        return
      }

      // The chosen units are the accumulated footprint; a candidate has to
      // survive all of them before anything downstream is considered.
      if (chosen.some((held) => unitsConflict(held, unit))) continue

      const narrowed: (readonly Unit[])[] = domains.slice(0, depth + 1)
      let wipedOut = false
      for (let next = depth + 1; next < ordered.length; next++) {
        const remaining = (domains[next] ?? []).filter((option) => !unitsConflict(unit, option))
        if (remaining.length === 0) {
          wipedOut = true
          break
        }
        narrowed.push(remaining)
      }
      if (wipedOut) continue

      chosen.push(unit)
      search(depth + 1, narrowed)
      chosen.pop()
      if (truncated) return
    }
  }

  search(
    0,
    ordered.map((course) => course.units),
  )

  return {
    schedules,
    truncated,
    empty: [],
    // Only worth computing when there is a failure to explain.
    blockers: schedules.length === 0 ? findBlockers(courses) : [],
  }
}
