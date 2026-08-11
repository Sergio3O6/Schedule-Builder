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
 * 275 blocks for 275 subjects, in alphabetical order). So a cap stops the file
 * partway through the alphabet, and the question is HOW FAR THROUGH THE
 * CATALOGUE the last present subject sits.
 *
 * An earlier version asked instead whether every missing subject sorted after
 * every present one. That predicate is unsound and was measured never to fire:
 * `AECL` is one of the 17 legitimately empty subjects and sorts near the front,
 * so a single scattered gap makes it false no matter how much of the tail is
 * gone. A 9,999-row cap on the real export leaves 156 of 275 subjects, stops at
 * `MATH`, and still printed `PASS`.
 *
 * Any failure means fall back to the per-subject loop. None of these prove
 * completeness outright — nothing can, without a second source — but each one
 * fails loudly on the shape a cap actually produces.
 */

import type { SheetRow } from '../xlsx/workbook.ts'

/** Column A of KU's export. */
const SUBJECT_COLUMN = 'A'

/**
 * Totals round enough to be a configured limit rather than a real count.
 *
 * Checked against the data-row count AND that count plus one, because a cap
 * upstream may or may not count the header row it emits. A limit of 10,000 that
 * includes the header leaves 9,999 data rows here, which is not round at all.
 */
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

/**
 * How far through the sorted catalogue the last present subject must sit.
 *
 * Measured on the real Fall 2026 export: the last present code is `WGSS` at
 * index 290 of 292, or 0.997 — only `WOLO` sorts after it. Truncation moves this
 * number a long way: a 9,999-row cap stops at `MATH` (0.572), 15,000 stops at
 * `SGRY` (0.870), 16,000 at `SW` (0.914).
 *
 * 0.95 leaves 15 trailing codes free to be legitimately empty, against the 17
 * empty codes seen live of which exactly one is at the tail. Being generous here
 * is deliberate — a false "truncated" costs 292 requests to KU.
 *
 * The limit is worth stating plainly: a cap that removes only the last percent
 * or two of the file (17,000 rows leaves 0.983) is invisible to this test, and
 * to every other test in this module. Nothing short of a second source can see
 * it.
 */
const MIN_TAIL_COVERAGE = 0.95

/**
 * The shortest absent tail that can mean anything.
 *
 * A short expected list cannot express a tail at all: one empty subject at the
 * end of a five-code list is 0.8 coverage, which would read as a cap. Requiring
 * two absent codes keeps that case honest without weakening the real catalogue,
 * where the ratio above needs 15 before it fires.
 */
const MIN_TRUNCATED_TAIL = 2

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
   * Share of the sorted expected catalogue up to and including the last present
   * subject. 0.997 live; a result cap drops it sharply. 0 when nothing came back.
   */
  readonly tailCoverage: number
  /** Expected subjects sorting after the last present one. 1 live (`WOLO`). */
  readonly absentTailLength: number
  /**
   * True when the catalogue stops well short of the end of the alphabet — the
   * shape a tail-truncating result cap produces. Scattered empty subjects do not
   * move `tailCoverage`, so they do not trip this.
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

  // How far into the alphabet the file gets before it stops. Nothing present is
  // the degenerate case: coverage 0, the whole catalogue absent from the tail.
  const reached = lastPresentSubject === null ? 0 : sortedExpected.indexOf(lastPresentSubject) + 1
  const absentTailLength = sortedExpected.length - reached
  const tailCoverage = sortedExpected.length === 0 ? 1 : reached / sortedExpected.length

  const looksTruncated = absentTailLength >= MIN_TRUNCATED_TAIL && tailCoverage < MIN_TAIL_COVERAGE

  return {
    totalRows: dataRows.length,
    rowsBySubject,
    missingSubjects,
    unexpectedSubjects: [...rowsBySubject.keys()].filter((s) => !expectedSet.has(s)).sort(),
    lastPresentSubject,
    firstMissingSubject,
    tailCoverage,
    absentTailLength,
    looksTruncated,
    presentSubjectRatio:
      sortedExpected.length === 0 ? 1 : presentExpected.length / sortedExpected.length,
    suspiciouslyRoundTotal:
      SUSPICIOUS_TOTALS.includes(dataRows.length) ||
      SUSPICIOUS_TOTALS.includes(dataRows.length + 1),
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
    lines.push(`${report.missingSubjects.length} subjects absent (${shown}${more}).`)
  }

  if (report.lastPresentSubject === null) {
    lines.push('FAIL: not one expected subject came back.')
  } else if (report.looksTruncated) {
    lines.push(
      `FAIL: the catalogue stops at ${report.lastPresentSubject}, ` +
        `${(report.tailCoverage * 100).toFixed(1)}% of the way through the subject list, with ` +
        `${report.absentTailLength} codes after it — which is what a result cap looks like.`,
    )
  } else if (report.missingSubjects.length > 0) {
    lines.push(
      'ok: the absences are scattered through the alphabet rather than piled at the end, ' +
        'consistent with subjects offering no classes this term.',
    )
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
