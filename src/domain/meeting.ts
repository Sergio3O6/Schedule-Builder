/**
 * When and where a section meets — or an explicit statement that it does not.
 *
 * This module exists to make one specific bug impossible. 7,745 of the 13,410
 * Lawrence rows publish no real meeting time, and 2,309 of those spell it
 * '12:00 AM'. Midnight is a perfectly valid time, so a parser that simply reads
 * the clock produces thousands of sections that all claim to meet at minute 0 —
 * mutually conflicting, every day, all term. Students would be told "no schedule
 * works" constantly, and the cause would be almost invisible.
 *
 * The defence is structural rather than careful. A meeting is a discriminated
 * union, so the parser MUST classify every row, and conflict detection accepts
 * only ScheduledMeeting. An unscheduled section is therefore not something a
 * developer has to remember to filter out — it cannot reach the conflict checker
 * at all, because it does not typecheck there.
 */

import { dayMaskOverlaps, END_OF_DAY, spansOverlap, timeOverlaps } from './time.ts'
import type { DateSpan, DayMask, MinuteOfDay } from './time.ts'

export interface Place {
  /** e.g. "LAWRENCE", "EDWARDS", "ONLINC". 41 distinct values live. */
  readonly campus: string
  /**
   * Always null from the anonymous feed: the Room column is empty in every one
   * of the 17,338 rows, and in a completed past term too. It is CAS-gated, not
   * unassigned. Kept nullable so an authenticated ingest could populate it
   * without a schema migration.
   */
  readonly room: string | null
}

export interface ScheduledMeeting {
  readonly kind: 'scheduled'
  /** Invariant: non-zero. A meeting on no days is not scheduled. */
  readonly days: DayMask
  readonly start: MinuteOfDay
  /**
   * Invariant: strictly greater than start. A class ending at midnight carries
   * END_OF_DAY (1440), not 0 — 0 would run the meeting backwards.
   */
  readonly end: MinuteOfDay
  readonly span: DateSpan
  readonly place: Place
}

/**
 * Why a section has no place in the timetable.
 *
 * Note what is absent: an 'online-async' reason. The plan proposed one, but it
 * is not derivable from this feed — online-campus sections use all three
 * encodings (596 real times, 763 APPT, 77 midnight), so the time value says
 * nothing about delivery mode. Inventing the distinction would mean labelling
 * rows with a confidence the data does not support.
 */
export type UnscheduledReason =
  /** 'APPT' — arranged between student and instructor. */
  | 'appointment'
  /** '12:00 AM'–'12:00 AM' — a zero-duration placeholder, not midnight. */
  | 'no-published-time'
  /** Blank, unparseable, or a time with no days to put it on. */
  | 'tba'
  /**
   * An end at or before the start, where the end is not midnight.
   *
   * Two things produce this and they cannot be told apart from the row: a data
   * error, or a meeting that wraps past midnight (10:00 PM–01:00 AM), which this
   * model does not represent — a wrapped meeting occupies two different days and
   * a single day mask cannot say so.
   *
   * Either way it must be its own reason. Filing it under 'no-published-time'
   * would state that KU published no time, which is false, and would hide the
   * one shape that means "look at this row".
   */
  | 'malformed-time'

export interface UnscheduledMeeting {
  readonly kind: 'unscheduled'
  readonly reason: UnscheduledReason
  /** Still dated: an unscheduled section belongs to a part of the term. */
  readonly span: DateSpan
  readonly place: Place
}

export type Meeting = ScheduledMeeting | UnscheduledMeeting

/** The raw shape of one export row, after the cheap per-field parses. */
export interface MeetingInput {
  readonly days: DayMask
  /** null when the Start column was not a clock time, e.g. 'APPT' or blank. */
  readonly start: MinuteOfDay | null
  readonly end: MinuteOfDay | null
  /** The Start column verbatim, needed to tell 'APPT' from a blank. */
  readonly rawStart: string
  readonly span: DateSpan
  readonly place: Place
}

/**
 * Sorts one row into scheduled or unscheduled.
 *
 * Classification keys on the TIME, never on whether days are present. One live
 * row (MATH 101, online) publishes 'MWF' alongside 12:00 AM–12:00 AM, so days
 * are not evidence of a real meeting; and 13 APPT rows carry days too. Reading
 * days first would put all of them on the calendar at midnight.
 */
export function classifyMeeting(input: MeetingInput): Meeting {
  const { days, start, end, rawStart, span, place } = input

  if (start === null || end === null) {
    return {
      kind: 'unscheduled',
      reason: rawStart.trim().toUpperCase() === 'APPT' ? 'appointment' : 'tba',
      span,
      place,
    }
  }

  // The sentinel, and only the sentinel: BOTH ends at minute 0. Treating this as
  // a real event at midnight is precisely the failure this module exists to
  // prevent — 4,115 rows carry it, and they would all conflict with each other.
  if (start === 0 && end === 0) {
    return { kind: 'unscheduled', reason: 'no-published-time', span, place }
  }

  // A real start with an end of 12:00 AM is a class that runs until midnight,
  // not a placeholder. 09:00 PM–12:00 AM is three hours of evening lecture; read
  // as 1260..0 it is negative, and the previous version filed it as "no
  // published time" — which made a real class structurally unable to reach the
  // conflict checker, so a student would be told the evening was free. No live
  // row has this shape today (the latest end in Fall 2026 is 10:00 PM), so this
  // is a trap set for the term that does, not a bug being observed.
  const finish = end === 0 ? END_OF_DAY : end

  if (finish <= start) {
    return { kind: 'unscheduled', reason: 'malformed-time', span, place }
  }

  // A time with nowhere to put it cannot be placed on a calendar.
  if (days === 0) {
    return { kind: 'unscheduled', reason: 'tba', span, place }
  }

  return { kind: 'scheduled', days, start, end: finish, span, place }
}

/** Splits mixed meetings into the two arrays a Section carries. */
export function partitionMeetings(meetings: readonly Meeting[]): {
  readonly scheduled: readonly ScheduledMeeting[]
  readonly unscheduled: readonly UnscheduledMeeting[]
} {
  const scheduled: ScheduledMeeting[] = []
  const unscheduled: UnscheduledMeeting[] = []
  for (const meeting of meetings) {
    if (meeting.kind === 'scheduled') scheduled.push(meeting)
    else unscheduled.push(meeting)
  }
  return { scheduled, unscheduled }
}

/**
 * Do two scheduled meetings collide?
 *
 * The signature is the point: this cannot be called with an unscheduled meeting,
 * so "did we remember to skip the TBA sections?" is not a question anyone has to
 * ask. Three cheap tests, ordered so the most selective runs first.
 */
export function meetingsConflict(a: ScheduledMeeting, b: ScheduledMeeting): boolean {
  return (
    dayMaskOverlaps(a.days, b.days) &&
    timeOverlaps(a.start, a.end, b.start, b.end) &&
    spansOverlap(a.span, b.span)
  )
}

/**
 * Does any meeting of one section collide with any of another?
 *
 * Takes only the scheduled arrays, so a section with nothing scheduled is
 * naturally, correctly free of conflicts — no special case required.
 */
export function anyMeetingConflicts(
  a: readonly ScheduledMeeting[],
  b: readonly ScheduledMeeting[],
): boolean {
  for (const left of a) {
    for (const right of b) {
      if (meetingsConflict(left, right)) return true
    }
  }
  return false
}
