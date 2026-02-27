/**
 * Generates a Jellyfin/Kodi-compatible movie.nfo XML string from metadata.
 */

import { VsMetaData } from '../parsers/vsmeta.js';
import { ParsedMovieInfo } from '../utils/filename-parser.js';
import { XML_HEADER, elem, escapeXml } from './xml-utils.js';

export interface MovieNfoInput {
  meta: VsMetaData;
  /** Fallback info derived from filename when vsmeta is incomplete */
  parsed: ParsedMovieInfo;
}

export function generateMovieNfo(input: MovieNfoInput): string {
  const { meta, parsed } = input;

  const title = meta.title || parsed.title;
  // Prefer vsmeta year field; fall back to release date; then filename-parsed year
  const year =
    meta.year ||
    (meta.releaseDate ? extractYear(meta.releaseDate) : undefined) ||
    parsed.year;

  let xml = XML_HEADER;
  xml += '<movie>\n';
  xml += elem('title', title);
  xml += elem('originaltitle', meta.originalTitle || title);
  if (meta.tagline) xml += elem('tagline', meta.tagline);
  if (year)         xml += elem('year', year);
  xml += elem('plot', meta.plot);
  if (meta.rating)  xml += elem('rating', meta.rating);
  if (meta.contentRating) xml += elem('mpaa', meta.contentRating);
  if (meta.releaseDate)   xml += elem('premiered', meta.releaseDate);

  // Unique IDs for scraper matching
  if (meta.imdbId) {
    xml += `  <uniqueid type="imdb" default="true">${escapeXml(meta.imdbId)}</uniqueid>\n`;
  }
  if (meta.tmdbId) {
    xml += `  <uniqueid type="tmdb">${escapeXml(meta.tmdbId)}</uniqueid>\n`;
  }

  for (const genre of meta.genres) {
    xml += elem('genre', genre);
  }

  for (const director of meta.directors) {
    xml += elem('director', director);
  }

  for (const writer of meta.writers) {
    xml += elem('credits', writer);
  }

  for (const actor of meta.actors) {
    xml += '  <actor>\n';
    xml += `    <name>${escapeXml(actor)}</name>\n`;
    xml += '  </actor>\n';
  }

  xml += '</movie>\n';
  return xml;
}

function extractYear(dateStr: string): number | undefined {
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}
