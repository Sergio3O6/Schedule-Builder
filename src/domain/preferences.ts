/**
 * Ranking, because 200 valid schedules is not an answer.
 *
 * The solver's output is a set, and a set has no best element until someone
 * says what better means. That is a product decision rather than a technical
 * one, so this module is built to make it a decision about DATA: every
 * judgement lives in the `Preferences` object below, and changing what the app
 * considers a good schedule is changing those numbers, not this code.
 *
 * ## The weights are a starting point, not a finding
 *
 * The defaults encode four preferences students actually voice — no early
 * starts, no dead time between classes, fewer days on campus, and specific days
 * kept free. What they cannot encode is how those trade off against each other
 * for a given person, and no amount of care here discovers that. They are
 * calibrated only to be mutually sensible, on one scale:
 *
 *   one hour of gap                  = 30
 *   one extra day on campus          = 60  (two hours of dead time)
 *   one hour earlier than you wanted = 60  (per day it happens)
 *   a day you asked to keep free     = 300 (dominates; you asked for it)
 *
 * Nothing validates those ratios. They are defensible, they are round, and they
 * are the thing to change first when the ranking feels wrong.
 *
 * ## Penalty, not score
 *
 * Lower is better and zero is perfect, which makes every component a cost that
 * can be shown to a student as a reason. A single opaque number would rank
 * correctly and explain nothing, and "why is this one first" is the question a
 * ranked list invites. So the components are kept alongside the total rather
 * than summed away.
 */

import { WEEK_DAY_BITS } from './time.ts'
import type { Schedule } from './solve.ts'
import type { DayMask, MinuteOfDay } from './time.ts'

/** What one day of the week looks like once everything is placed on it. */
export interface DayShape {
  readonly bit: DayMask
  readonly firstStart: MinuteOfDay
  readonly lastEnd: MinuteOfDay
  /** Minutes actually in class. */
  readonly classMinutes: number
  /** Minutes between the first start and last end that are not class. */
  readonly gapMinutes: number
}

/** The geometry of a schedule, independent of anybody's opinion about it. */
export interface ScheduleShape {
  /** Only days that have something on them, in teaching-week order. */
  readonly days: readonly DayShape[]
  readonly gapMinutes: number
  /**
   * Units with no published meeting time. They shape nothing and are counted
   * only so a caller can say so rather than appear to have lost them.
   */
  readonly unscheduledUnits: number
}

export interface Weights {
  /** Per minute a day starts before `noEarlierThan`. */
  readonly early: number
  /** Per minute a day ends after `noLaterThan`. */
  readonly late: number
  /** Per minute of dead time between classes. */
  readonly gap: number
  /** Per day with any class on it. */
  readonly day: number
  /** Per day named in `daysOff` that ends up with a class. */
  readonly dayOff: number
}

export interface Preferences {
  /** Nothing should start before this. Null switches the rule off. */
  readonly noEarlierThan: MinuteOfDay | null
  /** Nothing should end after this. Null switches the rule off. */
  readonly noLaterThan: MinuteOfDay | null
  /** Days the student wants kept free, as a mask. */
  readonly daysOff: DayMask
  readonly weights: Weights
}

/** 9am, the hour students most often draw the line at. */
const NINE_AM = 540 as MinuteOfDay
/** 5pm. */
const FIVE_PM = 1020 as MinuteOfDay

export const DEFAULT_WEIGHTS: Weights = {
  early: 1,
  late: 0.5,
  gap: 0.5,
  day: 60,
  dayOff: 300,
}

/**
 * The ranking the app applies until a student says otherwise.
 *
 * No day off is requested by default, because guessing which day someone wants
 * free is worse than not ranking on it at all — a wrong guess at weight 300
 * would reorder the entire list around a preference nobody expressed.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  noEarlierThan: NINE_AM,
  noLaterThan: FIVE_PM,
  daysOff: 0 as DayMask,
  weights: DEFAULT_WEIGHTS,
}

/**
 * Where a schedule sits on the week.
 *
 * Meetings are merged before gaps are measured. Two units genuinely can share a
 * minute — a cross-listed pair slips past the time check, and the export itself
 * publishes exact duplicate rows — and subtracting overlapping class time from
 * a day's span would report negative dead time.
 */
export function shapeOf(schedule: Schedule): ScheduleShape {
  const days: DayShape[] = []

  for (const bit of WEEK_DAY_BITS) {
    const intervals: { start: number; end: number }[] = []
    for (const unit of schedule.units) {
      for (const meeting of unit.scheduled) {
        if ((meeting.days & bit) !== 0) intervals.push({ start: meeting.start, end: meeting.end })
      }
    }
    if (intervals.length === 0) continue

    intervals.sort((a, b) => a.start - b.start || a.end - b.end)

    let classMinutes = 0
    let cursor = Number.NEGATIVE_INFINITY
    for (const interval of intervals) {
      const from = Math.max(interval.start, cursor)
      if (interval.end > from) classMinutes += interval.end - from
      cursor = Math.max(cursor, interval.end)
    }

    const firstStart = intervals[0]?.start ?? 0
    const lastEnd = intervals.reduce((latest, i) => Math.max(latest, i.end), 0)

    days.push({
      bit,
      firstStart: firstStart as MinuteOfDay,
      lastEnd: lastEnd as MinuteOfDay,
      classMinutes,
      gapMinutes: lastEnd - firstStart - classMinutes,
    })
  }

  return {
    days,
    gapMinutes: days.reduce((total, day) => total + day.gapMinutes, 0),
    unscheduledUnits: schedule.units.filter((unit) => unit.scheduled.length === 0).length,
  }
}

/** A penalty broken into the reasons for it. Lower is better; zero is perfect. */
export interface Penalty {
  readonly total: number
  readonly early: number
  readonly late: number
  readonly gaps: number
  readonly days: number
  readonly daysOff: number
}

export function penaltyOf(shape: ScheduleShape, preferences: Preferences): Penalty {
  const { weights } = preferences
  let earlyMinutes = 0
  let lateMinutes = 0
  let daysOffLost = 0

  for (const day of shape.days) {
    if (preferences.noEarlierThan !== null && day.firstStart < preferences.noEarlierThan) {
      earlyMinutes += preferences.noEarlierThan - day.firstStart
    }
    if (preferences.noLaterThan !== null && day.lastEnd > preferences.noLaterThan) {
      lateMinutes += day.lastEnd - preferences.noLaterThan
    }
    if ((preferences.daysOff & day.bit) !== 0) daysOffLost++
  }

  const early = earlyMinutes * weights.early
  const late = lateMinutes * weights.late
  const gaps = shape.gapMinutes * weights.gap
  const days = shape.days.length * weights.day
  const daysOff = daysOffLost * weights.dayOff

  return { total: early + late + gaps + days + daysOff, early, late, gaps, days, daysOff }
}

export interface RankedSchedule {
  readonly schedule: Schedule
  readonly shape: ScheduleShape
  readonly penalty: Penalty
}

/**
 * Best first.
 *
 * Ties are broken by the original order rather than left to the sort, so that
 * two schedules a student cannot tell apart do not swap places between renders.
 */
export function rankSchedules(
  schedules: readonly Schedule[],
  preferences: Preferences = DEFAULT_PREFERENCES,
): readonly RankedSchedule[] {
  return schedules
    .map((schedule, index) => {
      const shape = shapeOf(schedule)
      return { schedule, shape, penalty: penaltyOf(shape, preferences), index }
    })
    .sort((a, b) => a.penalty.total - b.penalty.total || a.index - b.index)
    .map(({ schedule, shape, penalty }) => ({ schedule, shape, penalty }))
}
