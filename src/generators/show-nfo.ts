/**
 * Generates a Jellyfin/Kodi-compatible tvshow.nfo XML string.
 * Written once per show in the show's root folder.
 */

import { VsMetaData } from '../parsers/vsmeta.js';
import { XML_HEADER, elem, escapeXml } from './xml-utils.js';

export interface ShowNfoInput {
  /** The show title (from source folder name or vsmeta title) */
  showTitle: string;
  /** Year of first air, if known */
  year?: number;
  /** Best plot/description found across all episodes */
  plot?: string;
  genres?: string[];
  actors?: string[];
  directors?: string[];
  contentRating?: string;
  rating?: number;
  imdbId?: string;
  tmdbId?: string;
}

/** Merge show-level metadata from a single episode's vsmeta into a ShowNfoInput accumulator. */
export function mergeShowMeta(acc: ShowNfoInput, meta: VsMetaData): void {
  if (!acc.plot && meta.plot)                  acc.plot    = meta.plot;
  if (!acc.genres?.length && meta.genres.length)   acc.genres  = meta.genres;
  if (!acc.actors?.length && meta.actors.length)   acc.actors  = meta.actors;
  if (!acc.directors?.length && meta.directors.length) acc.directors = meta.directors;
  if (!acc.contentRating && meta.contentRating) acc.contentRating = meta.contentRating;
  if (acc.rating == null && meta.rating)       acc.rating  = meta.rating;
  if (!acc.imdbId && meta.imdbId)              acc.imdbId  = meta.imdbId;
  if (!acc.tmdbId && meta.tmdbId)              acc.tmdbId  = meta.tmdbId;
  if (!acc.year && meta.releaseDate) {
    const m = meta.releaseDate.match(/(\d{4})/);
    if (m) acc.year = parseInt(m[1], 10);
  }
  if (!acc.year && meta.year) acc.year = meta.year;
}

export function generateShowNfo(input: ShowNfoInput): string {
  let xml = XML_HEADER;
  xml += '<tvshow>\n';
  xml += elem('title', input.showTitle);
  if (input.year)          xml += elem('year', input.year);
  xml += elem('plot', input.plot);
  if (input.rating)        xml += elem('rating', input.rating);
  if (input.contentRating) xml += elem('mpaa', input.contentRating);

  if (input.imdbId) {
    xml += `  <uniqueid type="imdb" default="true">${escapeXml(input.imdbId)}</uniqueid>\n`;
  }
  if (input.tmdbId) {
    xml += `  <uniqueid type="tmdb">${escapeXml(input.tmdbId)}</uniqueid>\n`;
  }

  for (const genre of input.genres ?? []) {
    xml += elem('genre', genre);
  }

  for (const director of input.directors ?? []) {
    xml += elem('director', director);
  }

  for (const actor of input.actors ?? []) {
    xml += '  <actor>\n';
    xml += `    <name>${escapeXml(actor)}</name>\n`;
    xml += '  </actor>\n';
  }

  xml += '</tvshow>\n';
  return xml;
}
