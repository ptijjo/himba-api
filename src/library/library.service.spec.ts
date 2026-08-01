import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockStorageService,
  mockStorageServiceProvider,
} from '../test/mocks/storage.mock';
import { LibraryService } from './library.service';

describe('LibraryService', () => {
  let service: LibraryService;
  let prisma: MockPrismaService;
  const notifications = {
    notifyNewFollower: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications.notifyNewFollower.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(createMockStorageService()),
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(LibraryService);
  });

  it('follow artiste existant', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1', userId: 'artist-u' });
    prisma.follow.create.mockResolvedValue({ id: 'f1' });
    prisma.user.findUnique.mockResolvedValue({ username: 'marie' });
    await expect(service.follow('u1', 'a1')).resolves.toMatchObject({
      id: 'f1',
    });
    // Laisse la microtask notif se déclencher
    await Promise.resolve();
    expect(notifications.notifyNewFollower).toHaveBeenCalledWith({
      artistUserId: 'artist-u',
      artistId: 'a1',
      followerId: 'u1',
      followerUsername: 'marie',
    });
  });

  it('follow artiste inconnu → 404', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(service.follow('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('favorite titre existant', async () => {
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.favorite.create.mockResolvedValue({ id: 'fav1' });
    await expect(service.favorite('u1', 't1')).resolves.toMatchObject({
      id: 'fav1',
    });
  });

  it('unfollow / unfavorite / listes', async () => {
    prisma.follow.delete.mockResolvedValue({});
    prisma.favorite.delete.mockResolvedValue({});
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.favorite.findMany.mockResolvedValue([]);
    await service.unfollow('u1', 'a1');
    await service.unfavorite('u1', 't1');
    await service.listFollowing('u1');
    await service.listFavorites('u1');
    expect(prisma.follow.delete).toHaveBeenCalled();
    expect(prisma.favorite.findMany).toHaveBeenCalled();
  });

  it('follow / favorite conflits et titre manquant', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1', userId: 'au' });
    prisma.follow.create.mockRejectedValue(new Error('unique'));
    await expect(service.follow('u1', 'a1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifications.notifyNewFollower).not.toHaveBeenCalled();

    prisma.track.findUnique.mockResolvedValue(null);
    await expect(service.favorite('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.favorite.create.mockRejectedValue(new Error('unique'));
    await expect(service.favorite('u1', 't1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('favoriteAlbum album existant', async () => {
    prisma.album.findUnique.mockResolvedValue({ id: 'alb1' });
    prisma.albumFavorite.create.mockResolvedValue({ id: 'af1' });
    await expect(service.favoriteAlbum('u1', 'alb1')).resolves.toMatchObject({
      id: 'af1',
    });
  });

  it('favoriteAlbum inconnu / conflit + listes', async () => {
    prisma.album.findUnique.mockResolvedValue(null);
    await expect(
      service.favoriteAlbum('u1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.album.findUnique.mockResolvedValue({ id: 'alb1' });
    prisma.albumFavorite.create.mockRejectedValue(new Error('unique'));
    await expect(service.favoriteAlbum('u1', 'alb1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.albumFavorite.delete.mockResolvedValue({});
    prisma.albumFavorite.findMany.mockResolvedValue([]);
    await service.unfavoriteAlbum('u1', 'alb1');
    await service.listAlbumFavorites('u1');
    expect(prisma.albumFavorite.delete).toHaveBeenCalled();
    expect(prisma.albumFavorite.findMany).toHaveBeenCalled();
  });
});
