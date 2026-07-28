import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertRatingDto } from './dto/upsert-rating.dto';

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, dto: UpsertRatingDto) {
    const hasTrack = Boolean(dto.trackId);
    const hasArtist = Boolean(dto.artistId);
    if (hasTrack === hasArtist) {
      throw new BadRequestException(
        'Indiquer exactement une cible : trackId ou artistId',
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

    const artist = await this.prisma.artist.findUnique({
      where: { id: dto.artistId! },
    });
    if (!artist) {
      throw new NotFoundException('Artiste introuvable');
    }
    return this.prisma.rating.upsert({
      where: {
        userId_artistId: { userId, artistId: dto.artistId! },
      },
      create: { userId, artistId: dto.artistId, value: dto.value },
      update: { value: dto.value },
    });
  }
}
