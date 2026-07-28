import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        artist: {
          select: { id: true, displayName: true, coverUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    return this.prisma.favorite.findMany({
      where: { userId },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            genre: true,
            priceCents: true,
            coverUrl: true,
            artistId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
