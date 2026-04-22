/**
 * Integration tests for migrate().
 *
 * Strategy:
 *   - Real temp directories on disk — actual file I/O happens.
 *   - Empty video files (zero bytes) — content doesn't matter, only paths.
 *   - Fake .vsmeta files written as JSON — the vsmeta-parser mock reads them
 *     back as JSON so each test controls exactly what metadata is returned.
 *   - vsmeta-to-jpeg / vsmeta-to-nfo are mocked (they require real binary
 *     vsmeta data; we're testing migration routing, not image conversion).
 *
 * Coverage:
 *   - All path-based detection modes (Season folder, movie/show keyword,
 *     episode pattern, embedded season in folder name)
 *   - vsmeta-driven detection (contentType 1 movie, contentType 2 show)
 *   - Folder-context inheritance (file with no vsmeta in a show folder)
 *   - File operation modes: copy, hardlink, dry run, overwrite
 *   - Fatal EEXIST on second run without --overwrite
 *   - Multi-file / multi-season scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { VsMetaData } from 'vsmeta-parser';
import { migrate } from '../src/migrator.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Parse fake .vsmeta files written as JSON by writeVsmeta() below.
// Falls back to a default movie meta for any file not written by this test suite.
vi.mock('vsmeta-parser', () => ({
  parseVsMeta: vi.fn((buf: Buffer) => {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return blankMeta();
    }
  }),
}));

// Artwork and NFO converters need real binary vsmeta — mock them out.
vi.mock('vsmeta-to-jpeg', () => ({
  convertVsMetaToJpeg: vi.fn(() => ({ status: 'OK', message: '' })),
}));

vi.mock('vsmeta-to-nfo', () => ({
  convertVsMetaToNfo: vi.fn(() => ({ status: 'OK', message: '' })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blankMeta(overrides: Partial<VsMetaData> = {}): VsMetaData {
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

/** Create an empty file, ensuring parent directories exist. */
function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
}

/** Write a fake .vsmeta file as JSON — consumed by the vsmeta-parser mock. */
function writeVsmeta(filePath: string, meta: Partial<VsMetaData> = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(blankMeta(meta)), 'utf8');
}

/** Return the file names (no directories) inside a directory, sorted. */
function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter(name => fs.statSync(path.join(dir, name)).isFile())
    .sort();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('migrate() integration', () => {
  let tmpRoot: string;
  let inputDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsvj-test-'));
    inputDir = path.join(tmpRoot, 'input');
    outputDir = path.join(tmpRoot, 'output');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Convenience wrapper — all options default to the safest/simplest values. */
  function run(overrides: Partial<Parameters<typeof migrate>[0]> = {}) {
    return migrate({
      input: inputDir,
      output: outputDir,
      type: 'auto',
      move: false,
      hardlink: false,
      dryRun: false,
      wetRun: false,
      noImages: true,
      overwrite: false,
      log: () => {},
      warn: () => {},
      ...overrides,
    });
  }

  // =========================================================================
  // Path-based detection (no .vsmeta)
  // =========================================================================

  describe('path-based detection', () => {
    it('detects a movie from a flat filename containing a year', async () => {
      touch(path.join(inputDir, 'The.Matrix.1999.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'The Matrix (1999)', 'The Matrix (1999).mkv'))).toBe(true);
    });

    it('detects a movie inside a folder containing the word "Movies"', async () => {
      touch(path.join(inputDir, 'Movies', 'Inception.2010.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'Inception (2010)', 'Inception (2010).mkv'))).toBe(true);
    });

    it('detects a TV show from a "Season N" ancestor folder', async () => {
      touch(path.join(inputDir, 'Breaking Bad', 'Season 1', 'Breaking.Bad.S01E01.Pilot.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(
        path.join(outputDir, 'Breaking Bad', 'Season 01', 'Breaking Bad S01E01 Pilot.mkv')
      )).toBe(true);
    });

    it('detects a TV show from a "SNN" (short season folder) ancestor', async () => {
      touch(path.join(inputDir, 'Firefly', 'S01', 'firefly.s01e01.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      expect(fs.existsSync(path.join(outputDir, 'Firefly', 'Season 01'))).toBe(true);
    });

    it('detects a TV show from an S##E## filename pattern (no season folder)', async () => {
      touch(path.join(inputDir, 'Dexter', 'dexter.s02e05.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      const files = listFiles(path.join(outputDir, 'Dexter', 'Season 02'));
      expect(files.some(f => f.includes('S02E05'))).toBe(true);
    });

    it('detects a TV show from a NxNN filename pattern', async () => {
      touch(path.join(inputDir, 'Seinfeld', 'seinfeld.3x04.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      const files = listFiles(path.join(outputDir, 'Seinfeld', 'Season 03'));
      expect(files.some(f => f.includes('S03E04'))).toBe(true);
    });

    it('detects a show from a "TV Shows" keyword ancestor folder', async () => {
      touch(path.join(inputDir, 'TV Shows', 'Friends', 'friends.1x01.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      expect(fs.existsSync(path.join(outputDir, 'Friends', 'Season 01'))).toBe(true);
    });

    it('strips embedded "Season N" suffix from DS Video-style folder names', async () => {
      // DS Video sometimes names folders "Show Name Season 2" instead of nesting
      touch(path.join(inputDir, 'Dark Angel Season 1', 'S1 - E01 - Pilot.avi'));

      const result = await run();

      expect(result.processed).toBe(1);
      // Show folder should be "Dark Angel", season stripped
      expect(fs.existsSync(path.join(outputDir, 'Dark Angel', 'Season 01'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Dark Angel Season 1'))).toBe(false);
    });

    it('Season folder beats "Movies" keyword — show wins', async () => {
      // File is inside both a "Movies" folder AND a "Season 1" folder.
      // The Season folder is the stronger signal.
      touch(path.join(inputDir, 'Movies', 'Some Series', 'Season 1', 'some.series.s01e01.mkv'));

      const result = await run();

      expect(result.processed).toBe(1);
      // Must land in a Season subfolder (show structure), not a flat movie folder
      expect(fs.existsSync(path.join(outputDir, 'Some Series', 'Season 01'))).toBe(true);
    });

    it('--type movies forces show-structured files to be treated as movies', async () => {
      // Without the override this would be a show (Season folder present)
      touch(path.join(inputDir, 'Breaking Bad', 'Season 1', 'Breaking.Bad.S01E01.mkv'));

      const result = await run({ type: 'movies' });

      expect(result.processed).toBe(1);
      // No Season 01 subfolder should exist in output
      expect(fs.existsSync(path.join(outputDir, 'Breaking Bad', 'Season 01'))).toBe(false);
    });

    it('--type shows forces flat files to be treated as shows', async () => {
      // Without the override this would be a movie (no season folder, no episode pattern)
      touch(path.join(inputDir, 'Standalone.Film.2019.mkv'));

      const result = await run({ type: 'shows' });

      expect(result.processed).toBe(1);
      // Output must have a Season subfolder (show structure)
      const showDirs = fs.readdirSync(outputDir);
      const hasSeasonFolder = showDirs.some(d => {
        const sub = path.join(outputDir, d);
        if (!fs.statSync(sub).isDirectory()) return false;
        return fs.readdirSync(sub).some(s => s.startsWith('Season'));
      });
      expect(hasSeasonFolder).toBe(true);
    });
  });

  // =========================================================================
  // vsmeta-driven detection
  // =========================================================================

  describe('vsmeta-driven detection', () => {
    it('routes to movie output when vsmeta has contentType 1', async () => {
      const videoFile = path.join(inputDir, 'misc', 'somefile.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, { contentType: 1, title: 'Cool Movie', year: 2020 });

      const result = await run();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'Cool Movie (2020)', 'Cool Movie (2020).mkv'))).toBe(true);
    });

    it('routes to show output when vsmeta has contentType 2 with season/episode', async () => {
      const videoFile = path.join(inputDir, 'misc', 'ep.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, {
        contentType: 2,
        title: 'Some Show',
        season: 1,
        episode: 3,
      });

      const result = await run();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(
        path.join(outputDir, 'Some Show', 'Season 01', 'Some Show S01E03.mkv')
      )).toBe(true);
    });

    it('copies .vsmeta sidecar to the output next to the video file', async () => {
      const videoFile = path.join(inputDir, 'misc', 'ep.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, {
        contentType: 2,
        title: 'My Show',
        season: 2,
        episode: 7,
      });

      await run();

      expect(fs.existsSync(
        path.join(outputDir, 'My Show', 'Season 02', 'My Show S02E07.mkv.vsmeta')
      )).toBe(true);
    });

    it('overrideYears corrects a wrong-but-plausible vsmeta year', async () => {
      // DS Video sometimes stores a plausible-but-wrong year (e.g. Heroes → 1961).
      // overrideYears must win over whatever the vsmeta says.
      const videoFile = path.join(inputDir, 'Heroes', 'Season 1', 'heroes.s01e01.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, {
        contentType: 2,
        title: 'Heroes',
        year: 1961,   // corrupt value from DS Video
        season: 1,
        episode: 1,
      });

      await run({ overrideYears: new Map([['Heroes', 2006]]) });

      expect(fs.existsSync(path.join(outputDir, 'Heroes (2006)', 'Season 01'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Heroes (1961)'))).toBe(false);
    });

    it('torrent-style folder names are parsed to extract the real show title', async () => {
      // Source folder: "Humans.S02E02.HDTV.x264-TLA[ettv]" — a torrent release group name.
      // inferShowName should extract "Humans" via parsePath, not use the full folder name.
      const dir = path.join(inputDir, 'Humans.S02E02.HDTV.x264-TLA');
      touch(path.join(dir, 'Humans.S02E02.HDTV.x264-TLA.mkv'));

      await run({ overrideYears: new Map([['Humans', 2015]]) });

      // Output must be under "Humans (2015)", not the full torrent folder name
      expect(fs.existsSync(path.join(outputDir, 'Humans (2015)', 'Season 02'))).toBe(true);
      expect(fs.readdirSync(outputDir).some(d => d.includes('TLA'))).toBe(false);
    });

    it('ignores corrupt vsmeta year values outside 1900–2100 (e.g. year = 4)', async () => {
      // DS Video sometimes stores a corrupt year (e.g. 4) in the vsmeta.
      // Without a plausibility guard this produces folder names like "Arthur (4)".
      // The corrupt year should be dropped; the show should use no year or fall back
      // to folder/filename year detection.
      const videoFile = path.join(inputDir, 'Arthur', 'Season 1', 'arthur.s01e01.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, {
        contentType: 2,
        title: 'Arthur',
        year: 4,       // corrupt value from DS Video
        season: 1,
        episode: 1,
      });

      const result = await run();

      expect(result.processed).toBe(1);
      // Must NOT produce "Arthur (4)"
      expect(fs.existsSync(path.join(outputDir, 'Arthur (4)'))).toBe(false);
      // Should produce "Arthur" (no year) or "Arthur (YYYY)" with a plausible year
      const outputDirs = fs.readdirSync(outputDir).filter(d =>
        fs.statSync(path.join(outputDir, d)).isDirectory()
      );
      expect(outputDirs.some(d => d.startsWith('Arthur'))).toBe(true);
      expect(outputDirs.every(d => !d.includes('(4)'))).toBe(true);
    });

    it('"movies" keyword ancestor overrides vsmeta contentType 2 (DS Video mislabel)', async () => {
      // DS Video sometimes tags standalone films with contentType 2.
      // A file inside a "Movies" folder should still be treated as a movie.
      const videoFile = path.join(inputDir, 'Movies', 'standalone.mkv');
      touch(videoFile);
      writeVsmeta(`${videoFile}.vsmeta`, { contentType: 2, title: 'Standalone Film', year: 2018 });

      const result = await run();

      expect(result.processed).toBe(1);
      // Should land in movie structure (no Season subfolder)
      expect(fs.existsSync(path.join(outputDir, 'Standalone Film (2018)', 'Standalone Film (2018).mkv'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Standalone Film (2018)', 'Season 01'))).toBe(false);
    });

    it('folder context: files without .vsmeta inherit show identity from siblings that have it', async () => {
      // ep1 has vsmeta marking it as a show; ep2 has no vsmeta and no episode pattern.
      // The folder context map should cause ep2 to be routed as a show episode too.
      const dir = path.join(inputDir, 'misc');
      touch(path.join(dir, 'episode1.avi'));
      touch(path.join(dir, 'episode2.avi'));
      writeVsmeta(path.join(dir, 'episode1.avi.vsmeta'), {
        contentType: 2,
        title: 'Orphan Show',
        season: 1,
        episode: 1,
      });

      const result = await run();

      expect(result.processed).toBe(2);
      // Both files should end up under "Orphan Show" (not as movies)
      const showDir = path.join(outputDir, 'Orphan Show');
      expect(fs.existsSync(showDir)).toBe(true);
    });
  });

  // =========================================================================
  // File operation modes
  // =========================================================================

  describe('file operation modes', () => {
    it('dry run: processes files but writes nothing to output', async () => {
      touch(path.join(inputDir, 'The.Matrix.1999.mkv'));

      const result = await run({ dryRun: true });

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      // Output directory must remain empty
      expect(fs.readdirSync(outputDir)).toHaveLength(0);
    });

    it('copy mode: source file is preserved, destination is an independent copy', async () => {
      const src = path.join(inputDir, 'The.Matrix.1999.mkv');
      fs.writeFileSync(src, 'fake video data');

      await run();

      const dest = path.join(outputDir, 'The Matrix (1999)', 'The Matrix (1999).mkv');
      expect(fs.existsSync(src)).toBe(true);
      expect(fs.existsSync(dest)).toBe(true);
      // Modifying src should NOT affect dest (independent copy, not a hardlink)
      fs.writeFileSync(src, 'changed');
      expect(fs.readFileSync(dest, 'utf8')).toBe('fake video data');
    });

    it('hardlink mode: both paths share the same underlying data', async () => {
      const src = path.join(inputDir, 'The.Matrix.1999.mkv');
      fs.writeFileSync(src, 'original');

      const result = await run({ hardlink: true });

      expect(result.errors).toBe(0);
      const dest = path.join(outputDir, 'The Matrix (1999)', 'The Matrix (1999).mkv');
      expect(fs.existsSync(dest)).toBe(true);
      // Overwriting via src should be visible through dest (same inode / hardlink)
      fs.writeFileSync(src, 'updated via src');
      expect(fs.readFileSync(dest, 'utf8')).toBe('updated via src');
    });

    it('overwrite mode: second run succeeds and updates existing files', async () => {
      touch(path.join(inputDir, 'The.Matrix.1999.mkv'));
      await run();

      const result = await run({ overwrite: true });

      expect(result.errors).toBe(0);
      expect(result.processed).toBe(1);
    });

    it('without --overwrite: second run is a fatal error (EEXIST)', async () => {
      touch(path.join(inputDir, 'The.Matrix.1999.mkv'));
      await run();

      await expect(run()).rejects.toThrow('Output file already exists');
    });
  });

  // =========================================================================
  // Multi-file scenarios
  // =========================================================================

  describe('multi-file scenarios', () => {
    it('processes multiple movies to separate output folders', async () => {
      touch(path.join(inputDir, 'The.Matrix.1999.mkv'));
      touch(path.join(inputDir, 'Inception.2010.mkv'));
      touch(path.join(inputDir, 'Interstellar.2014.mkv'));

      const result = await run();

      expect(result.processed).toBe(3);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'The Matrix (1999)'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Inception (2010)'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Interstellar (2014)'))).toBe(true);
    });

    it('processes multiple seasons of the same show into season subfolders', async () => {
      for (let ep = 1; ep <= 3; ep++) {
        touch(path.join(inputDir, 'Seinfeld', 'Season 1', `seinfeld.s01e0${ep}.mkv`));
        touch(path.join(inputDir, 'Seinfeld', 'Season 2', `seinfeld.s02e0${ep}.mkv`));
      }

      const result = await run();

      expect(result.processed).toBe(6);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'Seinfeld', 'Season 01'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Seinfeld', 'Season 02'))).toBe(true);
      expect(listFiles(path.join(outputDir, 'Seinfeld', 'Season 01'))).toHaveLength(3);
      expect(listFiles(path.join(outputDir, 'Seinfeld', 'Season 02'))).toHaveLength(3);
    });

    it('handles mixed movie and show content in the same input tree', async () => {
      touch(path.join(inputDir, 'Movies', 'Inception.2010.mkv'));
      touch(path.join(inputDir, 'TV Shows', 'Breaking Bad', 'Season 1', 'Breaking.Bad.S01E01.mkv'));

      const result = await run();

      expect(result.processed).toBe(2);
      expect(result.errors).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'Inception (2010)'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'Breaking Bad', 'Season 01'))).toBe(true);
    });

    it('returns 0 processed and 0 errors for an empty input directory', async () => {
      const result = await run();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
    });
  });
});
