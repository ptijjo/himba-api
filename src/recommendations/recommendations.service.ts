import { Injectable } from '@nestjs/common';
import { TrackGenre } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const trackSuggestSelect = {
  id: true,
  title: true,
  genre: true,
  price: true,
  coverUrl: true,
  artistId: true,
  durationMs: true,
  album: { select: { coverUrl: true } },
  artist: { select: { id: true, displayName: true } },
} as const;

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
    const genres = new Set<TrackGenre>();
    for (const play of recentPlays) {
      artistIds.add(play.track.artistId);
      genres.add(play.track.genre);
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
      const tracks = await this.prisma.track.findMany({
        take,
        orderBy: { createdAt: 'desc' },
        select: trackSuggestSelect,
      });
      return tracks.map((t) => this.toSuggestTrack(t));
    }

    const tracks = await this.prisma.track.findMany({
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
      select: trackSuggestSelect,
    });
    return tracks.map((t) => this.toSuggestTrack(t));
  }

  private toSuggestTrack(track: {
    id: string;
    title: string;
    genre: TrackGenre;
    price: unknown;
    coverUrl: string | null;
    artistId: string;
    durationMs: number | null;
    album: { coverUrl: string | null } | null;
    artist: { id: string; displayName: string } | null;
  }) {
    return {
      id: track.id,
      title: track.title,
      genre: track.genre,
      // Aligné sur TracksService.toPublicTrack — jamais un Decimal Prisma brut
      price: track.price == null ? null : Number(track.price),
      artistId: track.artistId,
      durationMs: track.durationMs,
      coverUrl: track.coverUrl ?? track.album?.coverUrl ?? null,
      artist: track.artist
        ? { id: track.artist.id, displayName: track.artist.displayName }
        : undefined,
    };
  }
}
