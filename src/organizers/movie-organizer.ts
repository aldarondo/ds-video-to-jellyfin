/**
 * Computes the Jellyfin-standard output path for a movie file and writes it.
 *
 * Output structure:
 *   <outputRoot>/
 *     <Movie Title (Year)>/
 *       <Movie Title (Year)>.ext       ← video file
 *       <Movie Title (Year)>.ext.vsmeta ← DS Video metadata (copied)
 *       movie.nfo                      ← Jellyfin metadata (generated)
 *       poster.jpg
 *       fanart.jpg
 */

import path from 'path';
import { VsMetaData } from '../parsers/vsmeta.js';
import { ParsedMovieInfo, sanitizePathComponent } from '../utils/filename-parser.js';

export interface MoviePaths {
  /** Absolute path to the output movie folder */
  folder: string;
  /** Absolute path for the video file in the output */
  videoFile: string;
  /** Absolute path for the .vsmeta file in the output */
  vsmetaFile: string;
  /** Absolute path for the movie.nfo file */
  nfoFile: string;
}

/**
 * Compute output paths for a movie.
 *
 * @param outputRoot   Root output directory
 * @param sourceFile   Absolute path to the source video file
 * @param meta         Parsed .vsmeta data
 * @param parsed       Filename-parsed movie info (fallback)
 */
export function computeMoviePaths(
  outputRoot: string,
  sourceFile: string,
  meta: VsMetaData,
  parsed: ParsedMovieInfo
): MoviePaths {
  const title = sanitizePathComponent(meta.title || parsed.title);
  const year =
    meta.year ||
    parsed.year ||
    (meta.releaseDate ? extractYear(meta.releaseDate) : undefined);

  const folderName = year ? `${title} (${year})` : title;
  const ext = path.extname(sourceFile);
  const videoFilename = `${folderName}${ext}`;

  const folder = path.join(outputRoot, folderName);

  return {
    folder,
    videoFile: path.join(folder, videoFilename),
    vsmetaFile: path.join(folder, `${videoFilename}.vsmeta`),
    nfoFile: path.join(folder, 'movie.nfo'),
  };
}

function extractYear(dateStr: string): number | undefined {
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}
