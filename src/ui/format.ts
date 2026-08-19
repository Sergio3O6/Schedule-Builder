/**
 * Turning the model back into text.
 *
 * Kept out of src/domain on purpose. Every choice here is a product decision —
 * a 12-hour clock, an en dash between times, "TBA" for a section with no
 * published time — and the domain has no business holding opinions about any of
 * them. The domain's job is that the values are correct; this module's job is
 * that a student can read them.
 *
 * These are inverses of the parsers in domain/time.ts, and where the source has
 * a convention they follow it rather than inventing a nicer one: days come out
 * in KU's own order and spelling, so 'MWF' round-trips to 'MWF' and a reader
 * comparing the app against the official schedule sees the same string.
 */

import type { DayMask, MinuteOfDay } from '../domain/time.ts'
import type { Credits } from '../domain/section.ts'
import type { Meeting, ScheduledMeeting } from '../domain/meeting.ts'

/** One column of the week, in the order a student reads one. */
export interface WeekDay {
  /** KU's own token, as the export writes it and as formatDayMask prints it. */
  readonly token: string
  /** The bit this day occupies in a DayMask. */
  readonly bit: number
  /** A calendar column heading. Wider than the token, which is too terse alone. */
  readonly heading: string
}

/**
 * KU's order, not the bitmask's.
 *
 * The mask starts at Sunday because that is where a 7-bit week naturally
 * starts, but the export writes 'MTuWThF' and a student reads a week as
 * starting on Monday. Printing bit order would produce 'SuMTuWThFSa' — correct
 * and unrecognisable.
 *
 * Exported because the calendar lays its columns out in exactly this order, and
 * two tables of the same seven days is one more than can be kept in step.
 */
export const DAY_ORDER: readonly WeekDay[] = [
  { token: 'M', bit: 1 << 1, heading: 'Mon' },
  { token: 'Tu', bit: 1 << 2, heading: 'Tue' },
  { token: 'W', bit: 1 << 3, heading: 'Wed' },
  { token: 'Th', bit: 1 << 4, heading: 'Thu' },
  { token: 'F', bit: 1 << 5, heading: 'Fri' },
  { token: 'Sa', bit: 1 << 6, heading: 'Sat' },
  { token: 'Su', bit: 1 << 0, heading: 'Sun' },
]

/** 'MWF'. Empty for a mask with no days, which the caller must not print bare. */
export function formatDayMask(days: DayMask): string {
  return DAY_ORDER.filter(({ bit }) => (days & bit) !== 0)
    .map(({ token }) => token)
    .join('')
}

/**
 * '9:00 AM'. 1440 prints as midnight, which is what it means.
 *
 * END_OF_DAY exists because a class ending at 12:00 AM runs to the end of its
 * day rather than backwards to the start of it. It is 1440 internally so the
 * arithmetic works; it is still midnight to a student.
 */
export function formatMinuteOfDay(minute: MinuteOfDay): string {
  const wrapped = minute % 1440
  const hour24 = Math.floor(wrapped / 60)
  const suffix = hour24 < 12 ? 'AM' : 'PM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${String(wrapped % 60).padStart(2, '0')} ${suffix}`
}

export function formatTimeRange(start: MinuteOfDay, end: MinuteOfDay): string {
  return `${formatMinuteOfDay(start)}\u2013${formatMinuteOfDay(end)}`
}

/** 'MWF 9:00 AM–9:50 AM'. */
export function formatScheduledMeeting(meeting: ScheduledMeeting): string {
  const days = formatDayMask(meeting.days)
  return `${days} ${formatTimeRange(meeting.start, meeting.end)}`.trim()
}

/**
 * Why a section has no place on the calendar, in words a student recognises.
 *
 * Every reason gets its own wording. Collapsing them all to 'TBA' would tell a
 * student that an arranged-with-the-instructor section and a section with a
 * broken time in the feed are the same thing, and only one of those is
 * something they can act on.
 */
export function describeUnscheduled(meeting: Meeting): string {
  if (meeting.kind === 'scheduled') return formatScheduledMeeting(meeting)
  switch (meeting.reason) {
    case 'appointment':
      return 'By appointment'
    case 'no-published-time':
      return 'No meeting time published'
    case 'malformed-time':
      return 'Meeting time unavailable'
    case 'tba':
      return 'TBA'
  }
}

/** '3 credits', '1–6 credits', '1 credit'. */
export function formatCredits(credits: Credits): string {
  const hours =
    credits.max > credits.min ? `${credits.min}\u2013${credits.max}` : String(credits.min)
  // 'credit' only when it is exactly one, so a 1–6 range stays plural.
  return `${hours} ${credits.max === 1 && credits.min === 1 ? 'credit' : 'credits'}`
}
