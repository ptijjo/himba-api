import { TrackGenre } from '../generated/prisma/client';

/**
 * Genres catalogue MVP — source de vérité = enum Prisma `TrackGenre`.
 * Ajouter un genre = modifier l’enum + migration.
 */
export { TrackGenre };

export const TRACK_GENRES: TrackGenre[] = Object.values(TrackGenre);

export const TRACK_GENRE_LABELS: Record<TrackGenre, string> = {
  [TrackGenre.RAP]: 'Rap',
  [TrackGenre.AFRO]: 'Afro',
  [TrackGenre.ZOUK]: 'Zouk',
  [TrackGenre.SHATTA]: 'Shatta',
  [TrackGenre.COUPE_DECALE]: 'Coupé-décalé',
  [TrackGenre.DANCEHALL]: 'Dancehall',
  [TrackGenre.RNB]: 'R&B',
  [TrackGenre.POP]: 'Pop',
  [TrackGenre.GOSPEL]: 'Gospel',
  [TrackGenre.REGGAE]: 'Reggae',
  [TrackGenre.KOMPA]: 'Kompa',
  [TrackGenre.OTHER]: 'Autre',
};

export function isTrackGenre(value: string): value is TrackGenre {
  return (TRACK_GENRES as string[]).includes(value);
}

export function listTrackGenres(): { id: TrackGenre; label: string }[] {
  return TRACK_GENRES.map((id) => ({ id, label: TRACK_GENRE_LABELS[id] }));
}
