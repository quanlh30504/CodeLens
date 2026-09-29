import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { ConfigModuleOptions } from './config/config.module';

/**
 * Builds the API. `rawBody` keeps the exact request bytes for webhook signature verification
 * (spec FR-028); no other route reads them.
 */
export async function createApp(options: ConfigModuleOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options), { rawBody: true, logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
