import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Runs the CLI the way a person actually runs it: plain `node`, no bundler.
 *
 * This exists because Vitest compiles TypeScript properly while Node only strips
 * types, so the two disagree about what is legal. Constructor parameter
 * properties typecheck, lint, and pass every unit test, then fail at runtime with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Nothing but executing the real entry point
 * catches that, so this suite is the guard for the whole scripts/ tree.
 *
 * --dry-run makes no network requests, so this is safe to run in CI.
 */
const cli = (args: string[]) =>
  run(process.execPath, ['scripts/fetch/main.ts', ...args], { cwd: process.cwd() })

describe('CLI under plain node', () => {
  it('loads every module in the crawl without a type-stripping error', async () => {
    const { stdout } = await cli(['--term=4269', '--dry-run'])
    expect(stdout).toContain('Dry run')
  })

  it('makes no requests and reports the exact plan', async () => {
    const { stdout } = await cli(['--term=4269', '--dry-run'])

    expect(stdout).toContain('no requests will be made')
    expect(stdout).toContain('exactly 2 requests')
    expect(stdout).toContain('classes.ku.edu/Classes/Display.action')
    expect(stdout).toContain('searchTerm=4269')
    expect(stdout).toContain('292 subjects')
  })

  it('shows the inverted flags pinned safe in the planned URL', async () => {
    const { stdout } = await cli(['--term=4269', '--dry-run'])

    expect(stdout).toContain('searchClosed=false')
    expect(stdout).toContain('searchShortClasses=false')
    expect(stdout).toContain('searchHonorsClasses=false')
    expect(stdout).toContain('oneRowLimit=false')
  })

  it('refuses to run without a term rather than guessing one', async () => {
    await expect(cli([])).rejects.toMatchObject({ code: 2 })
  })
}, 30_000)
