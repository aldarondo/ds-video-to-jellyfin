/**
 * Utility functions for parsing metadata from filenames and folder paths
 * when .vsmeta data is absent or incomplete.
 */

export interface ParsedEpisodeInfo {
  season: number;
  episode: number;
  /** Rest of filename after the S__E__ token, if any */
  episodeTitle?: string;
}

export interface ParsedMovieInfo {
  title: string;
  year?: number;
}

/**
 * Normalize a filename by replacing underscores or dots with spaces when the name
 * contains no spaces at all.  Encoders and rippers commonly use either character as
 * a word separator (e.g. "Dark_Angel_S01E01_Pilot" or "Dark.Angel.S01E01.Pilot").
 * Names that already contain spaces are returned unchanged to avoid corrupting
 * titles that legitimately mix separators (e.g. "some_tag episode title").
 */
function normalizeWordSeparators(name: string): string {
  return name.includes(' ') ? name : name.replace(/[_.]/g, ' ');
}

/**
 * Extract season and episode numbers from a filename.
 * Supports common patterns:
 *   S01E01, S1E1, s01e01           → season 1, ep 1
 *   S1 - E01, S1 - E01 - Title     → season 1, ep 1  (DS Video space-separated style)
 *   1x01, 01x01                    → season 1, ep 1
 *   Season 1 Episode 1             → season 1, ep 1
 */
export function parseEpisodeFilename(filename: string): ParsedEpisodeInfo | null {
  filename = normalizeWordSeparators(filename);
  // SxxExx pattern (most common, e.g. S01E01)
  const sxex = filename.match(/[Ss](\d{1,2})[Ee](\d{1,3})(.*)/);
  if (sxex) {
    return {
      season: parseInt(sxex[1], 10),
      episode: parseInt(sxex[2], 10),
      episodeTitle: cleanTitle(sxex[3]),
    };
  }

  // "S1 - E01" space/dash separated (DS Video style, e.g. "S1 - E01 - Pilot")
  const sdashed = filename.match(/[Ss](\d{1,2})\s*-\s*[Ee](\d{1,3})(.*)/);
  if (sdashed) {
    return {
      season: parseInt(sdashed[1], 10),
      episode: parseInt(sdashed[2], 10),
      episodeTitle: cleanTitle(sdashed[3]),
    };
  }

  // NxNN pattern (e.g. 1x01)
  const nxnn = filename.match(/(\d{1,2})x(\d{2,3})(.*)/i);
  if (nxnn) {
    return {
      season: parseInt(nxnn[1], 10),
      episode: parseInt(nxnn[2], 10),
      episodeTitle: cleanTitle(nxnn[3]),
    };
  }

  // "Season N Episode N" spelled out
  const spelled = filename.match(/Season\s+(\d+)\s+Episode\s+(\d+)(.*)/i);
  if (spelled) {
    return {
      season: parseInt(spelled[1], 10),
      episode: parseInt(spelled[2], 10),
      episodeTitle: cleanTitle(spelled[3]),
    };
  }

  return null;
}

/**
 * Extract season number from a folder name.
 * Supports: "Season 01", "Season 1", "S01", "s1"
 */
export function parseSeasonFolder(folderName: string): number | null {
  const full = folderName.match(/^Season\s+(\d+)$/i);
  if (full) return parseInt(full[1], 10);

  const short = folderName.match(/^[Ss](\d{1,2})$/);
  if (short) return parseInt(short[1], 10);

  return null;
}

/**
 * Extract title and year from a movie filename or folder name.
 * Supports:
 *   "Movie Title (2020)"
 *   "Movie.Title.2020"
 *   "Movie Title 2020"
 *   "Movie Title"
 */
export function parseMovieFilename(nameWithoutExt: string): ParsedMovieInfo {
  nameWithoutExt = normalizeWordSeparators(nameWithoutExt);

  // "Title (Year)" — most reliable
  const parens = nameWithoutExt.match(/^(.+?)\s*\((\d{4})\)/);
  if (parens) {
    return { title: parens[1].trim(), year: parseInt(parens[2], 10) };
  }

  // "Title.Year.extra" or "Title Year" — dot/space separated
  const dotYear = nameWithoutExt.match(/^(.+?)[\s.](\d{4})(?:[\s.]|$)/);
  if (dotYear) {
    const title = dotYear[1].replace(/\./g, ' ').trim();
    return { title, year: parseInt(dotYear[2], 10) };
  }

  // No year found — use whole name as title
  return { title: nameWithoutExt.replace(/\./g, ' ').trim() };
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

// Strip leading separators and media extensions from the remainder after SxxExx
function cleanTitle(rest: string): string | undefined {
  const cleaned = rest
    .replace(/^[\s._-]+/, '') // leading separators
    .replace(/\.(mkv|mp4|avi|mov|wmv|m4v|ts|m2ts|webm)$/i, '') // extensions
    .trim();
  return cleaned || undefined;
}
