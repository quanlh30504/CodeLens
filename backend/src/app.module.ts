import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigModuleOptions } from './config/config.module';
import { GithubModule } from './github/github.module';
import { ErrorFilter } from './observability/error.filter';
import { QueueModule } from './queue/queue.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({})
export class AppModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(options), TenancyModule, AuthModule, GithubModule, QueueModule],
      providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
    };
  }
}
