import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { QueueService } from '../../src/queue/queue.service';
import { RECONCILE_QUEUE } from '../../src/queue/queue.names';
import { createBullConnection } from '../../src/queue/redis';
import { Infra, startInfra } from './harness';

describe('queue deduplication (FR-029, research R6)', () => {
  let infra: Infra;
  let connection: Redis;
  let queues: QueueService;

  beforeAll(async () => {
    infra = await startInfra();
    connection = createBullConnection(infra.redisUrl);
    queues = new QueueService(connection);
  });

  afterAll(async () => {
    await queues.close();
    connection.disconnect();
    await infra.stop();
  });

  it('collapses identical pending jobs', async () => {
    expect(await queues.enqueueSync(111)).toBe('QUEUED');
    expect(await queues.enqueueSync(111)).toBe('ALREADY_QUEUED');
    expect(await queues.enqueueSync(111)).toBe('ALREADY_QUEUED');
    expect(await queues.enqueueSync(222)).toBe('QUEUED');
  });

  it('adds exactly one follow-up while the job is running, so no change is lost', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let markStarted!: () => void;
    const firstRunStarted = new Promise<void>((resolve) => (markStarted = resolve));
    const runs: number[] = [];

    const workerConnection = createBullConnection(infra.redisUrl);
    const worker = new Worker(
      RECONCILE_QUEUE,
      async () => {
        runs.push(runs.length + 1);
        markStarted();
        if (runs.length === 1) await gate;
      },
      { connection: workerConnection, concurrency: 1 },
    );

    expect(await queues.enqueueReconcile(333)).toBe('QUEUED');
    await firstRunStarted;

    // The job is running; two more events for the same installation arrive.
    expect(await queues.enqueueReconcile(333)).toBe('QUEUED');
    expect(await queues.enqueueReconcile(333)).toBe('ALREADY_QUEUED');

    release();
    await waitFor(() => runs.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(runs).toHaveLength(2);
    await worker.close();
    workerConnection.disconnect();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
