/**
 * Linkage tests, shaped after the four layouts the live term actually contains.
 *
 * Each fixture is a scaled-down copy of a real course rather than an invented
 * one, and the comment on each says which. A layout nobody offers is not worth
 * defending; these four cover all 4,412 courses in Fall 2026.
 */

import { describe, expect, it } from 'vitest'
import { attachmentOf, courseUnits, unitsConflict } from './unit.ts'
import { termCode } from './ids.ts'
import { arranged, makeSection, meets } from '../testing/sections.ts'
import type { Section } from './section.ts'

const TERM = termCode('4269')

const units = (sections: readonly Section[]) => courseUnits(TERM, sections)
/** Section labels of a unit, sorted, as a compact assertion target. */
const shape = (sections: readonly Section[]) =>
  sections
    .map((s) => s.number)
    .sort()
    .join('+')
const shapes = (list: readonly { sections: readonly Section[] }[]) =>
  list.map((u) => shape(u.sections)).sort()

describe('courseUnits', () => {
  it('treats each section of a single-component course as its own unit', () => {
    // 4,091 of 4,412 courses. The overwhelming ordinary case.
    const result = units([
      makeSection({
        course: 'HIST 101',
        classNbr: 1,
        number: '1000',
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
      makeSection({
        course: 'HIST 101',
        classNbr: 2,
        number: '2000',
        scheduled: [meets('MWF', '10:00 AM', '10:50 AM')],
      }),
    ])

    expect(result).toHaveLength(2)
    expect(shapes(result)).toEqual(['1000', '2000'])
  })

  it('attaches the single parent lecture to every enrollable child', () => {
    // AE 245: one non-enrollable LEC, four LBN children. 283 groups look like this.
    const result = units([
      makeSection({
        course: 'AE 245',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('Tu', '11:00 AM', '11:50 AM')],
      }),
      makeSection({
        course: 'AE 245',
        classNbr: 2,
        number: '1100',
        component: 'LBN',
        scheduled: [meets('W', '01:00 PM', '02:50 PM')],
      }),
      makeSection({
        course: 'AE 245',
        classNbr: 3,
        number: '1200',
        component: 'LBN',
        scheduled: [meets('Th', '01:00 PM', '02:50 PM')],
      }),
    ])

    expect(shapes(result)).toEqual(['1000+1100', '1000+1200'])
  })

  it('puts the parent lecture on the calendar even though nobody enrolls in it', () => {
    // The bug this module exists to prevent: 341 of 359 parents publish a real
    // meeting time that the student attends.
    const [unit] = units([
      makeSection({
        course: 'AE 245',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('Tu', '11:00 AM', '11:50 AM')],
      }),
      makeSection({
        course: 'AE 245',
        classNbr: 2,
        number: '1100',
        component: 'LBN',
        scheduled: [meets('W', '01:00 PM', '02:50 PM')],
      }),
    ])

    expect(unit?.scheduled).toHaveLength(2)
    // ...and the student is told to register for only the lab.
    expect(unit?.enroll.map((s) => s.number)).toEqual(['1100'])
  })

  it('pairs every lecture with every lab when the numbering expresses no blocks', () => {
    // CHEM 130: lectures at 1000/1025, labs at 3000/3010. No child sits between
    // the two lectures, so they are alternatives and all four pairs are real.
    const result = units([
      makeSection({
        course: 'CHEM 130',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 2,
        number: '1025',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MWF', '11:00 AM', '11:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 3,
        number: '3000',
        component: 'LBN',
        scheduled: [meets('Tu', '10:00 AM', '11:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 4,
        number: '3010',
        component: 'LBN',
        scheduled: [meets('W', '02:00 PM', '03:50 PM')],
      }),
    ])

    expect(shapes(result)).toEqual(['1000+3000', '1000+3010', '1025+3000', '1025+3010'])
  })

  it('respects numbered blocks, so a lab only pairs with the lecture that owns it', () => {
    // ACCT 200: lectures at 1000 and 3000, labs at 1010 and 3010. Lab 1010 sits
    // between the lectures, which is what marks this as a block layout.
    const result = units([
      makeSection({
        course: 'ACCT 200',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MW', '09:30 AM', '10:45 AM')],
      }),
      makeSection({
        course: 'ACCT 200',
        classNbr: 2,
        number: '3000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MW', '11:00 AM', '12:15 PM')],
      }),
      makeSection({
        course: 'ACCT 200',
        classNbr: 3,
        number: '1010',
        component: 'LBN',
        scheduled: [meets('Tu', '03:30 PM', '04:45 PM')],
      }),
      makeSection({
        course: 'ACCT 200',
        classNbr: 4,
        number: '3010',
        component: 'LBN',
        scheduled: [meets('Th', '03:30 PM', '04:45 PM')],
      }),
    ])

    // Two units, not four: 1010 belongs to 1000 and 3010 belongs to 3000.
    expect(shapes(result)).toEqual(['1000+1010', '3000+3010'])
  })

  it('drops a combination whose own lecture and lab collide', () => {
    // Not hypothetical once lectures and labs are crossed: a free-choice course
    // will generate pairs that overlap, and offering one is offering a schedule
    // that cannot be registered.
    const result = units([
      makeSection({
        course: 'CHEM 130',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 2,
        number: '1025',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('MWF', '02:00 PM', '02:50 PM')],
      }),
      // Clashes with the 9am lecture, not the 2pm one.
      makeSection({
        course: 'CHEM 130',
        classNbr: 3,
        number: '3000',
        component: 'LBN',
        scheduled: [meets('M', '09:30 AM', '11:20 AM')],
      }),
    ])

    expect(shapes(result)).toEqual(['1025+3000'])
  })

  it('keeps a unit that has no published meeting time at all', () => {
    // Over half the term publishes no time. A unit that vanished here would read
    // to a student as free time.
    const result = units([
      makeSection({ course: 'EECS 899', classNbr: 1, number: '1000', unscheduled: [arranged()] }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.scheduled).toEqual([])
    expect(result[0]?.unscheduled).toHaveLength(1)
  })

  it('ignores sections belonging to a different course', () => {
    const result = units([
      makeSection({ course: 'EECS 168', classNbr: 1, number: '1000' }),
      makeSection({ course: 'MATH 125', classNbr: 2, number: '1000' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.courseKey).toBe('EECS|168')
  })

  it('falls back to the sections themselves when a course has no enrollable one', () => {
    const result = units([
      makeSection({ course: 'ODD 100', classNbr: 1, number: '1000', enrollable: false }),
      makeSection({ course: 'ODD 100', classNbr: 2, number: '2000', enrollable: false }),
    ])

    expect(shapes(result)).toEqual(['1000', '2000'])
  })

  it('gives each combination a distinct id', () => {
    const result = units([
      makeSection({
        course: 'CHEM 130',
        classNbr: 1,
        number: '1000',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('M', '09:00 AM', '09:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 2,
        number: '1025',
        component: 'LEC',
        enrollable: false,
        scheduled: [meets('M', '11:00 AM', '11:50 AM')],
      }),
      makeSection({
        course: 'CHEM 130',
        classNbr: 3,
        number: '3000',
        component: 'LBN',
        scheduled: [meets('Tu', '10:00 AM', '11:50 AM')],
      }),
    ])

    // The lab is shared, so an id keyed on the enrolled section alone would
    // collapse these two genuinely different choices into one.
    expect(new Set(result.map((u) => u.id)).size).toBe(2)
  })
})

describe('attachmentOf', () => {
  const parent = (number: string) =>
    makeSection({ course: 'X 1', classNbr: Number(number), number, enrollable: false })

  it('calls a lone parent forced', () => {
    expect(attachmentOf([parent('1000')], [1100]).kind).toBe('forced')
  })

  it('calls interleaved parents a block layout', () => {
    expect(attachmentOf([parent('1000'), parent('3000')], [1010, 3010]).kind).toBe('block')
  })

  it('calls parents with nothing between them a free choice', () => {
    expect(attachmentOf([parent('1000'), parent('1025')], [3000, 3010]).kind).toBe('free')
  })

  it('falls back to free choice when a parent has no numeric label', () => {
    // Over-offering is recoverable at enrolment; hiding a student's only valid
    // combination is not.
    const unlabelled = makeSection({ course: 'X 1', classNbr: 9, number: 'A01', enrollable: false })
    expect(attachmentOf([parent('1000'), unlabelled], [1010]).kind).toBe('free')
  })
})

describe('unitsConflict', () => {
  const unitFor = (section: Section) => {
    const [unit] = courseUnits(TERM, [section])
    if (unit === undefined) throw new Error('fixture produced no unit')
    return unit
  }

  it('reports a clash when the meetings overlap', () => {
    const a = unitFor(
      makeSection({
        course: 'EECS 168',
        classNbr: 1,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
    )
    const b = unitFor(
      makeSection({
        course: 'MATH 125',
        classNbr: 2,
        scheduled: [meets('MWF', '09:30 AM', '10:20 AM')],
      }),
    )

    expect(unitsConflict(a, b)).toBe(true)
  })

  it('reports no clash when they merely sit next to each other', () => {
    const a = unitFor(
      makeSection({
        course: 'EECS 168',
        classNbr: 1,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
    )
    const b = unitFor(
      makeSection({
        course: 'MATH 125',
        classNbr: 2,
        scheduled: [meets('MWF', '09:50 AM', '10:40 AM')],
      }),
    )

    expect(unitsConflict(a, b)).toBe(false)
  })

  it('refuses two units that are the same cross-listed class', () => {
    // 15 of the 602 groups publish different meeting patterns across members,
    // so the time check alone would let these through as unrelated classes.
    const a = unitFor(
      makeSection({
        course: 'EECS 781',
        classNbr: 1,
        combSectId: 4950,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
    )
    const b = unitFor(
      makeSection({
        course: 'MATH 781',
        classNbr: 2,
        combSectId: 4950,
        scheduled: [meets('TuTh', '02:00 PM', '03:15 PM')],
      }),
    )

    expect(unitsConflict(a, b)).toBe(true)
  })

  it('allows two different cross-listed classes to coexist', () => {
    const a = unitFor(
      makeSection({
        course: 'EECS 781',
        classNbr: 1,
        combSectId: 4950,
        scheduled: [meets('MWF', '09:00 AM', '09:50 AM')],
      }),
    )
    const b = unitFor(
      makeSection({
        course: 'MATH 700',
        classNbr: 2,
        combSectId: 4951,
        scheduled: [meets('TuTh', '02:00 PM', '03:15 PM')],
      }),
    )

    expect(unitsConflict(a, b)).toBe(false)
  })
})
