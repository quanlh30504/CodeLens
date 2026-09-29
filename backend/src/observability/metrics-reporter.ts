import type { Logger } from 'pino';
import type { Metrics } from './metrics';

/**
 * Writes a metrics snapshot to the log once a minute: counters and timing summaries only, never
 * payloads, names or identifiers (Constitution XIII). The timer does not keep the process alive.
 */
export function startMetricsReporter(metrics: Metrics, logger: Logger, everyMs = 60_000): () => void {
  const timer = setInterval(() => logger.info({ metrics: metrics.snapshot() }, 'metrics'), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
