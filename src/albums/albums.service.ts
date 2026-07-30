import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Album, NotificationType, UserRole, Prisma } from '../generated/prisma/client';
import { ArtistsService } from '../artists/artists.service';
import { assertMoneyInRange, money } from '../common/money/money';
import { parseLimit } from '../common/pagination/cursor.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  AddAlbumTracksDto,
  CreateAlbumDto,
  UpdateAlbumDto,
} from './dto/album.dto';

export type AlbumActor = { id: string; role: UserRole };

@Injectable()
export class AlbumsService {
  private readonly tracksMax: number;
  private readonly priceMin: Prisma.Decimal;
  private readonly priceMax: Prisma.Decimal;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly artistsService: ArtistsService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.tracksMax = Number(
      this.configService.get<string | number>('ALBUM_TRACKS_MAX', 100),
    );
    this.priceMin = money(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MIN'),
    );
    this.priceMax = money(
      this.configService.getOrThrow<string | number>('TRACK_PRICE_MAX'),
    );
  }

  async create(
    actor: AlbumActor,
    dto: CreateAlbumDto,
    cover: Express.Multer.File,
  ): Promise<Album> {
    const artist = await this.requireArtistProfile(actor);
    this.assertPrice(dto.price);
    // 1. Cover obligatoire pour l’album
    if (!cover?.buffer?.length) {
      throw new BadRequestException('Cover album requise');
    }
    const uploaded = await this.storage.uploadImage(
      cover,
      'cover',
      `albums/${artist.id}`,
    );
    const coverUrl = uploaded.publicUrl ?? `r2://${uploaded.objectKey}`;

    const album = await this.prisma.album.create({
      data: {
        artistId: artist.id,
        title: dto.title.trim(),
        description: dto.description,
        price: dto.price ?? null,
        coverUrl,
      },
    });
    void this.notificationsService.notifyArtistFollowers(artist.id, {
      type: NotificationType.ALBUM_RELEASE,
      title: artist.displayName,
      body: `Nouvel album : « ${album.title} »`,
      data: { artistId: artist.id, albumId: album.id },
    });
    return album;
  }

  async list(artistId?: string, cursor?: string, limit?: number) {
    const take = parseLimit(limit);
    const items = await this.prisma.album.findMany({
      where: artistId ? { artistId } : undefined,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        artist: { select: { id: true, displayName: true } },
        _count: { select: { tracks: true } },
      },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async findById(id: string) {
    const album = await this.prisma.album.findUnique({
      where: { id },
      include: {
        artist: { select: { id: true, displayName: true } },
        tracks: {
          orderBy: { albumPosition: 'asc' },
          select: {
            id: true,
            title: true,
            genre: true,
            price: true,
            coverUrl: true,
            durationMs: true,
            albumPosition: true,
          },
        },
      },
    });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }
    // Titres sans cover propre → couverture album
    return {
      ...album,
      tracks: album.tracks.map((t) => ({
        ...t,
        coverUrl: t.coverUrl ?? album.coverUrl ?? null,
      })),
    };
  }

  async update(
    albumId: string,
    actor: AlbumActor,
    dto: UpdateAlbumDto,
    cover?: Express.Multer.File,
  ): Promise<Album> {
    const album = await this.requireAlbum(albumId);
    await this.assertAlbumOwner(album, actor);
    if (dto.price !== undefined) {
      this.assertPrice(dto.price);
    }

    const data: {
      title?: string;
      description?: string | null;
      coverUrl?: string;
      price?: number | null;
    } = {};
    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.price !== undefined) {
      data.price = dto.price;
    }
    if (cover) {
      const uploaded = await this.storage.uploadImage(
        cover,
        'cover',
        `albums/${album.artistId}`,
      );
      data.coverUrl = uploaded.publicUrl ?? `r2://${uploaded.objectKey}`;
    }

    return this.prisma.album.update({ where: { id: albumId }, data });
  }

  async remove(albumId: string, actor: AlbumActor): Promise<void> {
    const album = await this.requireAlbum(albumId);
    await this.assertAlbumOwner(album, actor);
    // SetNull sur Track.albumId via Prisma onDelete
    await this.prisma.album.delete({ where: { id: albumId } });
  }

  /**
   * Rattache N titres existants (même artiste) à l’album, dans l’ordre fourni.
   */
  async addTracks(
    albumId: string,
    actor: AlbumActor,
    dto: AddAlbumTracksDto,
  ): Promise<{ added: number }> {
    const album = await this.requireAlbum(albumId);
    await this.assertAlbumOwner(album, actor);

    const uniqueIds = [...new Set(dto.trackIds)];
    const currentCount = await this.prisma.track.count({
      where: { albumId },
    });
    // 1. Plafond ALBUM_TRACKS_MAX
    if (currentCount + uniqueIds.length > this.tracksMax) {
      throw new BadRequestException(
        `Album plein : max ${this.tracksMax} titres (ALBUM_TRACKS_MAX)`,
      );
    }

    const tracks = await this.prisma.track.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, artistId: true, albumId: true },
    });
    if (tracks.length !== uniqueIds.length) {
      throw new NotFoundException('Un ou plusieurs titres introuvables');
    }
    // 2. Ownership : titres du même artiste que l’album
    if (tracks.some((t) => t.artistId !== album.artistId)) {
      throw new ForbiddenException(
        'Seuls les titres de cet artiste peuvent rejoindre l’album',
      );
    }

    let position = currentCount;
    for (const trackId of uniqueIds) {
      await this.prisma.track.update({
        where: { id: trackId },
        data: { albumId, albumPosition: position },
      });
      position += 1;
    }

    return { added: uniqueIds.length };
  }

  async removeTrack(
    albumId: string,
    trackId: string,
    actor: AlbumActor,
  ): Promise<void> {
    const album = await this.requireAlbum(albumId);
    await this.assertAlbumOwner(album, actor);

    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track || track.albumId !== albumId) {
      throw new NotFoundException('Titre absent de cet album');
    }

    await this.prisma.track.update({
      where: { id: trackId },
      data: { albumId: null, albumPosition: null },
    });
  }

  private async requireAlbum(id: string): Promise<Album> {
    const album = await this.prisma.album.findUnique({ where: { id } });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }
    return album;
  }

  private async requireArtistProfile(actor: AlbumActor) {
    if (actor.role !== UserRole.ARTIST && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Rôle artiste requis');
    }
    const artist = await this.artistsService.findByUserId(actor.id);
    if (!artist) {
      throw new ForbiddenException('Profil artiste requis');
    }
    return artist;
  }

  private async assertAlbumOwner(
    album: Album,
    actor: AlbumActor,
  ): Promise<void> {
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    const artist = await this.artistsService.findByUserId(actor.id);
    if (!artist || artist.id !== album.artistId) {
      throw new ForbiddenException('Album non propriétaire');
    }
  }

  private assertPrice(price: number | null | undefined): void {
    assertMoneyInRange(price, this.priceMin, this.priceMax);
  }
}
