import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, SECRET_PROVIDER } from '../config/config.module';
import type { AppConfig } from '../config/app-config';
import type { SecretProvider } from '../config/secret-provider';
import { GithubAppClient } from './github-app.client';
import { GithubUserClient } from './github-user.client';

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
    {
      provide: GithubUserClient,
      inject: [APP_CONFIG, SECRET_PROVIDER],
      useFactory: (config: AppConfig, secrets: SecretProvider) =>
        new GithubUserClient({
          apiBaseUrl: config.githubApiBaseUrl,
          webBaseUrl: config.githubWebBaseUrl,
          clientId: config.githubAppClientId,
          clientSecret: () => secrets.githubClientSecret(),
        }),
    },
  ],
  exports: [GithubAppClient, GithubUserClient],
})
export class GithubModule {}
