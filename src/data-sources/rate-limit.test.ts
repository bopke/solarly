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
})
