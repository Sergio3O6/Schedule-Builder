import { describe, expect, it } from 'vitest'
import { hourMarks, weekLayout } from './calendar.ts'
import { arranged, makeSection, meets } from '../testing/sections.ts'
import type { CalendarSource } from './calendar.ts'
import type { ScheduledMeeting, UnscheduledMeeting } from '../domain/meeting.ts'

let counter = 0
const source = (
  label: string,
  scheduled: readonly ScheduledMeeting[],
  unscheduled: readonly UnscheduledMeeting[] = [],
): CalendarSource => {
  counter += 1
  return {
    id: label,
    label,
    section: makeSection({ course: label, classNbr: 20000 + counter, scheduled, unscheduled }),
  }
}

const appointment = arranged()

describe('columns', () => {
  it('draws the five weekdays even with nothing on them', () => {
    const layout = weekLayout([])
    expect(layout.days.map((day) => day.token)).toEqual(['M', 'Tu', 'W', 'Th', 'F'])
  })

  it('adds Saturday only when something is on it', () => {
    const layout = weekLayout([source('EECS 168', [meets('Sa', '09:00 AM', '11:00 AM')])])
    expect(layout.days.map((day) => day.token)).toEqual(['M', 'Tu', 'W', 'Th', 'F', 'Sa'])
  })

  it('keeps the weekend columns out when the week is ordinary', () => {
    const layout = weekLayout([source('EECS 168', [meets('MWF', '09:00 AM', '09:50 AM')])])
    expect(layout.days.map((day) => day.token)).not.toContain('Sa')
    expect(layout.days.map((day) => day.token)).not.toContain('Su')
  })
})

describe('placement', () => {
  it('puts one MWF lecture on three days', () => {
    const layout = weekLayout([source('EECS 168', [meets('MWF', '09:00 AM', '09:50 AM')])])
    expect(layout.blocks).toHaveLength(3)
    expect(layout.blocks.map((block) => layout.days[block.dayIndex]?.token).sort()).toEqual([
      'F',
      'M',
      'W',
    ])
  })

  it('gives every block a distinct key', () => {
    const layout = weekLayout([
      source('EECS 168', [
        meets('MWF', '09:00 AM', '09:50 AM'),
        meets('Tu', '02:00 PM', '03:50 PM'),
      ]),
      source('MATH 126', [meets('MWF', '10:00 AM', '10:50 AM')]),
    ])
    expect(new Set(layout.blocks.map((block) => block.key)).size).toBe(layout.blocks.length)
  })

  it('reports a section with nothing scheduled instead of dropping it', () => {
    // Over half the live rows publish no meeting time. Leaving them off the
    // screen entirely would show a student an empty week they are not free in.
    const layout = weekLayout([source('EECS 690', [], [appointment])])
    expect(layout.blocks).toHaveLength(0)
    expect(layout.unplaced.map((entry) => entry.label)).toEqual(['EECS 690'])
  })

  it('places a section that meets sometimes, however much of it is arranged', () => {
    const layout = weekLayout([
      source('EECS 268', [meets('MWF', '01:00 PM', '01:50 PM')], [appointment]),
    ])
    expect(layout.blocks).toHaveLength(3)
    expect(layout.unplaced).toHaveLength(0)
  })
})

describe('bounds', () => {
  it('falls back to a plausible teaching day when there is nothing to show', () => {
    const layout = weekLayout([])
    expect(layout.startMinute).toBe(8 * 60)
    expect(layout.endMinute).toBe(18 * 60)
  })

  it('snaps outward to whole hours so a 9:30 class is not clipped', () => {
    const layout = weekLayout([source('EECS 168', [meets('MW', '09:30 AM', '10:45 AM')])])
    expect(layout.startMinute).toBe(9 * 60)
    expect(layout.endMinute).toBe(11 * 60)
  })

  it('stretches to cover the earliest and the latest of everything', () => {
    const layout = weekLayout([
      source('EECS 168', [meets('MWF', '08:00 AM', '08:50 AM')]),
      source('MATH 126', [meets('Tu', '07:00 PM', '09:40 PM')]),
    ])
    expect(layout.startMinute).toBe(8 * 60)
    expect(layout.endMinute).toBe(22 * 60)
  })

  it('labels every hour from the top of the grid to the bottom', () => {
    const layout = weekLayout([source('EECS 168', [meets('M', '09:00 AM', '11:00 AM')])])
    expect(hourMarks(layout)).toEqual([9 * 60, 10 * 60, 11 * 60])
  })
})

describe('overlap packing', () => {
  it('splits two clashing classes into side-by-side columns', () => {
    const layout = weekLayout([
      source('EECS 168', [meets('M', '09:00 AM', '10:00 AM')]),
      source('MATH 126', [meets('M', '09:30 AM', '10:30 AM')]),
    ])
    expect(layout.blocks.map((block) => block.column)).toEqual([0, 1])
    expect(layout.blocks.every((block) => block.columns === 2)).toBe(true)
  })

  it('keeps back-to-back classes full width', () => {
    // Half-open, matching timeOverlaps: a 9:50 finish does not clash with a
    // 9:50 start, so nothing is narrowed to make room for a gap of zero.
    const layout = weekLayout([
      source('EECS 168', [meets('M', '09:00 AM', '09:50 AM')]),
      source('MATH 126', [meets('M', '09:50 AM', '10:40 AM')]),
    ])
    expect(layout.blocks.map((block) => block.column)).toEqual([0, 0])
    expect(layout.blocks.map((block) => block.columns)).toEqual([1, 1])
  })

  it('agrees on one width across a chain of overlaps', () => {
    // A clashes with B and B with C, but A and C do not touch. Widths have to
    // be settled for the whole chain: solving each pair alone gives blocks of
    // different widths that do not line up down the column.
    const layout = weekLayout([
      source('AAA 100', [meets('M', '09:00 AM', '11:00 AM')]),
      source('BBB 100', [meets('M', '10:00 AM', '12:00 PM')]),
      source('CCC 100', [meets('M', '11:00 AM', '01:00 PM')]),
    ])
    expect(layout.blocks.map((block) => [block.label, block.column])).toEqual([
      ['AAA 100', 0],
      ['BBB 100', 1],
      ['CCC 100', 0],
    ])
    expect(new Set(layout.blocks.map((block) => block.columns))).toEqual(new Set([2]))
  })

  it('narrows only the day that actually clashes', () => {
    const layout = weekLayout([
      source('EECS 168', [meets('MW', '09:00 AM', '10:00 AM')]),
      source('MATH 126', [meets('W', '09:30 AM', '10:30 AM')]),
    ])
    const monday = layout.blocks.filter((block) => layout.days[block.dayIndex]?.token === 'M')
    const wednesday = layout.blocks.filter((block) => layout.days[block.dayIndex]?.token === 'W')
    expect(monday.map((block) => block.columns)).toEqual([1])
    expect(wednesday.map((block) => block.columns)).toEqual([2, 2])
  })
})
