import {
  parseEpisodeFilename,
  parseSeasonFolder,
  parseMovieFilename,
  sanitizePathComponent,
  formatSeason,
  formatEpisode,
  extractYear,
  isExtrasFile,
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

  it('cleans alone episode titles with separators and extensions (line 130 cover)', () => {
    const r = parseEpisodeFilename('Show - 01 - ._Title.mkv');
    expect(r?.episode).toBe(1);
    expect(r?.episodeTitle).toBe('Title');
  });

  it('handles isolated standalone episode patterns not caught by parsePath', () => {
    // using a pattern that parsePath doesn't detect as an episode
    const r = parseEpisodeFilename('Show_Name_-15-_More_Text.mkv');
    expect(r?.episode).toBe(15);
    expect(r?.episodeTitle).toBe('More Text');
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

  // --- DS Video "-N-" standalone episode pattern ---

  it('parses DS Video "-N-" standalone episode number', () => {
    const r = parseEpisodeFilename('DoctorWho2006 -4- The Girl in the Fireplace');
    expect(r?.episode).toBe(4);
    expect(r?.episodeTitle).toBe('The Girl in the Fireplace');
  });

  it('parses two-digit "-NN-" standalone episode', () => {
    const r = parseEpisodeFilename('DoctorWho2006 -11- Fear Her');
    expect(r?.episode).toBe(11);
    expect(r?.episodeTitle).toBe('Fear Her');
  });

  it('parses "-N-" with spaces around the number', () => {
    const r = parseEpisodeFilename('Show Title - 7 - Episode Name');
    expect(r?.episode).toBe(7);
    expect(r?.episodeTitle).toBe('Episode Name');
  });

  it('returns null when there is no episode number between dashes', () => {
    // A plain dash-separated title with no digit group should not match
    expect(parseEpisodeFilename('Tooth & Claw - Documentary')).toBeNull();
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

  it('parses mashed years like "DoctorWho2006"', () => {
    const r = parseMovieFilename('DoctorWho2006.mkv');
    expect(r.title).toBe('DoctorWho');
    expect(r.year).toBe(2006);
  });

  it('uses fallback for mashed years not parsed by parsePath (e.g. year 2100)', () => {
    // parse-torrent-path only matches up to 2099 for years, so 2100 triggers our fallback
    const r = parseMovieFilename('DoctorWho2100');
    expect(r.title).toBe('DoctorWho');
    expect(r.year).toBe(2100);
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

  // --- Embedded year (DS Video "ShowName2006" style) ---

  it('extracts year appended directly to show name without separator', () => {
    const r = parseMovieFilename('DoctorWho2006 -4- The Girl in the Fireplace');
    expect(r.year).toBe(2006);
    expect(r.title).toBe('DoctorWho');
  });

  it('extracts embedded year when followed by a dash separator', () => {
    const r = parseMovieFilename('MyShow2005-Episode Title');
    expect(r.year).toBe(2005);
  });

  it('does not extract a 4-digit number outside the valid year range', () => {
    // 1066 is a year but unlikely to appear as a broadcast year
    const r = parseMovieFilename('Battle1066Scene');
    expect(r.year).toBeUndefined();
  });

  it('standard "Title Year" (space-separated) still works after embedded check', () => {
    const r = parseMovieFilename('My Show 2019');
    expect(r.year).toBe(2019);
    expect(r.title).toBe('My Show');
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

describe('isExtrasFile', () => {
  // --- True positives: common extras patterns ---
  it('detects "DVD Extras" in DS Video filename', () => {
    expect(isExtrasFile('Dilbert - DVD Extras - Dogbert Speaks')).toBe(true);
  });
  it('detects "Extras" as standalone word', () => {
    expect(isExtrasFile('Season 1 Extras')).toBe(true);
  });
  it('detects "Extra" (singular)', () => {
    expect(isExtrasFile('Bonus Extra Content')).toBe(true);
  });
  it('detects "Making of"', () => {
    expect(isExtrasFile('Making of The Dark Knight')).toBe(true);
  });
  it('detects "Making-of" (hyphenated)', () => {
    expect(isExtrasFile('Making-of Featurette')).toBe(true);
  });
  it('detects "Interview"', () => {
    expect(isExtrasFile('Interview with the Director')).toBe(true);
  });
  it('detects "Interviews" (plural)', () => {
    expect(isExtrasFile('Cast Interviews')).toBe(true);
  });
  it('detects "Deleted Scenes"', () => {
    expect(isExtrasFile('Deleted Scenes')).toBe(true);
  });
  it('detects "Deleted Scene" (singular)', () => {
    expect(isExtrasFile('Deleted Scene - The Alternate Ending')).toBe(true);
  });
  it('detects "Behind the Scenes"', () => {
    expect(isExtrasFile('Behind the Scenes')).toBe(true);
  });
  it('detects "Behind-the-Scenes" (hyphenated)', () => {
    expect(isExtrasFile('Behind-the-Scenes Documentary')).toBe(true);
  });
  it('detects "Featurette"', () => {
    expect(isExtrasFile('Production Featurette')).toBe(true);
  });
  it('detects "Featurettes" (plural)', () => {
    expect(isExtrasFile('Featurettes')).toBe(true);
  });
  it('detects "Trailer"', () => {
    expect(isExtrasFile('Official Trailer')).toBe(true);
  });
  it('detects "Trailers" (plural)', () => {
    expect(isExtrasFile('Trailers and Teasers')).toBe(true);
  });
  it('detects "Bloopers"', () => {
    expect(isExtrasFile('Season 2 Bloopers')).toBe(true);
  });
  it('detects "Outtakes"', () => {
    expect(isExtrasFile('Outtakes and Bloopers')).toBe(true);
  });
  it('detects "Shorts"', () => {
    expect(isExtrasFile('Animated Shorts')).toBe(true);
  });
  it('detects "Bonus"', () => {
    expect(isExtrasFile('Bonus Features')).toBe(true);
  });
  it('detects "BTS" abbreviation', () => {
    expect(isExtrasFile('BTS Footage')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isExtrasFile('DVD EXTRAS')).toBe(true);
    expect(isExtrasFile('making of')).toBe(true);
  });

  // --- True negatives: regular episodes should not match ---
  it('returns false for a plain episode name', () => {
    expect(isExtrasFile('Pilot Episode')).toBe(false);
  });
  it('returns false for SxxExx episode', () => {
    expect(isExtrasFile('Show S01E01 Episode Title')).toBe(false);
  });
  it('returns false for a show title with "extra" inside a word', () => {
    // "Extraordinary" contains "extra" but not as a word boundary
    expect(isExtrasFile('Extraordinary Rendition')).toBe(false);
  });
  it('returns false for a movie filename', () => {
    expect(isExtrasFile('The Dark Knight (2008)')).toBe(false);
  });
});
