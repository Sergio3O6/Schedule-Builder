/**
 * Proving a whole-term export is complete.
 *
 * The single-request whole-term crawl is worth 292x less traffic, but only if we
 * can tell a complete file from a truncated one. Silent server-side result caps
 * are common and they truncate the TAIL — so the obvious check, spot-checking a
 * few subjects, passes perfectly while everything past the cap is simply gone.
 *
 * The checks here are therefore about coverage, not counts:
 *
 *   1. Every expected subject code appears.
 *   2. The alphabetically last subject is non-empty (the tail is where a cap shows).
 *   3. The total is not suspiciously round.
 *   4. A known-populated subject clears a floor, as a sanity anchor.
 *
 * Any failure means fall back to the per-subject loop. None of these prove
 * completeness outright — nothing can, without a second source — but each one
 * fails loudly on the shape a cap actually produces.
 */

import type { SheetRow } from '../xlsx/workbook.ts'

/** Column A of KU's export. */
const SUBJECT_COLUMN = 'A'

/** Totals round enough to be a configured limit rather than a real count. */
const SUSPICIOUS_TOTALS: readonly number[] = [1000, 5000, 10000, 20000, 50000]

/** A subject we know is populated, used as a floor. Verified: EECS is 423 rows. */
const FLOOR_SUBJECT = 'EECS'
const FLOOR_ROWS = 400

export interface CoverageReport {
  readonly totalRows: number
  readonly rowsBySubject: ReadonlyMap<string, number>
  /** Expected but absent. Any entry here means the export is incomplete. */
  readonly missingSubjects: readonly string[]
  /** Present but unexpected — catalogue drift that slipped past the form check. */
  readonly unexpectedSubjects: readonly string[]
  readonly lastExpectedSubject: string | null
  readonly lastExpectedSubjectRows: number
  readonly suspiciouslyRoundTotal: boolean
  readonly floorSubject: string
  readonly floorSubjectRows: number
}

/**
 * Drops KU's header row, refusing to continue if it is not there.
 *
 * Worth a hard failure: if the header ever moves, every column letter this
 * project relies on is suspect, and silently treating a header as data would
 * add a phantom subject called "Course".
 */
export function stripHeaderRow(rows: readonly SheetRow[]): SheetRow[] {
  const header = rows[0]
  if (header === undefined) throw new Error('export is empty: no header row')
  if (header.get(SUBJECT_COLUMN) !== 'Course') {
    throw new Error(
      `unexpected header in column ${SUBJECT_COLUMN}: ` +
        `${JSON.stringify(header.get(SUBJECT_COLUMN))} (expected "Course")`,
    )
  }
  return rows.slice(1)
}

export function assessCoverage(
  dataRows: readonly SheetRow[],
  expectedSubjects: readonly string[],
): CoverageReport {
  const rowsBySubject = new Map<string, number>()
  for (const row of dataRows) {
    const subject = row.get(SUBJECT_COLUMN)
    if (subject === undefined || subject === '') continue
    rowsBySubject.set(subject, (rowsBySubject.get(subject) ?? 0) + 1)
  }

  const expectedSet = new Set(expectedSubjects)
  // Sorted so "last" is well defined regardless of how the caller ordered them.
  const sortedExpected = [...expectedSubjects].sort()
  const lastExpectedSubject = sortedExpected.at(-1) ?? null

  return {
    totalRows: dataRows.length,
    rowsBySubject,
    missingSubjects: sortedExpected.filter((s) => !rowsBySubject.has(s)),
    unexpectedSubjects: [...rowsBySubject.keys()].filter((s) => !expectedSet.has(s)).sort(),
    lastExpectedSubject,
    lastExpectedSubjectRows:
      lastExpectedSubject === null ? 0 : (rowsBySubject.get(lastExpectedSubject) ?? 0),
    suspiciouslyRoundTotal: SUSPICIOUS_TOTALS.includes(dataRows.length),
    floorSubject: FLOOR_SUBJECT,
    floorSubjectRows: rowsBySubject.get(FLOOR_SUBJECT) ?? 0,
  }
}

/** True when the export looks complete enough to trust as a whole-term crawl. */
export function isComplete(report: CoverageReport): boolean {
  return (
    report.missingSubjects.length === 0 &&
    report.lastExpectedSubjectRows > 0 &&
    !report.suspiciouslyRoundTotal &&
    report.floorSubjectRows >= FLOOR_ROWS
  )
}

/** Why the export was rejected, or why it was accepted. */
export function describeCoverage(report: CoverageReport): string {
  const lines: string[] = [
    `${report.totalRows} rows across ${report.rowsBySubject.size} subjects.`,
  ]

  if (report.missingSubjects.length > 0) {
    const shown = report.missingSubjects.slice(0, 10).join(', ')
    const more =
      report.missingSubjects.length > 10 ? ` (+${report.missingSubjects.length - 10} more)` : ''
    lines.push(`FAIL: ${report.missingSubjects.length} expected subjects absent: ${shown}${more}`)
  }
  if (report.lastExpectedSubject !== null && report.lastExpectedSubjectRows === 0) {
    lines.push(
      `FAIL: last subject ${report.lastExpectedSubject} has no rows — ` +
        'the tail is exactly where a result cap shows.',
    )
  }
  if (report.suspiciouslyRoundTotal) {
    lines.push(`FAIL: total of ${report.totalRows} is round enough to be a configured cap.`)
  }
  if (report.floorSubjectRows < FLOOR_ROWS) {
    lines.push(
      `FAIL: ${report.floorSubject} returned ${report.floorSubjectRows} rows, ` +
        `below the ${FLOOR_ROWS} floor.`,
    )
  }
  if (report.unexpectedSubjects.length > 0) {
    // Not fatal on its own: extra data is not missing data, and the form-level
    // drift check is the mechanism that is supposed to catch this.
    lines.push(`WARN: unexpected subjects present: ${report.unexpectedSubjects.join(', ')}`)
  }

  if (isComplete(report)) lines.push('PASS: whole-term export looks complete.')
  return lines.join('\n')
}
