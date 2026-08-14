/**
 * Write-through disk cache for raw KU exports.
 *
 * The cache is what makes the crawl a one-time cost: a warm rerun must make zero
 * outbound requests. That guarantee is only as good as the promise that a file
 * on disk is a *complete* file, so every write lands atomically.
 *
 * Layout: <root>/<term>/<subject>.xlsx, e.g. data/raw/4269/EECS.xlsx
 * This directory is gitignored — regenerable, and large.
 */

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface CacheKey {
  readonly term: string
  /** Omit for the single whole-term export. */
  readonly subject?: string
}

/**
 * Subject codes reach us from KU's own form and become filenames, so they are
 * validated rather than sanitized: a code outside this shape means KU changed
 * something, and we want to hear about it instead of silently writing to a
 * mangled path. The real alphabet is A-Z plus & and -, verified across all 292
 * codes (C&PE, HP&M, LA&S, CT-C, PM-C ...).
 */
const SUBJECT_PATTERN = /^[A-Z&-]{1,8}$/

/** Terms are PeopleSoft 4-digit codes. Same reasoning as above. */
const TERM_PATTERN = /^\d{4}$/

/**
 * Filename for the whole-term export. Deliberately lowercase with underscores so
 * it cannot collide with a subject code, which is uppercase by construction.
 */
const WHOLE_TERM_BASENAME = '__whole-term'

/**
 * The one filesystem error that means "not cached".
 *
 * Every other one — EACCES, EISDIR, EPERM, or a validation error from
 * `pathFor` — used to be swallowed by a bare catch and reported as a miss. That
 * is the expensive direction to be wrong in: a miss sends the crawler to KU for
 * a file it may already hold, every run, and a malformed key would do so
 * forever, because the write that finally throws happens after the request.
 */
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

export class RawCache {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  /** Absolute path a key maps to. Throws on a malformed term or subject. */
  pathFor(key: CacheKey): string {
    if (!TERM_PATTERN.test(key.term)) {
      throw new Error(`Refusing to build a path for malformed term: ${JSON.stringify(key.term)}`)
    }
    if (key.subject !== undefined && !SUBJECT_PATTERN.test(key.subject)) {
      throw new Error(
        `Refusing to build a path for malformed subject: ${JSON.stringify(key.subject)}`,
      )
    }
    const base = key.subject ?? WHOLE_TERM_BASENAME
    return join(this.#root, key.term, `${base}.xlsx`)
  }

  /**
   * True when a usable cached file exists. A zero-byte file counts as absent:
   * it can only be the residue of a failed write, and treating it as a hit
   * would resume straight past a hole in the data.
   *
   * Only "the file is not there" is a miss. Anything else — a malformed key, a
   * permission error, a directory sitting where the file belongs — is reported,
   * because a miss is an instruction to go and ask KU for it again.
   */
  async has(key: CacheKey): Promise<boolean> {
    const path = this.pathFor(key)
    let info
    try {
      info = await stat(path)
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
    if (!info.isFile()) throw new Error(`cache path exists but is not a file: ${path}`)
    return info.size > 0
  }

  /** Cached bytes, or null when there is genuinely no entry. */
  async read(key: CacheKey): Promise<Uint8Array | null> {
    const path = this.pathFor(key)
    try {
      const bytes = await readFile(path)
      return bytes.byteLength > 0 ? new Uint8Array(bytes) : null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  /**
   * Write atomically: full content to a temp file beside the target, then rename.
   *
   * A plain writeFile interrupted partway (Ctrl-C during an 8-minute crawl is a
   * realistic event) leaves a short but non-empty .xlsx. On the next run, resume
   * sees a file, skips the subject, and the dataset is silently missing rows with
   * nothing anywhere reporting a problem. Rename is the cheapest way to make a
   * half-written file unobservable.
   */
  async write(key: CacheKey, bytes: Uint8Array): Promise<void> {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })

    const temp = `${target}.${process.pid}.tmp`
    try {
      await writeFile(temp, bytes)
      await rename(temp, target)
    } catch (error) {
      // Never leave the temp file behind to be mistaken for anything later.
      await unlink(temp).catch(() => undefined)
      throw error
    }
  }
}
