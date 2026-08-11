/**
 * Time, days, and dates — reduced to integers the solver can compare cheaply.
 *
 * Conflict detection runs across every pair of candidate sections, so the
 * representation is chosen for that: a 7-bit day mask, minutes since midnight,
 * and integer day offsets from a pinned term epoch. A conflict is then four
 * integer comparisons and no allocation.
 *
 * Day offsets rather than a week bitmask because offsets are exact. A session
 * ending Wednesday and another starting Thursday share a calendar week but must
 * not overlap, and only real dates can tell you that.
 *
 * THE EPOCH MUST BE PINNED OR THIS MODEL FAILS SILENTLY. A DayOffset means
 * nothing without a fixed origin; if the normalizer and the client ever disagree
 * about it, every partial-term comparison is quietly wrong and nothing throws.
 * So the term calendar is written into the bundle at build time, and this module
 * is the only place a calendar date becomes a DayOffset.
 */

import type { TermCode } from './ids.ts'

/**
 * Minutes since midnight, 0..1439 — plus END_OF_DAY, which is only ever an end.
 */
export type MinuteOfDay = number & { readonly __brand: 'MinuteOfDay' }
/** Bit 0 = Sunday .. bit 6 = Saturday. */
export type DayMask = number & { readonly __brand: 'DayMask' }
/** Whole days since the term epoch. May be negative for pre-term sessions. */
export type DayOffset = number & { readonly __brand: 'DayOffset' }
/** A date in exactly `YYYY-MM-DD`, the only shape `Date.parse` reads as UTC. */
export type IsoDate = string & { readonly __brand: 'IsoDate' }

export interface DateSpan {
  readonly startDay: DayOffset
  /** Inclusive. */
  readonly endDay: DayOffset
}

/**
 * The term epoch. Pinned once per term and stored in the bundle index.
 *
 * The dates are branded, so this cannot be written as an object literal — it has
 * to come from `termCalendar()`. That is the whole point. An epoch of
 * '2026-08-24T00:00:00Z', or '2026/08/24', or one with a trailing space, parses
 * to NaN; the NaN flows into every DayOffset, `NaN < NaN` is false so the
 * inverted-span assert below never fires, and `spansOverlap` then answers false
 * for every pair of meetings in the term. Two identical 9am MWF lectures stop
 * conflicting and nothing anywhere throws.
 */
export interface TermCalendar {
  readonly term: TermCode
  /** The term's modal Begin date. */
  readonly startDate: IsoDate
  /** The term's modal End date. */
  readonly endDate: IsoDate
}

const MINUTES_PER_DAY = 1440
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/**
 * Day tokens as the EXPORT writes them — not as the search form accepts them.
 *
 * The two encodings differ and the difference is a live trap: a search request
 * uses single letters `N M T W R F S`, while the export emits `M Tu W Th F Sa
 * Su`. Tokens are variable width, so Tu/Th/Sa/Su must be matched before the
 * single letters or 'Th' reads as 'T' followed by a stray 'h'.
 *
 * Verified complete: this pattern consumes all 17,338 day strings in the Fall
 * 2026 export with no unmatched remainder.
 */
const DAY_TOKEN = /Su|Sa|Tu|Th|[MWF]/g

const DAY_BITS: Record<string, number> = {
  Su: 1 << 0,
  M: 1 << 1,
  Tu: 1 << 2,
  W: 1 << 3,
  Th: 1 << 4,
  F: 1 << 5,
  Sa: 1 << 6,
}

export const NO_DAYS = 0 as DayMask

/**
 * Parses a meeting-days string into a bitmask.
 *
 * Throws on leftover characters rather than ignoring them: a token this does not
 * know is a day a student would be expected to attend and we would not schedule.
 */
export function parseDayMask(raw: string): DayMask {
  const text = raw.trim()
  if (text === '') return NO_DAYS

  let mask = 0
  let matched = 0
  for (const match of text.matchAll(DAY_TOKEN)) {
    mask |= DAY_BITS[match[0]] ?? 0
    matched += match[0].length
  }

  if (matched !== text.length) {
    throw new Error(`unrecognized day token in ${JSON.stringify(raw)}`)
  }
  return mask as DayMask
}

/** Day masks share at least one day. */
export function dayMaskOverlaps(a: DayMask, b: DayMask): boolean {
  return (a & b) !== 0
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i

/**
 * Parses '02:00 PM' into minutes since midnight, or null when the value is not
 * a clock time at all.
 *
 * Note what this does NOT do: it has no opinion about '12:00 AM'. That value is
 * a perfectly valid midnight and also the export's marker for "no meeting time",
 * and 11,279 of 17,338 rows carry it or 'APPT'. Deciding which it means requires
 * looking at the whole row, so that judgement belongs to the meeting layer.
 * Here, midnight parses to 0 like any other time.
 */
export function parseClockTime(raw: string): MinuteOfDay | null {
  const match = CLOCK_PATTERN.exec(raw.trim())
  if (!match) return null

  const rawHour = Number(match[1])
  const minute = Number(match[2])
  const isPm = (match[3] ?? '').toUpperCase() === 'PM'
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null

  const hour = (rawHour % 12) + (isPm ? 12 : 0)
  return (hour * 60 + minute) as MinuteOfDay
}

/** Half-open comparison, so a class ending 09:50 does not clash with one starting 09:50. */
export function timeOverlaps(
  aStart: MinuteOfDay,
  aEnd: MinuteOfDay,
  bStart: MinuteOfDay,
  bEnd: MinuteOfDay,
): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Midnight at the far end of the day: 1440.
 *
 * A class running 09:00 PM to midnight ends here. It cannot be written as 0,
 * which is the *near* midnight and would make the meeting run backwards, and it
 * is deliberately not mintable through `minuteOfDay` — the constant is the only
 * source, so a value of 1440 can only ever have been meant as an end.
 */
export const END_OF_DAY = MINUTES_PER_DAY as MinuteOfDay

/** A point in the day, 0..1439. Ends at midnight use END_OF_DAY instead. */
export function minuteOfDay(value: number): MinuteOfDay {
  if (!Number.isInteger(value) || value < 0 || value >= MINUTES_PER_DAY) {
    throw new Error(`minute of day out of range: ${value}`)
  }
  return value as MinuteOfDay
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MMM_DD_PATTERN = /^([A-Z]{3})-(\d{1,2})$/i

/**
 * The calendar year a term belongs to.
 *
 * PeopleSoft codes are 4YYS: 4269 is YY=26, S=9. Season digits are 2=spring,
 * 6=summer, 9=fall, which we do not need here — only the year.
 */
export function termYear(term: TermCode): number {
  return 2000 + Number(term.slice(1, 3))
}

interface MonthDay {
  readonly month: number
  readonly day: number
}

function parseMonthDay(raw: string): MonthDay {
  const match = MMM_DD_PATTERN.exec(raw.trim())
  if (!match) throw new Error(`unparseable date: ${JSON.stringify(raw)}`)

  const month = MONTHS.indexOf((match[1] ?? '').toUpperCase())
  if (month < 0) throw new Error(`unknown month in ${JSON.stringify(raw)}`)
  return { month, day: Number(match[2]) }
}

const iso = (year: number, month: number, day: number): IsoDate =>
  isoDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)

const utcMs = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`)

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The only way to mint an IsoDate. Checks the shape, then checks that the shape
 * actually parses.
 *
 * Both halves are load-bearing. `Date.parse` reads a bare `YYYY-MM-DD` as UTC
 * midnight but reads '2026/08/24' or a leading space as LOCAL time, which is a
 * silent hour of drift; and it returns NaN for anything with a time component
 * appended, which is worse, because NaN propagates without complaint.
 *
 * What this does NOT yet check is whether the day exists: `2026-09-31` parses
 * cheerfully as October 1st. That is a real defect and it is fixed separately,
 * where the MMM-DD parser that produces such a date is also fixed.
 */
export function isoDate(raw: string): IsoDate {
  if (!ISO_DATE_PATTERN.test(raw)) {
    throw new Error(`not an ISO date (expected YYYY-MM-DD): ${JSON.stringify(raw)}`)
  }
  const date = raw as IsoDate
  if (Number.isNaN(utcMs(date))) {
    throw new Error(`ISO date does not exist: ${JSON.stringify(raw)}`)
  }
  return date
}

/**
 * Mints a validated term epoch.
 *
 * Everything downstream of this — every DayOffset, every partial-term overlap —
 * is measured from `startDate`, and an epoch that fails to parse breaks all of
 * it silently rather than loudly. So the epoch is validated once, here, at the
 * one moment where a person could still be told what is wrong.
 */
export function termCalendar(term: TermCode, startDate: string, endDate: string): TermCalendar {
  const start = isoDate(startDate)
  const end = isoDate(endDate)
  if (utcMs(end) < utcMs(start)) {
    throw new Error(`term ends before it starts: ${start}..${end}`)
  }
  return { term, startDate: start, endDate: end }
}

/**
 * Reconstructs the calendar year for a begin date.
 *
 * The export prints MMM-DD with no year at all, so the year has to be inferred.
 * Anchoring on "nearest to the term start" handles both ordinary sections and
 * the full-year ones: AUG-13 in a Fall 2026 term resolves to 2026, while the
 * same AUG-13 under a Spring 2027 term resolves to 2026 as well, because that is
 * the August adjacent to a January start.
 */
function yearNearestTermStart(md: MonthDay, calendarStart: IsoDate): number {
  const anchor = utcMs(calendarStart)
  const base = Number(calendarStart.slice(0, 4))

  let best = base
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of [base - 1, base, base + 1]) {
    const distance = Math.abs(utcMs(iso(candidate, md.month, md.day)) - anchor)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * Parses a Begin/End pair into ISO dates, reconstructing both years.
 *
 * Parsed as a PAIR rather than independently, because the end year is only
 * determinable relative to the begin: when the end month-day falls before the
 * begin, the span crosses a new year. AUG-13..MAY-26 in Fall 2026 is
 * 2026-08-13..2027-05-26 — reconstructing both as 2026 yields an inverted span
 * whose overlap test silently returns false for every comparison. Six rows in
 * the live export have exactly this shape.
 */
export function parseDateRange(
  calendar: TermCalendar,
  begin: string,
  end: string,
): { readonly startDate: IsoDate; readonly endDate: IsoDate } {
  // 25 live rows carry no dates at all — always both fields, never one, and
  // always sections that are unscheduled anyway (APPT, no meeting days). The
  // section still belongs to the term, so the term's own span is the honest
  // reading. One blank field is different: that is malformed, and guessing which
  // end is missing would invent a date range nobody published.
  const beginBlank = begin.trim() === ''
  const endBlank = end.trim() === ''
  if (beginBlank && endBlank) {
    return { startDate: calendar.startDate, endDate: calendar.endDate }
  }
  if (beginBlank || endBlank) {
    throw new Error(
      `half-open date range: ${JSON.stringify(begin)}..${JSON.stringify(end)}`,
    )
  }

  const from = parseMonthDay(begin)
  const to = parseMonthDay(end)

  const startYear = yearNearestTermStart(from, calendar.startDate)
  const wraps = to.month < from.month || (to.month === from.month && to.day < from.day)

  return {
    startDate: iso(startYear, from.month, from.day),
    endDate: iso(startYear + (wraps ? 1 : 0), to.month, to.day),
  }
}

/**
 * The single place a calendar date becomes a DayOffset. Imported by both the
 * normalizer and the client so the two cannot drift.
 */
export function toDayOffset(calendar: TermCalendar, date: IsoDate): DayOffset {
  const epoch = utcMs(calendar.startDate)
  // Belt and braces over the brand: a cast can still smuggle an unvalidated
  // epoch in here, and this is the one error worth paying a comparison to catch,
  // because its symptom is every conflict check quietly answering "no clash".
  if (Number.isNaN(epoch)) {
    throw new Error(`term epoch is not a parseable date: ${JSON.stringify(calendar.startDate)}`)
  }
  const ms = utcMs(date)
  if (Number.isNaN(ms)) throw new Error(`unparseable ISO date: ${JSON.stringify(date)}`)
  return Math.round((ms - epoch) / MS_PER_DAY) as DayOffset
}

export function dateSpan(calendar: TermCalendar, begin: string, end: string): DateSpan {
  const { startDate, endDate } = parseDateRange(calendar, begin, end)
  const span = {
    startDay: toDayOffset(calendar, startDate),
    endDay: toDayOffset(calendar, endDate),
  }
  if (span.endDay < span.startDay) {
    // Unreachable via parseDateRange, which is precisely why it is asserted: the
    // invariant is what every overlap test downstream silently assumes.
    throw new Error(`inverted date span: ${startDate}..${endDate}`)
  }
  return span
}

/** Inclusive comparison: sharing a single day is an overlap. */
export function spansOverlap(a: DateSpan, b: DateSpan): boolean {
  return a.startDay <= b.endDay && b.startDay <= a.endDay
}
