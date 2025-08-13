import { Redis } from "@upstash/redis";

interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

class InMemoryStore implements KeyValueStore {
  private map = new Map<string, { value: unknown; expiresAt: number }>();
  async get<T>(key: string): Promise<T | null> {
    const item = this.map.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) { this.map.delete(key); return null; }
    return item.value as T;
  }
  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.map.set(key, { value, expiresAt });
  }
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.set<number>(key, next, ttlSeconds);
    return next;
  }
}

function createStoreFromEnv(): KeyValueStore {
  const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!hasUpstash) return new InMemoryStore();
  const redis = Redis.fromEnv();
  return {
    async get(key) {
      const data = await redis.get<string>(key);
      if (!data) return null;
      try { return JSON.parse(data); } catch { return data as any; }
    },
    async set(key, value, ttlSeconds = 60) {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      await redis.set(key, serialized, { ex: ttlSeconds });
    },
    async incrementWithTtl(key, ttlSeconds) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttlSeconds);
      return count;
    }
  };
}

export const kv: KeyValueStore = createStoreFromEnv();
