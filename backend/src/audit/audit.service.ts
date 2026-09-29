import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertNoSecretKeys } from '../observability/redaction';
import { PrismaService } from '../tenancy/prisma.service';

/** Actions written by Feature 001 (data-model.md). */
export type AuditAction =
  | 'GITHUB_INSTALLATION_ADDED'
  | 'GITHUB_INSTALLATION_REMOVED'
  | 'GITHUB_INSTALLATION_SUSPENDED'
  | 'GITHUB_INSTALLATION_UNSUSPENDED'
  | 'REPOSITORY_ENABLED'
  | 'REPOSITORY_DISABLED'
  | 'REPOSITORY_SYNC_FAILED';

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  resourceType: 'GITHUB_INSTALLATION' | 'REPOSITORY';
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an audit entry. Metadata keys that look like secrets are rejected (FR-033), so a
   * caller mistake fails loudly instead of persisting a secret. Pass a transaction client to
   * make the entry atomic with the change it records.
   */
  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    if (entry.metadata) assertNoSecretKeys(entry.metadata);
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipHash: entry.ipHash ?? null,
      },
    });
  }
}
