/**
 * The whole-term crawl.
 *
 * Two requests: the search form, then the export. That is the entire network
 * cost of a successful run, and it is less than a browser spends loading the
 * classes homepage once.
 *
 * Order is deliberate. The catalogue drift check runs BEFORE the export is
 * requested, so a stale subject list costs one cheap HTML fetch rather than a
 * multi-megabyte spreadsheet KU had to generate. Failing cheap is the polite
 * default when the failure is our fault.
 *
 * This module decides nothing about falling back to the per-subject loop. It
 * reports whether the export looks complete and stops; escalating to 292
 * requests is a decision a person makes.
 */

import { fetchExport } from './fetcher.ts'
import { buildExportUrl } from './request.ts'
import type { RawCache } from './cache.ts'
import type { FetchSession } from './session.ts'
import {
  describeDrift,
  diffSubjects,
  hasDrift,
  parseSubjectCodes,
  SEARCH_FORM_URL,
  SUBJECT_CODES,
} from './subjects.ts'
import { assessCoverage, describeCoverage, isComplete, stripHeaderRow } from './verify.ts'
import { readWorkbook } from '../xlsx/workbook.ts'
import type { CoverageReport } from './verify.ts'

export interface CrawlOptions {
  readonly term: string
  /** Print the plan and make no requests at all. */
  readonly dryRun?: boolean
  /** Where progress is reported. Injected so tests stay quiet. */
  readonly log?: (message: string) => void
}

export interface CrawlOutcome {
  readonly requestsMade: number
  readonly fromCache: boolean
  readonly report: CoverageReport
  readonly complete: boolean
}

/** What a run would do, for --dry-run. */
export function describePlan(term: string): string {
  return [
    'Dry run — no requests will be made.',
    '',
    'This run would issue exactly 2 requests:',
    `  1. GET ${SEARCH_FORM_URL}`,
    '       (subject catalogue, to verify the committed list is still current)',
    `  2. GET ${buildExportUrl({ term })}`,
    `       (whole-term export for ${term})`,
    '',
    `Expected: ${SUBJECT_CODES.length} subjects in the result.`,
    'Cached results are reused, so a rerun issues zero requests.',
  ].join('\n')
}

export async function crawlWholeTerm(
  session: FetchSession,
  cache: RawCache,
  options: CrawlOptions,
): Promise<CrawlOutcome> {
  const log = options.log ?? (() => undefined)
  let requestsMade = 0

  // 1. Catalogue drift. Cheap, and it gates the expensive request below.
  log(`Checking subject catalogue against ${SEARCH_FORM_URL} ...`)
  const formHtml = new TextDecoder().decode(await session.get(SEARCH_FORM_URL))
  requestsMade += 1

  const liveSubjects = parseSubjectCodes(formHtml)
  const drift = diffSubjects(SUBJECT_CODES, liveSubjects)
  if (hasDrift(drift)) {
    // Refuse rather than crawl a catalogue we do not understand. Under-crawling
    // silently is the failure that yields a dataset which looks complete.
    throw new Error(describeDrift(drift))
  }
  log(`  ${liveSubjects.length} subjects, unchanged.`)

  // 2. The export itself.
  log(`Requesting whole-term export for ${options.term} ...`)
  const { bytes, fromCache } = await fetchExport(session, cache, { term: options.term })
  if (!fromCache) requestsMade += 1
  log(`  ${fromCache ? 'served from cache' : `${bytes.byteLength} bytes`}`)

  // 3. Is it complete, or did KU quietly cap it?
  const report = assessCoverage(stripHeaderRow(readWorkbook(bytes)), SUBJECT_CODES)
  log(describeCoverage(report))

  return { requestsMade, fromCache, report, complete: isComplete(report) }
}
