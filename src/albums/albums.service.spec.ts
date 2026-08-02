import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../generated/prisma/client';
import { ArtistsService } from '../artists/artists.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockStorageService,
  mockStorageServiceProvider,
  MockStorageService,
} from '../test/mocks/storage.mock';
import { RatingsService } from '../ratings/ratings.service';
import { AlbumsService } from './albums.service';

describe('AlbumsService', () => {
  let service: AlbumsService;
  let prisma: MockPrismaService;
  let storage: MockStorageService;
  let artistsService: { findByUserId: jest.Mock };
  let ratingsService: { getSummary: jest.Mock };

  const emptySummary = { average: null, count: 0, myValue: null };

  const artist = {
    id: 'artist-1',
    userId: 'user-1',
    displayName: 'Alice',
  };

  const album = {
    id: 'alb-1',
    artistId: 'artist-1',
    title: 'First LP',
    description: null,
    coverUrl: 'https://cdn.himba.test/albums/x.webp',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const coverFile = {
    buffer: Buffer.from('img'),
    mimetype: 'image/jpeg',
    originalname: 'c.jpg',
    size: 10,
  } as Express.Multer.File;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    artistsService = {
      findByUserId: jest.fn().mockResolvedValue(artist),
    };
    ratingsService = {
      getSummary: jest.fn().mockResolvedValue(emptySummary),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlbumsService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        mockConfigServiceProvider(),
        { provide: ArtistsService, useValue: artistsService },
        {
          provide: NotificationsService,
          useValue: { notifyArtistFollowers: jest.fn() },
        },
        { provide: RatingsService, useValue: ratingsService },
      ],
    }).compile();
    service = module.get(AlbumsService);
  });

  it('create album pour artiste', async () => {
    prisma.album.create.mockResolvedValue(album);
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'First LP' },
        coverFile,
      ),
    ).resolves.toMatchObject({ title: 'First LP' });
    expect(storage.uploadImage).toHaveBeenCalled();
  });

  it('create refuse sans cover', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'First LP' },
        undefined as unknown as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create refuse listener', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.LISTENER },
        { title: 'X' },
        coverFile,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('addTracks rattache N titres du même artiste', async () => {
    prisma.album.findUnique.mockResolvedValue(album);
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([
      { id: 't1', artistId: 'artist-1', albumId: null },
      { id: 't2', artistId: 'artist-1', albumId: null },
    ]);
    prisma.track.update.mockResolvedValue({});

    await expect(
      service.addTracks(
        'alb-1',
        { id: 'user-1', role: UserRole.ARTIST },
        { trackIds: ['t1', 't2'] },
      ),
    ).resolves.toMatchObject({ added: 2 });

    expect(prisma.track.update).toHaveBeenCalledTimes(2);
  });

  it('addTracks refuse titre d’un autre artiste', async () => {
    prisma.album.findUnique.mockResolvedValue(album);
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([
      { id: 't1', artistId: 'other', albumId: null },
    ]);

    await expect(
      service.addTracks(
        'alb-1',
        { id: 'user-1', role: UserRole.ARTIST },
        { trackIds: ['t1'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('addTracks refuse dépassement ALBUM_TRACKS_MAX', async () => {
    prisma.album.findUnique.mockResolvedValue(album);
    prisma.track.count.mockResolvedValue(99);
    prisma.track.findMany.mockResolvedValue([
      { id: 't1', artistId: 'artist-1', albumId: null },
      { id: 't2', artistId: 'artist-1', albumId: null },
    ]);

    await expect(
      service.addTracks(
        'alb-1',
        { id: 'user-1', role: UserRole.ARTIST },
        { trackIds: ['t1', 't2'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removeTrack détache le titre', async () => {
    prisma.album.findUnique.mockResolvedValue(album);
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      albumId: 'alb-1',
      artistId: 'artist-1',
    });
    prisma.track.update.mockResolvedValue({});

    await expect(
      service.removeTrack('alb-1', 't1', {
        id: 'user-1',
        role: UserRole.ARTIST,
      }),
    ).resolves.toBeUndefined();
  });

  it('findById introuvable', async () => {
    prisma.album.findUnique.mockResolvedValue(null);
    await expect(service.findById('missing', 'viewer-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update / remove propriétaire + cover fallback', async () => {
    prisma.album.findUnique.mockResolvedValue(album);
    storage.uploadImage.mockResolvedValue({
      objectKey: 'albums/x.webp',
      publicUrl: null,
    });
    prisma.album.update.mockResolvedValue({
      ...album,
      title: 'New',
      coverUrl: 'r2://albums/x.webp',
    });
    prisma.album.delete.mockResolvedValue(album);

    await expect(
      service.update(
        'alb-1',
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'New' },
        {
          buffer: Buffer.from('img'),
          mimetype: 'image/jpeg',
          originalname: 'c.jpg',
          size: 10,
        } as Express.Multer.File,
      ),
    ).resolves.toMatchObject({ coverUrl: 'r2://albums/x.webp' });

    await expect(
      service.remove('alb-1', { id: 'user-1', role: UserRole.ARTIST }),
    ).resolves.toBeUndefined();
  });

  it('create refuse prix hors fourchette', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'LP', price: 0.01 },
        coverFile,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list pagine + filtre artistId', async () => {
    prisma.album.findMany.mockResolvedValue([
      { ...album, id: '1' },
      { ...album, id: '2' },
      { ...album, id: '3' },
    ]);
    const page = await service.list('artist-1', undefined, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
  });
});
