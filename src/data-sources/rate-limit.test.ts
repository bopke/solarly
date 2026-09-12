import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from './rate-limit'

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the first task immediately', async () => {
    const schedule = createThrottle(1000)
    const task = vi.fn().mockResolvedValue('ok')

    const promise = schedule(task)
    await vi.advanceTimersByTimeAsync(0)

    expect(task).toHaveBeenCalledTimes(1)
    await expect(promise).resolves.toBe('ok')
  })

  it('delays a second task until minIntervalMs after the first started', async () => {
    const schedule = createThrottle(1000)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')

    const firstPromise = schedule(first)
    const secondPromise = schedule(second)

    await vi.advanceTimersByTimeAsync(0)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(second).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(second).toHaveBeenCalledTimes(1)

    await expect(firstPromise).resolves.toBe('first')
    await expect(secondPromise).resolves.toBe('second')
  })

  it('runs tasks strictly in the order they were scheduled', async () => {
    const schedule = createThrottle(1000)
    const order: number[] = []
    const makeTask = (id: number) => async () => {
      order.push(id)
      return id
    }

    schedule(makeTask(1))
    schedule(makeTask(2))
    schedule(makeTask(3))

    await vi.runAllTimersAsync()

    expect(order).toEqual([1, 2, 3])
  })

  it("does not let one task's rejection block later scheduled tasks", async () => {
    const schedule = createThrottle(1000)
    const failing = vi.fn().mockRejectedValue(new Error('boom'))
    const succeeding = vi.fn().mockResolvedValue('ok')

    const failingPromise = schedule(failing)
    const succeedingPromise = schedule(succeeding)
    const failingAssertion = expect(failingPromise).rejects.toThrow('boom')

    await vi.runAllTimersAsync()

    await failingAssertion
    await expect(succeedingPromise).resolves.toBe('ok')
  })

  it('normalizes a caller-supplied abort reason to AbortError even when it is an Error with a different name', async () => {
    const schedule = createThrottle(1000)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    const controller = new AbortController()

    const firstPromise = schedule(first)
    const secondPromise = schedule(second, controller.signal)
    const secondAssertion = expect(secondPromise).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('user typed again'))
    await vi.advanceTimersByTimeAsync(0)

    await secondAssertion
    await firstPromise
  })

  it('rejects a queued task immediately (without waiting minIntervalMs) when its signal aborts', async () => {
    const schedule = createThrottle(1000)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    const controller = new AbortController()

    const firstPromise = schedule(first)
    const secondPromise = schedule(second, controller.signal)
    const secondAssertion = expect(secondPromise).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(first).toHaveBeenCalledTimes(1)

    controller.abort()
    // No further time advance: the abort itself should free the slot,
    // not the full minIntervalMs wait.
    await vi.advanceTimersByTimeAsync(0)

    await secondAssertion
    expect(second).not.toHaveBeenCalled()

    await firstPromise
  })

  it('rejects immediately, without consuming a slot, when already aborted before its turn', async () => {
    const schedule = createThrottle(1000)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    const controller = new AbortController()
    controller.abort()

    const firstPromise = schedule(first)
    const secondPromise = schedule(second, controller.signal)
    const secondAssertion = expect(secondPromise).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.runAllTimersAsync()

    await secondAssertion
    expect(second).not.toHaveBeenCalled()
    await firstPromise
  })

  it('normalizes a timeout signal that fires while a task is still queued to AbortError (not TimeoutError)', async () => {
    // Regression test: AbortSignal.timeout()'s reason is a DOMException
    // named 'TimeoutError', which is still `instanceof Error`. Before the
    // fix, toAbortError() returned such reasons unchanged, so a timeout
    // firing while a task waited for its throttle slot leaked as
    // name === 'TimeoutError' instead of the documented 'AbortError'.
    //
    // Real timers are required here: AbortSignal.timeout() schedules its
    // own internal timer that fake timers do not control.
    vi.useRealTimers()

    const schedule = createThrottle(50)
    const succeeding = vi.fn().mockResolvedValue('ok')

    // Occupies the throttle immediately.
    const first = schedule(succeeding)
    // Queued behind `first`; its own 20ms timeout will fire well before
    // its ~50ms turn comes up.
    const secondSignal = AbortSignal.timeout(20)
    const second = schedule(succeeding, secondSignal)

    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await first
  })

  it('reproduces a burst of queued tasks: later ones time out as AbortError, not TimeoutError', async () => {
    // Mirrors the reviewer's report: a burst of tasks, each with its own
    // request timeout, queued behind a shared throttle. The ones far
    // enough back in the queue for their individual timeout to fire
    // before their turn must still surface as `name === 'AbortError'`.
    vi.useRealTimers()

    const schedule = createThrottle(50)
    const succeeding = vi.fn().mockResolvedValue('ok')

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => {
        const signal = AbortSignal.timeout(120)
        return schedule(succeeding, signal).then(
          () => 'ok',
          (err: Error) => err.name,
        )
      }),
    )

    // With minIntervalMs=50 and a 120ms per-task timeout, tasks whose
    // turn would come up after ~120ms never get one — they must reject,
    // and specifically with 'AbortError', never 'TimeoutError'.
    expect(outcomes).not.toContain('TimeoutError')
    expect(outcomes.some((o) => o === 'AbortError')).toBe(true)
    expect(outcomes.every((o) => o === 'ok' || o === 'AbortError')).toBe(true)
  })

  it('does not delay a later task by an earlier aborted task', async () => {
    const schedule = createThrottle(1000)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    const third = vi.fn().mockResolvedValue('third')
    const controller = new AbortController()

    const firstPromise = schedule(first)
    const secondPromise = schedule(second, controller.signal)
    const secondAssertion = expect(secondPromise).rejects.toMatchObject({
      name: 'AbortError',
    })
    const thirdPromise = schedule(third)

    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await secondAssertion

    // third should still start ~1000ms after first, not additionally
    // delayed by second's aborted wait.
    await vi.advanceTimersByTimeAsync(999)
    expect(third).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(third).toHaveBeenCalledTimes(1)

    await firstPromise
    await thirdPromise
  })
})
