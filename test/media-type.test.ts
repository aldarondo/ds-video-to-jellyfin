/**
 * Tests for detectMediaType().
 *
 * Detection priority (highest to lowest):
 *   1. forced option ('movies' | 'shows') → short-circuits everything
 *   2. vsmeta contentType === 2 or season/episode present → 'show'
 *   3. SxxExx / NxNN / Season-Episode pattern in filename → 'show'
 *   4. Season folder in ancestor path → 'show'
 *   5. "show(s)" or "movie(s)" keyword in ancestor path → 'show' / 'movie'
 *   6. Default → 'movie'
 */

import { detectMediaType } from '../src/detectors/media-type';
import { VsMetaData } from '../src/parsers/vsmeta';

/** Minimal VsMetaData with no useful fields set (content type defaults to movie). */
function emptyMeta(overrides: Partial<VsMetaData> = {}): VsMetaData {
  return {
    contentType: 1,
    title: '',
    originalTitle: '',
    tagline: '',
    year: 0,
    releaseDate: '',
    plot: '',
    tmdbId: '',
    imdbId: '',
    contentRating: '',
    rating: 0,
    actors: [],
    directors: [],
    genres: [],
    writers: [],
    ...overrides,
  };
}

describe('detectMediaType — forced option', () => {
  it('returns "movie" when forced="movies" regardless of meta', () => {
    expect(detectMediaType('/any/path/S01E01.mkv', emptyMeta({ contentType: 2 }), 'movies')).toBe('movie');
  });

  it('returns "show" when forced="shows" regardless of meta', () => {
    expect(detectMediaType('/any/path/movie.mkv', emptyMeta({ contentType: 1 }), 'shows')).toBe('show');
  });
});

describe('detectMediaType — vsmeta signals', () => {
  it('returns "show" when contentType is 2', () => {
    expect(detectMediaType('/library/ep.mkv', emptyMeta({ contentType: 2 }))).toBe('show');
  });

  it('returns "show" when meta.season is set', () => {
    expect(detectMediaType('/library/ep.mkv', emptyMeta({ season: 1 }))).toBe('show');
  });

  it('returns "show" when meta.episode is set', () => {
    expect(detectMediaType('/library/ep.mkv', emptyMeta({ episode: 5 }))).toBe('show');
  });

  it('returns "movie" when contentType is 1 and no season/episode', () => {
    expect(detectMediaType('/library/film.mkv', emptyMeta({ contentType: 1 }))).toBe('movie');
  });
});

describe('detectMediaType — filename patterns', () => {
  it('returns "show" for SxxExx uppercase', () => {
    expect(detectMediaType('/library/Show S01E01.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" for sxxexx lowercase', () => {
    expect(detectMediaType('/library/show.s02e03.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" for NxNN pattern', () => {
    expect(detectMediaType('/library/Show 1x07.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" for Season N Episode N pattern', () => {
    expect(detectMediaType('/library/Show Season 2 Episode 5.mkv', emptyMeta())).toBe('show');
  });

  it('returns "movie" for a plain title with year', () => {
    expect(detectMediaType('/library/The Dark Knight (2008).mkv', emptyMeta())).toBe('movie');
  });
});

describe('detectMediaType — ancestor folder patterns', () => {
  it('returns "show" when ancestor folder matches "Season N"', () => {
    expect(detectMediaType('/TV/Breaking Bad/Season 1/ep.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" when ancestor folder matches "S01" style', () => {
    expect(detectMediaType('/TV/My Show/S02/ep.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" for season folder even when inside a Movies folder', () => {
    // Season-folder detection has higher priority than keyword hint
    expect(detectMediaType('/Movies/SomeSeries/Season 1/ep.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" when "Shows" keyword appears in path', () => {
    expect(detectMediaType('/Media/TV Shows/My Show/ep.mkv', emptyMeta())).toBe('show');
  });

  it('returns "show" when "Show" keyword (singular) appears in path', () => {
    expect(detectMediaType('/Media/Show/My Series/ep.mkv', emptyMeta())).toBe('show');
  });

  it('returns "movie" when "Movies" keyword appears in path', () => {
    expect(detectMediaType('/Media/Movies/The Matrix (1999)/film.mkv', emptyMeta())).toBe('movie');
  });

  it('returns "movie" when "Movie" keyword (singular) appears in path', () => {
    expect(detectMediaType('/Media/Movie/Inception (2010)/film.mkv', emptyMeta())).toBe('movie');
  });

  it('season folder overrides earlier Movies keyword in same path', () => {
    // Season folder is processed in the same loop with higher priority
    expect(detectMediaType('/Movies/Series/Season 2/ep.mkv', emptyMeta())).toBe('show');
  });
});

describe('detectMediaType — default fallback', () => {
  it('returns "movie" when nothing matches', () => {
    expect(detectMediaType('/library/unknown.mkv', emptyMeta())).toBe('movie');
  });

  it('returns "movie" for path with no recognizable structure', () => {
    expect(detectMediaType('/files/content/item.mp4', emptyMeta())).toBe('movie');
  });
});
