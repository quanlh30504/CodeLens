import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/app-config';
import { QueueService } from './queue.service';
import { createBullConnection } from './redis';

export const BULL_CONNECTION = Symbol('BULL_CONNECTION');

@Global()
@Module({
  providers: [
    {
      provide: BULL_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis => createBullConnection(config.redisUrl),
    },
    {
      provide: QueueService,
      inject: [BULL_CONNECTION, APP_CONFIG],
      useFactory: (connection: Redis, config: AppConfig) => new QueueService(connection, config.queueBackoffMs),
    },
  ],
  exports: [BULL_CONNECTION, QueueService],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    private readonly queues: QueueService,
    @Inject(BULL_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queues.close();
    this.connection.disconnect();
  }
}
