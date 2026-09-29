import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedWebhook } from '../fakes/webhook-fixtures';

/** Sends a signed fixture exactly as GitHub would. */
export function deliver(app: INestApplication, webhook: SignedWebhook, overrides: { headers?: Record<string, string | undefined>; body?: string } = {}) {
  let req = request(app.getHttpServer()).post('/api/webhooks/github');
  const headers = { ...webhook.headers, ...overrides.headers };
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) req = req.set(name, value);
  }
  return req.send(overrides.body ?? webhook.body);
}

export async function tableCounts(prisma: import('@prisma/client').PrismaClient) {
  const [deliveries, installations, organizations, repositories, audits, users] = await Promise.all([
    prisma.webhookDelivery.count(),
    prisma.githubInstallation.count(),
    prisma.organization.count(),
    prisma.repository.count(),
    prisma.auditLog.count(),
    prisma.user.count(),
  ]);
  return { deliveries, installations, organizations, repositories, audits, users };
}
