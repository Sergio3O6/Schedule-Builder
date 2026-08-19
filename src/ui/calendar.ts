/**
 * Laying meetings out on a week grid.
 *
 * Pure arithmetic, deliberately: no JSX, no CSS units, no formatting. The
 * component that draws the grid decides how tall an hour is and what a block
 * says; this module decides only which column a meeting belongs in, where it
 * starts and stops, and how a pile of overlapping meetings shares the width.
 * That split is what makes the hard part — the overlap packing — testable
 * without rendering anything.
 *
 * Two rules here are product decisions rather than geometry, and both exist to
 * stop the grid lying to a student:
 *
 *   1. Saturday and Sunday appear only when something is on them. A KU week is
 *      five columns wide almost always, and two permanently empty columns cost
 *      a quarter of the width to say nothing.
 *   2. Sections with nothing scheduled are RETURNED, not dropped. Over half the
 *      live rows publish no meeting time — 7,746 of 13,410 after the career
 *      filter — so a calendar that silently omits them shows a student an empty
 *      week and lets them conclude they are free. They are not on the grid
 *      because they cannot be; they still have to be on the screen.
 */

import { DAY_ORDER } from './format.ts'
import type { WeekDay } from './format.ts'
import type { ScheduledMeeting } from '../domain/meeting.ts'
import type { Section } from '../domain/section.ts'
import type { MinuteOfDay } from '../domain/time.ts'

/** One section asking to be drawn, with the identity the caller wants back. */
export interface CalendarSource {
  /** Stable across renders — the course key, so colour follows the course. */
  readonly id: string
  /** What the block says, e.g. 'EECS 168'. */
  readonly label: string
  readonly section: Section
}

/** One meeting on one day. A MWF lecture produces three of these. */
export interface CalendarBlock {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly section: Section
  readonly meeting: ScheduledMeeting
  /** Index into the layout's `days`, NOT a bit position or a weekday number. */
  readonly dayIndex: number
  readonly start: MinuteOfDay
  readonly end: MinuteOfDay
  /** Which of `columns` side-by-side slots this block occupies, from 0. */
  readonly column: number
  /** How many slots the overlapping group needs. 1 when nothing clashes. */
  readonly columns: number
}

/** A section with no place on the grid, and therefore something to say instead. */
export interface UnplacedSection {
  readonly id: string
  readonly label: string
  readonly section: Section
}

export interface WeekLayout {
  /** Only the columns actually being drawn, in reading order. */
  readonly days: readonly WeekDay[]
  /** Grid bounds in minutes, snapped outward to whole hours. */
  readonly startMinute: number
  readonly endMinute: number
  readonly blocks: readonly CalendarBlock[]
  readonly unplaced: readonly UnplacedSection[]
}

/** Shown even when empty: a week with no Wednesday column reads as broken. */
const ALWAYS_SHOWN = new Set(['M', 'Tu', 'W', 'Th', 'F'])

/** The grid an empty schedule draws: a plausible teaching day, 8am to 6pm. */
const DEFAULT_START = 8 * 60
const DEFAULT_END = 18 * 60

const MINUTES_PER_HOUR = 60

interface Placement {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly section: Section
  readonly meeting: ScheduledMeeting
  readonly dayIndex: number
  readonly start: MinuteOfDay
  readonly end: MinuteOfDay
}

/**
 * Packs one day's meetings into side-by-side columns.
 *
 * Overlapping blocks are widened into a GROUP rather than each pair being
 * handled alone, because width has to be agreed by everything that touches:
 * three classes overlapping in a chain need three slots even though no two of
 * them are simultaneous, and giving each pair its own answer produces blocks of
 * different widths that do not line up.
 *
 * A group ends the moment a block starts at or after everything before it has
 * finished. Half-open, matching timeOverlaps — a 9:50 finish and a 9:50 start
 * do not clash, so they share a column rather than splitting the width.
 */
function packDay(placements: readonly Placement[]): CalendarBlock[] {
  const sorted = [...placements].sort((a, b) => a.start - b.start || a.end - b.end)
  const blocks: CalendarBlock[] = []

  let group: { readonly placement: Placement; readonly column: number }[] = []
  let columnEnds: number[] = []
  let groupEnd = Number.NEGATIVE_INFINITY

  const flush = (): void => {
    const columns = columnEnds.length
    for (const { placement, column } of group) {
      blocks.push({ ...placement, column, columns })
    }
    group = []
    columnEnds = []
  }

  for (const placement of sorted) {
    if (placement.start >= groupEnd) {
      flush()
      groupEnd = Number.NEGATIVE_INFINITY
    }

    // The leftmost column whose last block has already finished. Reusing it
    // keeps a day of back-to-back classes one column wide.
    let column = columnEnds.findIndex((end) => end <= placement.start)
    if (column < 0) {
      column = columnEnds.length
      columnEnds.push(placement.end)
    } else {
      columnEnds[column] = placement.end
    }

    group.push({ placement, column })
    groupEnd = Math.max(groupEnd, placement.end)
  }

  flush()
  return blocks
}

export function weekLayout(sources: readonly CalendarSource[]): WeekLayout {
  const unplaced: UnplacedSection[] = []
  const scheduled: { source: CalendarSource; meeting: ScheduledMeeting; index: number }[] = []

  for (const source of sources) {
    if (source.section.scheduled.length === 0) {
      unplaced.push({ id: source.id, label: source.label, section: source.section })
      continue
    }
    source.section.scheduled.forEach((meeting, index) => {
      scheduled.push({ source, meeting, index })
    })
  }

  const usedDays = scheduled.reduce((mask, { meeting }) => mask | meeting.days, 0)
  const days = DAY_ORDER.filter((day) => ALWAYS_SHOWN.has(day.token) || (usedDays & day.bit) !== 0)

  const byDay: Placement[][] = days.map(() => [])
  for (const { source, meeting, index } of scheduled) {
    days.forEach((day, dayIndex) => {
      if ((meeting.days & day.bit) === 0) return
      byDay[dayIndex]?.push({
        key: `${source.id}|${source.section.classNbr}|${index}|${day.token}`,
        id: source.id,
        label: source.label,
        section: source.section,
        meeting,
        dayIndex,
        start: meeting.start,
        end: meeting.end,
      })
    })
  }

  const blocks = byDay.flatMap(packDay)

  // Every day something falls on is a visible column, so no block is ever
  // dropped and these bounds cover the whole week that is drawn.
  const starts = blocks.map((block) => block.start)
  const ends = blocks.map((block) => block.end)
  const startMinute =
    starts.length === 0 ? DEFAULT_START : Math.floor(Math.min(...starts) / MINUTES_PER_HOUR) * MINUTES_PER_HOUR
  const endMinute =
    ends.length === 0 ? DEFAULT_END : Math.ceil(Math.max(...ends) / MINUTES_PER_HOUR) * MINUTES_PER_HOUR

  return { days, startMinute, endMinute, blocks, unplaced }
}

/**
 * The hour marks to label down the side, inclusive of both bounds.
 *
 * Branded so they can be printed by the same formatter as a meeting time, and
 * cast rather than minted because `minuteOfDay` refuses 1440 — which a grid
 * running to midnight legitimately reaches. Every value here is a whole hour
 * between the bounds weekLayout already snapped, so the range holds by
 * construction.
 */
export function hourMarks(layout: WeekLayout): readonly MinuteOfDay[] {
  const marks: MinuteOfDay[] = []
  for (let minute = layout.startMinute; minute <= layout.endMinute; minute += MINUTES_PER_HOUR) {
    marks.push(minute as MinuteOfDay)
  }
  return marks
}
