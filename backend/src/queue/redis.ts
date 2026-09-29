import Redis from 'ioredis';

/** Connection for BullMQ. `maxRetriesPerRequest: null` is required for blocking worker commands. */
export function createBullConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/** Connection for ordinary commands such as sessions. */
export function createRedis(redisUrl: string): Redis {
  return new Redis(redisUrl);
}
