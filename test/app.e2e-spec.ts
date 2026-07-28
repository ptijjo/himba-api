import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { StorageService } from '../src/storage/storage.service';
import { PaymentsService } from '../src/payments/payments.service';

describe('MVP (e2e)', () => {
  let app: INestApplication<App>;

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    artist: { findUnique: jest.fn(), create: jest.fn() },
    track: { findUnique: jest.fn(), findMany: jest.fn() },
    purchase: { findUnique: jest.fn(), create: jest.fn() },
  };

  const redisMock = {
    onModuleInit: jest.fn(),
    connect: jest.fn(),
    onModuleDestroy: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn().mockResolvedValue([]),
  };

  const storageMock = {
    uploadImage: jest.fn(),
    uploadAudio: jest.fn(),
    getSignedUrl: jest.fn(),
  };

  const paymentsMock = {
    createTrackPaymentIntent: jest.fn(),
    handleWebhook: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .overrideProvider(StorageService)
      .useValue(storageMock)
      .overrideProvider(PaymentsService)
      .useValue(paymentsMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('/health (GET) est public', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('route métier sans Bearer → 401', () => {
    return request(app.getHttpServer()).get('/tracks').expect(401);
  });

  it('webhook stripe sans signature → 400', () => {
    return request(app.getHttpServer())
      .post('/webhooks/stripe')
      .send({})
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
