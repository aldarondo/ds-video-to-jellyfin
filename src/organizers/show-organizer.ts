/**
 * Computes the Jellyfin-standard output paths for a TV show episode.
 *
 * Output structure:
 *   <outputRoot>/
 *     <Show Name (Year)>/
 *       tvshow.nfo
 *       poster.jpg
 *       fanart.jpg
 *       Season 01/
 *         <Show Name S01E01 Episode Title>.ext
 *         <Show Name S01E01 Episode Title>.ext.vsmeta
 *         <Show Name S01E01 Episode Title>.nfo
 */

import path from 'path';
import { VsMetaData } from '../parsers/vsmeta.js';
import {
  ParsedEpisodeInfo,
  ParsedMovieInfo,
  formatSeason,
  formatEpisode,
  sanitizePathComponent,
  parseMovieFilename,
} from '../utils/filename-parser.js';

export interface ShowPaths {
  /** Absolute path to the show root folder (e.g. /output/My Show (2020)) */
  showFolder: string;
  /** Absolute path to the season folder (e.g. /output/My Show (2020)/Season 01) */
  seasonFolder: string;
  /** Absolute path for the video file */
  videoFile: string;
  /** Absolute path for the .vsmeta file */
  vsmetaFile: string;
  /** Absolute path for the episode .nfo file */
  nfoFile: string;
  /** Absolute path for tvshow.nfo (in show root) */
  showNfoFile: string;
  /** The show folder name (used as a key when merging show metadata) */
  showKey: string;
  /** Resolved season number used in output paths */
  season: number;
  /** Resolved episode number used in output paths */
  episode: number;
  /** Where the season/episode numbers came from */
  numberSource: 'vsmeta' | 'filename' | 'default';
}

/**
 * Resolve the sanitized show title (without year) from the available metadata sources.
 * Exported so the migrator's pre-scan phase can use the exact same logic.
 */
export function resolveShowTitle(
  meta: VsMetaData,
  sourceShowName: string | undefined,
  parsedTitle: ParsedMovieInfo
): string {
  // Use `|| undefined` instead of plain ternary so that an empty meta.title ("")
  // doesn't win over the sourceShowName / parsedTitle fallbacks via `??`.
  return sanitizePathComponent(
    (meta.contentType === 2 ? meta.title || undefined : undefined) ??
    stripYearFromName(sourceShowName) ??
    parsedTitle.title
  );
}

/**
 * Compute output paths for a TV show episode.
 */
export function computeShowPaths(
  outputRoot: string,
  sourceFile: string,
  meta: VsMetaData,
  parsedEpisode: ParsedEpisodeInfo | null,
  parsedTitle: ParsedMovieInfo,
  /** Show folder name/year derived from source folder structure */
  sourceShowName?: string,
  /**
   * Pre-computed premiere year for this show (minimum air year seen across all
   * episodes of the same show title).  When provided, this takes priority over
   * any per-episode year sourced from .vsmeta — which reflects the individual
   * episode air date, not the show premiere year.
   */
  premiereYear?: number
): ShowPaths {
  // Determine show title — for TV shows meta.title holds the show name
  const showTitle = resolveShowTitle(meta, sourceShowName, parsedTitle);

  // Determine show year for folder naming.
  // Priority:
  //   1. premiereYear — pre-computed minimum year across all episodes of this show
  //   2. parsedTitle.year — year embedded in the source filename (reliable)
  //   3. year in parentheses in the source show folder name (e.g. "My Show (2020)")
  // We intentionally skip raw meta.year / meta.releaseDate here because for TV
  // shows those fields hold the individual EPISODE air date, not the premiere year.
  // File-path year (from the filename or source folder name) takes priority over
  // the vsmeta-derived premiere year.  When the same show title spans multiple
  // eras (e.g. "Doctor Who (1963)" vs "Doctor Who (2005)"), the year embedded in
  // the filename or its parent folder is the most reliable era discriminator —
  // vsmeta data can be incorrectly tagged across different versions of a show.
  const fileYear  = parsedTitle.year || extractYearFromName(sourceShowName);
  const showYear  = fileYear || premiereYear;

  const showFolderName = showYear ? `${showTitle} (${showYear})` : showTitle;

  // Season / episode numbers — track source for diagnostic logging
  let numberSource: ShowPaths['numberSource'];
  let season: number;
  let episode: number;
  if (meta.season != null || meta.episode != null) {
    season = meta.season ?? 1;
    // Prefer the episode number from the filename when parsedEpisode is available.
    // Filenames (as curated by the user) are more reliable for episode ordering
    // than vsmeta data that can be incorrectly tagged (e.g. multiple episodes all
    // marked E01 in vsmeta when the filename clearly has -2-, -4-, etc.).
    if (parsedEpisode !== null) {
      episode      = parsedEpisode.episode;
      numberSource = 'filename';
    } else {
      episode      = meta.episode ?? 1;
      numberSource = 'vsmeta';
    }
  } else if (parsedEpisode != null) {
    season  = parsedEpisode.season;
    episode = parsedEpisode.episode;
    numberSource = 'filename';
  } else {
    season  = 1;
    episode = 1;
    numberSource = 'default';
  }
  const seasonFolderName = `Season ${formatSeason(season)}`;

  // Episode filename: "Show Name S01E01 Episode Title.ext"
  // For TV shows meta.title = show title, so episode title only comes from filename parsing
  const episodeTitle = sanitizePathComponent(parsedEpisode?.episodeTitle ?? '');
  const episodePart = episodeTitle
    ? `${showTitle} S${formatSeason(season)}E${formatEpisode(episode)} ${episodeTitle}`
    : `${showTitle} S${formatSeason(season)}E${formatEpisode(episode)}`;

  const ext = path.extname(sourceFile);
  const episodeFilename = `${episodePart}${ext}`;

  const showFolder = path.join(outputRoot, showFolderName);
  const seasonFolder = path.join(showFolder, seasonFolderName);

  return {
    showFolder,
    seasonFolder,
    videoFile: path.join(seasonFolder, episodeFilename),
    vsmetaFile: path.join(seasonFolder, `${episodeFilename}.vsmeta`),
    nfoFile: path.join(seasonFolder, `${episodePart}.nfo`),
    showNfoFile: path.join(showFolder, 'tvshow.nfo'),
    showKey: showFolderName,
    season,
    episode,
    numberSource,
  };
}

/** Plausible year range for TV shows and films. */
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/**
 * Extract a 4-digit year from a folder/show name, trying several formats:
 *   1. Parenthesised suffix — "My Show (2020)"   (most unambiguous, checked first)
 *   2. Space/dot/embedded — "Seinfeld 1989", "Breaking.Bad.2008", "ShowName2006"
 *      (via parseMovieFilename, with range guard to exclude show titles like "The 4400")
 * Returns undefined if no plausible year is found.
 */
function extractYearFromName(name?: string): number | undefined {
  if (!name) return undefined;

  // "(YYYY)" is explicit and unambiguous.
  const parens = name.match(/\((\d{4})\)/);
  if (parens) return parseInt(parens[1], 10);

  // Fall back to filename-style parsing for "ShowName YYYY", "Show.Name.YYYY", etc.
  const parsed = parseMovieFilename(name);
  if (parsed.year && parsed.year >= YEAR_MIN && parsed.year <= YEAR_MAX) {
    return parsed.year;
  }

  return undefined;
}

/**
 * Return the name with any trailing "(YYYY)" year suffix removed and trimmed.
 * e.g. "Dark Angel (2000)" → "Dark Angel".
 */
function stripYearFromName(name?: string): string | undefined {
  if (!name) return undefined;
  return name.replace(/\s*\(\d{4}\)\s*$/, '').trim() || undefined;
}
