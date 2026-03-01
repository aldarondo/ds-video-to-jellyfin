/**
 * ds-video-to-jellyfin
 * Public API for programmatic use.
 */

export { migrate, MigrateOptions, MigrateResult } from './migrator.js';
export { VsMetaData } from 'vsmeta-parser';
export { detectMediaType, MediaType } from './detectors/media-type.js';
export { scanDirectory, ScanResult } from './utils/scanner.js';
