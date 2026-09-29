import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { APP_CONFIG, SECRET_PROVIDER } from '../config/config.module';
import type { AppConfig } from '../config/app-config';
import type { SecretProvider } from '../config/secret-provider';
import { createRedis } from '../queue/redis';
import { CsrfGuard } from './csrf.guard';
import { RedisKeyValueStore } from './redis-store';
import { SESSION_SERVICE, SessionGuard } from './session.guard';
import { SessionService } from './session.service';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (config: AppConfig): Redis => createRedis(config.redisUrl) },
    {
      provide: SESSION_SERVICE,
      inject: [REDIS, SECRET_PROVIDER],
      useFactory: (redis: Redis, secrets: SecretProvider) => new SessionService(new RedisKeyValueStore(redis), secrets),
    },
    SessionGuard,
    CsrfGuard,
  ],
  exports: [REDIS, SESSION_SERVICE, SessionGuard, CsrfGuard],
})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
