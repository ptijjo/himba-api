import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(configService: ConfigService) {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(configService.get<string>('REDIS_PORT', '6379'));
    const password = configService.get<string>('REDIS_PASSWORD') || undefined;
    // Username optionnel (ACL Redis 6+) — omit si vide
    const username = configService.get<string>('REDIS_USERNAME') || undefined;

    this.client = new Redis({
      host,
      port,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    // Évite le crash Node « Unhandled error event » ioredis
    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      try {
        await this.client.connect();
        this.logger.log('Connexion Redis OK');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Impossible de se connecter à Redis (${message}). Vérifier REDIS_HOST / REDIS_PORT / REDIS_PASSWORD.`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) {
      return;
    }
    await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) {
      return;
    }
    await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  /**
   * SCAN non bloquant — pour listes admin (ex. login:lock:*).
   * Évite KEYS qui bloque Redis en prod.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  /** TTL restant en secondes ; -1 = pas d’expire ; -2 = clé absente. */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
