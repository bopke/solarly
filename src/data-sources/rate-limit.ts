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

/** Builds an `Error` with `name === 'AbortError'`, matching `fetch`'s own. */
function toAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
