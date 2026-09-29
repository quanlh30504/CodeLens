import { Global, Module } from '@nestjs/common';
import { Metrics } from '../../observability/metrics';
import { SignatureGuard } from './signature.guard';
import { WebhookController } from './webhook.controller';
import { WebhookDeliveriesService } from './webhook-deliveries.service';

@Global()
@Module({
  controllers: [WebhookController],
  providers: [Metrics, SignatureGuard, WebhookDeliveriesService],
  exports: [Metrics, WebhookDeliveriesService],
})
export class WebhookModule {}
