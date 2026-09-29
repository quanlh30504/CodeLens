import type { Logger } from 'pino';
import { createLogger } from './logger';

let current: Logger = createLogger({ level: process.env.LOG_LEVEL ?? 'info' });

/** The process-wide logger. Replaceable so tests can capture exactly what is written. */
export const log = (): Logger => current;

export function setLogger(logger: Logger): void {
  current = logger;
}
