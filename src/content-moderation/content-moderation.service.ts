import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContentReviewOutcome,
  ContentReviewTargetType,
  ReportTargetType,
  UserRole,
  UserStatus,
} from '../generated/prisma/client';
import { parseLimit } from '../common/pagination/cursor.dto';
import {
  parsePage,
  parsePageLimit,
  pageSkip,
  toPageResult,
} from '../common/pagination/page.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportSanction } from '../reports/report-sanction';
import { AlbumsService } from '../albums/albums.service';
import { StorageService } from '../storage/storage.service';
import { TracksService } from '../tracks/tracks.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

const OK_COOLDOWN_DAYS = 14;

@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracksService: TracksService,
    private readonly albumsService: AlbumsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Tirage aléatoire de titres pour contrôle proactif.
   * Priorise le contenu récent ; exclut les titres marqués OK récemment.
   */
  async sampleTracks(query: {
    limit?: number;
    days?: number;
    pricing?: 'all' | 'paid' | 'free';
  }) {
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 30);
    const days = Math.min(Math.max(query.days ?? 30, 1), 365);
    const pricing = query.pricing ?? 'all';

    const excludeIds = await this.recentOkTargetIds(
      ContentReviewTargetType.TRACK,
    );

    const createdSince = new Date();
    createdSince.setUTCDate(createdSince.getUTCDate() - days);

    const priceFilter =
      pricing === 'paid'
        ? { not: null }
        : pricing === 'free'
          ? null
          : undefined;

    let pool = await this.prisma.track.findMany({
      where: {
        createdAt: { gte: createdSince },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        ...(priceFilter !== undefined ? { price: priceFilter } : {}),
      },
      include: {
        artist: {
          select: {
            id: true,
            displayName: true,
            userId: true,
          },
        },
        album: { select: { id: true, title: true, coverUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    if (pool.length < limit) {
      pool = await this.prisma.track.findMany({
        where: {
          ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
          ...(priceFilter !== undefined ? { price: priceFilter } : {}),
        },
        include: {
          artist: {
            select: {
              id: true,
              displayName: true,
              userId: true,
            },
          },
          album: { select: { id: true, title: true, coverUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }

    const shuffled = this.shuffle(pool).slice(0, limit);
    return {
      items: shuffled.map((t) => this.serializeTrack(t)),
      sampledAt: new Date().toISOString(),
    };
  }

  /**
   * Tirage aléatoire de covers (titres avec cover propre + albums).
   */
  async sampleCovers(query: {
    limit?: number;
    days?: number;
    kind?: 'all' | 'track' | 'album';
  }) {
    const limit = Math.min(Math.max(query.limit ?? 12, 1), 30);
    const days = Math.min(Math.max(query.days ?? 30, 1), 365);
    const kind = query.kind ?? 'all';

    const createdSince = new Date();
    createdSince.setUTCDate(createdSince.getUTCDate() - days);

    const excludeTrackCoverIds = await this.recentOkTargetIds(
      ContentReviewTargetType.TRACK_COVER,
    );
    const excludeAlbumCoverIds = await this.recentOkTargetIds(
      ContentReviewTargetType.ALBUM_COVER,
    );

    type CoverItem = {
      targetType: 'TRACK_COVER' | 'ALBUM_COVER';
      targetId: string;
      title: string;
      coverUrl: string;
      createdAt: Date;
      artist: { id: string; displayName: string; userId: string };
    };

    const items: CoverItem[] = [];

    if (kind === 'all' || kind === 'track') {
      let tracks = await this.prisma.track.findMany({
        where: {
          coverUrl: { not: null },
          createdAt: { gte: createdSince },
          ...(excludeTrackCoverIds.length
            ? { id: { notIn: excludeTrackCoverIds } }
            : {}),
        },
        include: {
          artist: {
            select: { id: true, displayName: true, userId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 150,
      });
      if (tracks.length < limit) {
        tracks = await this.prisma.track.findMany({
          where: {
            coverUrl: { not: null },
            ...(excludeTrackCoverIds.length
              ? { id: { notIn: excludeTrackCoverIds } }
              : {}),
          },
          include: {
            artist: {
              select: { id: true, displayName: true, userId: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 150,
        });
      }
      for (const t of tracks) {
        if (!t.coverUrl) continue;
        items.push({
          targetType: 'TRACK_COVER',
          targetId: t.id,
          title: t.title,
          coverUrl: t.coverUrl,
          createdAt: t.createdAt,
          artist: t.artist,
        });
      }
    }

    if (kind === 'all' || kind === 'album') {
      let albums = await this.prisma.album.findMany({
        where: {
          createdAt: { gte: createdSince },
          ...(excludeAlbumCoverIds.length
            ? { id: { notIn: excludeAlbumCoverIds } }
            : {}),
        },
        include: {
          artist: {
            select: { id: true, displayName: true, userId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 150,
      });
      if (albums.length < Math.ceil(limit / 2)) {
        albums = await this.prisma.album.findMany({
          where: {
            ...(excludeAlbumCoverIds.length
              ? { id: { notIn: excludeAlbumCoverIds } }
              : {}),
          },
          include: {
            artist: {
              select: { id: true, displayName: true, userId: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 150,
        });
      }
      for (const a of albums) {
        items.push({
          targetType: 'ALBUM_COVER',
          targetId: a.id,
          title: a.title,
          coverUrl: a.coverUrl,
          createdAt: a.createdAt,
          artist: a.artist,
        });
      }
    }

    const shuffled = this.shuffle(items).slice(0, limit);
    return {
      items: shuffled.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
      sampledAt: new Date().toISOString(),
    };
  }

  async getTrackForModeration(trackId: string, admin: AuthenticatedUser) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      include: {
        artist: {
          select: {
            id: true,
            displayName: true,
            userId: true,
          },
        },
        album: { select: { id: true, title: true, coverUrl: true } },
      },
    });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }

    const stream = await this.tracksService.getStreamUrl(
      trackId,
      admin.id,
      UserRole.ADMIN,
    );

    const lastReviews = await this.prisma.contentReview.findMany({
      where: {
        OR: [
          {
            targetType: ContentReviewTargetType.TRACK,
            targetId: trackId,
          },
          {
            targetType: ContentReviewTargetType.TRACK_COVER,
            targetId: trackId,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        reviewer: { select: { id: true, username: true } },
      },
    });

    return {
      ...this.serializeTrack(track),
      ownCoverUrl: track.coverUrl,
      streamUrl: stream.url,
      streamExpiresInSeconds: stream.expiresInSeconds,
      recentReviews: lastReviews,
    };
  }

  async getAlbumForModeration(albumId: string, admin: AuthenticatedUser) {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      include: {
        artist: {
          select: {
            id: true,
            displayName: true,
            userId: true,
          },
        },
        tracks: {
          orderBy: { albumPosition: 'asc' },
          select: {
            id: true,
            title: true,
            genre: true,
            price: true,
            coverUrl: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }

    const tracksWithStream = await Promise.all(
      album.tracks.map(async (t) => {
        const stream = await this.tracksService.getStreamUrl(
          t.id,
          admin.id,
          UserRole.ADMIN,
        );
        return {
          ...t,
          price: t.price == null ? null : Number(t.price),
          streamUrl: stream.url,
          streamExpiresInSeconds: stream.expiresInSeconds,
        };
      }),
    );

    return {
      id: album.id,
      title: album.title,
      description: album.description,
      coverUrl: album.coverUrl,
      price: album.price == null ? null : Number(album.price),
      createdAt: album.createdAt,
      artist: album.artist,
      tracks: tracksWithStream,
    };
  }

  async createReview(
    admin: AuthenticatedUser,
    input: {
      targetType: ContentReviewTargetType;
      targetId: string;
      outcome: ContentReviewOutcome;
      note?: string;
    },
  ) {
    const ownerUserId = await this.resolveOwnerUserId(
      input.targetType,
      input.targetId,
    );
    if (!ownerUserId) {
      throw new NotFoundException('Cible introuvable');
    }

    if (
      ownerUserId === admin.id &&
      input.outcome !== ContentReviewOutcome.OK
    ) {
      throw new ForbiddenException(
        'Impossible de te sanctionner toi-même via un contrôle',
      );
    }

    this.assertOutcomeAllowed(input.targetType, input.outcome);

    const review = await this.prisma.contentReview.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        reviewerId: admin.id,
        outcome: input.outcome,
        note: input.note?.trim() || null,
      },
      include: {
        reviewer: { select: { id: true, username: true } },
      },
    });

    if (input.outcome === ContentReviewOutcome.OK) {
      return review;
    }

    if (
      input.outcome === ContentReviewOutcome.RESTRICTED ||
      input.outcome === ContentReviewOutcome.BANNED
    ) {
      await this.applyAccountSanction(ownerUserId, input.outcome);
    }

    if (input.outcome === ContentReviewOutcome.COVER_REMOVED) {
      await this.removeCover(input.targetType, input.targetId);
    }

    if (
      input.outcome === ContentReviewOutcome.CONTENT_REMOVED &&
      (input.targetType === ContentReviewTargetType.TRACK ||
        input.targetType === ContentReviewTargetType.ALBUM)
    ) {
      try {
        if (input.targetType === ContentReviewTargetType.TRACK) {
          await this.tracksService.remove(input.targetId, {
            id: admin.id,
            role: UserRole.ADMIN,
          });
        } else {
          await this.albumsService.remove(input.targetId, {
            id: admin.id,
            role: UserRole.ADMIN,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Retrait contenu ${input.targetType}:${input.targetId} échoué: ${
            err instanceof Error ? err.message : 'erreur'
          }`,
        );
        throw err;
      }
    }

    const notifyMeta = this.buildNotifyMeta(input.targetType, input.outcome);
    if (notifyMeta) {
      try {
        await this.notifications.notifyModerationReview({
          artistUserId: ownerUserId,
          targetType: notifyMeta.reportTargetType,
          targetId: input.targetId,
          sanction: notifyMeta.sanction,
          note: input.note,
          title: notifyMeta.title,
          bodyOverride: notifyMeta.bodyOverride,
        });
      } catch (err) {
        this.logger.warn(
          `Notif contrôle ${review.id} échouée: ${
            err instanceof Error ? err.message : 'erreur'
          }`,
        );
      }
    }

    return review;
  }

  async listReviews(page?: number, limit?: number) {
    const pageNum = parsePage(page);
    const take = parsePageLimit(limit);
    const skip = pageSkip(pageNum, take);

    const [items, total] = await Promise.all([
      this.prisma.contentReview.findMany({
        where: {},
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          reviewer: { select: { id: true, username: true } },
        },
      }),
      this.prisma.contentReview.count(),
    ]);

    return toPageResult(items, total, pageNum, take);
  }

  /**
   * Catalogue titres paginé pour contrôles (remplace le seul tirage aléatoire).
   */
  async listTracksCatalog(query: {
    page?: number;
    limit?: number;
    pricing?: 'all' | 'paid' | 'free';
  }) {
    const page = parsePage(query.page);
    const limit = parsePageLimit(query.limit);
    const skip = pageSkip(page, limit);
    const pricing = query.pricing ?? 'all';

    const priceFilter =
      pricing === 'paid'
        ? { not: null }
        : pricing === 'free'
          ? null
          : undefined;

    const where = {
      ...(priceFilter !== undefined ? { price: priceFilter } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.track.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          artist: {
            select: { id: true, displayName: true, userId: true },
          },
          album: { select: { id: true, title: true, coverUrl: true } },
        },
      }),
      this.prisma.track.count({ where }),
    ]);

    return toPageResult(
      rows.map((t) => this.serializeTrack(t)),
      total,
      page,
      limit,
    );
  }

  /** Catalogue covers paginé (titres avec cover propre + albums). */
  async listCoversCatalog(query: {
    page?: number;
    limit?: number;
    kind?: 'all' | 'track' | 'album';
  }) {
    const page = parsePage(query.page);
    const limit = parsePageLimit(query.limit);
    const kind = query.kind ?? 'all';

    type CoverItem = {
      targetType: 'TRACK_COVER' | 'ALBUM_COVER';
      targetId: string;
      title: string;
      coverUrl: string;
      createdAt: string;
      artist: { id: string; displayName: string; userId: string };
    };

    const items: CoverItem[] = [];

    if (kind === 'all' || kind === 'track') {
      const tracks = await this.prisma.track.findMany({
        where: { coverUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
        include: {
          artist: {
            select: { id: true, displayName: true, userId: true },
          },
        },
      });
      for (const t of tracks) {
        if (!t.coverUrl) continue;
        items.push({
          targetType: 'TRACK_COVER',
          targetId: t.id,
          title: t.title,
          coverUrl: t.coverUrl,
          createdAt: t.createdAt.toISOString(),
          artist: t.artist,
        });
      }
    }

    if (kind === 'all' || kind === 'album') {
      const albums = await this.prisma.album.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          artist: {
            select: { id: true, displayName: true, userId: true },
          },
        },
      });
      for (const a of albums) {
        items.push({
          targetType: 'ALBUM_COVER',
          targetId: a.id,
          title: a.title,
          coverUrl: a.coverUrl,
          createdAt: a.createdAt.toISOString(),
          artist: a.artist,
        });
      }
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = items.length;
    const skip = pageSkip(page, limit);
    const pageItems = items.slice(skip, skip + limit);
    return toPageResult(pageItems, total, page, limit);
  }

  private assertOutcomeAllowed(
    targetType: ContentReviewTargetType,
    outcome: ContentReviewOutcome,
  ): void {
    const isCover =
      targetType === ContentReviewTargetType.TRACK_COVER ||
      targetType === ContentReviewTargetType.ALBUM_COVER;
    if (isCover && outcome === ContentReviewOutcome.CONTENT_REMOVED) {
      throw new BadRequestException(
        'Pour une cover, utilise COVER_REMOVED (pas CONTENT_REMOVED)',
      );
    }
    if (!isCover && outcome === ContentReviewOutcome.COVER_REMOVED) {
      throw new BadRequestException(
        'COVER_REMOVED est réservé aux cibles TRACK_COVER / ALBUM_COVER',
      );
    }
  }

  private async removeCover(
    targetType: ContentReviewTargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === ContentReviewTargetType.TRACK_COVER) {
      const track = await this.prisma.track.findUnique({
        where: { id: targetId },
        select: { id: true, coverUrl: true },
      });
      if (!track) {
        throw new NotFoundException('Titre introuvable');
      }
      await this.prisma.track.update({
        where: { id: targetId },
        data: { coverUrl: null },
      });
      return;
    }
    if (targetType === ContentReviewTargetType.ALBUM_COVER) {
      const album = await this.prisma.album.findUnique({
        where: { id: targetId },
        select: { id: true, artistId: true },
      });
      if (!album) {
        throw new NotFoundException('Album introuvable');
      }
      const placeholder = await this.storage.createPlaceholderCover(
        `albums/${album.artistId}/covers`,
      );
      const coverUrl =
        placeholder.publicUrl ?? `r2://${placeholder.objectKey}`;
      await this.prisma.album.update({
        where: { id: targetId },
        data: { coverUrl },
      });
      return;
    }
    throw new BadRequestException('Type de cover invalide');
  }

  private buildNotifyMeta(
    targetType: ContentReviewTargetType,
    outcome: ContentReviewOutcome,
  ): {
    reportTargetType: ReportTargetType;
    sanction: ReportSanction;
    title?: string;
    bodyOverride?: string;
  } | null {
    const reportTargetType =
      targetType === ContentReviewTargetType.ALBUM ||
      targetType === ContentReviewTargetType.ALBUM_COVER
        ? ReportTargetType.ALBUM
        : ReportTargetType.TRACK;

    switch (outcome) {
      case ContentReviewOutcome.OK:
        return null;
      case ContentReviewOutcome.WARNING:
        return {
          reportTargetType,
          sanction: ReportSanction.WARNING,
          title:
            targetType === ContentReviewTargetType.TRACK_COVER ||
            targetType === ContentReviewTargetType.ALBUM_COVER
              ? 'Contrôle Himba — couverture'
              : undefined,
        };
      case ContentReviewOutcome.COVER_REMOVED:
        return {
          reportTargetType,
          sanction: ReportSanction.CONTENT_REMOVED,
          title: 'Contrôle Himba — couverture retirée',
          bodyOverride:
            'Ta couverture a été retirée par l’équipe Himba car elle ne respectait pas les règles de la communauté. Tu peux en republier une conforme.',
        };
      case ContentReviewOutcome.CONTENT_REMOVED:
        return {
          reportTargetType,
          sanction: ReportSanction.CONTENT_REMOVED,
        };
      case ContentReviewOutcome.RESTRICTED:
        return {
          reportTargetType,
          sanction: ReportSanction.RESTRICTED,
        };
      case ContentReviewOutcome.BANNED:
        return {
          reportTargetType,
          sanction: ReportSanction.BANNED,
        };
      default: {
        const _exhaustive: never = outcome;
        throw new BadRequestException(`Outcome invalide: ${_exhaustive}`);
      }
    }
  }

  private async applyAccountSanction(
    userId: string,
    outcome: 'RESTRICTED' | 'BANNED',
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return;
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Impossible d’appliquer une sanction au compte administrateur',
      );
    }
    const status =
      outcome === 'BANNED' ? UserStatus.BANNED : UserStatus.RESTRICTED;
    await this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  private async resolveOwnerUserId(
    targetType: ContentReviewTargetType,
    targetId: string,
  ): Promise<string | null> {
    switch (targetType) {
      case ContentReviewTargetType.TRACK:
      case ContentReviewTargetType.TRACK_COVER: {
        const track = await this.prisma.track.findUnique({
          where: { id: targetId },
          select: { artist: { select: { userId: true } } },
        });
        return track?.artist.userId ?? null;
      }
      case ContentReviewTargetType.ALBUM:
      case ContentReviewTargetType.ALBUM_COVER: {
        const album = await this.prisma.album.findUnique({
          where: { id: targetId },
          select: { artist: { select: { userId: true } } },
        });
        return album?.artist.userId ?? null;
      }
      default: {
        const _exhaustive: never = targetType;
        throw new BadRequestException(`Type invalide: ${_exhaustive}`);
      }
    }
  }

  private async recentOkTargetIds(
    targetType: ContentReviewTargetType,
  ): Promise<string[]> {
    const okSince = new Date();
    okSince.setUTCDate(okSince.getUTCDate() - OK_COOLDOWN_DAYS);
    const recentOk = await this.prisma.contentReview.findMany({
      where: {
        targetType,
        outcome: ContentReviewOutcome.OK,
        createdAt: { gte: okSince },
      },
      select: { targetId: true },
      distinct: ['targetId'],
    });
    return recentOk.map((r) => r.targetId);
  }

  private serializeTrack(track: {
    id: string;
    title: string;
    genre: string;
    price: { toString(): string } | null;
    coverUrl: string | null;
    durationMs: number | null;
    createdAt: Date;
    albumId: string | null;
    artist: { id: string; displayName: string; userId: string };
    album: { id: string; title: string; coverUrl: string } | null;
  }) {
    return {
      id: track.id,
      title: track.title,
      genre: track.genre,
      price: track.price == null ? null : Number(track.price),
      coverUrl: track.coverUrl ?? track.album?.coverUrl ?? null,
      durationMs: track.durationMs,
      createdAt: track.createdAt,
      albumId: track.albumId,
      album: track.album,
      artist: track.artist,
    };
  }

  private shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}
