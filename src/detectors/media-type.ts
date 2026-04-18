/**
 * Detects whether a media file is a movie or a TV show episode.
 *
 * Detection priority:
 *   1. forced type ('movies' / 'shows') → immediate
 *   2. Any ancestor folder matches "Season N" or "SXX" → 'show' (immediate)
 *   3. Any ancestor folder name contains the word "movie" → 'movie' (immediate,
 *      overrides vsmeta — a file inside a "Movies" folder is trusted as a movie
 *      even if DS Video mislabelled it as a show in the .vsmeta)
 *   4. vsmeta data has content type 2 (TV) or season/episode fields → 'show'
 *   5. Filename matches S__E__ or Nx__ pattern → 'show'
 *   6. Any ancestor folder name contains the word "show" → 'show'
 *   7. Default → 'movie'
 *
 * Rationale for step 3 taking priority over vsmeta: DS Video occasionally
 * mislabels documentary or standalone films as TV show episodes (contentType 2).
 * When the file lives inside a folder whose name contains "movie" or "movies",
 * the directory structure is a more reliable signal than the vsmeta tag.
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

  // Scan all ancestor folder names (at most 5 innermost) and collect signals.
  // Only examine innermost folders — scanning the full absolute path risks
  // false keyword matches on OS-level directories unrelated to the media
  // library (e.g. a NAS share or user account named "movies").
  const parts = filePath.split(/[\\/]/);
  const ancestorParts = parts.slice(0, -1).slice(-5);
  let hasSeasonFolder = false;
  let hasMovieKeyword = false;
  let hasShowKeyword = false;
  for (const part of ancestorParts) {
    if (/^Season\s+\d+$/i.test(part) || /^[Ss]\d{1,2}$/.test(part)) hasSeasonFolder = true;
    else if (/\bmovies?\b/i.test(part)) hasMovieKeyword = true;
    else if (/\bshows?\b/i.test(part)) hasShowKeyword = true;
  }

  // Step 2: Season folder is the strongest path signal — always 'show'.
  // This handles "Movies/SomeSeries/Season 1/" correctly.
  if (hasSeasonFolder) return 'show';

  // Step 3: "movie" keyword in path overrides vsmeta.
  // A file inside a "Movies" or "Disney Movies" folder is treated as a movie
  // even if DS Video mislabelled its .vsmeta with contentType 2.
  if (hasMovieKeyword) return 'movie';

  // Step 4: vsmeta reports content type 2 (TV show), or has season/episode
  if (meta.contentType === 2) return 'show';
  if (meta.season != null || meta.episode != null) return 'show';

  // Step 5: Filename pattern
  if (parsePath(filePath).episode !== undefined) return 'show';

  // Step 6: "show" keyword path hint
  if (hasShowKeyword) return 'show';

  // Step 7: Default
  return 'movie';
}
