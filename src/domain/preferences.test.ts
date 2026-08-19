/**
 * Ranking tests.
 *
 * Each of the four preferences gets a test that isolates it: two schedules
 * identical except in the one dimension being ranked on. A test where several
 * things differ would pass on the wrong reason and never say so.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, penaltyOf, rankSchedules, shapeOf } from './preferences.ts'
import { courseUnits } from './unit.ts'
import { termCode } from './ids.ts'
import { parseDayMask } from './time.ts'
import { arranged, makeSection, meets } from '../testing/sections.ts'
import type { Unit } from './unit.ts'
import type { Schedule } from './solve.ts'
import type { Meeting } from './meeting.ts'

const TERM = termCode('4269')

let nextClassNbr = 1

function unitWith(name: string, meetings: readonly Meeting[]): Unit {
  const [unit] = courseUnits(TERM, [
    makeSection({
      course: name,
      classNbr: nextClassNbr++,
      scheduled: meetings.filter((m) => m.kind === 'scheduled'),
      unscheduled: meetings.filter((m) => m.kind === 'unscheduled'),
    }),
  ])
  if (unit === undefined) throw new Error('fixture produced no unit')
  return unit
}

const schedule = (...units: readonly Unit[]): Schedule => ({ units })

describe('shapeOf', () => {
  it('counts only the days something falls on', () => {
    const shape = shapeOf(schedule(unitWith('EECS 168', [meets('MWF', '09:00 AM', '09:50 AM')])))

    expect(shape.days).toHaveLength(3)
    expect(shape.gapMinutes).toBe(0)
  })

  it('measures the dead time between two classes on one day', () => {
    const shape = shapeOf(
      schedule(
        unitWith('EECS 168', [meets('M', '09:00 AM', '09:50 AM')]),
        unitWith('MATH 125', [meets('M', '01:00 PM', '01:50 PM')]),
      ),
    )

    // 9:50 to 13:00 is 190 minutes of nothing.
    expect(shape.gapMinutes).toBe(190)
    expect(shape.days[0]?.classMinutes).toBe(100)
  })

  it('reports no dead time for back-to-back classes', () => {
    const shape = shapeOf(
      schedule(
        unitWith('EECS 168', [meets('M', '09:00 AM', '09:50 AM')]),
        unitWith('MATH 125', [meets('M', '09:50 AM', '10:40 AM')]),
      ),
    )

    expect(shape.gapMinutes).toBe(0)
  })

  it('never reports negative dead time when two meetings overlap', () => {
    // Cross-listed pairs and duplicate rows both put two units on one minute.
    // Subtracting overlapping class time from the span would go below zero.
    const shape = shapeOf(
      schedule(
        unitWith('EECS 781', [meets('M', '09:00 AM', '10:00 AM')]),
        unitWith('MATH 781', [meets('M', '09:00 AM', '10:00 AM')]),
      ),
    )

    expect(shape.gapMinutes).toBe(0)
    expect(shape.days[0]?.classMinutes).toBe(60)
  })

  it('keeps a unit with no meeting time countable rather than lost', () => {
    const shape = shapeOf(schedule(unitWith('EECS 899', [arranged()])))

    expect(shape.days).toEqual([])
    expect(shape.unscheduledUnits).toBe(1)
  })
})

describe('penaltyOf', () => {
  const penalty = (units: readonly Unit[]) =>
    penaltyOf(shapeOf(schedule(...units)), DEFAULT_PREFERENCES)

  it('charges nothing for a schedule that breaks no preference', () => {
    // One day, inside the window, no gaps: everything but the per-day cost.
    const result = penalty([unitWith('EECS 168', [meets('M', '10:00 AM', '10:50 AM')])])

    expect(result.early).toBe(0)
    expect(result.late).toBe(0)
    expect(result.gaps).toBe(0)
    expect(result.daysOff).toBe(0)
    expect(result.days).toBe(60)
  })

  it('charges for starting before the hour a student asked for', () => {
    // 8am against a 9am preference, on one day.
    const result = penalty([unitWith('EECS 168', [meets('M', '08:00 AM', '08:50 AM')])])

    expect(result.early).toBe(60)
  })

  it('charges for every day the early start happens', () => {
    const result = penalty([unitWith('EECS 168', [meets('MWF', '08:00 AM', '08:50 AM')])])

    expect(result.early).toBe(180)
  })

  it('charges for running past the end of the day', () => {
    const result = penalty([unitWith('EECS 168', [meets('M', '04:00 PM', '06:00 PM')])])

    // An hour past 5pm, at half weight.
    expect(result.late).toBe(30)
  })

  it('charges for a day the student asked to keep free', () => {
    const friday = { ...DEFAULT_PREFERENCES, daysOff: parseDayMask('F') }
    const shape = shapeOf(schedule(unitWith('EECS 168', [meets('F', '10:00 AM', '10:50 AM')])))

    expect(penaltyOf(shape, friday).daysOff).toBe(300)
  })

  it('leaves a day alone when it is not the one asked for', () => {
    const friday = { ...DEFAULT_PREFERENCES, daysOff: parseDayMask('F') }
    const shape = shapeOf(schedule(unitWith('EECS 168', [meets('M', '10:00 AM', '10:50 AM')])))

    expect(penaltyOf(shape, friday).daysOff).toBe(0)
  })

  it('switches a rule off entirely when its bound is null', () => {
    const noOpinion = { ...DEFAULT_PREFERENCES, noEarlierThan: null }
    const shape = shapeOf(schedule(unitWith('EECS 168', [meets('M', '07:00 AM', '07:50 AM')])))

    expect(penaltyOf(shape, noOpinion).early).toBe(0)
  })
})

describe('rankSchedules', () => {
  it('puts the later start first when only the hour differs', () => {
    const early = schedule(unitWith('EECS 168', [meets('MWF', '08:00 AM', '08:50 AM')]))
    const sane = schedule(unitWith('EECS 168', [meets('MWF', '10:00 AM', '10:50 AM')]))

    const ranked = rankSchedules([early, sane])

    expect(ranked[0]?.schedule).toBe(sane)
  })

  it('prefers the compact day to the one with a hole in it', () => {
    const gappy = schedule(
      unitWith('A 1', [meets('M', '09:00 AM', '09:50 AM')]),
      unitWith('B 2', [meets('M', '03:00 PM', '03:50 PM')]),
    )
    const tight = schedule(
      unitWith('C 3', [meets('M', '09:00 AM', '09:50 AM')]),
      unitWith('D 4', [meets('M', '10:00 AM', '10:50 AM')]),
    )

    expect(rankSchedules([gappy, tight])[0]?.schedule).toBe(tight)
  })

  it('prefers two days on campus to four', () => {
    const spread = schedule(
      unitWith('A 1', [meets('M', '10:00 AM', '10:50 AM')]),
      unitWith('B 2', [meets('Tu', '10:00 AM', '10:50 AM')]),
      unitWith('C 3', [meets('W', '10:00 AM', '10:50 AM')]),
      unitWith('D 4', [meets('Th', '10:00 AM', '10:50 AM')]),
    )
    const packed = schedule(
      unitWith('E 5', [meets('M', '10:00 AM', '10:50 AM')]),
      unitWith('F 6', [meets('M', '11:00 AM', '11:50 AM')]),
      unitWith('G 7', [meets('Tu', '10:00 AM', '10:50 AM')]),
      unitWith('H 8', [meets('Tu', '11:00 AM', '11:50 AM')]),
    )

    expect(rankSchedules([spread, packed])[0]?.schedule).toBe(packed)
  })

  it('honours a requested day off over a tighter week', () => {
    // The day-off weight dominates on purpose: the student asked for it.
    const onFriday = schedule(unitWith('A 1', [meets('F', '10:00 AM', '10:50 AM')]))
    const gappyMonday = schedule(
      unitWith('B 2', [meets('M', '10:00 AM', '10:50 AM')]),
      unitWith('C 3', [meets('M', '02:00 PM', '02:50 PM')]),
    )

    const ranked = rankSchedules([onFriday, gappyMonday], {
      ...DEFAULT_PREFERENCES,
      daysOff: parseDayMask('F'),
    })

    expect(ranked[0]?.schedule).toBe(gappyMonday)
  })

  it('keeps equal schedules in the order they arrived', () => {
    // Two schedules a student cannot tell apart must not swap between renders.
    const a = schedule(unitWith('A 1', [meets('M', '10:00 AM', '10:50 AM')]))
    const b = schedule(unitWith('B 2', [meets('M', '10:00 AM', '10:50 AM')]))

    const ranked = rankSchedules([a, b])

    expect(ranked[0]?.penalty.total).toBe(ranked[1]?.penalty.total)
    expect(ranked[0]?.schedule).toBe(a)
  })

  it('explains its ordering rather than just producing one', () => {
    // The components are the reasons shown to a student, so they have to add up.
    const [best] = rankSchedules([
      schedule(
        unitWith('A 1', [meets('M', '08:00 AM', '08:50 AM')]),
        unitWith('B 2', [meets('M', '11:00 AM', '11:50 AM')]),
      ),
    ])

    const penalty = best?.penalty
    expect(penalty?.total).toBe(
      (penalty?.early ?? 0) +
        (penalty?.late ?? 0) +
        (penalty?.gaps ?? 0) +
        (penalty?.days ?? 0) +
        (penalty?.daysOff ?? 0),
    )
    expect(penalty?.early).toBeGreaterThan(0)
    expect(penalty?.gaps).toBeGreaterThan(0)
  })

  it('ranks nothing when there is nothing to rank', () => {
    expect(rankSchedules([])).toEqual([])
  })
})
