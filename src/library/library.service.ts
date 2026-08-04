import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async follow(userId: string, artistId: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id: artistId },
      select: { id: true, userId: true },
    });
    if (!artist) {
      throw new NotFoundException('Artiste introuvable');
    }
    try {
      const follow = await this.prisma.follow.create({
        data: { followerId: userId, artistId },
      });

      // Notif artiste : « @user a commencé à te suivre » (async, non bloquant)
      void this.notifyFollowAsync(userId, artist);

      return follow;
    } catch {
      throw new ConflictException('Déjà abonné à cet artiste');
    }
  }

  private async notifyFollowAsync(
    followerId: string,
    artist: { id: string; userId: string },
  ): Promise<void> {
    try {
      const follower = await this.prisma.user.findUnique({
        where: { id: followerId },
        select: { username: true },
      });
      if (!follower) {
        return;
      }
      await this.notifications.notifyNewFollower({
        artistUserId: artist.userId,
        artistId: artist.id,
        followerId,
        followerUsername: follower.username,
      });
    } catch {
      // Ne jamais faire échouer le follow pour une notif
    }
  }

  async unfollow(userId: string, artistId: string): Promise<void> {
    await this.prisma.follow.delete({
      where: {
        followerId_artistId: { followerId: userId, artistId },
      },
    });
  }

  listFollowing(userId: string) {
    // Photo de profil = User.avatarUrl (pas cover album / titre / artiste)
    return this.prisma.follow
      .findMany({
        where: { followerId: userId },
        include: {
          artist: {
            select: {
              id: true,
              displayName: true,
              coverUrl: true,
              user: { select: { avatarUrl: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((items) =>
        items.map((follow) => ({
          ...follow,
          artist: follow.artist
            ? {
                id: follow.artist.id,
                displayName: follow.artist.displayName,
                coverUrl: this.storage.resolvePublicUrl(
                  follow.artist.coverUrl,
                ),
                avatarUrl: this.storage.resolvePublicUrl(
                  follow.artist.user.avatarUrl,
                ),
              }
            : undefined,
        })),
      );
  }

  async favorite(userId: string, trackId: string) {
    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    try {
      return await this.prisma.favorite.create({
        data: { userId, trackId },
      });
    } catch {
      throw new ConflictException('Titre déjà en favoris');
    }
  }

  async unfavorite(userId: string, trackId: string): Promise<void> {
    await this.prisma.favorite.delete({
      where: { userId_trackId: { userId, trackId } },
    });
  }

  listFavorites(userId: string) {
    return this.prisma.favorite
      .findMany({
        where: { userId },
        include: {
          track: {
            select: {
              id: true,
              title: true,
              genre: true,
              price: true,
              coverUrl: true,
              artistId: true,
              artist: { select: { id: true, displayName: true } },
              durationMs: true,
              album: { select: { coverUrl: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((items) =>
        items.map((fav) => ({
          ...fav,
          track: fav.track
            ? {
                id: fav.track.id,
                title: fav.track.title,
                genre: fav.track.genre,
                price: fav.track.price,
                artistId: fav.track.artistId,
                artist: fav.track.artist
                  ? {
                      id: fav.track.artist.id,
                      displayName: fav.track.artist.displayName,
                    }
                  : undefined,
                durationMs: fav.track.durationMs,
                coverUrl:
                  fav.track.coverUrl ?? fav.track.album?.coverUrl ?? null,
              }
            : undefined,
        })),
      );
  }

  async favoriteAlbum(userId: string, albumId: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }
    try {
      return await this.prisma.albumFavorite.create({
        data: { userId, albumId },
      });
    } catch {
      throw new ConflictException('Album déjà en favoris');
    }
  }

  async unfavoriteAlbum(userId: string, albumId: string): Promise<void> {
    await this.prisma.albumFavorite.delete({
      where: { userId_albumId: { userId, albumId } },
    });
  }

  listAlbumFavorites(userId: string) {
    return this.prisma.albumFavorite
      .findMany({
        where: { userId },
        include: {
          album: {
            select: {
              id: true,
              title: true,
              coverUrl: true,
              artistId: true,
              artist: { select: { id: true, displayName: true } },
              _count: { select: { tracks: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((items) =>
        items.map((fav) => ({
          ...fav,
          album: fav.album
            ? {
                id: fav.album.id,
                title: fav.album.title,
                artistId: fav.album.artistId,
                coverUrl: this.storage.resolvePublicUrl(fav.album.coverUrl),
                artist: fav.album.artist,
                _count: fav.album._count,
              }
            : undefined,
        })),
      );
  }
}
