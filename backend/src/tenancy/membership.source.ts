import { Injectable } from '@nestjs/common';
import type { Membership, MembershipSource, Role } from '../auth/authorization-context';
import { PrismaService } from './prisma.service';

/** Memberships always come from the database, never from the request or the browser. */
@Injectable()
export class PrismaMembershipSource implements MembershipSource {
  constructor(private readonly prisma: PrismaService) {}

  async findMemberships(userId: string): Promise<Membership[]> {
    const rows = await this.prisma.organizationMember.findMany({ where: { userId } });
    return rows.map((row) => ({
      organizationId: row.organizationId,
      role: row.role as Role,
      roleVerifiedAt: row.roleVerifiedAt,
    }));
  }
}
