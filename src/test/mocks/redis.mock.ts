import { Provider } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export type MockRedisService = {
  connect: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  incr: jest.Mock;
  expire: jest.Mock;
  getJson: jest.Mock;
  setJson: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  smembers: jest.Mock;
  scanKeys: jest.Mock;
  ttl: jest.Mock;
  getClient: jest.Mock;
};

export function createMockRedisService(): MockRedisService {
  return {
    connect: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn().mockResolvedValue([]),
    scanKeys: jest.fn().mockResolvedValue([]),
    ttl: jest.fn().mockResolvedValue(-2),
    getClient: jest.fn(),
  };
}

export function mockRedisServiceProvider(
  redis: MockRedisService = createMockRedisService(),
): Provider {
  return {
    provide: RedisService,
    useValue: redis,
  };
}
