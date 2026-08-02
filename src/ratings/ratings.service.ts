import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertRatingDto } from './dto/upsert-rating.dto';

/** Agrégat exposé sur GET track / artist / album. */
export type RatingSummary = {
  average: number | null;
  count: number;
  myValue: number | null;
};

export type RatingTarget =
  | { trackId: string }
  | { artistId: string }
  | { albumId: string };

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, dto: UpsertRatingDto) {
    const targets = [dto.trackId, dto.artistId, dto.albumId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Indiquer exactement une cible : trackId, artistId ou albumId',
      );
    }
    if (dto.value < 1 || dto.value > 5) {
      throw new BadRequestException('Note entre 1 et 5');
    }

    if (dto.trackId) {
      const track = await this.prisma.track.findUnique({
        where: { id: dto.trackId },
      });
      if (!track) {
        throw new NotFoundException('Titre introuvable');
      }
      return this.prisma.rating.upsert({
        where: {
          userId_trackId: { userId, trackId: dto.trackId },
        },
        create: { userId, trackId: dto.trackId, value: dto.value },
        update: { value: dto.value },
      });
    }

    if (dto.artistId) {
      const artist = await this.prisma.artist.findUnique({
        where: { id: dto.artistId },
      });
      if (!artist) {
        throw new NotFoundException('Artiste introuvable');
      }
      return this.prisma.rating.upsert({
        where: {
          userId_artistId: { userId, artistId: dto.artistId },
        },
        create: { userId, artistId: dto.artistId, value: dto.value },
        update: { value: dto.value },
      });
    }

    const album = await this.prisma.album.findUnique({
      where: { id: dto.albumId! },
    });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }
    return this.prisma.rating.upsert({
      where: {
        userId_albumId: { userId, albumId: dto.albumId! },
      },
      create: { userId, albumId: dto.albumId, value: dto.value },
      update: { value: dto.value },
    });
  }

  /**
   * Moyenne (1 décimale) + count + note de l’utilisateur courant.
   * 0 vote → average null.
   */
  async getSummary(
    target: RatingTarget,
    userId: string,
  ): Promise<RatingSummary> {
    const where = this.toWhere(target);

    const [aggregate, mine] = await Promise.all([
      this.prisma.rating.aggregate({
        where,
        _avg: { value: true },
        _count: { _all: true },
      }),
      this.prisma.rating.findFirst({
        where: { ...where, userId },
        select: { value: true },
      }),
    ]);

    const count = aggregate._count._all;
    const rawAvg = aggregate._avg.value;
    const average =
      count === 0 || rawAvg == null
        ? null
        : Math.round(rawAvg * 10) / 10;

    return {
      average,
      count,
      myValue: mine?.value ?? null,
    };
  }

  private toWhere(target: RatingTarget): Prisma.RatingWhereInput {
    if ('trackId' in target) {
      return { trackId: target.trackId };
    }
    if ('artistId' in target) {
      return { artistId: target.artistId };
    }
    return { albumId: target.albumId };
  }
}
