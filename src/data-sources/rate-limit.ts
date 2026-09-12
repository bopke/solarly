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

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = Math.max(0, lastStart + minIntervalMs - Date.now())
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait))
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
