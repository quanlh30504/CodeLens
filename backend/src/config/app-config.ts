import { z } from 'zod';

/**
 * Non-secret runtime configuration. Secrets are never part of this object: they are only
 * reachable through the narrow methods of SecretProvider (see secret-provider.ts).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_API_BASE_URL: z.string().url().default('https://api.github.com'),
  GITHUB_WEB_BASE_URL: z.string().url().default('https://github.com'),
  QUEUE_BACKOFF_MS: z.coerce.number().int().min(0).default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  publicBaseUrl: string;
  githubAppId: string;
  githubAppClientId: string;
  githubAppSlug: string;
  githubApiBaseUrl: string;
  githubWebBaseUrl: string;
  queueBackoffMs: number;
  logLevel: string;
};

export class ConfigError extends Error {}

/** Parses and validates the environment. Fails fast, naming only the invalid variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new ConfigError(`Invalid or missing configuration: ${names}`);
  }
  const v = parsed.data;
  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    redisUrl: v.REDIS_URL,
    publicBaseUrl: v.PUBLIC_BASE_URL.replace(/\/$/, ''),
    githubAppId: v.GITHUB_APP_ID,
    githubAppClientId: v.GITHUB_APP_CLIENT_ID,
    githubAppSlug: v.GITHUB_APP_SLUG,
    githubApiBaseUrl: v.GITHUB_API_BASE_URL.replace(/\/$/, ''),
    githubWebBaseUrl: v.GITHUB_WEB_BASE_URL.replace(/\/$/, ''),
    queueBackoffMs: v.QUEUE_BACKOFF_MS,
    logLevel: v.LOG_LEVEL,
  };
}
