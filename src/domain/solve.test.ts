/**
 * Solver tests.
 *
 * The interesting cases are the failures, not the successes: a solver that
 * finds schedules when they exist is the easy half, and a solver that explains
 * itself when they do not is the half a student actually meets.
 */

import { describe, expect, it } from 'vitest'
import { solveSchedules } from './solve.ts'
import { courseUnits } from './unit.ts'
import { courseKey, termCode } from './ids.ts'
import { arranged, makeSection, meets } from '../testing/sections.ts'
import type { CourseOptions } from './solve.ts'
import type { Meeting } from './meeting.ts'

const TERM = termCode('4269')

let nextClassNbr = 1

/**
 * A course offering one unit per meeting pattern given.
 *
 * Built through courseUnits rather than by hand so the solver is always tested
 * against units the linkage code really produces.
 */
function course(name: string, patterns: readonly (readonly Meeting[])[]): CourseOptions {
  const [subject = 'EECS', number = '100'] = name.split(' ')
  const sections = patterns.map((pattern, index) =>
    makeSection({
      course: name,
      classNbr: nextClassNbr++,
      number: String(1000 + index * 100),
      scheduled: pattern.filter((m) => m.kind === 'scheduled'),
      unscheduled: pattern.filter((m) => m.kind === 'unscheduled'),
    }),
  )
  return { courseKey: courseKey(subject, number), units: courseUnits(TERM, sections) }
}

const at = (days: string, start: string, end: string): readonly Meeting[] => [meets(days, start, end)]

describe('solveSchedules', () => {
  it('returns nothing at all when asked for nothing', () => {
    expect(solveSchedules([]).schedules).toEqual([])
  })

  it('offers every section of a single course', () => {
    const result = solveSchedules([
      course('EECS 168', [at('MWF', '09:00 AM', '09:50 AM'), at('MWF', '10:00 AM', '10:50 AM')]),
    ])

    expect(result.schedules).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('combines two courses that do not collide', () => {
    const result = solveSchedules([
      course('EECS 168', [at('MWF', '09:00 AM', '09:50 AM')]),
      course('MATH 125', [at('MWF', '11:00 AM', '11:50 AM')]),
    ])

    expect(result.schedules).toHaveLength(1)
    expect(result.schedules[0]?.units).toHaveLength(2)
  })

  it('drops the combinations that collide and keeps the ones that do not', () => {
    const result = solveSchedules([
      course('EECS 168', [at('MWF', '09:00 AM', '09:50 AM'), at('MWF', '01:00 PM', '01:50 PM')]),
      // Clashes with the 9am option only.
      course('MATH 125', [at('MWF', '09:30 AM', '10:20 AM')]),
    ])

    expect(result.schedules).toHaveLength(1)
    expect(result.schedules[0]?.units[0]?.sections[0]?.number).toBe('1100')
  })

  it('names the two courses to blame when nothing works', () => {
    // The whole point: "no schedule works" is useless, "EECS 168 and MATH 125
    // cannot both be taken" is actionable.
    const result = solveSchedules([
      course('EECS 168', [at('MWF', '09:00 AM', '09:50 AM')]),
      course('MATH 125', [at('MWF', '09:00 AM', '09:50 AM')]),
    ])

    expect(result.schedules).toEqual([])
    expect(result.blockers).toEqual([['EECS|168', 'MATH|125']])
  })

  it('reports a course with no options separately from a clash', () => {
    // A different problem with a different fix, so it is not folded into
    // blockers — there is no second course to blame.
    const result = solveSchedules([
      course('EECS 168', [at('MWF', '09:00 AM', '09:50 AM')]),
      { courseKey: courseKey('MATH', '125'), units: [] },
    ])

    expect(result.empty).toEqual(['MATH|125'])
    expect(result.blockers).toEqual([])
    expect(result.schedules).toEqual([])
  })

  it('does not blame a pair when the failure needs all three', () => {
    // Pairwise-compatible but jointly impossible: every course has two slots
    // and there are only two slots to go round. Reporting a culprit here would
    // be inventing one.
    const morning = at('MWF', '09:00 AM', '09:50 AM')
    const noon = at('MWF', '12:00 PM', '12:50 PM')
    const result = solveSchedules([
      course('A 1', [morning, noon]),
      course('B 2', [morning, noon]),
      course('C 3', [morning, noon]),
    ])

    expect(result.schedules).toEqual([])
    expect(result.blockers).toEqual([])
  })

  it('lets sections with no published time coexist with anything', () => {
    // Over half the term publishes no meeting time. If these conflicted, a
    // student taking two independent studies would be told it is impossible.
    const result = solveSchedules([
      course('EECS 899', [[arranged()]]),
      course('MATH 899', [[arranged()]]),
    ])

    expect(result.schedules).toHaveLength(1)
  })

  it('stops at the cap and says so', () => {
    // Ten distinct start times. They may overlap each other freely: only one
    // section of a course is ever chosen, so they are never compared.
    const many = Array.from({ length: 10 }, (_, i) =>
      at('MWF', `08:${String(i * 5).padStart(2, '0')} AM`, '09:00 AM'),
    )
    const result = solveSchedules([course('EECS 168', many)], { limit: 3 })

    expect(result.schedules).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('gives up rather than hanging, and calls that truncation not failure', () => {
    // A step ceiling reached must never be reported as "no schedule exists" —
    // that would be a lie about the data rather than about the search.
    const many = Array.from({ length: 20 }, (_, i) =>
      at(
        'Sa',
        `${String(1 + (i % 11)).padStart(2, '0')}:00 AM`,
        `${String(1 + (i % 11)).padStart(2, '0')}:50 AM`,
      ),
    )
    const result = solveSchedules([course('A 1', many), course('B 2', many)], { maxSteps: 5 })

    expect(result.truncated).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('hands back units in the order the student added the courses', () => {
    // The search reorders courses fewest-options-first; the result must not
    // leak that ordering, or the UI reshuffles rows for no visible reason.
    const result = solveSchedules([
      // Two options, so the search visits this one second.
      course('ZZZ 900', [at('Tu', '09:00 AM', '09:50 AM'), at('Tu', '10:00 AM', '10:50 AM')]),
      course('AAA 100', [at('W', '09:00 AM', '09:50 AM')]),
    ])

    expect(result.schedules[0]?.units.map((u) => u.courseKey)).toEqual(['ZZZ|900', 'AAA|100'])
  })

  it('refuses to put a student in the same cross-listed class twice', () => {
    const a = makeSection({
      course: 'EECS 781',
      classNbr: 9001,
      combSectId: 4950,
      scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
    })
    const b = makeSection({
      course: 'MATH 781',
      classNbr: 9002,
      combSectId: 4950,
      // A different pattern, so only the cross-listing check catches this.
      scheduled: [meets('TuTh', '02:00 PM', '03:15 PM')],
    })

    const result = solveSchedules([
      { courseKey: courseKey('EECS', '781'), units: courseUnits(TERM, [a]) },
      { courseKey: courseKey('MATH', '781'), units: courseUnits(TERM, [b]) },
    ])

    expect(result.schedules).toEqual([])
    expect(result.blockers).toEqual([['EECS|781', 'MATH|781']])
  })

  it('keeps a mandatory parent lecture out of the way of another course', () => {
    // The linkage payoff: the lecture is not enrollable and not what the
    // student registers for, but the solver still must not book over it.
    const lecture = makeSection({
      course: 'AE 245',
      classNbr: 8001,
      number: '1000',
      component: 'LEC',
      enrollable: false,
      scheduled: [meets('Tu', '11:00 AM', '11:50 AM')],
    })
    const lab = makeSection({
      course: 'AE 245',
      classNbr: 8002,
      number: '1100',
      component: 'LBN',
      scheduled: [meets('W', '01:00 PM', '02:50 PM')],
    })

    const result = solveSchedules([
      { courseKey: courseKey('AE', '245'), units: courseUnits(TERM, [lecture, lab]) },
      // Collides with the lecture only, which a section-based solver would miss.
      course('MATH 125', [at('Tu', '11:30 AM', '12:20 PM')]),
    ])

    expect(result.schedules).toEqual([])
    expect(result.blockers).toEqual([['AE|245', 'MATH|125']])
  })
})
