import type { INestApplication } from '@nestjs/common';
import { json, raw } from 'express';
import type { Request } from 'express';

export const WEBHOOK_PATH = '/api/webhooks/github';

/**
 * Body parsing for the whole API (spec FR-028): the webhook route receives the exact request bytes
 * and is NOT parsed, so its signature can be checked before anything is interpreted. Every other
 * route gets ordinary JSON parsing with a small size limit.
 */
export function configureBodyParsing(app: INestApplication): void {
  app.use(WEBHOOK_PATH, raw({ type: () => true, limit: '1mb' }));
  app.use(json({ limit: '256kb' }));
}

/** The raw bytes of a webhook request, or null when the request had no body. */
export function rawBodyOf(request: Request): Buffer | null {
  return Buffer.isBuffer(request.body) && request.body.length > 0 ? request.body : null;
}
