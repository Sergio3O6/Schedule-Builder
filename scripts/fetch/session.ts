/**
 * A deliberately slow, deliberately serial HTTP session for crawling KU.
 *
 * Politeness is enforced structurally rather than by convention: there is no way
 * to use this class to issue two requests at once, and no way to issue them
 * faster than the configured spacing. Callers cannot opt out, because the crawl
 * runs under a real person's contact address and a burst is their problem.
 *
 * The clock and fetch are injected so the whole policy — spacing, abort rules,
 * failure counting — is testable in milliseconds against zero network traffic.
 */

import { USER_AGENT } from './request.ts'

/** Minimal slice of `Response` we depend on. The global `Response` satisfies it. */
export interface ResponseLike {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<ResponseLike>

export interface SessionOptions {
  /**
   * Minimum quiet period between the END of one request and the START of the
   * next. Measured from completion rather than from dispatch so a slow response
   * lengthens the gap instead of being absorbed by it — the server is already
   * struggling, and that is the wrong moment to keep to schedule.
   */
  readonly minSpacingMs?: number
  /** Consecutive non-200s tolerated before the crawl is abandoned entirely. */
  readonly maxConsecutiveFailures?: number
  readonly fetch?: FetchLike
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/** A single request failed. The caller may reasonably skip it and continue. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
  }
}

/** The crawl must stop now. Never retry past this — it is not a transient error. */
export class CrawlAbortedError extends Error {
  constructor(
    readonly reason: 'blocked' | 'consecutive-failures',
    message: string,
  ) {
    super(message)
    this.name = 'CrawlAbortedError'
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class FetchSession {
  readonly #minSpacingMs: number
  readonly #maxConsecutiveFailures: number
  readonly #fetch: FetchLike
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number

  /** Timestamp the previous request finished. null until the first one does. */
  #lastFinishedAt: number | null = null
  #consecutiveFailures = 0
  #aborted: CrawlAbortedError | null = null

  /**
   * Tail of the request chain. Every get() appends to it, which makes overlap
   * impossible even if a caller forgets to await — the alternative is trusting
   * call sites not to Promise.all() a list of subjects, and that trust is
   * exactly what produces an accidental 292-way burst.
   */
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: SessionOptions = {}) {
    this.#minSpacingMs = options.minSpacingMs ?? 1500
    this.#maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.#sleep = options.sleep ?? defaultSleep
    this.#now = options.now ?? Date.now
  }

  /** Requests made so far that returned 200. Used by the caller for reporting. */
  get consecutiveFailures(): number {
    return this.#consecutiveFailures
  }

  /**
   * Fetch one URL as bytes. Throws HttpError for a single failure, or
   * CrawlAbortedError when the crawl must not continue.
   */
  async get(url: string): Promise<Uint8Array> {
    const run = this.#queue.then(
      () => this.#getUnqueued(url),
      () => this.#getUnqueued(url),
    )
    // Keep the chain alive regardless of this call's outcome, so one failure
    // does not wedge every subsequent request behind a rejected promise.
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #getUnqueued(url: string): Promise<Uint8Array> {
    // Once aborted, stay aborted. A queued caller must not slip a request in
    // after the stop decision was already made.
    if (this.#aborted) throw this.#aborted

    await this.#waitForSlot()

    let response: ResponseLike
    try {
      response = await this.#fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    } finally {
      // Network errors still consume a slot. A connection that fails fast must
      // not become a way to hammer the host.
      this.#lastFinishedAt = this.#now()
    }

    if (response.status === 403 || response.status === 429) {
      // Being told "no" is not a transient failure, and retrying is how a polite
      // crawler becomes an abusive one. Surface Retry-After for the human, then
      // stop — resuming is a decision a person makes, not the program.
      const retryAfter = response.headers.get('retry-after')
      throw (this.#aborted = new CrawlAbortedError(
        'blocked',
        `KU returned ${response.status} for ${url}. Stopping.` +
          (retryAfter === null ? '' : ` Retry-After: ${retryAfter}.`),
      ))
    }

    if (response.status !== 200) {
      this.#consecutiveFailures += 1
      if (this.#consecutiveFailures >= this.#maxConsecutiveFailures) {
        throw (this.#aborted = new CrawlAbortedError(
          'consecutive-failures',
          `${this.#consecutiveFailures} consecutive failures, last was ` +
            `HTTP ${response.status} for ${url}. Stopping.`,
        ))
      }
      throw new HttpError(response.status, url)
    }

    this.#consecutiveFailures = 0
    return new Uint8Array(await response.arrayBuffer())
  }

  /** Sleep off whatever remains of the quiet period. No wait before the first. */
  async #waitForSlot(): Promise<void> {
    if (this.#lastFinishedAt === null) return
    const elapsed = this.#now() - this.#lastFinishedAt
    const remaining = this.#minSpacingMs - elapsed
    if (remaining > 0) await this.#sleep(remaining)
  }
}
