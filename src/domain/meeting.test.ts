import { describe, expect, it } from 'vitest'
import { termCode } from './ids.ts'
import { dateSpan, parseClockTime, parseDayMask, termCalendar } from './time.ts'
import {
  anyMeetingConflicts,
  classifyMeeting,
  meetingsConflict,
  partitionMeetings,
} from './meeting.ts'
import type { ScheduledMeeting } from './meeting.ts'

const fall2026 = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

const LAWRENCE = { campus: 'LAWRENCE', room: null }

/** Builds a MeetingInput the way the normalizer will: parse, then classify. */
const input = (days: string, start: string, end: string, begin = 'AUG-24', finish = 'DEC-18') => ({
  days: parseDayMask(days),
  start: parseClockTime(start),
  end: parseClockTime(end),
  rawStart: start,
  span: dateSpan(fall2026, begin, finish),
  place: LAWRENCE,
})

/** A scheduled meeting, for the conflict tests. */
const meeting = (days: string, start: string, end: string, begin = 'AUG-24', finish = 'DEC-18') => {
  const m = classifyMeeting(input(days, start, end, begin, finish))
  if (m.kind !== 'scheduled') throw new Error('fixture is not scheduled')
  return m
}

describe('classifyMeeting — the sentinels', () => {
  it("treats '12:00 AM'–'12:00 AM' as unscheduled, not as a midnight class", () => {
    // 2,309 live rows. Reading the clock literally gives thousands of sections
    // all meeting at minute 0, mutually conflicting every day of the term.
    const m = classifyMeeting(input('', '12:00 AM', '12:00 AM'))
    expect(m.kind).toBe('unscheduled')
    expect(m.kind === 'unscheduled' && m.reason).toBe('no-published-time')
  })

  it("treats 'APPT' as an appointment", () => {
    const m = classifyMeeting(input('', 'APPT', ''))
    expect(m.kind).toBe('unscheduled')
    expect(m.kind === 'unscheduled' && m.reason).toBe('appointment')
  })

  it('treats blank times as TBA', () => {
    const m = classifyMeeting(input('', '', ''))
    expect(m.kind).toBe('unscheduled')
    expect(m.kind === 'unscheduled' && m.reason).toBe('tba')
  })

  it('classifies on the time even when real days are published', () => {
    // The live MATH 101 row: online, days MWF, time 12:00 AM–12:00 AM. Keying on
    // days would put it on the calendar at midnight three times a week.
    const m = classifyMeeting(input('MWF', '12:00 AM', '12:00 AM'))
    expect(m.kind).toBe('unscheduled')
    expect(m.kind === 'unscheduled' && m.reason).toBe('no-published-time')
  })

  it('classifies APPT rows that carry days as unscheduled too', () => {
    // 13 live rows have this shape.
    expect(classifyMeeting(input('TuTh', 'APPT', '')).kind).toBe('unscheduled')
  })

  it('rejects a real time with no days, having nowhere to put it', () => {
    const m = classifyMeeting(input('', '09:00 AM', '09:50 AM'))
    expect(m.kind).toBe('unscheduled')
    expect(m.kind === 'unscheduled' && m.reason).toBe('tba')
  })

  it('rejects a backwards time range', () => {
    expect(classifyMeeting(input('MWF', '02:00 PM', '09:00 AM')).kind).toBe('unscheduled')
  })

  it('keeps the date span and place on unscheduled meetings', () => {
    // They still belong to a part of the term, which matters for reporting.
    const m = classifyMeeting(input('', 'APPT', '', 'OCT-21', 'DEC-18'))
    expect(m.span).toEqual(dateSpan(fall2026, 'OCT-21', 'DEC-18'))
    expect(m.place.campus).toBe('LAWRENCE')
  })
})

describe('classifyMeeting — real meetings', () => {
  it('accepts an ordinary lecture', () => {
    const m = classifyMeeting(input('MWF', '09:00 AM', '09:50 AM'))
    expect(m.kind).toBe('scheduled')
    if (m.kind !== 'scheduled') return
    expect(m.days).toBe(parseDayMask('MWF'))
    expect(m.start).toBe(9 * 60)
    expect(m.end).toBe(9 * 60 + 50)
  })

  it('accepts a Saturday section', () => {
    expect(classifyMeeting(input('Sa', '09:00 AM', '11:50 AM')).kind).toBe('scheduled')
  })

  it('accepts an afternoon TuTh section', () => {
    const m = classifyMeeting(input('TuTh', '02:00 PM', '03:15 PM'))
    expect(m.kind).toBe('scheduled')
    if (m.kind !== 'scheduled') return
    expect(m.start).toBe(14 * 60)
    expect(m.end).toBe(15 * 60 + 15)
  })
})

describe('meetingsConflict', () => {
  it('finds a clash on a shared day and overlapping time', () => {
    expect(
      meetingsConflict(meeting('MWF', '09:00 AM', '09:50 AM'), meeting('MW', '09:30 AM', '10:20 AM')),
    ).toBe(true)
  })

  it('lets back-to-back classes stand', () => {
    // Ends 09:50, next starts 09:50. Half-open, so no conflict.
    expect(
      meetingsConflict(meeting('MWF', '09:00 AM', '09:50 AM'), meeting('MWF', '09:50 AM', '10:40 AM')),
    ).toBe(false)
  })

  it('lets the same hour stand on different days', () => {
    expect(
      meetingsConflict(meeting('MWF', '09:00 AM', '09:50 AM'), meeting('TuTh', '09:00 AM', '09:50 AM')),
    ).toBe(false)
  })

  it('lets the same hour and days stand in disjoint parts of the term', () => {
    expect(
      meetingsConflict(
        meeting('MWF', '09:00 AM', '09:50 AM', 'AUG-24', 'SEP-30'),
        meeting('MWF', '09:00 AM', '09:50 AM', 'OCT-01', 'DEC-18'),
      ),
    ).toBe(false)
  })

  it('finds a clash when the date spans do touch', () => {
    expect(
      meetingsConflict(
        meeting('MWF', '09:00 AM', '09:50 AM', 'AUG-24', 'OCT-16'),
        meeting('MWF', '09:00 AM', '09:50 AM', 'OCT-01', 'DEC-18'),
      ),
    ).toBe(true)
  })

  it('finds a clash against a year-long section', () => {
    // The year-wrap span must overlap the ordinary term, or a full-year class
    // silently conflicts with nothing at all.
    expect(
      meetingsConflict(
        meeting('MWF', '09:00 AM', '09:50 AM', 'AUG-13', 'MAY-26'),
        meeting('MWF', '09:00 AM', '09:50 AM'),
      ),
    ).toBe(true)
  })

  it('is symmetric', () => {
    const a = meeting('MWF', '09:00 AM', '10:00 AM')
    const b = meeting('MW', '09:30 AM', '10:30 AM')
    expect(meetingsConflict(a, b)).toBe(meetingsConflict(b, a))
  })
})

describe('anyMeetingConflicts', () => {
  it('reports a section with nothing scheduled as free', () => {
    // The natural, correct meaning of an empty array — no special case needed.
    expect(anyMeetingConflicts([], [meeting('MWF', '09:00 AM', '09:50 AM')])).toBe(false)
    expect(anyMeetingConflicts([], [])).toBe(false)
  })

  it('finds a clash on the second meeting pattern of a section', () => {
    // Class 22671 (EECS 220) meets MWF 12:00 and Tu 15:30. A schedule that
    // collides only with the Tuesday pattern must still be rejected.
    const multiPattern: ScheduledMeeting[] = [
      meeting('MWF', '12:00 PM', '12:50 PM'),
      meeting('Tu', '03:30 PM', '04:20 PM'),
    ]
    expect(anyMeetingConflicts(multiPattern, [meeting('Tu', '04:00 PM', '05:00 PM')])).toBe(true)
  })

  it('clears a section that misses every pattern', () => {
    const multiPattern: ScheduledMeeting[] = [
      meeting('MWF', '12:00 PM', '12:50 PM'),
      meeting('Tu', '03:30 PM', '04:20 PM'),
    ]
    expect(anyMeetingConflicts(multiPattern, [meeting('Th', '03:30 PM', '04:20 PM')])).toBe(false)
  })
})

describe('partitionMeetings', () => {
  it('separates the two kinds', () => {
    const { scheduled, unscheduled } = partitionMeetings([
      classifyMeeting(input('MWF', '09:00 AM', '09:50 AM')),
      classifyMeeting(input('', 'APPT', '')),
      classifyMeeting(input('TuTh', '02:00 PM', '03:15 PM')),
      classifyMeeting(input('', '12:00 AM', '12:00 AM')),
    ])

    expect(scheduled).toHaveLength(2)
    expect(unscheduled).toHaveLength(2)
    expect(unscheduled.map((m) => m.reason).sort()).toEqual(['appointment', 'no-published-time'])
  })

  it('handles an all-unscheduled section', () => {
    const { scheduled, unscheduled } = partitionMeetings([classifyMeeting(input('', 'APPT', ''))])
    expect(scheduled).toEqual([])
    expect(unscheduled).toHaveLength(1)
  })
})
