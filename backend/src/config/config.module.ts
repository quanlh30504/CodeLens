import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './app-config';
import { EnvSecretProvider, SecretProvider } from './secret-provider';

export const APP_CONFIG = Symbol('APP_CONFIG');
export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');

export interface ConfigModuleOptions {
  /** Tests pass explicit values; production reads the environment. */
  config?: AppConfig;
  secrets?: SecretProvider;
}

@Global()
@Module({})
export class ConfigModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useFactory: (): AppConfig => options.config ?? loadConfig() },
        { provide: SECRET_PROVIDER, useFactory: (): SecretProvider => options.secrets ?? new EnvSecretProvider() },
      ],
      exports: [APP_CONFIG, SECRET_PROVIDER],
    };
  }
}
