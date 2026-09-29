import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest, MembershipSource, resolveAuthorizationContext } from './authorization-context';
import { parseCookies } from './cookies';
import { SESSION_COOKIE_NAME, SessionService } from './session.service';

export const SESSION_SERVICE = Symbol('SESSION_SERVICE');
export const MEMBERSHIP_SOURCE = Symbol('MEMBERSHIP_SOURCE');

/**
 * Requires a valid session and attaches the AuthorizationContext to the request.
 * Unauthenticated requests get 401 and see no tenant data (FR-004).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(MEMBERSHIP_SOURCE) private readonly memberships: MembershipSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
    const resolved = await this.sessions.resolve(cookie);
    if (!resolved) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required.' });
    }
    request.auth = {
      sessionId: resolved.id,
      session: resolved.session,
      context: await resolveAuthorizationContext(this.memberships, resolved.session.userId),
    };
    return true;
  }
}
