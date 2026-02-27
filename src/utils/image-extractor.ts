/**
 * Extracts and writes artwork images for a media file.
 *
 * Sources (in priority order):
 *   1. Embedded images in .vsmeta (posterImage, backdropImage, thumbnailImage)
 *   2. Synology @eaDir thumbnails alongside the source file
 *
 * Writes Jellyfin-standard filenames:
 *   poster.jpg   — main artwork / cover
 *   fanart.jpg   — backdrop / background
 */

import fs from 'fs';
import path from 'path';
import { VsMetaData } from '../parsers/vsmeta.js';

export interface ImageWriteResult {
  poster?: string;
  fanart?: string;
}

/**
 * Extract and save images for a media item.
 *
 * @param meta          Parsed vsmeta data
 * @param sourceFile    Absolute path to the source video file (for @eaDir fallback)
 * @param outputDir     Directory to write poster.jpg and fanart.jpg into
 * @param dryRun        If true, don't write anything (preview only)
 * @param wetRun        If true, write a .txt placeholder instead of the real image
 * @param overwrite     If false (default), skip writing if the destination already exists
 */
export function extractImages(
  meta: VsMetaData,
  sourceFile: string,
  outputDir: string,
  dryRun = false,
  wetRun = false,
  overwrite = false
): ImageWriteResult {
  const result: ImageWriteResult = {};

  // Poster
  const posterBuf = meta.posterImage ?? findEaDirImage(sourceFile, 'POSTER');
  if (posterBuf) {
    const dest = path.join(outputDir, 'poster.jpg');
    if (!dryRun) {
      const destExists = fs.existsSync(wetRun ? dest + '.txt' : dest);
      if (overwrite || !destExists) {
        if (wetRun) {
          fs.writeFileSync(
            dest + '.txt',
            `[WET RUN PLACEHOLDER]\nWould extract poster image from: ${sourceFile}\nTo: ${dest}\n`,
            'utf8'
          );
        } else {
          fs.writeFileSync(dest, posterBuf);
        }
      }
    }
    result.poster = dest;
  }

  // Fanart / backdrop
  const fanartBuf = meta.backdropImage ?? findEaDirImage(sourceFile, 'BACKDROP');
  if (fanartBuf) {
    const dest = path.join(outputDir, 'fanart.jpg');
    if (!dryRun) {
      const destExists = fs.existsSync(wetRun ? dest + '.txt' : dest);
      if (overwrite || !destExists) {
        if (wetRun) {
          fs.writeFileSync(
            dest + '.txt',
            `[WET RUN PLACEHOLDER]\nWould extract fanart image from: ${sourceFile}\nTo: ${dest}\n`,
            'utf8'
          );
        } else {
          fs.writeFileSync(dest, fanartBuf);
        }
      }
    }
    result.fanart = dest;
  }

  return result;
}

/**
 * Look for a Synology @eaDir thumbnail image alongside the source file.
 * Synology stores thumbnails in <parent>/@eaDir/<filename>/SYNOPHOTO:THUMB_*.jpg
 *
 * @eaDir only contains video thumbnails, not separate backdrop images.
 * Returns null for BACKDROP requests since there is no @eaDir equivalent —
 * using the thumbnail as a backdrop would produce a duplicate of the poster.
 */
function findEaDirImage(sourceFile: string, type: 'POSTER' | 'BACKDROP'): Buffer | null {
  // Synology thumbnails are frame grabs / covers, not widescreen backdrops.
  // Writing the same image to both poster.jpg and fanart.jpg would confuse Jellyfin.
  if (type === 'BACKDROP') return null;

  const dir = path.dirname(sourceFile);
  const filename = path.basename(sourceFile);
  const eaDir = path.join(dir, '@eaDir', filename);

  if (!fs.existsSync(eaDir)) return null;

  // Synology generates several thumbnail sizes — pick the largest
  const candidates = ['SYNOPHOTO:THUMB_XL.jpg', 'SYNOPHOTO:THUMB_L.jpg', 'SYNOPHOTO:THUMB_M.jpg'];
  for (const candidate of candidates) {
    const p = path.join(eaDir, candidate);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {
        // ignore read errors
      }
    }
  }

  // Also try non-colon filenames (some filesystems don't support colons)
  const altCandidates = ['THUMB_XL.jpg', 'THUMB_L.jpg', 'THUMB_M.jpg'];
  for (const candidate of altCandidates) {
    const p = path.join(eaDir, candidate);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {
        // ignore
      }
    }
  }

  return null;
}
