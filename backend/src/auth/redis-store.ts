import type Redis from 'ioredis';
import type { KeyValueStore } from './session.service';

export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', Math.max(1, Math.floor(ttlSeconds)));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
