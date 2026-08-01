import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '../generated/prisma/client';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: MockPrismaService;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService, mockPrismaServiceProvider(prisma)],
    }).compile();
    service = module.get(NotificationsService);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('upsertPushToken délègue à Prisma', async () => {
    prisma.devicePushToken.upsert.mockResolvedValue({
      id: 'd1',
      token: 'ExponentPushToken[abc]',
    });
    await expect(
      service.upsertPushToken('u1', 'ExponentPushToken[abc]', 'android'),
    ).resolves.toMatchObject({ id: 'd1' });
    expect(prisma.devicePushToken.upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]' },
      create: {
        userId: 'u1',
        token: 'ExponentPushToken[abc]',
        platform: 'android',
      },
      update: { userId: 'u1', platform: 'android' },
    });
  });

  it('listMine pagine', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: '1' },
      { id: '2' },
      { id: '3' },
    ]);
    const page = await service.listMine('u1', undefined, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
  });

  it('markRead refuse une notif d’autrui', async () => {
    prisma.notification.findUnique.mockResolvedValue({
      id: 'n1',
      userId: 'other',
    });
    await expect(service.markRead('u1', 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('markRead met à jour si non lue', async () => {
    prisma.notification.findUnique.mockResolvedValue({
      id: 'n1',
      userId: 'u1',
      readAt: null,
    });
    prisma.notification.update.mockResolvedValue({
      id: 'n1',
      readAt: new Date(),
    });
    await expect(service.markRead('u1', 'n1')).resolves.toMatchObject({
      id: 'n1',
    });
  });

  it('notifyArtistFollowers crée notifs + push Expo', async () => {
    prisma.follow.findMany.mockResolvedValue([
      { followerId: 'u1' },
      { followerId: 'u2' },
    ]);
    prisma.notification.createMany.mockResolvedValue({ count: 2 });
    prisma.devicePushToken.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ]);

    await service.notifyArtistFollowers('artist-1', {
      type: NotificationType.TRACK_RELEASE,
      title: 'Soriba',
      body: 'Nouveau titre',
      data: { artistId: 'artist-1', trackId: 't1' },
    });

    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('notifyArtistFollowers no-op sans followers', async () => {
    prisma.follow.findMany.mockResolvedValue([]);
    await service.notifyArtistFollowers('artist-1', {
      type: NotificationType.ALBUM_RELEASE,
      title: 'X',
      body: 'Y',
      data: { artistId: 'artist-1', albumId: 'a1' },
    });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('notifyNewFollower crée notif + push pour l’artiste', async () => {
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
    prisma.devicePushToken.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
    ]);

    await service.notifyNewFollower({
      artistUserId: 'artist-user',
      artistId: 'artist-1',
      followerId: 'u2',
      followerUsername: 'marie',
    });

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'artist-user',
          type: NotificationType.NEW_FOLLOWER,
          title: 'Nouveau follower',
          body: 'marie a commencé à te suivre',
        }),
      ],
    });
    expect(global.fetch).toHaveBeenCalled();
  });

  it('notifyNewFollower ignore auto-follow', async () => {
    await service.notifyNewFollower({
      artistUserId: 'u1',
      artistId: 'artist-1',
      followerId: 'u1',
      followerUsername: 'moi',
    });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('markAllRead + deletePushToken', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 3 });

    prisma.devicePushToken.deleteMany.mockResolvedValue({ count: 1 });
    await expect(
      service.deletePushToken('u1', 'ExponentPushToken[x]'),
    ).resolves.toBeUndefined();
  });
});
