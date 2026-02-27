import {
  parseEpisodeFilename,
  parseSeasonFolder,
  parseMovieFilename,
  sanitizePathComponent,
  formatSeason,
  formatEpisode,
  extractYear,
} from '../src/utils/filename-parser';

describe('parseEpisodeFilename', () => {
  it('parses SxxExx (uppercase)', () => {
    const r = parseEpisodeFilename('Breaking.Bad.S05E14.Ozymandias');
    expect(r?.season).toBe(5);
    expect(r?.episode).toBe(14);
    expect(r?.episodeTitle).toBe('Ozymandias');
  });

  it('parses sxxexx (lowercase)', () => {
    const r = parseEpisodeFilename('show.s01e03.title');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(3);
  });

  it('parses NxNN pattern', () => {
    const r = parseEpisodeFilename('Show 1x07 Episode Title');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(7);
  });

  it('parses spelled-out Season N Episode N', () => {
    const r = parseEpisodeFilename('Show Season 2 Episode 3 Title');
    expect(r?.season).toBe(2);
    expect(r?.episode).toBe(3);
  });

  it('parses DS Video "S1 - E01 - Title" style', () => {
    const r = parseEpisodeFilename('S1 - E01 - Pilot');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBe('Pilot');
  });

  it('parses DS Video "S1 - E01" without title', () => {
    const r = parseEpisodeFilename('S1 - E01');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBeUndefined();
  });

  it('parses DS Video style with multi-word title', () => {
    const r = parseEpisodeFilename('S1 - E07 - Cold Comfort');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(7);
    expect(r?.episodeTitle).toBe('Cold Comfort');
  });

  it('returns null for a plain movie filename', () => {
    expect(parseEpisodeFilename('Some Great Movie (2020)')).toBeNull();
  });

  it('handles no episode title after SxxExx', () => {
    const r = parseEpisodeFilename('Show.S03E01');
    expect(r?.season).toBe(3);
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBeUndefined();
  });

  // --- underscore / dot normalization ---

  it('normalizes underscores to spaces when no spaces present', () => {
    const r = parseEpisodeFilename('Dark_Angel_S01E01_Pilot');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBe('Pilot');
  });

  it('normalizes dots to spaces when no spaces present', () => {
    const r = parseEpisodeFilename('Dark.Angel.S01E01.Pilot');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBe('Pilot');
  });

  it('does not normalize when spaces already present', () => {
    // underscores alongside spaces are left alone
    const r = parseEpisodeFilename('Dark Angel S01E01_extra');
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(1);
  });

  it('normalizes spelled-out Season/Episode pattern with underscores', () => {
    const r = parseEpisodeFilename('Show_Season_2_Episode_5');
    expect(r?.season).toBe(2);
    expect(r?.episode).toBe(5);
  });

  it('normalizes spelled-out Season/Episode pattern with dots', () => {
    const r = parseEpisodeFilename('Show.Season.3.Episode.7');
    expect(r?.season).toBe(3);
    expect(r?.episode).toBe(7);
  });
});

describe('parseSeasonFolder', () => {
  it('parses "Season 01"', () => expect(parseSeasonFolder('Season 01')).toBe(1));
  it('parses "Season 12"', () => expect(parseSeasonFolder('Season 12')).toBe(12));
  it('parses "S01"', () => expect(parseSeasonFolder('S01')).toBe(1));
  it('parses "s1"', () => expect(parseSeasonFolder('s1')).toBe(1));
  it('returns null for show folder', () => expect(parseSeasonFolder('Breaking Bad')).toBeNull());
  it('returns null for plain number', () => expect(parseSeasonFolder('2020')).toBeNull());
});

describe('parseMovieFilename', () => {
  it('parses "Title (Year)"', () => {
    const r = parseMovieFilename('The Dark Knight (2008)');
    expect(r.title).toBe('The Dark Knight');
    expect(r.year).toBe(2008);
  });

  it('parses "Title.Year.extra"', () => {
    const r = parseMovieFilename('Inception.2010.1080p');
    expect(r.title).toBe('Inception');
    expect(r.year).toBe(2010);
  });

  it('parses title with no year', () => {
    const r = parseMovieFilename('Some Old Movie');
    expect(r.title).toBe('Some Old Movie');
    expect(r.year).toBeUndefined();
  });

  it('converts dots to spaces when no year', () => {
    const r = parseMovieFilename('Some.Movie.Without.Year');
    expect(r.title).toBe('Some Movie Without Year');
  });

  // --- underscore / dot normalization ---

  it('normalizes underscores to spaces (no spaces in name)', () => {
    const r = parseMovieFilename('The_Matrix_1999');
    expect(r.title).toBe('The Matrix');
    expect(r.year).toBe(1999);
  });

  it('normalizes dots to spaces (no spaces in name)', () => {
    const r = parseMovieFilename('The.Matrix.1999');
    expect(r.title).toBe('The Matrix');
    expect(r.year).toBe(1999);
  });

  it('normalizes underscores for title-only name', () => {
    const r = parseMovieFilename('My_Favorite_Movie');
    expect(r.title).toBe('My Favorite Movie');
    expect(r.year).toBeUndefined();
  });

  it('does not normalize when name already has spaces', () => {
    // underscores kept when spaces exist
    const r = parseMovieFilename('The Matrix (1999)');
    expect(r.title).toBe('The Matrix');
    expect(r.year).toBe(1999);
  });

  it('normalizes underscored "Title_(Year)" format', () => {
    const r = parseMovieFilename('The_Matrix_(1999)');
    expect(r.title).toBe('The Matrix');
    expect(r.year).toBe(1999);
  });
});

describe('sanitizePathComponent', () => {
  it('removes reserved characters', () => {
    expect(sanitizePathComponent('Movie: A Story')).toBe('Movie A Story');
    expect(sanitizePathComponent('Show <2020>')).toBe('Show 2020');
    expect(sanitizePathComponent('Title/Subtitle')).toBe('TitleSubtitle');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizePathComponent('Title   With   Spaces')).toBe('Title With Spaces');
  });
});

describe('formatSeason / formatEpisode', () => {
  it('zero-pads single digit season', () => expect(formatSeason(1)).toBe('01'));
  it('does not pad double digit season', () => expect(formatSeason(12)).toBe('12'));
  it('zero-pads single digit episode', () => expect(formatEpisode(3)).toBe('03'));
});

describe('extractYear', () => {
  it('extracts year from ISO date', () => expect(extractYear('2020-06-15')).toBe(2020));
  it('extracts year from plain string', () => expect(extractYear('2008')).toBe(2008));
  it('returns undefined for non-year string', () => expect(extractYear('no year here')).toBeUndefined());
});
