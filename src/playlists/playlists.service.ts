import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { AddPlaylistTrackDto } from './dto/add-playlist-track.dto';

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

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
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
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
            priceCents: true,
            coverUrl: true,
            durationMs: true,
            artistId: true,
          },
        },
      },
    });
    return { ...playlist, tracks };
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
}
