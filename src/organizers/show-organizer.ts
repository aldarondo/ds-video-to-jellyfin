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
import { VsMetaData } from 'vsmeta-parser';
import {
  ParsedInfo,
  parsePath,
} from 'parse-torrent-path';
import {
  formatSeason,
  formatEpisode,
  sanitizePathComponent,
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
  parsedTitle: ParsedInfo
): string {
  // Use `|| undefined` instead of plain ternary so that an empty meta.title ("")
  // doesn't win over the sourceShowName / parsedTitle fallbacks via `??`.
  return sanitizePathComponent(
    (meta.contentType === 2 ? meta.title || undefined : undefined) ??
    stripYearFromName(sourceShowName) ??
    parsedTitle.showTitle ??
    parsedTitle.title ??
    ''
  );
}

/**
 * Compute output paths for a TV show episode.
 */
export function computeShowPaths(
  outputRoot: string,
  sourceFile: string,
  meta: VsMetaData,
  parsedEpisode: ParsedInfo | null,
  parsedTitle: ParsedInfo,
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
  //
  // Priority:
  //   1. Year embedded in the episode filename itself (parsedTitle.year).
  //      Keeps same-named reboots in separate folders — e.g. "Doctor Who (1963)"
  //      vs "Doctor Who (2005)" — because the filenames carry the era year.
  //   2. Premiere year from the pre-scan pass (minimum year seen across all
  //      episodes of this show title).  Consolidates shows whose source library
  //      was split into per-year folders — e.g. "Animaniacs (1993)", "Animaniacs
  //      (1994)", … — all route to "Animaniacs (1993)" in the output.
  //   3. Year from the folder/path structure as a last resort (e.g. a show folder
  //      named "My Show (2010)" when no other year is determinable).
  const filenameYear = parsedTitle.year;
  const folderYear = extractYearFromPath(sourceFile, sourceShowName);
  const showYear = filenameYear || premiereYear || folderYear;

  const showFolderName = showYear ? `${showTitle} (${showYear})` : showTitle;

  // Season / episode numbers — track source for diagnostic logging
  let numberSource: ShowPaths['numberSource'];
  let season: number;
  let episode: number;
  if (meta.season != null || meta.episode != null) {
    season = meta.season ?? parsedEpisode?.season ?? 1;
    // Prefer the episode number from the filename when parsedEpisode is available.
    if (parsedEpisode !== null && parsedEpisode.episode !== undefined) {
      episode = parsedEpisode.episode;
      numberSource = 'filename';
    } else {
      episode = meta.episode ?? 1;
      numberSource = 'vsmeta';
    }
  } else if (parsedEpisode != null && parsedEpisode.episode !== undefined) {
    season = parsedEpisode.season ?? 1;
    episode = parsedEpisode.episode;
    numberSource = 'filename';
  } else {
    season = 1;
    episode = 1;
    numberSource = 'default';
  }
  const seasonFolderName = `Season ${formatSeason(season)}`;

  // Episode filename: "Show Name S01E01 Episode Title.ext"
  // For TV shows meta.title = show title, so episode title only comes from filename parsing
  const episodeTitleText = parsedEpisode?.episodeTitle ?? '';
  const episodeTitle = sanitizePathComponent(Array.isArray(episodeTitleText) ? episodeTitleText.join(' ') : episodeTitleText);
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
 *      (via parsePath, with range guard to exclude show titles like "The 4400")
 * Returns undefined if no plausible year is found.
 */
function extractYearFromName(nameOrPath?: string): number | undefined {
  if (!nameOrPath) return undefined;

  // "(YYYY)" is explicit and unambiguous — check the basename first
  const filename = path.basename(nameOrPath);
  const parens = filename.match(/\((\d{4})\)/);
  if (parens) return parseInt(parens[1], 10);

  // Fall back to filename-style parsing for "ShowName YYYY", "Show.Name.YYYY", etc.
  // parsePath is now path-aware.
  const parsed = parsePath(nameOrPath);
  if (parsed.year && parsed.year >= YEAR_MIN && parsed.year <= YEAR_MAX) {
    return parsed.year;
  }

  return undefined;
}

/**
 * Extract a year from a folder path, checking the immediate show folder and
 * then parent folders up the tree. This handles cases where the show name is
 * in a parent folder, e.g.:
 *   Six Million Dollar Man 1974-1978/
 *     SIX_MILLION_DOLLAR_MAN_S2_D1/
 *       season.02.ep.01.avi
 * (where the disc folder has no year but the show folder does)
 */
function extractYearFromPath(sourceFile: string, sourceShowName?: string): number | undefined {
  if (!sourceShowName) return undefined;

  // First try the immediate show name
  let year = extractYearFromName(sourceShowName);
  if (year) return year;

  // If not found, walk up the directory tree from the video file
  // This finds years in parent/ancestor folder names
  let currentPath = path.dirname(sourceFile);
  for (let i = 0; i < 5; i++) {
    // limit walk to 5 levels to avoid walking to filesystem root
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break; // reached filesystem root

    const parentFolderName = path.basename(parentPath);
    year = extractYearFromName(parentFolderName);
    if (year) return year;

    currentPath = parentPath;
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
