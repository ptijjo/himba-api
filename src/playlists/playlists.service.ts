import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { AddPlaylistTrackDto } from './dto/add-playlist-track.dto';

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  create(userId: string, dto: CreatePlaylistDto) {
    return this.prisma.playlist.create({
      data: { userId, name: dto.name.trim() },
    });
  }

  async listMine(userId: string, cursor?: string, limit?: number) {
    const take = parseLimit(limit);
    const items = await this.prisma.playlist.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tracks: true } },
        // Jusqu’à 8 titres pour constituer 4 covers (certains sans image)
        tracks: {
          take: 8,
          orderBy: { position: 'asc' },
          include: {
            track: {
              select: {
                coverUrl: true,
                album: { select: { coverUrl: true } },
              },
            },
          },
        },
      },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page.map(({ _count, tracks, ...playlist }) => ({
        ...playlist,
        trackCount: _count.tracks,
        coverUrls: this.collectCoverUrls(tracks),
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  /**
   * Playlists d’un autre utilisateur pour profil public.
   * 1. Vérifier que le compte existe et n’est pas ban
   * 2. Renvoyer nom + nombre de titres uniquement (pas d’email)
   */
  async listPublicByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user || user.status === 'BANNED') {
      throw new NotFoundException('Utilisateur introuvable');
    }
    const items = await this.prisma.playlist.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { tracks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      trackCount: p._count.tracks,
    }));
  }

  async get(userId: string, playlistId: string) {
    const playlist = await this.requireOwned(userId, playlistId);
    const tracks = await this.prisma.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            genre: true,
            price: true,
            coverUrl: true,
            durationMs: true,
            artistId: true,
            artist: { select: { id: true, displayName: true } },
            album: { select: { coverUrl: true } },
          },
        },
      },
    });
    return {
      ...playlist,
      tracks: tracks.map((row) => ({
        ...row,
        track: row.track
          ? {
              id: row.track.id,
              title: row.track.title,
              genre: row.track.genre,
              price: row.track.price,
              durationMs: row.track.durationMs,
              artistId: row.track.artistId,
              artist: row.track.artist
                ? {
                    id: row.track.artist.id,
                    displayName: row.track.artist.displayName,
                  }
                : undefined,
              coverUrl: this.storage.resolvePublicUrl(
                row.track.coverUrl ?? row.track.album?.coverUrl ?? null,
              ),
            }
          : row.track,
      })),
    };
  }

  async update(userId: string, playlistId: string, dto: UpdatePlaylistDto) {
    await this.requireOwned(userId, playlistId);
    return this.prisma.playlist.update({
      where: { id: playlistId },
      data: { name: dto.name.trim() },
    });
  }

  async remove(userId: string, playlistId: string): Promise<void> {
    await this.requireOwned(userId, playlistId);
    await this.prisma.playlist.delete({ where: { id: playlistId } });
  }

  async addTrack(
    userId: string,
    playlistId: string,
    dto: AddPlaylistTrackDto,
  ) {
    await this.requireOwned(userId, playlistId);
    const track = await this.prisma.track.findUnique({
      where: { id: dto.trackId },
    });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    // 1. Un titre ne peut figurer qu’une fois par playlist (@@unique)
    const existing = await this.prisma.playlistTrack.findUnique({
      where: {
        playlistId_trackId: { playlistId, trackId: dto.trackId },
      },
    });
    if (existing) {
      throw new ConflictException('Titre déjà dans cette playlist');
    }
    const count = await this.prisma.playlistTrack.count({
      where: { playlistId },
    });
    return this.prisma.playlistTrack.create({
      data: {
        playlistId,
        trackId: dto.trackId,
        position: dto.position ?? count,
      },
    });
  }

  async removeTrack(
    userId: string,
    playlistId: string,
    trackId: string,
  ): Promise<void> {
    await this.requireOwned(userId, playlistId);
    await this.prisma.playlistTrack.delete({
      where: { playlistId_trackId: { playlistId, trackId } },
    });
  }

  private async requireOwned(userId: string, playlistId: string) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
    });
    if (!playlist) {
      throw new NotFoundException('Playlist introuvable');
    }
    if (playlist.userId !== userId) {
      throw new ForbiddenException('Playlist non propriétaire');
    }
    return playlist;
  }

  /** Jusqu’à 4 covers distinctes (titre puis album) — mosaïque type Deezer. */
  private collectCoverUrls(
    rows: Array<{
      track: {
        coverUrl: string | null;
        album: { coverUrl: string } | null;
      } | null;
    }>,
  ): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.track) {
        continue;
      }
      const resolved = this.storage.resolvePublicUrl(
        row.track.coverUrl ?? row.track.album?.coverUrl ?? null,
      );
      if (!resolved || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      urls.push(resolved);
      if (urls.length >= 4) {
        break;
      }
    }
    return urls;
  }
}
