/**
 * ds-video-to-jellyfin
 * Public API for programmatic use.
 */

export { migrate, MigrateOptions, MigrateResult } from './migrator.js';
export { parseVsMeta, VsMetaData } from './parsers/vsmeta.js';
export { detectMediaType, MediaType } from './detectors/media-type.js';
export { scanDirectory, ScanResult } from './utils/scanner.js';
export { generateMovieNfo } from './generators/movie-nfo.js';
export { generateShowNfo, mergeShowMeta, ShowNfoInput } from './generators/show-nfo.js';
export { generateEpisodeNfo } from './generators/episode-nfo.js';
