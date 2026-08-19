/**
 * The registerable unit: the thing a student actually chooses.
 *
 * A section is not the unit of choice, and treating it as one produces a
 * schedule builder that is wrong for 321 of the 4,412 courses in the term.
 * EECS 168 is a lecture AND a lab. CHEM 130 is one of four lectures AND one of
 * thirty-eight labs. What a student picks is a COMBINATION of components, and
 * what goes on their calendar is the union of that combination's meetings.
 *
 * ## Why the parent lecture cannot be ignored
 *
 * 359 sections in the term are marked not-directly-enrollable, spread over 320
 * courses. It is tempting to read that flag as "not the student's problem" and
 * filter them out. That is exactly backwards: 341 of those 359 publish a real
 * meeting time, and the student attends it. AE 245's lecture meets Tuesday
 * 11:00-11:50 and is not enrollable; the student registers for a lab and sits
 * in that lecture anyway. Drop it and the calendar shows an hour free that is
 * not free, and the solver will happily schedule something on top of it.
 *
 * So a unit's time footprint is the union over every section in the
 * combination, enrollable or not. That is the whole reason this module exists.
 *
 * ## How a course's components combine
 *
 * Sections are partitioned by component code, and each group is a choose-one
 * set. A unit is one section from each group. Measured across all 275 subjects:
 *
 *   - 4,091 courses have a single component. One section, one unit, no work.
 *   - 321 courses have two or more. Of their attached (all-non-enrollable)
 *     groups, 283 hold exactly one parent — forced, attach it to everything.
 *   - 9 attached groups are a BLOCK layout and 15 are FREE choice. The
 *     difference is real and is described at `attachmentOf`.
 *
 * ## Cross-listing is an identity link, never an attribute source
 *
 * All 602 `Comb Sect ID` groups span two or more sections, and 593 of them span
 * two or more DIFFERENT course codes — they are genuine cross-listings, one
 * physical class published under several catalogue numbers. The groups
 * contradict themselves constantly: 306 disagree on Title, 209 on Career, 59 on
 * Max Hours, 49 on Component.
 *
 * That looks like data corruption demanding a tie-break rule, and it is not.
 * Those columns are properties of the COURSE CODE, not of the shared class.
 * EECS 690 and MATH 690 meet in one room at one time, and a student enrolling
 * through MATH gets MATH's title, MATH's career and MATH's credit hours. There
 * is no single truth to pick because there is no single course. So nothing here
 * merges cross-listed sections or reconciles their fields: each keeps exactly
 * what KU published under its own code.
 *
 * The group id is used for one thing — two units sharing one are the same
 * physical class, so a student cannot hold both. 587 of the 602 groups would be
 * caught by the time check anyway, since they meet at the same moment; the
 * remaining 15 publish different meeting patterns and would otherwise slip
 * through as two unrelated classes that happen to be the same class.
 */

import { unitId } from './ids.ts'
import { anyMeetingConflicts } from './meeting.ts'
import { vocabularyLabel } from './section.ts'
import type { CombSectId, CourseKey, TermCode, UnitId } from './ids.ts'
import type { ScheduledMeeting, UnscheduledMeeting } from './meeting.ts'
import type { Section } from './section.ts'

/**
 * One combination of sections a student can hold at once.
 *
 * `sections` is everything attended; `enroll` is the subset actually registered
 * for. They differ precisely when a parent lecture is involved, which is the
 * case this module exists to handle. Both are kept because a student needs to
 * be told what to register for, and the calendar needs to draw everything.
 */
export interface Unit {
  readonly id: UnitId
  readonly courseKey: CourseKey
  /** Every section attended, ordered by component code. Never empty. */
  readonly sections: readonly Section[]
  /** The sections to actually register for. Empty only if KU marks none. */
  readonly enroll: readonly Section[]
  /** The union footprint. What conflict detection and the grid both read. */
  readonly scheduled: readonly ScheduledMeeting[]
  /** Kept so a unit with no published time still says so rather than vanishing. */
  readonly unscheduled: readonly UnscheduledMeeting[]
  /** Every cross-listing group this unit touches. Usually empty. */
  readonly combSectIds: readonly CombSectId[]
}

/** Numeric value of a section label, or null when it has none or is not numeric. */
function labelNumber(section: Section): number | null {
  if (section.number === null) return null
  const value = Number(section.number)
  return Number.isFinite(value) ? value : null
}

/** Partition a course's sections by component code, preserving input order. */
function byComponent(sections: readonly Section[]): Map<string, Section[]> {
  const groups = new Map<string, Section[]>()
  for (const section of sections) {
    const code = vocabularyLabel(section.component)
    const group = groups.get(code)
    if (group === undefined) groups.set(code, [section])
    else group.push(section)
  }
  return groups
}

/**
 * How an all-non-enrollable component group attaches to the sections a student
 * actually registers for.
 *
 * Three shapes occur, and the numbering is the only evidence distinguishing the
 * last two:
 *
 *   forced — one parent, so every unit gets it. 283 groups, the ordinary case.
 *
 *   block  — parents INTERLEAVE with the enrollable labels, which means KU laid
 *            the course out in numbered blocks. ACCT 200 has lectures at 1000,
 *            3000 and 5000 with labs at 1010-2040, 3010-3700 and 5800: lab 3010
 *            belongs to lecture 3000 and to no other. Pairing it with lecture
 *            1000 would offer a combination that does not exist. 9 groups.
 *
 *   free   — every parent sits outside the children's range, so the numbering
 *            expresses no pairing at all. CHEM 130 puts its four lectures at
 *            1000-1075 and all thirty-eight labs at 3000+; a student takes any
 *            lecture with any lab. 15 groups. Assuming blocks here would
 *            collapse 152 real combinations down to 38.
 *
 * The interleave test is the discriminator: a group is a block layout when at
 * least one enrollable label falls strictly between every consecutive pair of
 * parents. A parent without a usable numeric label cannot participate in that
 * reasoning, so such a group falls back to `free` — over-offering is recoverable
 * at enrolment, whereas hiding a student's only valid combination is not.
 */
export type Attachment =
  | { readonly kind: 'forced'; readonly parent: Section }
  | { readonly kind: 'block'; readonly parents: readonly Section[] }
  | { readonly kind: 'free'; readonly parents: readonly Section[] }

export function attachmentOf(
  parents: readonly Section[],
  enrollLabels: readonly number[],
): Attachment {
  const [only] = parents
  if (parents.length === 1 && only !== undefined) return { kind: 'forced', parent: only }

  const numbered = parents.filter((parent) => labelNumber(parent) !== null)
  if (numbered.length !== parents.length) return { kind: 'free', parents }

  const sorted = [...parents].sort((a, b) => (labelNumber(a) ?? 0) - (labelNumber(b) ?? 0))
  for (let index = 0; index + 1 < sorted.length; index++) {
    const low = labelNumber(sorted[index] as Section) ?? 0
    const high = labelNumber(sorted[index + 1] as Section) ?? 0
    if (!enrollLabels.some((label) => label > low && label < high)) {
      return { kind: 'free', parents: sorted }
    }
  }
  return { kind: 'block', parents: sorted }
}

/** The block parent owning a label: the nearest one at or below it. */
function blockParentFor(parents: readonly Section[], label: number | null): Section | undefined {
  if (label === null) return parents[0]
  let owner: Section | undefined
  for (const parent of parents) {
    const value = labelNumber(parent)
    if (value !== null && value <= label) owner = parent
  }
  // A label below every parent still needs one; the lowest is the only
  // defensible answer, and returning nothing would silently drop the section.
  return owner ?? parents[0]
}

/** Does any section in a combination clash with any other? */
function combinationConflicts(sections: readonly Section[]): boolean {
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const left = sections[i]
      const right = sections[j]
      if (left === undefined || right === undefined) continue
      if (anyMeetingConflicts(left.scheduled, right.scheduled)) return true
    }
  }
  return false
}

function makeUnit(term: TermCode, key: CourseKey, chosen: readonly Section[]): Unit {
  const sections = [...chosen].sort((a, b) =>
    vocabularyLabel(a.component).localeCompare(vocabularyLabel(b.component)),
  )
  const combSectIds = [
    ...new Set(sections.flatMap((s) => (s.combSectId === null ? [] : [s.combSectId]))),
  ]

  return {
    id: unitId(
      term,
      sections.map((s) => s.classNbr),
    ),
    courseKey: key,
    sections,
    enroll: sections.filter((s) => s.enrollable),
    scheduled: sections.flatMap((s) => s.scheduled),
    unscheduled: sections.flatMap((s) => s.unscheduled),
    combSectIds,
  }
}

/**
 * Every combination of one course's sections that a student could hold.
 *
 * Takes one course's sections — the caller filters, because this cannot tell a
 * mixed list apart from a course with a very strange component layout, and
 * silently grouping two courses together would produce units nobody can enrol
 * in. Sections of a different course are ignored rather than trusted.
 *
 * Combinations whose own components collide are dropped: a lecture that clashes
 * with a lab is not a choice a student has, and offering it would make the
 * solver's output unenrollable in a way no downstream check would catch.
 */
export function courseUnits(term: TermCode, sections: readonly Section[]): readonly Unit[] {
  const [first] = sections
  if (first === undefined) return []
  const key = first.courseKey
  const own = sections.filter((section) => section.courseKey === key)

  const groups = [...byComponent(own)]
  const enrollGroups = groups.filter(([, group]) => group.some((s) => s.enrollable))
  const attachedGroups = groups.filter(([, group]) => !group.some((s) => s.enrollable))

  // A course whose every section is non-enrollable has no registration point,
  // so the sections themselves are the only honest units to offer.
  const choiceGroups = enrollGroups.length > 0 ? enrollGroups : attachedGroups
  const attached = enrollGroups.length > 0 ? attachedGroups : []

  const enrollLabels = choiceGroups
    .flatMap(([, group]) => group.map(labelNumber))
    .filter((label): label is number => label !== null)

  // Start from the cross product of the groups a student registers in, then
  // hang each attached group off it — forced and block attachments are decided
  // by the choice already made, and only free ones widen the product further.
  let combinations: Section[][] = [[]]
  for (const [, group] of choiceGroups) {
    combinations = combinations.flatMap((combo) => group.map((section) => [...combo, section]))
  }

  for (const [, group] of attached) {
    const attachment = attachmentOf(group, enrollLabels)
    if (attachment.kind === 'forced') {
      const { parent } = attachment
      combinations = combinations.map((combo) => [...combo, parent])
    } else if (attachment.kind === 'block') {
      const { parents } = attachment
      combinations = combinations.map((combo) => {
        const labels = combo.map(labelNumber).filter((l): l is number => l !== null)
        const parent = blockParentFor(parents, labels.length > 0 ? Math.min(...labels) : null)
        return parent === undefined ? combo : [...combo, parent]
      })
    } else {
      const { parents } = attachment
      combinations = combinations.flatMap((combo) => parents.map((parent) => [...combo, parent]))
    }
  }

  return combinations
    .filter((combo) => combo.length > 0 && !combinationConflicts(combo))
    .map((combo) => makeUnit(term, key, combo))
}

/**
 * Do two units collide?
 *
 * Two tests, not one. The time check is the obvious half. The cross-listing
 * check catches what it cannot see: two units that ARE the same physical class
 * published under different course codes, which a student can only hold once.
 * 15 of the 602 groups publish different meeting patterns across their members,
 * so time alone would let those through.
 */
export function unitsConflict(a: Unit, b: Unit): boolean {
  if (a.combSectIds.some((id) => b.combSectIds.includes(id))) return true
  return anyMeetingConflicts(a.scheduled, b.scheduled)
}
