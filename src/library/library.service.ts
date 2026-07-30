import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async follow(userId: string, artistId: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id: artistId },
    });
    if (!artist) {
      throw new NotFoundException('Artiste introuvable');
    }
    try {
      return await this.prisma.follow.create({
        data: { followerId: userId, artistId },
      });
    } catch {
      throw new ConflictException('Déjà abonné à cet artiste');
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
                durationMs: fav.track.durationMs,
                coverUrl:
                  fav.track.coverUrl ?? fav.track.album?.coverUrl ?? null,
              }
            : undefined,
        })),
      );
  }
}
