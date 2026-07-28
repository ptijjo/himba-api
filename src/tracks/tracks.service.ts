import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Track, UserRole } from '../generated/prisma/client';
import { ArtistsService } from '../artists/artists.service';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateTrackDto } from './dto/create-track.dto';
import { UpdateTrackDto } from './dto/update-track.dto';

export type TrackAccessActor = { id: string; role: UserRole };

@Injectable()
export class TracksService {
  private readonly priceMin: number;
  private readonly priceMax: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly artistsService: ArtistsService,
    private readonly configService: ConfigService,
  ) {
    this.priceMin = Number(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MIN_CENTS'),
    );
    this.priceMax = Number(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MAX_CENTS'),
    );
  }

  async create(
    actor: TrackAccessActor,
    dto: CreateTrackDto,
    audio: Express.Multer.File,
    cover?: Express.Multer.File,
  ): Promise<Track> {
    const artist = await this.requireArtistProfile(actor);
    this.assertPrice(dto.priceCents);
    if (!audio) {
      throw new BadRequestException('Fichier audio AAC/M4A requis');
    }

    const uploadedAudio = await this.storage.uploadAudio(
      audio,
      `tracks/${artist.id}`,
    );
    let coverUrl: string | undefined;
    if (cover) {
      const uploadedCover = await this.storage.uploadImage(
        cover,
        'cover',
        `tracks/${artist.id}/covers`,
      );
      coverUrl =
        uploadedCover.publicUrl ?? `r2://${uploadedCover.objectKey}`;
    }

    return this.prisma.track.create({
      data: {
        artistId: artist.id,
        title: dto.title.trim(),
        genre: dto.genre,
        priceCents: dto.priceCents ?? null,
        audioObjectKey: uploadedAudio.objectKey,
        coverUrl,
        durationMs: dto.durationMs,
      },
    });
  }

  async list(cursor?: string, limit?: number) {
    const take = parseLimit(limit);
    const tracks = await this.prisma.track.findMany({
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { artist: { select: { id: true, displayName: true } } },
    });
    const hasMore = tracks.length > take;
    const items = hasMore ? tracks.slice(0, take) : tracks;
    return {
      items: items.map((t) => this.toPublicTrack(t)),
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  async findById(id: string) {
    const track = await this.prisma.track.findUnique({
      where: { id },
      include: { artist: { select: { id: true, displayName: true } } },
    });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    return this.toPublicTrack(track);
  }

  async update(
    trackId: string,
    actor: TrackAccessActor,
    dto: UpdateTrackDto,
  ): Promise<Track> {
    const track = await this.requireTrack(trackId);
    await this.assertTrackOwner(track, actor);
    if (dto.priceCents !== undefined) {
      this.assertPrice(dto.priceCents);
    }
    return this.prisma.track.update({
      where: { id: trackId },
      data: {
        title: dto.title?.trim(),
        genre: dto.genre,
        priceCents: dto.priceCents === undefined ? undefined : dto.priceCents,
        durationMs: dto.durationMs,
      },
    });
  }

  async remove(trackId: string, actor: TrackAccessActor): Promise<void> {
    const track = await this.requireTrack(trackId);
    await this.assertTrackOwner(track, actor);
    await this.prisma.track.delete({ where: { id: trackId } });
  }

  async getStreamUrl(
    trackId: string,
    userId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const track = await this.requireTrack(trackId);
    await this.assertCanStream(track, userId);
    const url = await this.storage.getSignedUrl(track.audioObjectKey);
    return {
      url,
      expiresInSeconds: Number(
        this.configService.get('SIGNED_URL_TTL_SECONDS', 300),
      ),
    };
  }

  async getDownloadUrl(
    trackId: string,
    userId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const track = await this.requireTrack(trackId);
    // Gratuit : download OK ; payant : Purchase requis
    await this.assertCanDownload(track, userId);
    const url = await this.storage.getSignedUrl(track.audioObjectKey);
    return {
      url,
      expiresInSeconds: Number(
        this.configService.get('SIGNED_URL_TTL_SECONDS', 300),
      ),
    };
  }

  private async assertCanStream(track: Track, userId: string): Promise<void> {
    if (track.priceCents === null) {
      return;
    }
    const purchase = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId: track.id } },
    });
    if (!purchase) {
      throw new ForbiddenException('Achat requis pour streamer ce titre');
    }
  }

  private async assertCanDownload(track: Track, userId: string): Promise<void> {
    if (track.priceCents === null) {
      return;
    }
    const purchase = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId: track.id } },
    });
    if (!purchase) {
      throw new ForbiddenException('Achat requis pour télécharger ce titre');
    }
  }

  private assertPrice(priceCents: number | null | undefined): void {
    if (priceCents === null || priceCents === undefined) {
      return;
    }
    if (
      !Number.isInteger(priceCents) ||
      priceCents < this.priceMin ||
      priceCents > this.priceMax
    ) {
      throw new BadRequestException(
        `Prix hors fourchette [${this.priceMin}, ${this.priceMax}] centimes`,
      );
    }
  }

  private async requireTrack(id: string): Promise<Track> {
    const track = await this.prisma.track.findUnique({ where: { id } });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    return track;
  }

  private async requireArtistProfile(actor: TrackAccessActor) {
    if (actor.role !== UserRole.ARTIST && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Rôle artiste requis');
    }
    const artist = await this.artistsService.findByUserId(actor.id);
    if (!artist) {
      throw new ForbiddenException('Profil artiste requis');
    }
    return artist;
  }

  private async assertTrackOwner(
    track: Track,
    actor: TrackAccessActor,
  ): Promise<void> {
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    const artist = await this.artistsService.findByUserId(actor.id);
    if (!artist || artist.id !== track.artistId) {
      throw new ForbiddenException('Titre non propriétaire');
    }
  }

  private toPublicTrack<T extends Track>(track: T) {
    const { audioObjectKey: _key, ...rest } = track;
    return rest;
  }
}
