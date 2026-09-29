import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './authorization-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Requires the per-session CSRF token on state-changing requests. Must run after SessionGuard.
 * The webhook route is not session-based and does not use this guard (it is authenticated by
 * its signature).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const session = request.auth?.session;
    if (!session) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required.' });
    }

    const header = request.headers[CSRF_HEADER];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(session.csrfToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'Request could not be verified.' });
    }
    return true;
  }
}
