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
    await expect(
      service.upsert('u1', { trackId: 't1', artistId: 'a1', value: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsert note titre et permet le changement', async () => {
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.rating.upsert.mockResolvedValue({ id: 'r1', value: 4 });
    await expect(
      service.upsert('u1', { trackId: 't1', value: 4 }),
    ).resolves.toMatchObject({ value: 4 });

    prisma.rating.upsert.mockResolvedValue({ id: 'r1', value: 2 });
    await expect(
      service.upsert('u1', { trackId: 't1', value: 2 }),
    ).resolves.toMatchObject({ value: 2 });
  });

  it('upsert note artiste', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.rating.upsert.mockResolvedValue({ id: 'r2', value: 5 });
    await expect(
      service.upsert('u1', { artistId: 'a1', value: 5 }),
    ).resolves.toMatchObject({ value: 5 });
  });

  it('upsert note album', async () => {
    prisma.album.findUnique.mockResolvedValue({ id: 'alb-1' });
    prisma.rating.upsert.mockResolvedValue({ id: 'r3', value: 3 });
    await expect(
      service.upsert('u1', { albumId: 'alb-1', value: 3 }),
    ).resolves.toMatchObject({ value: 3 });
    expect(prisma.rating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_albumId: { userId: 'u1', albumId: 'alb-1' } },
      }),
    );
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

    prisma.album.findUnique.mockResolvedValue(null);
    await expect(
      service.upsert('u1', { albumId: 'alb-1', value: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getSummary vide → average null', async () => {
    prisma.rating.aggregate.mockResolvedValue({
      _avg: { value: null },
      _count: { _all: 0 },
    });
    prisma.rating.findFirst.mockResolvedValue(null);

    await expect(
      service.getSummary({ trackId: 't1' }, 'u1'),
    ).resolves.toEqual({
      average: null,
      count: 0,
      myValue: null,
    });
  });

  it('getSummary avec votes + myValue', async () => {
    prisma.rating.aggregate.mockResolvedValue({
      _avg: { value: 4.25 },
      _count: { _all: 4 },
    });
    prisma.rating.findFirst.mockResolvedValue({ value: 5 });

    await expect(
      service.getSummary({ albumId: 'alb-1' }, 'u1'),
    ).resolves.toEqual({
      average: 4.3,
      count: 4,
      myValue: 5,
    });
  });
});
