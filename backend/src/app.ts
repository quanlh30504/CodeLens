import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { ConfigModuleOptions } from './config/config.module';
import { configureBodyParsing } from './github/webhook/raw-body.middleware';

/**
 * Builds the API. Body parsing is configured explicitly so the webhook route keeps the exact
 * request bytes for signature verification (spec FR-028).
 */
export async function createApp(options: ConfigModuleOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options), { bodyParser: false, logger: ['error', 'warn'] });
  configureBodyParsing(app);
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
