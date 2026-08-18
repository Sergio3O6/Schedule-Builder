/**
 * CLI entry point for the normalizer.
 *
 *   node scripts/normalize/main.ts --term=4269
 *   node scripts/normalize/main.ts --term=4269 --subject=EECS
 *
 * Reads the cached export the crawler already fetched and writes one JSON
 * bundle per subject. Makes no network requests: if the export is not cached,
 * it says so and stops rather than reaching for KU.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RawCache } from '../fetch/cache.ts'
import { readWorkbook } from '../xlsx/workbook.ts'
import { stripHeaderRow } from '../fetch/verify.ts'
import { assertColumnLayout, cell } from './columns.ts'
import { deriveTermCalendar, describeCalendar, modalDateSpan } from './calendar.ts'
import { buildSections } from './rows.ts'
import { bundleSubject, bytesOf, subjectsIn } from './bundle.ts'
import { buildCatalog, catalogBytes } from './catalog.ts'
import { subjectCode, termCode } from '../../src/domain/ids.ts'
import type { SubjectCode } from '../../src/domain/ids.ts'

/**
 * Paths resolved against the repo, not the shell's working directory.
 *
 * The crawler roots its cache at a relative 'data/raw', so running it from
 * elsewhere silently creates a second cache and re-downloads from KU. Nothing
 * here can afford that either: reading from the wrong place would look like a
 * missing export, and writing to the wrong place would scatter 275 files
 * wherever the terminal happened to be.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RAW_ROOT = join(REPO_ROOT, 'data/raw')
const BUNDLE_ROOT = join(REPO_ROOT, 'public/bundles')

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

/**
 * The filename for a subject.
 *
 * Percent-encoded because six subject codes contain '&' and four contain '-':
 * C&PE, HP&M, LA&S, CT-C, PM-C. A raw '&' in a URL path is legal but invites
 * exactly one bug, in whichever layer forgets to encode it, and the failure is
 * a 404 for six subjects that nobody notices until a student picks one.
 * encodeURIComponent both ways means the client never has to know.
 */
export function bundleFileName(subject: SubjectCode): string {
  return `${encodeURIComponent(subject)}.json`
}

async function main(): Promise<number> {
  const term = argValue('term')
  if (term === undefined) {
    console.error('usage: node scripts/normalize/main.ts --term=4269 [--subject=EECS]')
    return 2
  }

  const cache = new RawCache(RAW_ROOT)
  const key = { term }
  // One read, not has() then read(): the pair is a race, and the answer to
  // "is it there" is the bytes themselves.
  console.log(`Reading ${cache.pathFor(key)} ...`)
  const cached = await cache.read(key)
  if (cached === null) {
    console.error(`No cached export for term ${term} at ${cache.pathFor(key)}`)
    console.error(`Run the crawler first: npm run crawl -- --term=${term}`)
    return 1
  }

  const workbook = readWorkbook(cached)

  const header = workbook[0]
  if (header === undefined) throw new Error('the cached export has no rows')
  assertColumnLayout(header)

  const rows = stripHeaderRow(workbook)
  const dates = rows.map((row) => ({ begin: cell(row, 'beginDate'), end: cell(row, 'endDate') }))
  const calendar = deriveTermCalendar(termCode(term), dates)
  console.log(`  ${describeCalendar(calendar.term, modalDateSpan(dates))}`)

  const sections = buildSections(rows, calendar)
  console.log(`  ${rows.length} rows -> ${sections.length} sections`)

  const only = argValue('subject')
  const subjects = only === undefined ? subjectsIn(sections) : [subjectCode(only)]

  const outDir = join(BUNDLE_ROOT, term)
  await mkdir(outDir, { recursive: true })

  let written = 0
  let bytes = 0
  for (const subject of subjects) {
    const bundle = bundleSubject(sections, subject, calendar)
    if (bundle.sections.length === 0) {
      // Naming it matters: an empty bundle is indistinguishable from a typo in
      // --subject, and writing one would ship a file the app treats as "this
      // subject exists and offers nothing".
      console.error(`  no sections for subject ${subject} — nothing written`)
      continue
    }
    const payload = bytesOf(bundle)
    await writeFile(join(outDir, bundleFileName(subject)), payload)
    written += 1
    bytes += payload.byteLength
  }

  // The index covers the whole term, so it is only written on a full run.
  // A --subject run would otherwise replace it with a one-subject catalogue
  // and silently make every other course unfindable.
  if (only === undefined) {
    const catalog = buildCatalog(sections, calendar)
    const encoded = catalogBytes(catalog)
    await writeFile(join(outDir, 'index.json'), encoded)
    console.log(`  index.json: ${catalog.courses.length} courses`)
    bytes += encoded.byteLength
  } else {
    console.log('  index.json not written: a --subject run does not see the whole term')
  }

  console.log(`\nWrote ${written} bundles to ${outDir} (${(bytes / 1024).toFixed(1)}KB)`)
  return written === 0 ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)
