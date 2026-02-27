/**
 * Generates a Jellyfin/Kodi-compatible episode .nfo XML string.
 * Written alongside each episode file as <EpisodeFilename>.nfo.
 */

import { VsMetaData } from '../parsers/vsmeta.js';
import { ParsedEpisodeInfo, ParsedMovieInfo } from '../utils/filename-parser.js';
import { XML_HEADER, elem, escapeXml } from './xml-utils.js';

export interface EpisodeNfoInput {
  meta: VsMetaData;
  /** Fallback info from filename when vsmeta is incomplete */
  parsedEpisode: ParsedEpisodeInfo | null;
  /** Fallback title from movie-style filename parsing */
  parsedTitle: ParsedMovieInfo;
  /** The show title to use */
  showTitle: string;
  /**
   * Override season number from the path-computation result.
   * Must be provided when the season was clamped (e.g. implausible season → Season 00)
   * so the NFO matches the actual folder the episode was placed in.
   */
  resolvedSeason?: number;
  /**
   * Override episode number from the path-computation result.
   * Kept in sync with resolvedSeason so the NFO is always consistent with the filename.
   */
  resolvedEpisode?: number;
}

export function generateEpisodeNfo(input: EpisodeNfoInput): string {
  const { meta, parsedEpisode, parsedTitle, showTitle } = input;

  // Use the caller-resolved season/episode when provided (they account for clamping,
  // folder-context inheritance, and the 'default' fallback — all of which are computed
  // by computeShowPaths, not here).  Fall back through vsmeta → filename → default.
  const season  = input.resolvedSeason  ?? meta.season  ?? parsedEpisode?.season  ?? 1;
  const episode = input.resolvedEpisode ?? meta.episode ?? parsedEpisode?.episode ?? 1;
  // For TV shows, meta.title is the show title; the episode title comes from parsedEpisode
  const title   = parsedEpisode?.episodeTitle ?? parsedTitle.title;

  let xml = XML_HEADER;
  xml += '<episodedetails>\n';
  xml += elem('title', title);
  xml += elem('showtitle', showTitle);
  xml += elem('season', season);
  xml += elem('episode', episode);
  // Use episodePlot for the episode-specific plot (may differ from show plot)
  xml += elem('plot', meta.episodePlot || meta.plot);
  if (meta.airDate)      xml += elem('aired', meta.airDate);
  if (meta.releaseDate && !meta.airDate) xml += elem('aired', meta.releaseDate);
  if (meta.rating)       xml += elem('rating', meta.rating);
  if (meta.contentRating) xml += elem('mpaa', meta.contentRating);

  if (meta.imdbId) {
    xml += `  <uniqueid type="imdb" default="true">${escapeXml(meta.imdbId)}</uniqueid>\n`;
  }
  if (meta.tmdbId) {
    xml += `  <uniqueid type="tmdb">${escapeXml(meta.tmdbId)}</uniqueid>\n`;
  }

  for (const director of meta.directors) {
    xml += elem('director', director);
  }

  for (const writer of meta.writers) {
    xml += elem('credits', writer);
  }

  xml += '</episodedetails>\n';
  return xml;
}
