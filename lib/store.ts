import "server-only";
import { Redis } from "@upstash/redis";

/** Minimal key/value interface backed by Upstash Redis (or memory for local dev/tests). */
export interface Store {
  get<T>(key: string): Promise<T | null>;
  /** Returns false when `nx` is set and the key already existed. */
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Atomically increments; a newly created counter expires after `ttlSeconds`. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

class RedisStore implements Store {
  constructor(private redis: Redis) {}
  async get<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown, opts: { ex?: number; nx?: boolean } = {}) {
    const res = opts.ex
      ? opts.nx
        ? await this.redis.set(key, value, { ex: opts.ex, nx: true })
        : await this.redis.set(key, value, { ex: opts.ex })
      : opts.nx
        ? await this.redis.set(key, value, { nx: true })
        : await this.redis.set(key, value);
    return res === "OK";
  }
  async del(key: string) {
    await this.redis.del(key);
  }
  async incr(key: string, ttlSeconds: number) {
    // Create with a TTL first (no-op if present); INCR keeps the existing TTL.
    await this.redis.set(key, 0, { ex: ttlSeconds, nx: true });
    return this.redis.incr(key);
  }
}

export class MemoryStore implements Store {
  private data = new Map<string, { v: string; exp: number | null }>();
  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (JSON.parse(e.v) as T) : null;
  }
  async set(key: string, value: unknown, opts: { ex?: number; nx?: boolean } = {}) {
    if (opts.nx && this.live(key)) return false;
    this.data.set(key, {
      v: JSON.stringify(value),
      exp: opts.ex ? Date.now() + opts.ex * 1000 : null,
    });
    return true;
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async incr(key: string, ttlSeconds: number) {
    const e = this.live(key);
    const n = (e ? Number(JSON.parse(e.v)) : 0) + 1;
    this.data.set(key, {
      v: JSON.stringify(n),
      exp: e ? e.exp : Date.now() + ttlSeconds * 1000,
    });
    return n;
  }
}

let store: Store | undefined;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token }));
  } else if (process.env.NODE_ENV !== "production" || process.env.UNSAFE_MEMORY_STORE === "1") {
    // Local development / tests only: data is lost on restart and not shared
    // between serverless instances. Kept on globalThis because Next.js bundles
    // route handlers and pages separately, and they must share one store.
    const g = globalThis as { __pzMemoryStore?: MemoryStore };
    store = g.__pzMemoryStore ??= new MemoryStore();
  } else {
    throw new Error(
      "No database configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  return store;
}

/** Test hook. */
export function setStoreForTests(s: Store | undefined) {
  store = s;
}
