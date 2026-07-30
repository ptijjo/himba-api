import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { PlaylistsService } from './playlists.service';

describe('PlaylistsService', () => {
  let service: PlaylistsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlaylistsService, mockPrismaServiceProvider(prisma)],
    }).compile();
    service = module.get(PlaylistsService);
  });

  it('listPublicByUser liste les playlists sans PII', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ACTIVE',
    });
    prisma.playlist.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Mix',
        createdAt: new Date('2026-01-01'),
        _count: { tracks: 3 },
      },
    ]);

    await expect(service.listPublicByUser('u1')).resolves.toEqual([
      {
        id: 'p1',
        name: 'Mix',
        createdAt: new Date('2026-01-01'),
        trackCount: 3,
      },
    ]);
  });

  it('listPublicByUser refuse user absent / ban', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.listPublicByUser('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create playlist', async () => {
    prisma.playlist.create.mockResolvedValue({
      id: 'p1',
      name: 'Mix',
      userId: 'u1',
    });
    await expect(service.create('u1', { name: 'Mix' })).resolves.toMatchObject({
      name: 'Mix',
    });
  });

  it('addTrack vérifie le titre', async () => {
    prisma.playlist.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
    });
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.playlistTrack.findUnique.mockResolvedValue(null);
    prisma.playlistTrack.count.mockResolvedValue(0);
    prisma.playlistTrack.create.mockResolvedValue({ id: 'pt1' });

    await expect(
      service.addTrack('u1', 'p1', { trackId: 't1' }),
    ).resolves.toMatchObject({ id: 'pt1' });
  });

  it('addTrack refuse un titre déjà dans la playlist → 409', async () => {
    prisma.playlist.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
    });
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.playlistTrack.findUnique.mockResolvedValue({
      playlistId: 'p1',
      trackId: 't1',
    });

    await expect(
      service.addTrack('u1', 'p1', { trackId: 't1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.playlistTrack.create).not.toHaveBeenCalled();
  });

  it('listMine / get / update / remove / removeTrack', async () => {
    prisma.playlist.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1', _count: { tracks: 2 } },
    ]);
    prisma.playlist.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
    prisma.playlistTrack.findMany.mockResolvedValue([]);
    prisma.playlist.update.mockResolvedValue({ id: 'p1', name: 'N' });
    prisma.playlist.delete.mockResolvedValue({});
    prisma.playlistTrack.delete.mockResolvedValue({});

    await expect(service.listMine('u1')).resolves.toMatchObject({
      items: [{ id: 'p1', trackCount: 2 }],
    });
    await service.get('u1', 'p1');
    await service.update('u1', 'p1', { name: 'N' });
    await service.remove('u1', 'p1');
    await service.removeTrack('u1', 'p1', 't1');
    expect(prisma.playlist.delete).toHaveBeenCalled();
  });

  it('erreurs ownership / titre / pagination cursor', async () => {
    prisma.playlist.findUnique.mockResolvedValue(null);
    await expect(service.get('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.playlist.findUnique.mockResolvedValue({ id: 'p1', userId: 'other' });
    await expect(service.get('u1', 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.playlist.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.addTrack('u1', 'p1', { trackId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.playlist.findMany.mockResolvedValue([
      { id: '1', _count: { tracks: 0 } },
      { id: '2', _count: { tracks: 0 } },
      { id: '3', _count: { tracks: 0 } },
    ]);
    const page = await service.listMine('u1', 'cur', 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
  });
});
