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
 *   1. Missing subjects do not form a clean alphabetical tail.
 *   2. The total is not suspiciously round.
 *   3. A known-populated subject clears a floor, as a sanity anchor.
 *
 * Note what (1) is NOT: "every subject appears". A subject legitimately has no
 * rows when it offers no classes that term — verified against Fall 2026, where
 * 17 of the 292 codes are empty and requesting one individually returns KU's
 * "No classes were found" page. Treating absence as truncation rejects a
 * perfectly good export.
 *
 * The export is sorted by subject and grouped into contiguous blocks (verified:
 * 275 blocks for 275 subjects, in alphabetical order). So a cap that truncates
 * the tail must drop a *suffix* — every missing subject would sort after every
 * present one. Scattered gaps are empty subjects; a clean tail is a cap.
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

/**
 * Minimum share of expected subjects that must actually appear.
 *
 * Empty subjects are the exception, not the rule: Fall 2026 returned 275 of 292,
 * or 94%. This guards the case the tail test cannot see — an export that is
 * missing most of the catalogue in scattered fashion is broken regardless of how
 * the gaps are distributed. Deliberately generous, because the tail test is the
 * precise instrument and this is only a floor against catastrophe.
 */
const MIN_PRESENT_RATIO = 0.5

export interface CoverageReport {
  readonly totalRows: number
  readonly rowsBySubject: ReadonlyMap<string, number>
  /**
   * Expected but absent. Informational, NOT a failure on its own: a subject with
   * no classes this term is legitimately absent from the export.
   */
  readonly missingSubjects: readonly string[]
  /** Present but unexpected — catalogue drift that slipped past the form check. */
  readonly unexpectedSubjects: readonly string[]
  readonly lastPresentSubject: string | null
  readonly firstMissingSubject: string | null
  /**
   * True when every missing subject sorts after every present one — the shape a
   * tail-truncating result cap produces, and the shape scattered empty subjects
   * cannot produce.
   */
  readonly looksTruncated: boolean
  /** Share of expected subjects that appear at all. Verified 0.94 for Fall 2026. */
  readonly presentSubjectRatio: number
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
  // Sorted so the tail comparison below is well defined regardless of caller order.
  const sortedExpected = [...expectedSubjects].sort()
  const missingSubjects = sortedExpected.filter((s) => !rowsBySubject.has(s))
  const presentExpected = sortedExpected.filter((s) => rowsBySubject.has(s))

  const lastPresentSubject = presentExpected.at(-1) ?? null
  const firstMissingSubject = missingSubjects[0] ?? null

  // Truncation drops a suffix. If anything is missing but nothing came back at
  // all, that is the degenerate case of the same thing.
  const looksTruncated =
    missingSubjects.length > 0 &&
    (lastPresentSubject === null ||
      (firstMissingSubject !== null && firstMissingSubject > lastPresentSubject))

  return {
    totalRows: dataRows.length,
    rowsBySubject,
    missingSubjects,
    unexpectedSubjects: [...rowsBySubject.keys()].filter((s) => !expectedSet.has(s)).sort(),
    lastPresentSubject,
    firstMissingSubject,
    looksTruncated,
    presentSubjectRatio:
      sortedExpected.length === 0 ? 1 : presentExpected.length / sortedExpected.length,
    suspiciouslyRoundTotal: SUSPICIOUS_TOTALS.includes(dataRows.length),
    floorSubject: FLOOR_SUBJECT,
    floorSubjectRows: rowsBySubject.get(FLOOR_SUBJECT) ?? 0,
  }
}

/** True when the export looks complete enough to trust as a whole-term crawl. */
export function isComplete(report: CoverageReport): boolean {
  return (
    !report.looksTruncated &&
    report.presentSubjectRatio >= MIN_PRESENT_RATIO &&
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
    const verdict = report.looksTruncated
      ? 'FAIL: they form an unbroken alphabetical tail, which is what a result cap looks like'
      : 'ok: scattered through the alphabet, consistent with subjects offering no classes this term'
    lines.push(`${report.missingSubjects.length} subjects absent (${shown}${more}) — ${verdict}.`)
  }
  if (report.looksTruncated && report.missingSubjects.length === 0) {
    lines.push('FAIL: nothing came back at all.')
  }
  if (report.presentSubjectRatio < MIN_PRESENT_RATIO) {
    const percent = (report.presentSubjectRatio * 100).toFixed(1)
    lines.push(
      `FAIL: only ${percent}% of expected subjects appear. Empty subjects are the ` +
        'exception, so most of the catalogue missing means a broken export, not a quiet term.',
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
