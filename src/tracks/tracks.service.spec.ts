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
import { TracksService } from './tracks.service';

describe('TracksService', () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let storage: MockStorageService;
  let artistsService: { findByUserId: jest.Mock };

  const artist = {
    id: 'artist-1',
    userId: 'user-1',
    displayName: 'Alice',
    bio: null,
    coverUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const freeTrack = {
    id: 't-free',
    artistId: 'artist-1',
    title: 'Free',
    genre: 'AFRO',
    price: null,
    audioObjectKey: 'audio/free.m4a',
    coverUrl: null,
    durationMs: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const paidTrack = {
    ...freeTrack,
    id: 't-paid',
    title: 'Paid',
    price: 1.99,
    audioObjectKey: 'audio/paid.m4a',
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    artistsService = {
      findByUserId: jest.fn().mockResolvedValue(artist),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        mockConfigServiceProvider(),
        { provide: ArtistsService, useValue: artistsService },
        {
          provide: NotificationsService,
          useValue: { notifyArtistFollowers: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(TracksService);
  });

  it('create refuse un prix hors fourchette', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'X', genre: 'RAP', price: 0.01 },
        {
          buffer: Buffer.from('a'),
          mimetype: 'audio/mp4',
          originalname: 'a.m4a',
          size: 1,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stream gratuit OK', async () => {
    prisma.track.findUnique.mockResolvedValue(freeTrack);

    await expect(service.getStreamUrl('t-free', 'u2')).resolves.toMatchObject({
      url: 'https://signed.example/audio.m4a',
    });
  });

  it('stream payant sans Purchase → 403', async () => {
    prisma.track.findUnique.mockResolvedValue(paidTrack);
    prisma.purchase.findUnique.mockResolvedValue(null);
    prisma.albumPurchase.findUnique.mockResolvedValue(null);

    await expect(service.getStreamUrl('t-paid', 'u2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('stream payant avec Purchase OK', async () => {
    prisma.track.findUnique.mockResolvedValue(paidTrack);
    prisma.purchase.findUnique.mockResolvedValue({ id: 'p1' });

    await expect(service.getStreamUrl('t-paid', 'u2')).resolves.toMatchObject({
      url: expect.any(String),
    });
  });

  it('download payant sans Purchase → 403', async () => {
    prisma.track.findUnique.mockResolvedValue(paidTrack);
    prisma.purchase.findUnique.mockResolvedValue(null);
    prisma.albumPurchase.findUnique.mockResolvedValue(null);

    await expect(
      service.getDownloadUrl('t-paid', 'u2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stream payant avec AlbumPurchase OK', async () => {
    const albumTrack = { ...paidTrack, albumId: 'alb-1' };
    prisma.track.findUnique.mockResolvedValue(albumTrack);
    prisma.purchase.findUnique.mockResolvedValue(null);
    prisma.albumPurchase.findUnique.mockResolvedValue({ id: 'ap1' });

    await expect(service.getStreamUrl('t-paid', 'u2')).resolves.toMatchObject({
      url: expect.any(String),
    });
  });

  it('create titre gratuit OK', async () => {
    prisma.track.create.mockResolvedValue({
      ...freeTrack,
      coverUrl: 'https://cdn.himba.test/covers/x.webp',
    });
    const audio = {
      buffer: Buffer.from('a'),
      mimetype: 'audio/mp4',
      originalname: 'a.m4a',
      size: 1,
    } as Express.Multer.File;
    const cover = {
      buffer: Buffer.from('img'),
      mimetype: 'image/jpeg',
      originalname: 'c.jpg',
      size: 10,
    } as Express.Multer.File;

    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'Free', genre: 'AFRO', price: null },
        audio,
        cover,
      ),
    ).resolves.toMatchObject({ title: 'Free', price: null });

    const created = await service.create(
      { id: 'user-1', role: UserRole.ARTIST },
      { title: 'Free', genre: 'AFRO', price: null },
      audio,
      cover,
    );
    expect(created).not.toHaveProperty('audioObjectKey');
  });

  it('create single sans cover → 400', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'Single', genre: 'RAP' },
        {
          buffer: Buffer.from('a'),
          mimetype: 'audio/mp4',
          originalname: 'a.m4a',
          size: 1,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadAudio).not.toHaveBeenCalled();
  });

  it('update / remove propriétaire OK', async () => {
    prisma.track.findUnique.mockResolvedValue(freeTrack);
    prisma.track.update.mockResolvedValue({ ...freeTrack, title: 'New' });
    prisma.track.delete.mockResolvedValue(freeTrack);

    await expect(
      service.update(
        't-free',
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'New' },
      ),
    ).resolves.toMatchObject({ title: 'New' });

    await expect(
      service.remove('t-free', { id: 'user-1', role: UserRole.ARTIST }),
    ).resolves.toBeUndefined();
  });

  it('list pagine avec nextCursor', async () => {
    prisma.track.findMany.mockResolvedValue([
      { ...freeTrack, id: '1', artist: { id: 'a', displayName: 'A' } },
      { ...freeTrack, id: '2', artist: { id: 'a', displayName: 'A' } },
      { ...freeTrack, id: '3', artist: { id: 'a', displayName: 'A' } },
    ]);
    const page = await service.list(undefined, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
    expect(page.items[0]).not.toHaveProperty('audioObjectKey');
  });

  it('list filtre par genre + artistId + listGenres', async () => {
    prisma.track.findMany.mockResolvedValue([]);
    await service.list(undefined, 20, 'SHATTA');
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { genre: 'SHATTA' } }),
    );
    await service.list(undefined, 20, undefined, 'artist-1');
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artistId: 'artist-1' } }),
    );
    expect(service.listGenres()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'RAP', label: 'Rap' }),
        expect.objectContaining({ id: 'AFRO' }),
        expect.objectContaining({ id: 'ZOUK' }),
        expect.objectContaining({ id: 'SHATTA' }),
      ]),
    );
  });

  it('list sans page suivante', async () => {
    prisma.track.findMany.mockResolvedValue([
      { ...freeTrack, id: '1', artist: { id: 'a', displayName: 'A' } },
    ]);
    const page = await service.list('cur', 20);
    expect(page.nextCursor).toBeNull();
  });

  it('create refuse audio manquant et rôle listener', async () => {
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'X', genre: 'RAP' },
        undefined as unknown as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(
        { id: 'user-1', role: UserRole.LISTENER },
        { title: 'X', genre: 'RAP' },
        {
          buffer: Buffer.from('a'),
          mimetype: 'audio/mp4',
          originalname: 'a.m4a',
          size: 1,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('create sur album hérite de la cover album', async () => {
    prisma.album.findUnique.mockResolvedValue({
      id: 'alb-1',
      artistId: 'artist-1',
      coverUrl: 'https://cdn.himba.test/albums/cover.webp',
    });
    prisma.track.count.mockResolvedValue(0);
    prisma.track.create.mockResolvedValue({
      ...freeTrack,
      albumId: 'alb-1',
      coverUrl: 'https://cdn.himba.test/albums/cover.webp',
      album: { coverUrl: 'https://cdn.himba.test/albums/cover.webp' },
      artist: { id: 'artist-1', displayName: 'Alice' },
    });

    const created = await service.create(
      { id: 'user-1', role: UserRole.ARTIST },
      { title: 'Free', genre: 'AFRO', albumId: 'alb-1' },
      {
        buffer: Buffer.from('a'),
        mimetype: 'audio/mp4',
        originalname: 'a.m4a',
        size: 1,
      } as Express.Multer.File,
    );

    expect(prisma.track.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          albumId: 'alb-1',
          coverUrl: 'https://cdn.himba.test/albums/cover.webp',
        }),
      }),
    );
    expect(created.coverUrl).toBe(
      'https://cdn.himba.test/albums/cover.webp',
    );
    expect(created).not.toHaveProperty('album');
  });

  it('findById fallback cover album si titre sans cover', async () => {
    prisma.track.findUnique.mockResolvedValue({
      ...freeTrack,
      albumId: 'alb-1',
      coverUrl: null,
      artist: { id: 'a', displayName: 'A' },
      album: { coverUrl: 'https://cdn.himba.test/albums/x.webp' },
    });
    await expect(service.findById('t-free')).resolves.toMatchObject({
      coverUrl: 'https://cdn.himba.test/albums/x.webp',
    });
  });

  it('create refuse sans profil artiste + upload cover sans publicUrl', async () => {
    artistsService.findByUserId.mockResolvedValue(null);
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'X', genre: 'SHATTA' },
        {
          buffer: Buffer.from('a'),
          mimetype: 'audio/mp4',
          originalname: 'a.m4a',
          size: 1,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    artistsService.findByUserId.mockResolvedValue(artist);
    storage.uploadImage.mockResolvedValue({
      objectKey: 'covers/x.webp',
      publicUrl: null,
    });
    prisma.track.create.mockResolvedValue(freeTrack);
    await expect(
      service.create(
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'Free', genre: 'ZOUK', price: 1.99 },
        {
          buffer: Buffer.from('a'),
          mimetype: 'audio/mp4',
          originalname: 'a.m4a',
          size: 1,
        } as Express.Multer.File,
        {
          buffer: Buffer.from('img'),
          mimetype: 'image/jpeg',
          originalname: 'c.jpg',
          size: 10,
        } as Express.Multer.File,
      ),
    ).resolves.toBeDefined();
    expect(prisma.track.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverUrl: 'r2://covers/x.webp' }),
      }),
    );
  });

  it('findById / update prix / download gratuit / admin owner', async () => {
    prisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.track.findUnique.mockResolvedValue({
      ...freeTrack,
      artist: { id: 'a', displayName: 'A' },
    });
    await expect(service.findById('t-free')).resolves.not.toHaveProperty(
      'audioObjectKey',
    );

    prisma.track.findUnique.mockResolvedValue(freeTrack);
    prisma.track.update.mockResolvedValue(freeTrack);
    await service.update(
      't-free',
      { id: 'admin', role: UserRole.ADMIN },
      { price: 2.50 },
    );

    prisma.track.findUnique.mockResolvedValue(freeTrack);
    await expect(service.getDownloadUrl('t-free', 'u2')).resolves.toMatchObject(
      { url: expect.any(String) },
    );

    prisma.track.findUnique.mockResolvedValue(paidTrack);
    prisma.purchase.findUnique.mockResolvedValue({ id: 'p1' });
    await expect(service.getDownloadUrl('t-paid', 'u2')).resolves.toMatchObject(
      { url: expect.any(String) },
    );

    artistsService.findByUserId.mockResolvedValue({
      ...artist,
      id: 'other-artist',
    });
    prisma.track.findUnique.mockResolvedValue(freeTrack);
    await expect(
      service.update(
        't-free',
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'Hack' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update refuse titre introuvable', async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.update(
        'missing',
        { id: 'user-1', role: UserRole.ARTIST },
        { title: 'X' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
