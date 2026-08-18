import { describe, expect, it } from 'vitest'
import {
  describeUnscheduled,
  formatCredits,
  formatDayMask,
  formatMinuteOfDay,
  formatScheduledMeeting,
  formatTimeRange,
} from './format.ts'
import { classifyMeeting } from '../domain/meeting.ts'
import { termCode } from '../domain/ids.ts'
import {
  dateSpan,
  END_OF_DAY,
  minuteOfDay,
  parseClockTime,
  parseDayMask,
  termCalendar,
} from '../domain/time.ts'
import { parseCredits } from '../domain/section.ts'
import type { ScheduledMeeting } from '../domain/meeting.ts'

const fall = termCalendar(termCode('4269'), '2026-08-24', '2026-12-18')

const meeting = (days: string, start: string, end: string) =>
  classifyMeeting({
    days: parseDayMask(days),
    start: parseClockTime(start),
    end: parseClockTime(end),
    rawStart: start,
    span: dateSpan(fall, 'AUG-24', 'DEC-18'),
    place: { campus: 'LAWRENCE', room: null },
  })

const scheduled = (days: string, start: string, end: string): ScheduledMeeting => {
  const m = meeting(days, start, end)
  if (m.kind !== 'scheduled') throw new Error('fixture is not scheduled')
  return m
}

describe('formatDayMask', () => {
  it('round-trips the patterns the export really writes', () => {
    // A reader comparing the app against the official schedule must see the
    // same string, so this follows KU's spelling rather than inventing one.
    for (const pattern of ['MWF', 'TuTh', 'MTuWThF', 'M', 'F', 'Sa', 'Su']) {
      expect(formatDayMask(parseDayMask(pattern))).toBe(pattern)
    }
  })

  it('prints a week starting on Monday, not on the mask s first bit', () => {
    // The mask starts at Sunday because that is where a 7-bit week starts.
    // Printing bit order gives 'SuMTuWThFSa' — correct and unrecognisable.
    expect(formatDayMask(parseDayMask('SuSaF'))).toBe('FSaSu')
  })

  it('is empty for no days, which a caller must not print bare', () => {
    expect(formatDayMask(parseDayMask(''))).toBe('')
  })
})

describe('formatMinuteOfDay', () => {
  it('reads back every clock time the export publishes', () => {
    for (const time of ['12:00 AM', '08:00 AM', '09:50 AM', '12:00 PM', '01:00 PM', '10:00 PM']) {
      const parsed = parseClockTime(time)
      if (parsed === null) throw new Error(`unparseable fixture: ${time}`)
      // The export zero-pads the hour and this does not; compare on value.
      expect(formatMinuteOfDay(parsed)).toBe(time.replace(/^0/, ''))
    }
  })

  it('prints noon and midnight the way a person says them', () => {
    expect(formatMinuteOfDay(minuteOfDay(0))).toBe('12:00 AM')
    expect(formatMinuteOfDay(minuteOfDay(720))).toBe('12:00 PM')
  })

  it('prints the end-of-day sentinel as midnight, which is what it means', () => {
    // 1440 exists so a class ending at 12:00 AM runs to the end of its day
    // instead of backwards to the start of it. It is still midnight to read.
    // Reached through END_OF_DAY because minuteOfDay refuses to mint it — the
    // constant is the only source, so a 1440 can only have been meant as an end.
    expect(formatMinuteOfDay(END_OF_DAY)).toBe('12:00 AM')
  })
})

describe('formatScheduledMeeting', () => {
  it('reads like a line from the schedule', () => {
    expect(formatScheduledMeeting(scheduled('MWF', '09:00 AM', '09:50 AM'))).toBe(
      'MWF 9:00 AM\u20139:50 AM',
    )
  })

  it('separates the times with an en dash, not a hyphen', () => {
    expect(formatTimeRange(minuteOfDay(540), minuteOfDay(590))).toContain('\u2013')
  })
})

describe('describeUnscheduled', () => {
  it('gives each reason its own wording', () => {
    // Collapsing these to 'TBA' would tell a student that an arranged section
    // and a broken feed value are the same thing. Only one is actionable.
    expect(describeUnscheduled(meeting('', 'APPT', ''))).toBe('By appointment')
    expect(describeUnscheduled(meeting('MWF', '12:00 AM', '12:00 AM'))).toBe(
      'No meeting time published',
    )
    expect(describeUnscheduled(meeting('', '', ''))).toBe('TBA')
    expect(describeUnscheduled(meeting('MWF', '10:00 AM', '09:00 AM'))).toBe(
      'Meeting time unavailable',
    )
  })

  it('falls through to the normal rendering for a scheduled meeting', () => {
    expect(describeUnscheduled(meeting('TuTh', '02:00 PM', '03:15 PM'))).toBe(
      'TuTh 2:00 PM\u20133:15 PM',
    )
  })
})

describe('formatCredits', () => {
  it('prints a fixed value plainly', () => {
    expect(formatCredits(parseCredits('3.0', '3.0'))).toBe('3 credits')
  })

  it('prints a range as a range, because half the catalogue is one', () => {
    expect(formatCredits(parseCredits('1.0', '6.0'))).toBe('1\u20136 credits')
  })

  it('says credit only when there is exactly one', () => {
    expect(formatCredits(parseCredits('1.0', '1.0'))).toBe('1 credit')
    expect(formatCredits(parseCredits('1.0', '3.0'))).toBe('1\u20133 credits')
  })

  it('keeps the fractional hours 22 rows really use', () => {
    expect(formatCredits(parseCredits('0.25', '0.25'))).toBe('0.25 credits')
  })

  it('prints a zero-credit section rather than hiding it', () => {
    expect(formatCredits(parseCredits('0.0', '0.0'))).toBe('0 credits')
  })
})
