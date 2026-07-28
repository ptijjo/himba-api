import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { RatingsService } from './ratings.service';

describe('RatingsService', () => {
  let service: RatingsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RatingsService, mockPrismaServiceProvider(prisma)],
    }).compile();
    service = module.get(RatingsService);
  });

  it('refuse sans cible unique', async () => {
    await expect(
      service.upsert('u1', { value: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsert note titre', async () => {
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.rating.upsert.mockResolvedValue({ id: 'r1', value: 4 });
    await expect(
      service.upsert('u1', { trackId: 't1', value: 4 }),
    ).resolves.toMatchObject({ value: 4 });
  });

  it('upsert note artiste', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.rating.upsert.mockResolvedValue({ id: 'r2', value: 5 });
    await expect(
      service.upsert('u1', { artistId: 'a1', value: 5 }),
    ).resolves.toMatchObject({ value: 5 });
  });

  it('refuse note hors bornes + cibles introuvables', async () => {
    await expect(
      service.upsert('u1', { trackId: 't1', value: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.upsert('u1', { trackId: 't1', value: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(
      service.upsert('u1', { artistId: 'a1', value: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
