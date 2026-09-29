import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './authorization-context';
import { PrismaService } from '../tenancy/prisma.service';
import { notFound } from '../tenancy/tenant-scoped.repository';
import { requireUuid } from '../installations/installations.repository';

export const ROLE_MAX_AGE_MS = 10 * 60 * 1000;

export type ManagedResource = { kind: 'repository' | 'installation'; param: string };
const MANAGED = 'managed-resource';

/** Marks a route as a management action on a repository or installation named by a route parameter. */
export const Managed = (kind: ManagedResource['kind'], param: string) => SetMetadata(MANAGED, { kind, param });

/**
 * Guards management actions (enable, disable, synchronize; spec FR-021, FR-037, FR-040). Order:
 *  1. the resource must exist inside the caller's organizations, else the same 404 as a missing one;
 *  2. the caller must be an OWNER of that organization, else 403 FORBIDDEN;
 *  3. GitHub must have confirmed the OWNER role within the last 10 minutes, else 403 REAUTH_REQUIRED
 *     and the request has no effect until the role is confirmed again.
 * A stored role older than that is never trusted (FR-038). Must run after SessionGuard.
 */
@Injectable()
export class RoleFreshnessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const managed = this.reflector.get<ManagedResource | undefined>(MANAGED, context.getHandler());
    if (!managed) throw new Error('RoleFreshnessGuard needs a @Managed(...) route');
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    const auth = request.auth;
    if (!auth) throw notFound();

    const id = requireUuid(request.params[managed.param]);
    const organizationId = await this.organizationOf(managed.kind, id);
    const membership = organizationId
      ? auth.context.memberships.find((m) => m.organizationId === organizationId)
      : undefined;
    if (!membership) throw notFound(); // missing or not yours: indistinguishable (FR-020)

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only organization owners can change this.' });
    }
    const verifiedAt = membership.roleVerifiedAt?.getTime();
    if (verifiedAt === undefined || Date.now() - verifiedAt > ROLE_MAX_AGE_MS) {
      throw new ForbiddenException({
        code: 'REAUTH_REQUIRED',
        message: 'Please confirm your access with GitHub and try again.',
      });
    }
    return true;
  }

  private async organizationOf(kind: ManagedResource['kind'], id: string): Promise<string | null> {
    if (kind === 'repository') {
      return (await this.prisma.repository.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null;
    }
    return (await this.prisma.githubInstallation.findUnique({ where: { id }, select: { organizationId: true } }))?.organizationId ?? null;
  }
}
