import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Track, TrackGenre, UserRole, Prisma } from '../generated/prisma/client';
import { ArtistsService } from '../artists/artists.service';
import { assertMoneyInRange, money } from '../common/money/money';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateTrackDto } from './dto/create-track.dto';
import { UpdateTrackDto } from './dto/update-track.dto';
import { listTrackGenres } from './track-genres';

export type TrackAccessActor = { id: string; role: UserRole };

/** Réponse publique : pas de clé R2 ; prix en number euros (JSON-friendly). */
export type PublicTrack = Omit<Track, 'audioObjectKey' | 'price'> & {
  price: number | null;
};

/** Include Prisma — cover album pour fallback titre sans cover propre. */
const trackPublicInclude = {
  artist: { select: { id: true, displayName: true } },
  album: { select: { coverUrl: true } },
} as const;

@Injectable()
export class TracksService {
  private readonly priceMin: Prisma.Decimal;
  private readonly priceMax: Prisma.Decimal;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly artistsService: ArtistsService,
    private readonly configService: ConfigService,
  ) {
    this.priceMin = money(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MIN'),
    );
    this.priceMax = money(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MAX'),
    );
  }

  async create(
    actor: TrackAccessActor,
    dto: CreateTrackDto,
    audio: Express.Multer.File,
    cover?: Express.Multer.File,
  ): Promise<PublicTrack> {
    const artist = await this.requireArtistProfile(actor);
    this.assertPrice(dto.price);
    if (!audio) {
      throw new BadRequestException('Fichier audio M4A / AAC / MP3 requis');
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

    let albumId: string | undefined;
    let albumPosition: number | undefined;
    if (dto.albumId) {
      // 1. Vérifier album du même artiste + plafond
      const album = await this.prisma.album.findUnique({
        where: { id: dto.albumId },
      });
      if (!album || album.artistId !== artist.id) {
        throw new ForbiddenException('Album introuvable ou non propriétaire');
      }
      const tracksMax = Number(
        this.configService.get<string | number>('ALBUM_TRACKS_MAX', 100),
      );
      const count = await this.prisma.track.count({
        where: { albumId: dto.albumId },
      });
      if (count >= tracksMax) {
        throw new BadRequestException(
          `Album plein : max ${tracksMax} titres (ALBUM_TRACKS_MAX)`,
        );
      }
      albumId = dto.albumId;
      albumPosition = count;
      // 2. Sans cover titre → hériter de la couverture album
      if (!coverUrl && album.coverUrl) {
        coverUrl = album.coverUrl;
      }
    }

    const created = await this.prisma.track.create({
      data: {
        artistId: artist.id,
        albumId,
        albumPosition,
        title: dto.title.trim(),
        genre: dto.genre,
        price: dto.price ?? null,
        audioObjectKey: uploadedAudio.objectKey,
        coverUrl,
        durationMs: dto.durationMs,
      },
      include: trackPublicInclude,
    });
    return this.toPublicTrack(created);
  }

  async list(
    cursor?: string,
    limit?: number,
    genre?: TrackGenre,
    artistId?: string,
  ) {
    const take = parseLimit(limit);
    const where: Prisma.TrackWhereInput = {};
    if (genre) {
      where.genre = genre;
    }
    if (artistId) {
      where.artistId = artistId;
    }
    const tracks = await this.prisma.track.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: trackPublicInclude,
    });
    const hasMore = tracks.length > take;
    const items = hasMore ? tracks.slice(0, take) : tracks;
    return {
      items: items.map((t) => this.toPublicTrack(t)),
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  listGenres() {
    return listTrackGenres();
  }

  async findById(id: string) {
    const track = await this.prisma.track.findUnique({
      where: { id },
      include: trackPublicInclude,
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
  ): Promise<PublicTrack> {
    const track = await this.requireTrack(trackId);
    await this.assertTrackOwner(track, actor);
    if (dto.price !== undefined) {
      this.assertPrice(dto.price);
    }
    const updated = await this.prisma.track.update({
      where: { id: trackId },
      data: {
        title: dto.title?.trim(),
        genre: dto.genre,
        price: dto.price === undefined ? undefined : dto.price,
        durationMs: dto.durationMs,
      },
      include: trackPublicInclude,
    });
    return this.toPublicTrack(updated);
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
    if (track.price === null) {
      return;
    }
    if (await this.userOwnsTrackAccess(userId, track)) {
      return;
    }
    throw new ForbiddenException('Achat requis pour streamer ce titre');
  }

  private async assertCanDownload(track: Track, userId: string): Promise<void> {
    if (track.price === null) {
      return;
    }
    if (await this.userOwnsTrackAccess(userId, track)) {
      return;
    }
    throw new ForbiddenException('Achat requis pour télécharger ce titre');
  }

  /** Accès payant : Purchase titre OU AlbumPurchase de l’album contenant le titre. */
  private async userOwnsTrackAccess(
    userId: string,
    track: Track,
  ): Promise<boolean> {
    const purchase = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId: track.id } },
    });
    if (purchase) {
      return true;
    }
    if (!track.albumId) {
      return false;
    }
    const albumPurchase = await this.prisma.albumPurchase.findUnique({
      where: { userId_albumId: { userId, albumId: track.albumId } },
    });
    return Boolean(albumPurchase);
  }

  private assertPrice(price: number | null | undefined): void {
    assertMoneyInRange(price, this.priceMin, this.priceMax);
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

  /**
   * Sérialise un titre pour le client.
   * coverUrl titre sinon couverture album (titres rattachés sans image propre).
   */
  private toPublicTrack<T extends Track>(
    track: T & {
      album?: { coverUrl: string | null } | null;
      artist?: { id: string; displayName: string };
    },
  ): PublicTrack & Omit<T, keyof Track | 'album'> {
    const { audioObjectKey: _key, price, album, ...rest } = track;
    const resolvedCover =
      rest.coverUrl ?? album?.coverUrl ?? null;
    return {
      ...rest,
      coverUrl: resolvedCover,
      // Decimal Prisma → number euros (JSON-friendly pour le client RTK/Zod)
      price: price == null ? null : Number(price),
    } as PublicTrack & Omit<T, keyof Track | 'album'>;
  }
}
