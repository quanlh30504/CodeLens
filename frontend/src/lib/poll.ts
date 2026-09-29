export interface PollOptions<T> {
  fetchValue: () => Promise<T>;
  isDone: (value: T) => boolean;
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Return true to stop polling early (for example when the page is left). */
  cancelled?: () => boolean;
}

export type PollResult<T> = { status: 'done'; value: T } | { status: 'timeout' } | { status: 'cancelled' };

/** Polls until the value is done or the time is up. Errors while polling are treated as "not done yet". */
export async function pollUntil<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const started = now();

  for (;;) {
    if (options.cancelled?.()) return { status: 'cancelled' };
    try {
      const value = await options.fetchValue();
      if (options.isDone(value)) return { status: 'done', value };
    } catch {
      // A failed check is not a failed setup; try again until the time is up.
    }
    if (now() - started >= options.timeoutMs) return { status: 'timeout' };
    await sleep(options.intervalMs);
  }
}
