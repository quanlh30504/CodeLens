import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { QueueService } from '../../src/queue/queue.service';
import { createBullConnection } from '../../src/queue/redis';
import { FakeGithub } from '../fakes/fake-github';
import { Infra, startApi, startInfra, startWorker } from './harness';

describe('integration harness', () => {
  let infra: Infra;
  let github: FakeGithub;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startInfra();
    github = await new FakeGithub().start();
    app = await startApi(infra, github);
  });

  afterAll(async () => {
    await app.close();
    await github.stop();
    await infra.stop();
  });

  it('boots the API and answers unknown routes with the standard error shape', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules/);
  });

  it('does not advertise the server technology', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('runs queue consumers against the test Redis', async () => {
    const seen: number[] = [];
    const worker = startWorker(infra, {
      reconcile: async (data) => void seen.push(data.githubInstallationId),
      sync: async () => undefined,
    });
    const connection = createBullConnection(infra.redisUrl);
    const queues = new QueueService(connection);
    await queues.enqueueReconcile(777);
    const start = Date.now();
    while (seen.length === 0 && Date.now() - start < 15000) await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual([777]);
    await queues.close();
    connection.disconnect();
    await worker.stop();
  });
});
