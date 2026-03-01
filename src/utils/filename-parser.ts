import { parsePath, ParsedInfo } from 'parse-torrent-path';

export type ParsedEpisodeInfo = ParsedInfo;
export type ParsedMovieInfo = ParsedInfo;

/**
 * Extract season and episode numbers from a file path.
 */
export function parseEpisodeFilename(filePath: string): ParsedEpisodeInfo | null {
  const result = parsePath(filePath);
  if (result.episode !== undefined) {
    if (result.episodeTitle) {
      return { ...result, episodeTitle: cleanTitle(result.episodeTitle) };
    }
    return result;
  }

  // Fallback for DS Video "-N-" standalone episode pattern - usually in basename
  const filename = filePath.split(/[\\/]/).pop() || filePath;
  const standaloneMatch = filename.match(/(?:^|[\s._-])-?\s*(\d{1,3})\s*-?(?:[\s._-]|$)/);
  if (standaloneMatch) {
    const episode = parseInt(standaloneMatch[1], 10);
    // Try to extract title after the pattern
    const rest = filename.substring(standaloneMatch.index! + standaloneMatch[0].length);
    const episodeTitle = cleanTitle(rest);
    return { ...result, episode, episodeTitle };
  }

  return null;
}

/**
 * Extract season number from a folder or file path.
 */
export function parseSeasonFolder(filePath: string): number | null {
  const result = parsePath(filePath);
  if (result.season !== undefined) return result.season;

  // Minimal fallback for "Season N" or "SN" - check the relevant path component
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const m = name.match(/^(?:Season\s+|S)([0-9]{1,2})$/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract title and year from a movie file path.
 */
export function parseMovieFilename(filePath: string): ParsedMovieInfo {
  const result = parsePath(filePath);

  // Fallback for mashed years like "DoctorWho2006" - usually in basename
  if (result.year === undefined || Number.isNaN(result.year)) {
    const filename = filePath.split(/[\\/]/).pop() || filePath;
    const mashedYear = filename.match(/([a-zA-Z]+)(\d{4})\b/);
    if (mashedYear) {
      const year = parseInt(mashedYear[2], 10);
      if (year >= 1900 && year <= 2100) {
        return { ...result, title: mashedYear[1], year };
      }
    }
  }

  return result;
}

/**
 * Sanitize a string for use as a filesystem path component.
 * Removes characters reserved on Windows/Linux/macOS.
 */
export function sanitizePathComponent(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // reserved chars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, ''); // Windows forbids names that end with a period
}

/**
 * Format a season number as a zero-padded string (e.g. 1 → "01").
 */
export function formatSeason(season: number): string {
  return String(season).padStart(2, '0');
}

/**
 * Format an episode number as a zero-padded string (e.g. 3 → "03").
 */
export function formatEpisode(episode: number): string {
  return String(episode).padStart(2, '0');
}

/**
 * Extract year from a date string (various formats: YYYY-MM-DD, YYYY, etc.)
 */
export function extractYear(dateStr: string): number | undefined {
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Extras keyword patterns recognised by DS Video, Jellyfin, and Emby.
 * Matches filenames that represent supplementary content (DVD extras, making-of
 * featurettes, interview clips, deleted scenes, etc.) rather than regular episodes.
 *
 * Word-boundary anchors prevent false matches on words that merely contain one of
 * these roots (e.g. "Extraordinary" won't match `extra`).
 */
const EXTRAS_PATTERN =
  /\b(?:extras?|bts|featurettes?|behind[\s_-]the[\s_-]scenes?|deleted[\s_-]scenes?|interviews?|trailers?|bloopers?|outtakes?|shorts?|making[\s_-]of|bonus)\b/i;

/**
 * Returns true when a filename (without extension) looks like a bonus extra
 * rather than a regular episode.  Files matching this pattern are routed to an
 * `Extras` sub-folder instead of a Season folder so Jellyfin surfaces them as
 * supplementary content.
 *
 * @param nameWithoutExt — bare filename with no extension or path components
 *
 * Examples:
 *   "Dilbert - DVD Extras - Dogbert Speaks"  → true
 *   "Making of The Dark Knight"              → true
 *   "Interview with the Director"            → true
 *   "Deleted Scenes"                         → true
 *   "Show S01E01 Episode Title"              → false (episode pattern present)
 *   "Normal Episode Name"                    → false
 */
export function isExtrasFile(nameWithoutExt: string): boolean {
  return EXTRAS_PATTERN.test(nameWithoutExt);
}

// Strip leading separators and media extensions from the remainder after SxxExx
function cleanTitle(rest: string): string | undefined {
  let cleaned = rest
    .replace(/^[\s\._-]+/, '') // leading separators
    .replace(/\.(mkv|mp4|avi|mov|wmv|m4v|ts|m2ts|webm)$/i, '') // extensions
    .trim();

  if (!cleaned.includes(' ') && cleaned.match(/[._]/)) {
    cleaned = cleaned.replace(/[._]+/g, ' ').trim();
  }
  return cleaned || undefined;
}
