/**
 * What each column of the export means, and a check that it still does.
 *
 * Reading by position is the only option — the export has no stable ids, just
 * 32 columns in a fixed order. That makes column drift the most dangerous kind
 * of upstream change: if KU inserts a column, every field after it reads its
 * neighbour's value, and nearly all of them would pass their parsers. 'Enroll
 * cap' would be read as 'Total enrl' and still be a plausible headcount;
 * 'Consent' would be read as 'Component' and still be a plausible code. The
 * bundle would rebuild green and be wrong throughout.
 *
 * So the layout is pinned to the header row the export itself carries, and the
 * check runs before a single data row is read. It is a cheap assertion against
 * the failure that would otherwise be invisible.
 */

import type { SheetRow } from '../xlsx/workbook.ts'

/**
 * Field name to [column letter, exact header text].
 *
 * Every column is listed, including the ones nothing reads. Naming only the
 * used ones would leave gaps in the check, and a gap is exactly where an
 * inserted column would slip through unnoticed.
 */
const LAYOUT = {
  subject: ['A', 'Course'],
  /** Space-padded in every row: ' 101'. Not always numeric — 'XXXX', '1W'. */
  number: ['B', 'Number'],
  /** Zero-padded 6-digit catalog id, '000125'. Nothing reads it; parseInt destroys it. */
  courseNbr: ['C', 'Course nbr'],
  title: ['D', 'Course title'],
  topic: ['E', 'Course topic'],
  classNbr: ['F', 'Class nbr'],
  sectionNumber: ['G', 'Sec. nbr'],
  minHours: ['H', 'Min Hrs'],
  maxHours: ['I', 'Max Hrs'],
  seatsAvailable: ['J', 'Seats avl'],
  totalEnrolled: ['K', 'Total enrl'],
  enrollCap: ['L', 'Enroll cap'],
  career: ['M', 'Acad career'],
  component: ['N', 'Component'],
  consent: ['O', 'Consent'],
  enrollable: ['P', 'Enrollable'],
  /** Empty in 100% of rows: CAS-gated, not unassigned. */
  instructor: ['Q', 'Instructor'],
  startTime: ['R', 'Start'],
  endTime: ['S', 'End'],
  meetingDays: ['T', 'Meeting days'],
  beginDate: ['U', 'Begin date'],
  endDate: ['V', 'End date'],
  location: ['W', 'Location'],
  /** Empty in 100% of rows, same cause as instructor. */
  room: ['X', 'Room'],
  roomCap: ['Y', 'Room cap'],
  waitCap: ['Z', 'Wait Cap'],
  waitTotal: ['AA', 'Wait Total'],
  combSectId: ['AB', 'Comb Sect ID'],
  /** The CS columns describe the cross-listing group, not this section. */
  csEnrollCap: ['AC', 'CS Enrl Cap'],
  csEnrollTotal: ['AD', 'CS Enrl Total'],
  csWaitCap: ['AE', 'CS Wait Cap'],
  csWaitTotal: ['AF', 'CS Wait Total'],
} as const satisfies Record<string, readonly [string, string]>

export type Field = keyof typeof LAYOUT

export const FIELDS = Object.keys(LAYOUT) as readonly Field[]

/** The column letter a field lives in, for diagnostics. */
export function columnOf(field: Field): string {
  return LAYOUT[field][0]
}

/**
 * One cell, by meaning rather than by letter.
 *
 * A missing key is an empty cell, not an error: a spreadsheet omits cells it
 * has no value for, and three columns are empty in every row. Whether the
 * column EXISTS is settled once by assertColumnLayout, not 17,338 times here.
 */
export function cell(row: SheetRow, field: Field): string {
  return row.get(LAYOUT[field][0]) ?? ''
}

/**
 * Checks the header row against the layout above, and refuses on any drift.
 *
 * Reports every mismatch rather than the first. One inserted column shifts
 * everything after it, so failing on the first would describe a 20-column
 * problem as a 1-column problem and send the reader looking in the wrong place.
 */
export function assertColumnLayout(header: SheetRow): void {
  const problems: string[] = []

  for (const field of FIELDS) {
    const [column, expected] = LAYOUT[field]
    const actual = (header.get(column) ?? '').trim()
    if (actual !== expected) {
      problems.push(`  ${column}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
    }
  }

  // An added column at the END shifts nothing and breaks nothing, but it is
  // still a change in the export we should see rather than discover later.
  const extra = [...header.keys()].filter(
    (column) => !FIELDS.some((field) => LAYOUT[field][0] === column),
  )
  for (const column of extra) {
    problems.push(`  ${column}: unexpected column ${JSON.stringify(header.get(column) ?? '')}`)
  }

  if (problems.length > 0) {
    throw new Error(
      `the export's column layout has changed — every field is read by position, ` +
        `so this must be reconciled in scripts/normalize/columns.ts before the data ` +
        `can be trusted:\n${problems.join('\n')}`,
    )
  }
}
