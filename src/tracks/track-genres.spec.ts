import { TrackGenre, listTrackGenres, TRACK_GENRES, isTrackGenre } from './track-genres';

describe('track-genres', () => {
  it('expose la liste MVP depuis l’enum Prisma', () => {
    expect(TRACK_GENRES).toEqual(
      expect.arrayContaining([
        TrackGenre.RAP,
        TrackGenre.AFRO,
        TrackGenre.ZOUK,
        TrackGenre.SHATTA,
      ]),
    );
    expect(listTrackGenres()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: TrackGenre.RAP, label: 'Rap' }),
      ]),
    );
  });

  it('isTrackGenre valide les valeurs enum', () => {
    expect(isTrackGenre(TrackGenre.ZOUK)).toBe(true);
    expect(isTrackGenre('metal')).toBe(false);
  });
});
