/**
 * Creates a throttled task scheduler that runs tasks strictly one at a
 * time, waiting at least `minIntervalMs` between the *start* of one task
 * and the start of the next.
 *
 * This is a simple client-side rate limiter — it does not persist state
 * across page loads/tabs, so it only protects against a single browser
 * tab hammering an API faster than its usage policy allows. It is not a
 * substitute for server-side rate limiting.
 */
export function createThrottle(minIntervalMs: number) {
  let queue: Promise<void> = Promise.resolve()
  let lastStart = 0

  return function schedule<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      // Bail out before waiting (and before consuming a throttle slot) if
      // we're already aborted by the time our turn in the queue comes up.
      if (signal?.aborted) {
        throw toAbortError(signal)
      }

      const wait = Math.max(0, lastStart + minIntervalMs - Date.now())
      if (wait > 0) {
        // Wake up early if aborted mid-wait, rather than sleeping out the
        // full throttle delay only to fail afterwards — an aborted queued
        // request must free its slot immediately so the next request isn't
        // held up behind it.
        await waitOrAbort(wait, signal)
      }

      if (signal?.aborted) {
        throw toAbortError(signal)
      }

      lastStart = Date.now()
      return task()
    }

    // Chain onto the queue so calls run strictly in order, one at a time.
    const result = queue.then(run, run)

    // Keep the queue alive even if a task rejects, so one failure doesn't
    // permanently wedge later scheduled tasks.
    queue = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }
}

/** Resolves after `ms`, or immediately if `signal` aborts first. */
function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Builds an `Error` with `name === 'AbortError'`, matching `fetch`'s own,
 * regardless of what triggered the abort.
 *
 * `signal.reason` is *not* trustworthy as-is: `AbortSignal.timeout()` fires
 * with a `TimeoutError` `DOMException`, and `DOMException instanceof Error`
 * is `true`, so a naive `instanceof Error` check lets it through unchanged.
 * The documented contract (and ADR 0050) is that every cancellation reason
 * — caller abort or timeout — normalizes to `name === 'AbortError'`, so we
 * only pass `signal.reason` through untouched when it already satisfies
 * that; everything else (a `TimeoutError`, a plain string, a caller-supplied
 * `Error` with some other name, etc.) is wrapped into a fresh `AbortError`
 * that preserves the original as `cause`.
 */
function toAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason
  }
  const error = new Error('Aborted', { cause: reason })
  error.name = 'AbortError'
  return error
}
