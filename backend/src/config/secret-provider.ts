import { readFileSync } from 'node:fs';
import { ConfigError } from './app-config';

/**
 * Access to secrets. Deliberately narrow (Constitution XI, ADR-008): there is no generic
 * `get(name)`. Each method exists for exactly one consumer, and none of the values may be
 * logged, stored in the database or audit entries, or returned to a client.
 *
 * The MVP implementation reads environment variables or mounted files. A future
 * implementation (for example AWS Secrets Manager) only has to implement this interface.
 */
export interface SecretProvider {
  /** Private key used only to sign GitHub App JWTs (GitHubAppClient). */
  githubAppPrivateKey(): string;
  /** OAuth client secret used only for the GitHub user authorization exchange. */
  githubClientSecret(): string;
  /** Used only by the webhook signature verifier. */
  githubWebhookSecret(): string;
  /** Used only by the session store to sign identifiers. */
  sessionSecret(): string;
  /** Throws (naming only the missing secrets) if any secret is absent. Returns no values. */
  assertAllPresent(): void;
}

const NAMES = {
  privateKey: 'GITHUB_APP_PRIVATE_KEY',
  clientSecret: 'GITHUB_APP_CLIENT_SECRET',
  webhookSecret: 'GITHUB_WEBHOOK_SECRET',
  sessionSecret: 'SESSION_SECRET',
} as const;

/** Reads `<NAME>` from the environment, or the file named by `<NAME>_FILE` (mounted secret). */
export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  githubAppPrivateKey(): string {
    return this.read(NAMES.privateKey);
  }

  githubClientSecret(): string {
    return this.read(NAMES.clientSecret);
  }

  githubWebhookSecret(): string {
    return this.read(NAMES.webhookSecret);
  }

  sessionSecret(): string {
    return this.read(NAMES.sessionSecret);
  }

  assertAllPresent(): void {
    const missing = Object.values(NAMES).filter((name) => {
      try {
        return this.read(name).length === 0;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      throw new ConfigError(`Missing secrets: ${missing.join(', ')}`);
    }
  }

  private read(name: string): string {
    const filePath = this.env[`${name}_FILE`];
    if (filePath) {
      return readFileSync(filePath, 'utf8').trim();
    }
    const value = this.env[name];
    if (!value) {
      throw new ConfigError(`Secret ${name} is not configured`);
    }
    return value;
  }
}
