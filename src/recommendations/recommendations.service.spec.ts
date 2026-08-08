import { Test, TestingModule } from '@nestjs/testing';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  let service: RecommendationsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        mockPrismaServiceProvider(prisma),
      ],
    }).compile();
    service = module.get(RecommendationsService);
  });

  it('retourne le catalogue récent si aucun signal', async () => {
    prisma.playEvent.findMany.mockResolvedValue([]);
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.playlistTrack.findMany.mockResolvedValue([]);
    prisma.track.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'A',
        genre: 'AFRO',
        price: null,
        coverUrl: null,
        artistId: 'a1',
        durationMs: 1000,
        album: { coverUrl: 'https://cdn/album.webp' },
        artist: { id: 'a1', displayName: 'FOFO' },
      },
    ]);

    await expect(service.suggest('u1')).resolves.toEqual([
      {
        id: 't1',
        title: 'A',
        genre: 'AFRO',
        price: null,
        coverUrl: 'https://cdn/album.webp',
        artistId: 'a1',
        durationMs: 1000,
        artist: { id: 'a1', displayName: 'FOFO' },
      },
    ]);
  });

  it('utilise artistes des écoutes récentes', async () => {
    prisma.playEvent.findMany.mockResolvedValue([
      {
        trackId: 't0',
        track: { artistId: 'a1', genre: 'POP' },
      },
    ]);
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.playlistTrack.findMany.mockResolvedValue([]);
    prisma.track.findMany.mockResolvedValue([{ id: 't2' }]);

    await service.suggest('u1', 5);
    expect(prisma.track.findMany).toHaveBeenCalled();
  });

  it('sérialise price Decimal en number (pas d’objet Prisma brut)', async () => {
    prisma.playEvent.findMany.mockResolvedValue([]);
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.playlistTrack.findMany.mockResolvedValue([]);
    prisma.track.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Paid',
        genre: 'RAP',
        price: { toString: () => '1.99' },
        coverUrl: null,
        artistId: 'a1',
        durationMs: null,
        album: null,
        artist: null,
      },
    ]);

    await expect(service.suggest('u1')).resolves.toEqual([
      expect.objectContaining({ id: 't1', price: 1.99 }),
    ]);
  });
});
