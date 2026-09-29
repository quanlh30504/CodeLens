import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SECRET_PROVIDER } from '../../config/config.module';
import type { SecretProvider } from '../../config/secret-provider';
import { METRIC, Metrics } from '../../observability/metrics';
import { log } from '../../observability/app-logger';
import { rawBodyOf } from './raw-body.middleware';

const SIGNATURE = /^sha256=[0-9a-f]{64}$/;

/** The one answer for every rejection: no detail that would help someone forge a request. */
const rejection = () => new UnauthorizedException({ code: 'NOT_ACCEPTED', message: 'Not accepted.' });

/**
 * Proves the event came from GitHub and was not changed (spec FR-028). The HMAC-SHA-256 of the raw
 * body with the shared webhook secret is compared in constant time BEFORE anything is parsed.
 * A rejection changes no state and logs only: time, reason, delivery id if present, and a keyed
 * fingerprint of the sender's address (never the body, the header value or the secret).
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    private readonly metrics: Metrics,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const body = rawBodyOf(request);
    const header = request.headers['x-hub-signature-256'];

    if (!body) return this.reject(request, 'missing_body');
    if (typeof header !== 'string' || header.length === 0) return this.reject(request, 'missing_signature');
    if (!SIGNATURE.test(header)) return this.reject(request, 'malformed_signature');

    const expected = Buffer.from(
      `sha256=${createHmac('sha256', this.secrets.githubWebhookSecret()).update(body).digest('hex')}`,
    );
    const given = Buffer.from(header);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return this.reject(request, 'signature_mismatch');
    }
    return true;
  }

  private reject(request: Request, reason: string): never {
    this.metrics.increment(METRIC.webhookRejected);
    const deliveryId = request.headers['x-github-delivery'];
    log().warn(
      {
        reason,
        deliveryId: typeof deliveryId === 'string' ? deliveryId.slice(0, 64) : undefined,
        sender: this.fingerprint(request.ip ?? request.socket?.remoteAddress ?? ''),
      },
      'webhook rejected',
    );
    throw rejection();
  }

  /** Keyed and truncated, so the address cannot be recovered from the log by hashing guesses. */
  private fingerprint(address: string): string {
    return createHmac('sha256', this.secrets.githubWebhookSecret()).update(`sender:${address}`).digest('hex').slice(0, 16);
  }
}
