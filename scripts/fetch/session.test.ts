import { describe, expect, it } from 'vitest'
import { CrawlAbortedError, FetchSession, HttpError } from './session.ts'
import type { FetchLike, ResponseLike } from './session.ts'
import { USER_AGENT } from './request.ts'

/**
 * Virtual clock. Sleeping advances time instantly, so a 1.5s policy is asserted
 * in microseconds and the suite never actually waits.
 */
function makeClock() {
  let t = 1_000
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

function reply(status: number, body = 'x', headers: Record<string, string> = {}): ResponseLike {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  }
}

/**
 * A 200 whose body takes `ms` of clock time to arrive.
 *
 * The distinction this exists to expose: `fetch` resolves when the HEADERS
 * land, and `arrayBuffer()` runs afterwards. KU's whole-term export is 1.9MB,
 * so that gap is the normal case, not an edge one.
 */
function slowBody(clock: { advance: (ms: number) => void }, ms: number): ResponseLike {
  return {
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => {
      clock.advance(ms)
      return new TextEncoder().encode('x').buffer as ArrayBuffer
    },
  }
}

/** Records every call and replies from a scripted queue. */
function makeFetch(replies: ResponseLike[]) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers })
    const r = replies[i++]
    if (!r) throw new Error(`fake fetch ran out of replies at call ${i}`)
    return r
  }
  return { fetch, calls }
}

describe('spacing', () => {
  it('does not delay the very first request', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(200)])
    const started = clock.now()
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    await s.get('https://example.test/a')

    expect(clock.now()).toBe(started)
  })

  it('leaves at least the quiet period between requests', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(200), reply(200)])
    const s = new FetchSession({
      minSpacingMs: 1500,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await s.get('https://example.test/a')
    const afterFirst = clock.now()
    await s.get('https://example.test/b')

    expect(clock.now() - afterFirst).toBeGreaterThanOrEqual(1500)
  })

  it('does not sleep when the caller was already slow enough', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(200), reply(200)])
    const s = new FetchSession({
      minSpacingMs: 1500,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await s.get('https://example.test/a')
    clock.advance(5000) // caller did other work
    const before = clock.now()
    await s.get('https://example.test/b')

    expect(clock.now()).toBe(before)
  })

  it('measures the quiet period from the end of the body, not the headers', async () => {
    // The defect: the timestamp was taken in a finally around fetch(), which
    // resolves at the headers. A 4s body then counted as elapsed quiet time, so
    // the observed gap was 0ms — and the 1.9MB export is exactly this case.
    const clock = makeClock()
    const dispatchedAt: number[] = []
    let i = 0
    const replies = [slowBody(clock, 4000), reply(200)]
    const fetch: FetchLike = async () => {
      dispatchedAt.push(clock.now())
      const r = replies[i++]
      if (!r) throw new Error('out of replies')
      return r
    }
    const s = new FetchSession({ minSpacingMs: 1500, fetch, sleep: clock.sleep, now: clock.now })

    await s.get('https://example.test/a')
    const bodyFinishedAt = clock.now()
    await s.get('https://example.test/b')

    expect(bodyFinishedAt - (dispatchedAt[0] ?? 0)).toBe(4000)
    expect((dispatchedAt[1] ?? 0) - bodyFinishedAt).toBeGreaterThanOrEqual(1500)
  })

  it('serializes concurrent callers instead of bursting', async () => {
    // The failure this guards against is Promise.all over 292 subjects.
    const clock = makeClock()
    const { fetch, calls } = makeFetch([reply(200), reply(200), reply(200)])
    const s = new FetchSession({
      minSpacingMs: 1500,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })
    const start = clock.now()

    await Promise.all([
      s.get('https://example.test/a'),
      s.get('https://example.test/b'),
      s.get('https://example.test/c'),
    ])

    expect(calls).toHaveLength(3)
    expect(clock.now() - start).toBeGreaterThanOrEqual(3000) // two gaps, not zero
  })
})

describe('identification', () => {
  it('sends the contact User-Agent on every request', async () => {
    const clock = makeClock()
    const { fetch, calls } = makeFetch([reply(200), reply(200)])
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    await s.get('https://example.test/a')
    await s.get('https://example.test/b')

    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c.headers['User-Agent']).toBe(USER_AGENT)
  })
})

describe('success', () => {
  it('returns the body as bytes', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(200, 'hello')])
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    expect(new TextDecoder().decode(await s.get('https://example.test/a'))).toBe('hello')
  })
})

describe('being told no', () => {
  for (const status of [403, 429]) {
    it(`aborts the whole crawl immediately on ${status}`, async () => {
      const clock = makeClock()
      const { fetch, calls } = makeFetch([reply(status), reply(200)])
      const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

      await expect(s.get('https://example.test/a')).rejects.toThrow(CrawlAbortedError)
      // and stays aborted: no second request is attempted
      await expect(s.get('https://example.test/b')).rejects.toThrow(CrawlAbortedError)
      expect(calls).toHaveLength(1)
    })
  }

  it('surfaces Retry-After for the human without retrying', async () => {
    const clock = makeClock()
    const { fetch, calls } = makeFetch([reply(429, 'x', { 'retry-after': '120' })])
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    await expect(s.get('https://example.test/a')).rejects.toThrow(/Retry-After: 120/)
    expect(calls).toHaveLength(1)
  })

  it('reports blocked as the reason', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(403)])
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    await s.get('https://example.test/a').then(
      () => expect.unreachable('should have thrown'),
      (e: unknown) => {
        expect(e).toBeInstanceOf(CrawlAbortedError)
        expect((e as CrawlAbortedError).reason).toBe('blocked')
      },
    )
  })
})

describe('consecutive failures', () => {
  it('reports a single failure as recoverable', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(500)])
    const s = new FetchSession({ fetch, sleep: clock.sleep, now: clock.now })

    await expect(s.get('https://example.test/a')).rejects.toThrow(HttpError)
  })

  it('abandons the crawl after three in a row', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(500), reply(502), reply(503)])
    const s = new FetchSession({
      maxConsecutiveFailures: 3,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/a')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/b')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/c')).rejects.toThrow(CrawlAbortedError)
  })

  it('resets the streak on any success', async () => {
    const clock = makeClock()
    const { fetch } = makeFetch([reply(500), reply(500), reply(200), reply(500), reply(500)])
    const s = new FetchSession({
      maxConsecutiveFailures: 3,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/1')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/2')).rejects.toThrow(HttpError)
    await s.get('https://example.test/3')
    expect(s.consecutiveFailures).toBe(0)

    // Two more failures must not abort: the streak restarted.
    await expect(s.get('https://example.test/4')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/5')).rejects.toThrow(HttpError)
  })
})

describe('network errors', () => {
  /** A session whose every request dies at the transport layer. */
  const alwaysReset = (clock: ReturnType<typeof makeClock>, max = 3) => {
    let calls = 0
    const fetch: FetchLike = async () => {
      calls += 1
      throw new Error('ECONNRESET')
    }
    return {
      session: new FetchSession({
        maxConsecutiveFailures: max,
        minSpacingMs: 1500,
        fetch,
        sleep: clock.sleep,
        now: clock.now,
      }),
      callCount: () => calls,
    }
  }

  it('counts a connection that never opened toward the abort threshold', async () => {
    // The defect: the counter only advanced in the non-200 branch, so a fetch
    // that threw bypassed it. Fifty consecutive network errors gave fifty
    // attempts and a consecutiveFailures of zero. Against the 292-subject
    // fallback, a host resetting every connection would never stop the crawl.
    const clock = makeClock()
    const { session, callCount } = alwaysReset(clock)

    await expect(session.get('https://example.test/a')).rejects.toThrow('ECONNRESET')
    expect(session.consecutiveFailures).toBe(1)
    await expect(session.get('https://example.test/b')).rejects.toThrow('ECONNRESET')
    expect(session.consecutiveFailures).toBe(2)
    await expect(session.get('https://example.test/c')).rejects.toThrow(CrawlAbortedError)

    // And it stays stopped rather than trying a fourth time.
    await expect(session.get('https://example.test/d')).rejects.toThrow(CrawlAbortedError)
    expect(callCount()).toBe(3)
  })

  it('names the transport error in the abort message', async () => {
    const clock = makeClock()
    const { session } = alwaysReset(clock, 2)

    await expect(session.get('https://example.test/a')).rejects.toThrow('ECONNRESET')
    await expect(session.get('https://example.test/b')).rejects.toThrow(
      /2 consecutive failures, last was ECONNRESET for https:\/\/example\.test\/b/,
    )
  })

  it('counts transport errors and bad statuses toward the same streak', async () => {
    // They mean the same thing to the host, so a mixture must still stop.
    const clock = makeClock()
    let calls = 0
    const fetch: FetchLike = async () => {
      calls += 1
      if (calls === 2) return reply(500)
      throw new Error('ECONNRESET')
    }
    const s = new FetchSession({
      maxConsecutiveFailures: 3,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/a')).rejects.toThrow('ECONNRESET')
    await expect(s.get('https://example.test/b')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/c')).rejects.toThrow(CrawlAbortedError)
  })

  it('treats a 200 whose body dies mid-stream as a failure, not a success', async () => {
    // Reading the body is where a large export actually fails. Counting the
    // headers as success would reset the very streak meant to notice trouble.
    const clock = makeClock()
    const dying: ResponseLike = {
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => {
        throw new Error('socket hang up')
      },
    }
    const { fetch } = makeFetch([reply(500), dying, dying])
    const s = new FetchSession({
      maxConsecutiveFailures: 3,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/a')).rejects.toThrow(HttpError)
    await expect(s.get('https://example.test/b')).rejects.toThrow('socket hang up')
    expect(s.consecutiveFailures).toBe(2)
    await expect(s.get('https://example.test/c')).rejects.toThrow(CrawlAbortedError)
  })

  it('lets a success clear a streak of transport errors', async () => {
    const clock = makeClock()
    let calls = 0
    const fetch: FetchLike = async () => {
      calls += 1
      if (calls <= 2) throw new Error('ECONNRESET')
      return reply(200)
    }
    const s = new FetchSession({
      maxConsecutiveFailures: 3,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/a')).rejects.toThrow('ECONNRESET')
    await expect(s.get('https://example.test/b')).rejects.toThrow('ECONNRESET')
    await s.get('https://example.test/c')

    expect(s.consecutiveFailures).toBe(0)
  })

  it('still consumes a slot, so a fast failure cannot become a burst', async () => {
    const clock = makeClock()
    let calls = 0
    const fetch: FetchLike = async () => {
      calls += 1
      throw new Error('ECONNRESET')
    }
    const s = new FetchSession({
      minSpacingMs: 1500,
      fetch,
      sleep: clock.sleep,
      now: clock.now,
    })

    await expect(s.get('https://example.test/a')).rejects.toThrow('ECONNRESET')
    const afterFirst = clock.now()
    await expect(s.get('https://example.test/b')).rejects.toThrow('ECONNRESET')

    expect(calls).toBe(2)
    expect(clock.now() - afterFirst).toBeGreaterThanOrEqual(1500)
  })
})
