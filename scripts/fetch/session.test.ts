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
