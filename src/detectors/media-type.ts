/**
 * Detects whether a media file is a movie or a TV show episode.
 *
 * Detection priority:
 *   1. vsmeta data has content type 2 (TV) or season/episode fields → 'show'
 *   2. Filename matches S__E__ or Nx__ pattern → 'show'
 *   3. Any ancestor folder matches "Season N" or "SXX" → 'show'
 *   4. Any ancestor folder name contains the word "show" → 'show'
 *      or the word "movie" → 'movie'  (case-insensitive; matches e.g. "Movies", "TV Shows")
 *   5. Default → 'movie'
 *
 * Season-folder detection (step 3) has higher priority than keyword hints (step 4) so
 * that a file under Movies/SomeSeries/Season 1/ is still detected as a TV show.
 */


import { VsMetaData } from 'vsmeta-parser';
import { parsePath } from 'parse-torrent-path';

export type MediaType = 'movie' | 'show';

/**
 * Detect the media type of a video file.
 *
 * @param filePath  Absolute or relative path to the video file
 * @param meta      Parsed .vsmeta data (may be an empty object)
 * @param forced    If provided, skips detection and returns this value
 */
export function detectMediaType(
  filePath: string,
  meta: VsMetaData,
  forced?: 'movies' | 'shows' | 'auto'
): MediaType {
  if (forced === 'movies') return 'movie';
  if (forced === 'shows') return 'show';

  // 1. vsmeta reports content type 2 (TV show), or has season/episode
  if (meta.contentType === 2) return 'show';
  if (meta.season != null || meta.episode != null) return 'show';

  // 2. Filename pattern
  if (parsePath(filePath).episode !== undefined) return 'show';

  // 3 & 4. Scan ancestor folder names in a single pass.
  //   - Season-folder patterns return immediately (high priority).
  //   - "show"/"movie" keyword hints are remembered and applied after the loop
  //     (lower priority, so a Season folder can override a "Movies" ancestor).
  //
  // Only examine the innermost ancestor folders (at most 5).  Scanning the
  // full absolute path risks false keyword matches on OS-level directories
  // that are unrelated to the media library (e.g. a NAS share or user account
  // named "movies" would misclassify everything stored beneath it).
  const parts = filePath.split(/[\\/]/);
  const ancestorParts = parts.slice(0, -1).slice(-5);
  let pathHint: MediaType | undefined;
  for (const part of ancestorParts) {
    // Step 3: explicit season-folder patterns → definitive 'show'
    const isSeasonFolder =
      /^Season\s+\d+$/i.test(part) ||
      /^[Ss]\d{1,2}$/.test(part);
    if (isSeasonFolder) return 'show';
    // Step 4: keyword hints (last match wins if multiple keywords appear)
    if (/\bshows?\b/i.test(part)) pathHint = 'show';
    else if (/\bmovies?\b/i.test(part)) pathHint = 'movie';
  }

  // Apply keyword hint if any was found
  if (pathHint) return pathHint;

  // 5. Default
  return 'movie';
}
