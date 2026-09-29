import pino, { Logger } from 'pino';
import { redact } from './redaction';

/** Correlation fields available on every log line of a webhook or job (Constitution XIII). */
export interface LogContext {
  deliveryId?: string;
  githubInstallationId?: string | number;
  jobId?: string;
  organizationId?: string;
}

/**
 * Structured JSON logger. Every object is passed through `redact`, so a secret-looking key
 * (token, secret, authorization, cookie, private key, ...) is never written. Webhook bodies
 * and repository content must not be logged by callers at all.
 */
export function createLogger(options: { level?: string; destination?: pino.DestinationStream } = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        log: (object) => redact(object),
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
    },
    options.destination,
  );
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(redact(context));
}
