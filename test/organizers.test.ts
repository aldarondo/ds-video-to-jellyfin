import path from 'path';
import { computeMoviePaths } from '../src/organizers/movie-organizer';
import {
  computeShowPaths,
  resolveShowTitle,
} from '../src/organizers/show-organizer';
import { VsMetaData } from 'vsmeta-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal VsMetaData — all optional fields absent, contentType defaults to 1. */
function emptyMeta(overrides: Partial<VsMetaData> = {}): VsMetaData {
  return {
    contentType: 1,
    title: '',
    originalTitle: '',
    episodeTitle: '',
    year: 0,
    releaseDate: '',
    locked: false,
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

const ROOT = '/output';

// ---------------------------------------------------------------------------
// computeMoviePaths
// ---------------------------------------------------------------------------

describe('computeMoviePaths', () => {
  it('uses meta.title and meta.year for folder and file names', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/movie.mkv',
      emptyMeta({ title: 'The Dark Knight', year: 2008 }),
      { title: 'ignored' }
    );
    expect(p.folder).toBe(path.join(ROOT, 'The Dark Knight (2008)'));
    expect(p.videoFile).toBe(path.join(ROOT, 'The Dark Knight (2008)', 'The Dark Knight (2008).mkv'));
    expect(p.vsmetaFile).toBe(path.join(ROOT, 'The Dark Knight (2008)', 'The Dark Knight (2008).mkv.vsmeta'));
    expect(p.nfoFile).toBe(path.join(ROOT, 'The Dark Knight (2008)', 'movie.nfo'));
  });

  it('falls back to parsed.title when meta.title is empty', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/inception.mp4',
      emptyMeta({ year: 2010 }),
      { title: 'Inception', year: 2010 }
    );
    expect(p.folder).toBe(path.join(ROOT, 'Inception (2010)'));
    expect(p.videoFile).toContain('Inception (2010).mp4');
  });

  it('falls back to parsed.year when meta.year is 0', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.mkv',
      emptyMeta({ title: 'Old Film', year: 0 }),
      { title: 'Old Film', year: 1999 }
    );
    expect(p.folder).toBe(path.join(ROOT, 'Old Film (1999)'));
  });

  it('extracts year from meta.releaseDate when meta.year is 0 and parsed.year absent', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.mkv',
      emptyMeta({ title: 'From Date', releaseDate: '2019-06-15' }),
      { title: 'From Date' }
    );
    expect(p.folder).toBe(path.join(ROOT, 'From Date (2019)'));
  });

  it('omits year from folder name when no year is available', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.mkv',
      emptyMeta({ title: 'No Year Film' }),
      { title: 'No Year Film' }
    );
    expect(p.folder).toBe(path.join(ROOT, 'No Year Film'));
    expect(p.videoFile).toContain('No Year Film.mkv');
  });

  it('prefers meta.year over parsed.year', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.mkv',
      emptyMeta({ title: 'Conflict', year: 2022 }),
      { title: 'Conflict', year: 1980 }
    );
    expect(p.folder).toContain('2022');
    expect(p.folder).not.toContain('1980');
  });

  it('sanitizes special characters in title', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.mkv',
      emptyMeta({ title: 'Movie: The Sequel', year: 2021 }),
      { title: 'Movie: The Sequel' }
    );
    // sanitizePathComponent removes ':'
    expect(p.folder).not.toContain(':');
    expect(p.folder).toContain('Movie');
    expect(p.folder).toContain('2021');
  });

  it('preserves original file extension', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/film.avi',
      emptyMeta({ title: 'AVI Film', year: 2000 }),
      { title: 'AVI Film', year: 2000 }
    );
    expect(p.videoFile).toMatch(/\.avi$/);
    expect(p.vsmetaFile).toMatch(/\.avi\.vsmeta$/);
  });

  it('handles empty title fallback (line 44 cover)', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/movie.mkv',
      emptyMeta({ title: '', year: 0 }),
      { title: '' }
    );
    expect(p.folder).toBe(path.join(ROOT, ''));
  });

  it('handles invalid releaseDate year format (line 66 cover)', () => {
    const p = computeMoviePaths(
      ROOT,
      '/source/movie.mkv',
      emptyMeta({ title: 'Invalid Date', releaseDate: 'not-a-date' }),
      { title: 'Invalid Date' }
    );
    expect(p.folder).toBe(path.join(ROOT, 'Invalid Date'));
  });
});

// ---------------------------------------------------------------------------
// resolveShowTitle
// ---------------------------------------------------------------------------

describe('resolveShowTitle', () => {
  it('uses meta.title when contentType is 2', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 2, title: 'Breaking Bad' }),
      undefined,
      { title: 'parsed title' }
    );
    expect(title).toBe('Breaking Bad');
  });

  it('ignores meta.title when contentType is 1 (movie), uses sourceShowName', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 1, title: 'Should Be Ignored' }),
      'Source Show Name',
      { title: 'parsed title' }
    );
    expect(title).toBe('Source Show Name');
  });

  it('falls back to sourceShowName when meta.title is empty string (even with contentType 2)', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 2, title: '' }),
      'Fallback Source',
      { title: 'parsed title' }
    );
    expect(title).toBe('Fallback Source');
  });

  it('falls back to parsedTitle when meta.title is empty and sourceShowName is undefined', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 2, title: '' }),
      undefined,
      { title: 'Parsed Title' }
    );
    expect(title).toBe('Parsed Title');
  });

  it('strips year suffix from sourceShowName', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 1, title: '' }),
      'Dark Angel (2000)',
      { title: 'parsed title' }
    );
    expect(title).toBe('Dark Angel');
  });

  it('sanitizes special characters from the resolved title', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 2, title: 'Show: A Drama' }),
      undefined,
      { title: 'parsed' }
    );
    expect(title).not.toContain(':');
  });
});

// ---------------------------------------------------------------------------
// computeShowPaths
// ---------------------------------------------------------------------------

describe('computeShowPaths', () => {
  it('uses meta season/episode when available', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 2, episode: 5 }),
      null,
      { title: 'My Show S02E05' },
    );
    expect(p.season).toBe(2);
    expect(p.episode).toBe(5);
    expect(p.numberSource).toBe('vsmeta');
    expect(p.seasonFolder).toContain('Season 02');
    expect(p.videoFile).toContain('My Show S02E05');
  });

  it('falls back to parsedEpisode when meta has no season/episode', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show' }),
      { title: '', season: 3, episode: 7, episodeTitle: 'Some Title' },
      { title: 'My Show S03E07 Some Title' },
    );
    expect(p.season).toBe(3);
    expect(p.episode).toBe(7);
    expect(p.numberSource).toBe('filename');
    expect(p.videoFile).toContain('S03E07');
    expect(p.videoFile).toContain('Some Title');
  });

  it('defaults to season 1 episode 1 when nothing is available', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Mystery Show' }),
      null,
      { title: 'Mystery Show' },
    );
    expect(p.season).toBe(1);
    expect(p.episode).toBe(1);
    expect(p.numberSource).toBe('default');
    expect(p.seasonFolder).toContain('Season 01');
  });

  it('builds correct path structure', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Breaking Bad', season: 1, episode: 1 }),
      { title: '', season: 1, episode: 1, episodeTitle: 'Pilot' },
      { title: 'Breaking Bad S01E01 Pilot', year: 2008 },
    );
    expect(p.showFolder).toBe(path.join(ROOT, 'Breaking Bad (2008)'));
    expect(p.seasonFolder).toBe(path.join(ROOT, 'Breaking Bad (2008)', 'Season 01'));
    expect(p.videoFile).toBe(path.join(ROOT, 'Breaking Bad (2008)', 'Season 01', 'Breaking Bad S01E01 Pilot.mkv'));
    expect(p.vsmetaFile).toBe(path.join(ROOT, 'Breaking Bad (2008)', 'Season 01', 'Breaking Bad S01E01 Pilot.mkv.vsmeta'));
    expect(p.nfoFile).toBe(path.join(ROOT, 'Breaking Bad (2008)', 'Season 01', 'Breaking Bad S01E01 Pilot.nfo'));
    expect(p.showNfoFile).toBe(path.join(ROOT, 'Breaking Bad (2008)', 'tvshow.nfo'));
    expect(p.showKey).toBe('Breaking Bad (2008)');
  });

  it('prefers file-path year (parsedTitle.year) over premiereYear', () => {
    // File-path year takes priority so that same-name shows from different eras
    // (e.g. "Doctor Who 1963" vs "Doctor Who 2005") land in separate folders.
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 1, episode: 1 }),
      null,
      { title: 'My Show', year: 2006 },  // year extracted from filename
      undefined,
      1973  // vsmeta-derived premiereYear — should NOT win
    );
    expect(p.showFolder).toContain('2006');
    expect(p.showFolder).not.toContain('1973');
  });

  it('falls back to premiereYear when no file-path year is available', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 1, episode: 1 }),
      null,
      { title: 'My Show' },  // no year in filename
      undefined,
      2008  // vsmeta premiereYear used as fallback
    );
    expect(p.showFolder).toContain('2008');
  });

  it('prefers parsedEpisode.episode over meta.episode when both are available', () => {
    // Simulates the Doctor Who case: vsmeta says E01 for multiple episodes
    // but filenames carry the real episode numbers (-2-, -4-, etc.)
    const p = computeShowPaths(
      ROOT,
      '/source/DoctorWho2006 -4- The Girl in the Fireplace.divx',
      emptyMeta({ contentType: 2, title: 'Doctor Who', season: 2, episode: 1 }),
      { title: '', season: 1, episode: 4, episodeTitle: 'The Girl in the Fireplace' },
      { title: 'DoctorWho', year: 2006 },
    );
    expect(p.episode).toBe(4);           // from filename, not vsmeta E01
    expect(p.season).toBe(2);            // from vsmeta (correct)
    expect(p.numberSource).toBe('filename');
    expect(p.showFolder).toContain('2006');
    expect(p.videoFile).toContain('S02E04');
  });

  it('extracts year from sourceShowName "(YYYY)" pattern', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Dark Angel', season: 1, episode: 1 }),
      null,
      { title: 'Dark Angel' },
      'Dark Angel (2000)'
    );
    expect(p.showFolder).toContain('2000');
  });

  it('extracts year from sourceShowName space-separated format "ShowName YYYY"', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Seinfeld', season: 1, episode: 1 }),
      null,
      { title: 'Seinfeld' },
      'Seinfeld 1989'  // year embedded in folder name without parentheses
    );
    expect(p.showFolder).toContain('1989');
  });

  it('does not mistake show titles like "The 4400" for a year', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'The 4400', season: 1, episode: 1 }),
      null,
      { title: 'The 4400' },
      'The 4400'  // "4400" is the title, not a valid year
    );
    // 4400 is outside 1900–2100, so no year should be appended
    expect(p.showFolder).toBe(path.join(ROOT, 'The 4400'));
  });

  it('omits year from show folder when none is available', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Timeless Show', season: 1, episode: 1 }),
      null,
      { title: 'Timeless Show' },
    );
    expect(p.showFolder).toBe(path.join(ROOT, 'Timeless Show'));
  });

  it('includes episode title in filename when parsedEpisode has episodeTitle', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 1, episode: 2 }),
      { title: '', season: 1, episode: 2, episodeTitle: 'Cold Comfort' },
      { title: 'My Show' },
    );
    expect(path.basename(p.videoFile)).toBe('My Show S01E02 Cold Comfort.mkv');
  });

  it('omits episode title from filename when not available', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 1, episode: 3 }),
      null,
      { title: 'My Show' },
    );
    expect(path.basename(p.videoFile)).toBe('My Show S01E03.mkv');
  });

  it('zero-pads single-digit season and episode numbers', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Show', season: 1, episode: 7 }),
      null,
      { title: 'Show' },
    );
    expect(p.seasonFolder).toContain('Season 01');
    expect(path.basename(p.videoFile)).toContain('S01E07');
  });

  it('handles double-digit season and episode numbers', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Long Runner', season: 12, episode: 24 }),
      null,
      { title: 'Long Runner' },
    );
    expect(p.seasonFolder).toContain('Season 12');
    expect(path.basename(p.videoFile)).toContain('S12E24');
  });

  it('uses meta.season 0 for Season 00 (clamped implausible)', () => {
    // Simulates the migrator clamping: caller passes { ...meta, season: 0 }
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'Cartoon Show', season: 0, episode: 42 }),
      null,
      { title: 'Cartoon Show' },
    );
    expect(p.seasonFolder).toContain('Season 00');
    expect(p.season).toBe(0);
  });

  it('sourceShowName without year is used as-is for showTitle when contentType is not 2', () => {
    // When meta has no useful title (contentType 1 = movie metadata used for show)
    // resolveShowTitle picks sourceShowName (year stripped)
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 1, title: '', season: 2, episode: 3 }),
      null,
      { title: 'fallback' },
      'The Wire'
    );
    expect(p.showFolder).toContain('The Wire');
  });

  it('handles multipart episode titles (line 127 cover)', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ contentType: 2, title: 'My Show', season: 1, episode: 1 }),
      { title: '', season: 1, episode: 1, episodeTitle: ['Part', 'One'] },
      { title: 'My Show' },
    );
    expect(path.basename(p.videoFile)).toBe('My Show S01E01 Part One.mkv');
  });

  it('inherits season from parsedEpisode when meta has only episode (line 114 cover)', () => {
    const p = computeShowPaths(
      ROOT,
      '/source/ep.mkv',
      emptyMeta({ episode: 5 }), // meta missing season
      { title: '', season: 2, episode: 5 },
      { title: 'My Show S02E05' },
    );
    expect(p.season).toBe(2);
    expect(p.episode).toBe(5);
    expect(p.numberSource).toBe('filename');
  });

  it('extracts year from grand-parent folder (line 207 cover)', () => {
    // Current walk: currentPath = '/source/Show/Season 1'
    // parent = '/source/Show'
    // parentFolderName = 'Show' -> no year
    // next iteration: currentPath = '/source/Show'
    // parent = '/source'
    // parentFolderName = 'source' -> no year
    // Wait, let's make it '/source/Show (2010)/Season 1/ep.mkv'
    const p = computeShowPaths(
      ROOT,
      '/source/Show (2010)/Season 1/ep.mkv',
      emptyMeta({ title: 'Show' }),
      null,
      { title: 'Show' },
      'Show'
    );
    expect(p.showFolder).toContain('Show (2010)');
  });

  it('handles falsy name in stripYearFromName (line 221 cover)', () => {
    const title = resolveShowTitle(
      emptyMeta({ contentType: 1, title: '' }),
      '', // falsy sourceShowName
      { title: 'Parsed' }
    );
    expect(title).toBe('Parsed');
  });
});
