import { describe, expect, it } from 'vitest';
import { pollUntil } from './poll';

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('pollUntil', () => {
  it('returns as soon as the value is done', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil({
      fetchValue: async () => ++calls,
      isDone: (n) => n === 3,
      intervalMs: 3000,
      timeoutMs: 120_000,
      ...clock,
    });
    expect(result).toEqual({ status: 'done', value: 3 });
    expect(clock.now()).toBe(6000);
  });

  it('gives up after the timeout (2 minutes in the UI)', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil({
      fetchValue: async () => ++calls,
      isDone: () => false,
      intervalMs: 3000,
      timeoutMs: 120_000,
      ...clock,
    });
    expect(result).toEqual({ status: 'timeout' });
    expect(calls).toBe(41);
  });

  it('keeps polling through temporary errors', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil({
      fetchValue: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network');
        return 'ready';
      },
      isDone: (v) => v === 'ready',
      intervalMs: 1000,
      timeoutMs: 60_000,
      ...clock,
    });
    expect(result).toEqual({ status: 'done', value: 'ready' });
  });

  it('stops when cancelled', async () => {
    const clock = fakeClock();
    const result = await pollUntil({
      fetchValue: async () => 1,
      isDone: () => false,
      intervalMs: 1000,
      timeoutMs: 60_000,
      cancelled: () => true,
      ...clock,
    });
    expect(result).toEqual({ status: 'cancelled' });
  });
});
