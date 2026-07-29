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

  it('fusionne follows + playlists et borne le limit', async () => {
    prisma.playEvent.findMany.mockResolvedValue([
      { trackId: 't0', track: { artistId: 'a1', genre: 'AFRO' } },
    ]);
    prisma.follow.findMany.mockResolvedValue([{ artistId: 'a2' }]);
    prisma.playlistTrack.findMany.mockResolvedValue([
      { track: { artistId: 'a3' } },
    ]);
    prisma.track.findMany.mockResolvedValue([]);

    await service.suggest('u1', 100);
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
