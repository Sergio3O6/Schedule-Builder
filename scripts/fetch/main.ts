/**
 * CLI entry point for the crawl.
 *
 *   node scripts/fetch/main.ts --term=4269 --dry-run
 *   node scripts/fetch/main.ts --term=4269
 *
 * Defaults to --dry-run being absent but prints the plan before acting either
 * way, so the traffic about to be sent is always visible before it is sent.
 */

import { RawCache } from './cache.ts'
import { crawlWholeTerm, describePlan } from './crawl.ts'
import { FetchSession } from './session.ts'
import { CrawlAbortedError } from './session.ts'

const RAW_ROOT = 'data/raw'

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

async function main(): Promise<number> {
  const term = argValue('term')
  if (term === undefined) {
    console.error('usage: node scripts/fetch/main.ts --term=4269 [--dry-run]')
    return 2
  }

  console.log(describePlan(term))

  if (process.argv.includes('--dry-run')) return 0

  console.log('\n--- running ---\n')

  const outcome = await crawlWholeTerm(new FetchSession(), new RawCache(RAW_ROOT), {
    term,
    log: (m) => console.log(m),
  })

  console.log(`\nRequests made: ${outcome.requestsMade}`)

  if (!outcome.complete) {
    // Deliberately not automatic. Escalating to 292 requests is a decision a
    // person makes, with the coverage report in front of them.
    console.error(
      '\nThe whole-term export did not pass the coverage checks.\n' +
        'Do NOT assume it is usable. The per-subject fallback is the next step,\n' +
        'and it is ~292 requests — run it deliberately, not reflexively.',
    )
    return 1
  }

  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    if (error instanceof CrawlAbortedError) {
      console.error(`\nCrawl stopped (${error.reason}): ${error.message}`)
    } else {
      console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    }
    process.exitCode = 1
  },
)
