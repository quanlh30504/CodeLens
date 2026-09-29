import { Injectable } from '@nestjs/common';

/**
 * Minimal in-process counters and timings (Constitution XIII). Names only, never labels that could
 * carry repository content or secrets. They are logged periodically and available to tests.
 */
@Injectable()
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, number[]>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, milliseconds: number): void {
    const list = this.timings.get(name) ?? [];
    list.push(milliseconds);
    if (list.length > 1000) list.shift();
    this.timings.set(name, list);
  }

  count(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): { counters: Record<string, number>; timings: Record<string, { count: number; p95: number }> } {
    const timings: Record<string, { count: number; p95: number }> = {};
    for (const [name, values] of this.timings) {
      const sorted = [...values].sort((a, b) => a - b);
      timings[name] = { count: sorted.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] };
    }
    return { counters: Object.fromEntries(this.counters), timings };
  }
}
