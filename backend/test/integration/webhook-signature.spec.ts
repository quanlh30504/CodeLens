import { Writable } from 'node:stream';
import { createLogger } from '../../src/observability/logger';
import { setLogger } from '../../src/observability/app-logger';
import { fixtures, sign, signedWebhook } from '../fakes/webhook-fixtures';
import { World, startWorld } from './scenario';
import { deliver, tableCounts } from './webhook-helpers';

/** FR-028, SC-004, US5 scenario 1. */
describe('webhook signature verification', () => {
  let world: World;
  const output: string[] = [];
  let restore: () => void;

  beforeAll(async () => {
    world = await startWorld();
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    setLogger(createLogger({ level: 'info', destination: stream }));
    restore = () => setLogger(createLogger({ level: 'silent' }));
  });

  afterAll(async () => {
    restore();
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
    output.length = 0;
  });

  const jobKeys = async () => (await world.app.get<import('ioredis').default>((await import('../../src/auth/auth.module')).REDIS).keys('bull:*')).length;

  it('accepts a correctly signed delivery with 202', async () => {
    const response = await deliver(world.app, fixtures.ping());
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'accepted' });
  });

  it('rejects missing, wrong, malformed and body-modified signatures with the same 401 and changes nothing', async () => {
    const valid = fixtures.installationCreated(500);
    const before = await tableCounts(world.infra.prisma);
    const queued = await jobKeys();

    const attempts = [
      deliver(world.app, valid, { headers: { 'x-hub-signature-256': undefined } }),
      deliver(world.app, valid, { headers: { 'x-hub-signature-256': sign(valid.body, 'some-other-secret') } }),
      deliver(world.app, valid, { headers: { 'x-hub-signature-256': 'sha256=not-hex' } }),
      deliver(world.app, valid, { headers: { 'x-hub-signature-256': `sha1=${sign(valid.body).slice(7, 47)}` } }),
      deliver(world.app, valid, { headers: { 'x-hub-signature-256': '' } }),
      // Correct signature, but the body was changed afterwards.
      deliver(world.app, valid, { body: valid.body.replace('acme', 'evil') }),
      // No body at all.
      deliver(world.app, valid, { body: '' }),
    ];
    const responses = await Promise.all(attempts);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'NOT_ACCEPTED', message: 'Not accepted.' });
    }
    expect(await tableCounts(world.infra.prisma)).toEqual(before);
    expect(await jobKeys()).toBe(queued);
  });

  it('answers 401, not 400, for an unsigned request with a malformed body (verification comes before parsing)', async () => {
    const response = await deliver(world.app, fixtures.ping(), {
      headers: { 'x-hub-signature-256': undefined },
      body: '{ this is not json',
    });
    expect(response.status).toBe(401);
  });

  it('logs a rejection with the reason, the delivery id and a fingerprint, but never the body, the signature or the secret', async () => {
    const webhook = fixtures.installationCreated(500, 1000, 'super-private-account-name');
    const bad = sign(webhook.body, 'wrong-secret');
    await deliver(world.app, webhook, { headers: { 'x-hub-signature-256': bad, 'x-github-delivery': 'delivery-under-test' } });

    const logged = output.join('');
    expect(logged).toContain('webhook rejected');
    expect(logged).toContain('signature_mismatch');
    expect(logged).toContain('delivery-under-test');
    expect(logged).not.toContain('super-private-account-name');
    expect(logged).not.toContain(bad);
    expect(logged).not.toContain('wrong-secret');
    expect(logged).not.toContain('test-only-webhook-secret');
    expect(logged).not.toMatch(/127\.0\.0\.1|::1|::ffff/);
    expect(world.app.get((await import('../../src/observability/metrics')).Metrics).count('webhook.rejected')).toBeGreaterThan(0);
  });

  it('requires the event and delivery headers once the signature is valid (400)', async () => {
    const webhook = fixtures.ping();
    const noEvent = await deliver(world.app, webhook, { headers: { 'x-github-event': undefined } });
    const noDelivery = await deliver(world.app, webhook, { headers: { 'x-github-delivery': undefined } });
    const weirdDelivery = await deliver(world.app, webhook, { headers: { 'x-github-delivery': 'has spaces and <tags>' } });
    for (const response of [noEvent, noDelivery, weirdDelivery]) {
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('BAD_REQUEST');
    }
    expect((await tableCounts(world.infra.prisma)).deliveries).toBe(0);
  });

  it('answers 400 for a validly signed body that is not a JSON object', async () => {
    for (const body of ['not json', '[1,2]', '"text"', 'null']) {
      const webhook = signedWebhook('ping', {});
      const response = await deliver(world.app, { ...webhook, body, headers: { ...webhook.headers, 'x-hub-signature-256': sign(body) } });
      expect(response.status).toBe(400);
    }
  });

  it('never stores the payload, only its hash', async () => {
    const webhook = fixtures.installationCreated(500, 1000, 'remember-me-not');
    await deliver(world.app, webhook).expect(202);
    const rows = JSON.stringify(await world.infra.prisma.$queryRawUnsafe('SELECT * FROM webhook_deliveries'), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(rows).not.toContain('remember-me-not');
    expect(rows).toMatch(/[0-9a-f]{64}/);
  });
});
