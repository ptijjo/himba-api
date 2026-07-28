import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Règles déterministes MVP (pas de ML) :
   * 1. Même artiste / genre que les dernières écoutes
   * 2. Titres d’artistes suivis
   * 3. Artistes liés aux playlists de l’user
   */
  async suggest(userId: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const recentPlays = await this.prisma.playEvent.findMany({
      where: { userId },
      orderBy: { listenedAt: 'desc' },
      take: 20,
      include: { track: true },
    });

    const artistIds = new Set<string>();
    const genres = new Set<string>();
    for (const play of recentPlays) {
      artistIds.add(play.track.artistId);
      if (play.track.genre) {
        genres.add(play.track.genre);
      }
    }

    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { artistId: true },
    });
    for (const f of follows) {
      artistIds.add(f.artistId);
    }

    const playlistTracks = await this.prisma.playlistTrack.findMany({
      where: { playlist: { userId } },
      take: 50,
      include: { track: { select: { artistId: true } } },
    });
    for (const pt of playlistTracks) {
      artistIds.add(pt.track.artistId);
    }

    const playedTrackIds = recentPlays.map((p) => p.trackId);
    const artistIdList = [...artistIds];
    const genreList = [...genres];

    if (artistIdList.length === 0 && genreList.length === 0) {
      return this.prisma.track.findMany({
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          genre: true,
          priceCents: true,
          coverUrl: true,
          artistId: true,
          durationMs: true,
        },
      });
    }

    return this.prisma.track.findMany({
      where: {
        AND: [
          playedTrackIds.length
            ? { id: { notIn: playedTrackIds } }
            : {},
          {
            OR: [
              artistIdList.length ? { artistId: { in: artistIdList } } : {},
              genreList.length ? { genre: { in: genreList } } : {},
            ].filter((c) => Object.keys(c).length > 0),
          },
        ],
      },
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        genre: true,
        priceCents: true,
        coverUrl: true,
        artistId: true,
        durationMs: true,
      },
    });
  }
}
