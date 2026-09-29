import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../tenancy/prisma.service';

export interface DeliveryRecord {
  deliveryGuid: string;
  event: string;
  action: string | null;
  githubInstallationId: number | null;
  payloadSha256: string;
}

/**
 * The record of each authentic delivery (data-model.md): it recognizes repeats by GitHub's
 * delivery id and traces what was done. It holds a hash of the payload, never the payload.
 */
@Injectable()
export class WebhookDeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns 'NEW' the first time a delivery id is seen and 'DUPLICATE' every time after (FR-029). */
  async record(delivery: DeliveryRecord): Promise<'NEW' | 'DUPLICATE'> {
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          deliveryGuid: delivery.deliveryGuid,
          event: delivery.event,
          action: delivery.action,
          githubInstallationId: delivery.githubInstallationId === null ? null : BigInt(delivery.githubInstallationId),
          payloadSha256: delivery.payloadSha256,
          status: 'RECEIVED',
        },
      });
      return 'NEW';
    } catch (error) {
      // The unique delivery id makes two simultaneous identical deliveries safe as well.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'DUPLICATE';
      throw error;
    }
  }

  markProcessed(deliveryGuid: string | undefined): Promise<unknown> {
    return this.finish(deliveryGuid, 'PROCESSED', null);
  }

  markIgnored(deliveryGuid: string, reason: string | null = null): Promise<unknown> {
    return this.finish(deliveryGuid, 'IGNORED', reason);
  }

  markFailed(deliveryGuid: string | undefined, errorCode: string): Promise<unknown> {
    return this.finish(deliveryGuid, 'FAILED', errorCode);
  }

  private async finish(deliveryGuid: string | undefined, status: 'PROCESSED' | 'IGNORED' | 'FAILED', errorCode: string | null) {
    if (!deliveryGuid) return;
    await this.prisma.webhookDelivery.updateMany({
      where: { deliveryGuid, status: 'RECEIVED' },
      data: { status, errorCode, processedAt: new Date() },
    });
  }
}
