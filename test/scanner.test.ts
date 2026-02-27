import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanDirectory, ScanResult } from '../src/utils/scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory tree for a test.
 * Returns the root path; caller should clean up with `fs.rmSync(root, { recursive: true })`.
 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

// ---------------------------------------------------------------------------
// scanDirectory
// ---------------------------------------------------------------------------

describe('scanDirectory', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── basic discovery ───────────────────────────────────────────────────────

  it('returns an empty array for an empty directory', () => {
    expect(scanDirectory(root)).toEqual([]);
  });

  it('discovers a single video file with no vsmeta', () => {
    touch(path.join(root, 'movie.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].videoFile).toBe(path.join(root, 'movie.mkv'));
    expect(results[0].vsmetaFile).toBeNull();
  });

  it('associates a vsmeta sidecar file with the video', () => {
    touch(path.join(root, 'movie.mkv'));
    touch(path.join(root, 'movie.mkv.vsmeta'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].vsmetaFile).toBe(path.join(root, 'movie.mkv.vsmeta'));
  });

  it('does not include the .vsmeta file itself as a video result', () => {
    touch(path.join(root, 'movie.mkv'));
    touch(path.join(root, 'movie.mkv.vsmeta'));
    const results = scanDirectory(root);
    const files = results.map(r => r.videoFile);
    expect(files.every(f => !f.endsWith('.vsmeta'))).toBe(true);
  });

  // ── multiple extensions ───────────────────────────────────────────────────

  it('detects all supported video extensions', () => {
    const exts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v',
                  '.ts', '.m2ts', '.webm', '.flv', '.ogv', '.divx',
                  '.mpg', '.mpeg', '.vob', '.iso'];
    for (const ext of exts) {
      touch(path.join(root, `video${ext}`));
    }
    const results = scanDirectory(root);
    expect(results).toHaveLength(exts.length);
  });

  it('ignores non-video files', () => {
    touch(path.join(root, 'readme.txt'));
    touch(path.join(root, 'image.jpg'));
    touch(path.join(root, 'subtitle.srt'));
    touch(path.join(root, 'video.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].videoFile).toContain('video.mkv');
  });

  it('is case-insensitive for extensions', () => {
    touch(path.join(root, 'VIDEO.MKV'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
  });

  // ── recursion ─────────────────────────────────────────────────────────────

  it('recurses into subdirectories', () => {
    touch(path.join(root, 'Movies', 'Inception (2010)', 'Inception (2010).mkv'));
    touch(path.join(root, 'Movies', 'The Matrix (1999)', 'The Matrix (1999).mp4'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(2);
  });

  it('recurses into nested show season folders', () => {
    touch(path.join(root, 'Shows', 'Breaking Bad (2008)', 'Season 01', 'ep01.mkv'));
    touch(path.join(root, 'Shows', 'Breaking Bad (2008)', 'Season 02', 'ep01.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(2);
  });

  it('correctly pairs vsmeta in deeply nested subdirectory', () => {
    const epDir = path.join(root, 'Shows', 'My Show', 'Season 01');
    touch(path.join(epDir, 'ep.mkv'));
    touch(path.join(epDir, 'ep.mkv.vsmeta'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].vsmetaFile).toBe(path.join(epDir, 'ep.mkv.vsmeta'));
  });

  // ── skipped directories ───────────────────────────────────────────────────

  it('skips @eaDir (Synology thumbnails)', () => {
    touch(path.join(root, '@eaDir', 'thumb.mkv'));
    touch(path.join(root, 'real.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].videoFile).toContain('real.mkv');
  });

  it('skips @tmp directory', () => {
    touch(path.join(root, '@tmp', 'temp.mkv'));
    touch(path.join(root, 'real.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
  });

  it('skips #recycle directory', () => {
    touch(path.join(root, '#recycle', 'old.mkv'));
    touch(path.join(root, 'real.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
  });

  it('skips @Recycle directory', () => {
    touch(path.join(root, '@Recycle', 'old.mkv'));
    touch(path.join(root, 'real.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
  });

  it('skips .@__thumb directory', () => {
    touch(path.join(root, '.@__thumb', 'thumb.mkv'));
    touch(path.join(root, 'real.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
  });

  it('skips hidden directories (starting with .)', () => {
    touch(path.join(root, '.hidden', 'video.mkv'));
    touch(path.join(root, 'visible.mkv'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].videoFile).toContain('visible.mkv');
  });

  // ── robustness ────────────────────────────────────────────────────────────

  it('returns empty array for a non-existent directory (no throw)', () => {
    expect(() => scanDirectory(path.join(root, 'does-not-exist'))).not.toThrow();
    expect(scanDirectory(path.join(root, 'does-not-exist'))).toEqual([]);
  });

  it('handles a directory with both videos and irrelevant files at same level', () => {
    touch(path.join(root, 'movie.mkv'));
    touch(path.join(root, 'movie.mkv.vsmeta'));
    touch(path.join(root, 'poster.jpg'));
    touch(path.join(root, 'fanart.jpg'));
    touch(path.join(root, 'movie.nfo'));
    const results = scanDirectory(root);
    expect(results).toHaveLength(1);
    expect(results[0].videoFile).toContain('movie.mkv');
    expect(results[0].vsmetaFile).toContain('movie.mkv.vsmeta');
  });
});
