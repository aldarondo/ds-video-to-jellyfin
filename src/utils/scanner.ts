/**
 * Recursively scans a directory for video files.
 * Skips @eaDir (Synology thumbnail directories) and hidden folders.
 */

import fs from 'fs';
import path from 'path';

/** Video file extensions to include */
const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v',
  '.ts', '.m2ts', '.webm', '.flv', '.ogv', '.divx',
  '.mpg', '.mpeg', '.vob', '.iso',
]);

/** Directories to skip when scanning */
const SKIP_DIRS = new Set(['@eaDir', '@tmp', '.@__thumb', '#recycle', '@Recycle']);

export interface ScanResult {
  /** Absolute path to the video file */
  videoFile: string;
  /** Absolute path to the adjacent .vsmeta file, if it exists */
  vsmetaFile: string | null;
}

/**
 * Recursively scan a directory and return all video files with their
 * optional .vsmeta sidecar paths.
 */
export function scanDirectory(dir: string): ScanResult[] {
  const results: ScanResult[] = [];
  scanRecursive(dir, results);
  return results;
}

function scanRecursive(dir: string, results: ScanResult[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // skip unreadable directories
  }

  // Build a Set of all filenames in this directory so .vsmeta existence checks
  // are O(1) lookups instead of a stat syscall per video file.
  const fileNames = new Set(entries.map(e => e.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanRecursive(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        const vsmetaName = `${entry.name}.vsmeta`;
        results.push({
          videoFile: fullPath,
          vsmetaFile: fileNames.has(vsmetaName) ? `${fullPath}.vsmeta` : null,
        });
      }
    }
  }
}
