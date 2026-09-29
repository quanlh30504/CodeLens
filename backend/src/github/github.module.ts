import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, SECRET_PROVIDER } from '../config/config.module';
import type { AppConfig } from '../config/app-config';
import type { SecretProvider } from '../config/secret-provider';
import { GithubAppClient } from './github-app.client';

@Global()
@Module({
  providers: [
    {
      provide: GithubAppClient,
      inject: [APP_CONFIG, SECRET_PROVIDER],
      useFactory: (config: AppConfig, secrets: SecretProvider) =>
        new GithubAppClient({
          appId: config.githubAppId,
          apiBaseUrl: config.githubApiBaseUrl,
          privateKey: () => secrets.githubAppPrivateKey(),
        }),
    },
  ],
  exports: [GithubAppClient],
})
export class GithubModule {}
