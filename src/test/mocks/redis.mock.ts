import { Provider } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export type MockRedisService = {
  connect: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  getJson: jest.Mock;
  setJson: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  smembers: jest.Mock;
  getClient: jest.Mock;
};

export function createMockRedisService(): MockRedisService {
  return {
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn().mockResolvedValue([]),
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
