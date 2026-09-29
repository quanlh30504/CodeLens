import { createHash } from 'node:crypto';
import { BadRequestException, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { METRIC, Metrics } from '../../observability/metrics';
import { log } from '../../observability/app-logger';
import { QueueService } from '../../queue/queue.service';
import { actionOf, installationIdOf, routeEvent } from './event-router';
import { rawBodyOf } from './raw-body.middleware';
import { SignatureGuard } from './signature.guard';
import { WebhookDeliveriesService } from './webhook-deliveries.service';

const HEADER_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
const badRequest = () => new BadRequestException({ code: 'BAD_REQUEST', message: 'The delivery is malformed.' });

/** Every authentic event, including repeats, receives this same acknowledgement (FR-028). */
const ACCEPTED = { status: 'accepted' } as const;

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly deliveries: WebhookDeliveriesService,
    private readonly queues: QueueService,
    private readonly metrics: Metrics,
  ) {}

  /**
   * Receives GitHub events. Only quick work happens here (verify, record, enqueue) so the answer
   * is well inside GitHub's 10 second limit; reading GitHub and writing repositories happen in the
   * worker (FR-031).
   */
  @Post('github')
  @HttpCode(202)
  @UseGuards(SignatureGuard)
  async receive(@Req() request: Request): Promise<typeof ACCEPTED> {
    const started = Date.now();
    const event = request.headers['x-github-event'];
    const deliveryId = request.headers['x-github-delivery'];
    if (typeof event !== 'string' || !HEADER_VALUE.test(event) || typeof deliveryId !== 'string' || !HEADER_VALUE.test(deliveryId)) {
      throw badRequest();
    }

    const body = rawBodyOf(request)!;
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw badRequest();
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest();

    const githubInstallationId = installationIdOf(payload);
    const outcome = await this.deliveries.record({
      deliveryGuid: deliveryId,
      event,
      action: actionOf(payload),
      githubInstallationId,
      payloadSha256: createHash('sha256').update(body).digest('hex'),
    });

    if (outcome === 'DUPLICATE') {
      this.metrics.increment(METRIC.webhookDuplicate);
      return ACCEPTED;
    }

    this.metrics.increment(METRIC.webhookReceived);
    const routing = routeEvent(event, payload);
    if (routing.kind === 'ignore') {
      await this.deliveries.markIgnored(deliveryId, routing.reason);
    } else {
      const result =
        routing.kind === 'reconcile'
          ? await this.queues.enqueueReconcile(routing.githubInstallationId, deliveryId)
          : await this.queues.enqueueSync(routing.githubInstallationId, deliveryId);
      // A job that is already waiting will read the latest state when it runs, so this delivery
      // is covered by it (research R6).
      if (result === 'ALREADY_QUEUED') await this.deliveries.markProcessed(deliveryId);
    }

    this.metrics.observe(METRIC.webhookAckMs, Date.now() - started);
    log().info({ deliveryId, githubInstallationId, event, routing: routing.kind }, 'webhook accepted');
    return ACCEPTED;
  }
}
