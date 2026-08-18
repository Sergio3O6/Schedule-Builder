import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { subjectCode } from '../../src/domain/ids.ts'
import { bundleFileName } from './main.ts'

const run = promisify(execFile)

/**
 * Runs the normalizer the way a person runs it: plain `node`, no bundler.
 *
 * Vitest compiles TypeScript properly while Node only strips types, so the two
 * disagree about what is legal — an enum or a constructor parameter property
 * typechecks, lints, passes every unit test, and then dies at runtime with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. The crawler's suite makes that guarantee
 * for its own import graph, which does not reach scripts/normalize. This makes
 * it for the other half: main.ts pulls in columns, calendar, rows and bundle.
 *
 * Every case here is offline. The normalizer reads the cache and never fetches.
 */
const cli = (args: string[]) =>
  run(process.execPath, ['scripts/normalize/main.ts', ...args], { cwd: process.cwd() })

/** execFile rejects on a non-zero exit; this reports the code either way. */
const runForCode = async (args: string[]): Promise<{ code: number; stderr: string }> => {
  try {
    await cli(args)
    return { code: 0, stderr: '' }
  } catch (error) {
    const failure = error as { code?: number; stderr?: string }
    return { code: failure.code ?? -1, stderr: failure.stderr ?? '' }
  }
}

describe('normalizer CLI under plain node', () => {
  it('loads every module it imports without a type-stripping error', async () => {
    // Reaching the usage message proves the whole import graph parsed.
    const { code, stderr } = await runForCode([])
    expect(stderr).toContain('usage: node scripts/normalize/main.ts')
    expect(code).toBe(2)
  })

  it('refuses to run without a term rather than guessing one', async () => {
    const { code } = await runForCode([])
    expect(code).toBe(2)
  })

  it('says what to run when the export is not cached, and fetches nothing', async () => {
    // The normalizer must never reach for KU. A missing export is an
    // instruction to the operator, not a reason to open a connection.
    const { code, stderr } = await runForCode(['--term=4299'])
    expect(stderr).toContain('No cached export for term 4299')
    expect(stderr).toContain('npm run crawl -- --term=4299')
    expect(code).toBe(1)
  })
})

describe('bundleFileName', () => {
  it('percent-encodes the subjects that carry an ampersand', () => {
    // Six subject codes contain '&'. A raw one in a URL path is legal but
    // invites exactly one bug, in whichever layer forgets to encode it, and
    // the failure is a 404 for six subjects nobody notices until a student
    // picks one.
    expect(bundleFileName(subjectCode('C&PE'))).toBe('C%26PE.json')
    expect(bundleFileName(subjectCode('HP&M'))).toBe('HP%26M.json')
  })

  it('leaves the ordinary codes alone', () => {
    expect(bundleFileName(subjectCode('EECS'))).toBe('EECS.json')
    expect(bundleFileName(subjectCode('CT-C'))).toBe('CT-C.json')
  })

  it('round-trips, so the client never has to know the rule', () => {
    for (const code of ['EECS', 'C&PE', 'LA&S', 'PM-C']) {
      const name = bundleFileName(subjectCode(code))
      expect(decodeURIComponent(name.replace(/\.json$/, ''))).toBe(code)
    }
  })

  it('never produces a name that escapes its directory', () => {
    // The subject is validated upstream, but this is the layer that turns it
    // into a path, and encodeURIComponent is what makes that safe.
    for (const code of ['EECS', 'C&PE', 'CT-C']) {
      expect(bundleFileName(subjectCode(code))).not.toContain('/')
      expect(bundleFileName(subjectCode(code))).not.toContain('..')
    }
  })
})
