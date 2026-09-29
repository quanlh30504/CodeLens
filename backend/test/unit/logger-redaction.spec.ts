import { Writable } from 'node:stream';
import { createLogger } from '../../src/observability/logger';
import { assertNoSecretKeys, REDACTED, redact } from '../../src/observability/redaction';

const SECRET_KEYS = [
  'privateKey',
  'private_key',
  'GITHUB_APP_PRIVATE_KEY',
  'webhookSecret',
  'clientSecret',
  'client_secret',
  'sessionSecret',
  'SESSION_SECRET',
  'authorization',
  'Authorization',
  'cookie',
  'set-cookie',
  'token',
  'accessToken',
  'installationToken',
  'x-hub-signature-256',
  'code',
];

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe('log redaction', () => {
  it.each(SECRET_KEYS)('never writes the value of %s', (key) => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'debug', destination: stream });
    logger.info({ [key]: 'super-secret-value', nested: { [key]: 'super-secret-value' } }, 'event');
    const output = lines.join('');
    expect(output).not.toContain('super-secret-value');
    expect(output).toContain(REDACTED);
  });

  it('keeps ordinary correlation fields', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ destination: stream });
    logger.info({ deliveryId: 'd-1', githubInstallationId: 42 }, 'accepted');
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ deliveryId: 'd-1', githubInstallationId: 42, msg: 'accepted' });
  });

  it('redacts HTTP authorization and cookie headers', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ destination: stream });
    logger.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'codelens_session=abc' } } }, 'request');
    expect(lines.join('')).not.toContain('Bearer abc');
    expect(lines.join('')).not.toContain('codelens_session=abc');
  });

  it('redact() does not mutate its input and handles arrays', () => {
    const input = { list: [{ token: 'a' }], keep: 'x' };
    const out = redact(input);
    expect(input.list[0].token).toBe('a');
    expect(out).toEqual({ list: [{ token: REDACTED }], keep: 'x' });
  });

  it('assertNoSecretKeys rejects secret-looking keys at any depth', () => {
    expect(() => assertNoSecretKeys({ a: { b: [{ apiKey: 'x' }] } })).toThrow(/apiKey/);
    expect(() => assertNoSecretKeys({ repository: 'acme/app', action: 'REPOSITORY_ENABLED' })).not.toThrow();
  });
});
