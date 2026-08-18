/**
 * Rows in, sections out.
 *
 * A section is one `Class nbr`, and a Class nbr is not one row. 588 of them
 * span two to ten rows: most carry a second meeting pattern — a lecture that
 * meets MWF and also Th — and 129 groups are exact duplicates. So assembly is a
 * grouping, not a mapping, and the two failure modes are opposite. Deduping by
 * row destroys 459 real patterns; taking one row per class number destroys the
 * same 459. Both leave a student's calendar missing a class they have to attend.
 *
 * The identity fields are taken from the first row of a group and every later
 * row is required to agree. That agreement is measured — all 24 non-meeting
 * columns match across every multi-row class number, zero exceptions — but it
 * is upstream's invariant, not ours, and the whole grouping rests on it. If it
 * ever stops holding, silently keeping the first row's title and credits is
 * exactly the wrong answer.
 */

import { classifyMeeting, partitionMeetings } from '../../src/domain/meeting.ts'
import {
  parseCareer,
  parseComponent,
  parseConsent,
  parseCredits,
  parseEnrollable,
  parseEnrollment,
  parseTitle,
  parseTopic,
} from '../../src/domain/section.ts'
import { classNbr, combSectId, courseKey, sectionNumber } from '../../src/domain/ids.ts'
import { dateSpan, parseClockTime, parseDayMask } from '../../src/domain/time.ts'
import { cell, columnOf, FIELDS } from './columns.ts'
import type { Field } from './columns.ts'
import type { Meeting } from '../../src/domain/meeting.ts'
import type { Section } from '../../src/domain/section.ts'
import type { SheetRow } from '../xlsx/workbook.ts'
import type { TermCalendar } from '../../src/domain/time.ts'

/**
 * The columns that describe WHEN and WHERE, rather than WHAT.
 *
 * Everything not listed here is identity, and must agree across the rows of a
 * class number. Deriving the identity set by subtraction rather than listing it
 * means a column added to columns.ts is treated as identity by default — the
 * safe direction, since the cost is a loud failure rather than a silent one.
 */
const MEETING_FIELDS: readonly Field[] = [
  'startTime',
  'endTime',
  'meetingDays',
  'beginDate',
  'endDate',
  'location',
  'room',
]

const IDENTITY_FIELDS: readonly Field[] = FIELDS.filter(
  (field) => field !== 'classNbr' && !MEETING_FIELDS.includes(field),
)

/** One row's meeting, before it is grouped with its siblings. */
function meetingOf(row: SheetRow, calendar: TermCalendar): Meeting {
  const rawStart = cell(row, 'startTime')
  return classifyMeeting({
    days: parseDayMask(cell(row, 'meetingDays')),
    start: parseClockTime(rawStart),
    end: parseClockTime(cell(row, 'endTime')),
    rawStart,
    span: dateSpan(calendar, cell(row, 'beginDate'), cell(row, 'endDate')),
    place: {
      campus: cell(row, 'location').trim(),
      // Never populated by the anonymous feed — CAS-gated, not unassigned.
      room: null,
    },
  })
}

/**
 * A meeting's full value, for dropping the exact duplicates.
 *
 * 129 class numbers repeat a row verbatim — BAND 402 publishes the same meeting
 * five times. Rendering those is five identical blocks stacked on one calendar
 * square. Keyed on every field rather than on the pattern alone, so two genuinely
 * different meetings that happen to share a time are both kept.
 */
function meetingKey(meeting: Meeting): string {
  const place = `${meeting.place.campus}|${meeting.place.room ?? ''}`
  const span = `${meeting.span.startDay}-${meeting.span.endDay}`
  return meeting.kind === 'scheduled'
    ? `s|${meeting.days}|${meeting.start}|${meeting.end}|${span}|${place}`
    : `u|${meeting.reason}|${span}|${place}`
}

function assertIdentityAgrees(first: SheetRow, other: SheetRow, id: string): void {
  for (const field of IDENTITY_FIELDS) {
    const a = cell(first, field).trim()
    const b = cell(other, field).trim()
    if (a !== b) {
      throw new Error(
        `class number ${id} disagrees with itself on ${field} (column ` +
          `${columnOf(field)}): ${JSON.stringify(a)} vs ${JSON.stringify(b)} — ` +
          `grouping by class number assumes these rows describe one section`,
      )
    }
  }
}

/** Builds the section, given the rows that share its class number. */
function sectionOf(rows: readonly SheetRow[], calendar: TermCalendar): Section {
  const first = rows[0]
  if (first === undefined) throw new Error('cannot build a section from no rows')

  const meetings: Meeting[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const meeting = meetingOf(row, calendar)
    const key = meetingKey(meeting)
    if (seen.has(key)) continue
    seen.add(key)
    meetings.push(meeting)
  }

  const { scheduled, unscheduled } = partitionMeetings(meetings)

  return {
    classNbr: classNbr(cell(first, 'classNbr')),
    courseKey: courseKey(cell(first, 'subject'), cell(first, 'number')),
    number: sectionNumber(cell(first, 'sectionNumber')),
    title: parseTitle(cell(first, 'title')),
    topic: parseTopic(cell(first, 'topic')),
    component: parseComponent(cell(first, 'component')),
    career: parseCareer(cell(first, 'career')),
    consent: parseConsent(cell(first, 'consent')),
    credits: parseCredits(cell(first, 'minHours'), cell(first, 'maxHours')),
    enrollable: parseEnrollable(cell(first, 'enrollable')),
    combSectId: combSectId(cell(first, 'combSectId')),
    enrollment: parseEnrollment({
      cap: cell(first, 'enrollCap'),
      enrolled: cell(first, 'totalEnrolled'),
      seatsAvailable: cell(first, 'seatsAvailable'),
      waitCap: cell(first, 'waitCap'),
      waitTotal: cell(first, 'waitTotal'),
    }),
    // Always empty: the anonymous feed never publishes it.
    instructors: [],
    scheduled,
    unscheduled,
  }
}

/**
 * Groups data rows by class number and assembles each group into a Section.
 *
 * Insertion-ordered, so the output follows the export's own order and a rebuild
 * of unchanged data produces an identical bundle rather than a reshuffled one.
 * The header row must already be stripped.
 */
export function buildSections(
  rows: readonly SheetRow[],
  calendar: TermCalendar,
): readonly Section[] {
  const groups = new Map<string, SheetRow[]>()

  for (const row of rows) {
    const id = cell(row, 'classNbr').trim()
    if (id === '') throw new Error('a data row carries no class number')

    const group = groups.get(id)
    if (group === undefined) {
      groups.set(id, [row])
      continue
    }
    const first = group[0]
    if (first !== undefined) assertIdentityAgrees(first, row, id)
    group.push(row)
  }

  return [...groups.values()].map((group) => sectionOf(group, calendar))
}
