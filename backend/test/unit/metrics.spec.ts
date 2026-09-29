import { Writable } from 'node:stream';
import { createLogger } from '../../src/observability/logger';
import { METRIC, Metrics } from '../../src/observability/metrics';
import { startMetricsReporter } from '../../src/observability/metrics-reporter';

describe('Metrics', () => {
  it('counts and summarizes timings', () => {
    const metrics = new Metrics();
    metrics.increment(METRIC.webhookReceived);
    metrics.increment(METRIC.webhookReceived, 2);
    for (let i = 1; i <= 100; i += 1) metrics.observe(METRIC.syncDurationMs, i);
    expect(metrics.count(METRIC.webhookReceived)).toBe(3);
    expect(metrics.count(METRIC.webhookRejected)).toBe(0);
    const snapshot = metrics.snapshot();
    expect(snapshot.counters[METRIC.webhookReceived]).toBe(3);
    expect(snapshot.timings[METRIC.syncDurationMs]).toEqual({ count: 100, p95: 96 });
  });

  it('logs a snapshot with counters only', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, cb) { lines.push(chunk.toString()); cb(); } });
    const metrics = new Metrics();
    metrics.increment(METRIC.syncFailed);
    const stop = startMetricsReporter(metrics, createLogger({ destination: stream }), 10);
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toBe('metrics');
    expect(entry.metrics.counters[METRIC.syncFailed]).toBe(1);
  });
});
