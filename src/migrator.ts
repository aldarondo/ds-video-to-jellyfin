/**
 * Main migration orchestrator.
 * Coordinates scanning, parsing, path computation, file copying, and NFO generation.
 */

import fs from 'fs';
import path from 'path';

import { parseVsMeta, VsMetaData } from 'vsmeta-parser';
import { parsePath } from 'parse-torrent-path';
import { crawlDir, parseNfo, buildMoviesJson, buildTvShowsJson, ParsedNfo } from 'nfo-to-json';
import { convertVsMetaToJpeg } from 'vsmeta-to-jpeg';
import { convertVsMetaToNfo } from 'vsmeta-to-nfo';

import { detectMediaType } from './detectors/media-type.js';
import {
  extractYear,
  formatSeason,
  formatEpisode,
  isExtrasFile,
} from './utils/filename-parser.js';
import { scanDirectory, ScanResult } from './utils/scanner.js';
import { computeMoviePaths } from './organizers/movie-organizer.js';
import { computeShowPaths, resolveShowTitle } from './organizers/show-organizer.js';

export interface MigrateOptions {
  /** Source directory to scan */
  input: string;
  /** Destination root directory */
  output: string;
  /** Force all content to be treated as movies, shows, or auto-detect */
  type: 'movies' | 'shows' | 'auto';
  /** Move files instead of copying */
  move: boolean;
  /** Create hardlinks instead of copying (zero extra disk space; both paths point to the same data) */
  hardlink: boolean;
  /** Don't write any files — just log what would happen */
  dryRun: boolean;
  /**
   * Create output folders and real .nfo files, but write a small .txt placeholder
   * instead of copying/moving each video or image file.  Useful for validating the
   * output structure without paying the cost of copying large video files.
   * Ignored when dryRun is also true.
   */
  wetRun: boolean;
  /** Skip image extraction */
  noImages: boolean;
  /** Overwrite existing output files */
  overwrite: boolean;
  /** Log function for progress output */
  log: (msg: string) => void;
  /** Log function for warnings */
  warn: (msg: string) => void;
  /**
   * Called for each TV show whose year cannot be determined from filenames or
   * .vsmeta data.  The implementation should display the question and return
   * the raw user input (e.g. via readline).  An empty string or a non-numeric
   * response means "skip — leave this show without a year".
   * Omit to name shows without a detectable year using only the show title.
   */
  prompt?: (question: string) => Promise<string>;
}

export interface MigrateResult {
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Run the full migration from a DS Video folder structure to a Jellyfin-compatible layout.
 */
export async function migrate(opts: MigrateOptions): Promise<MigrateResult> {
  const { input, output, dryRun, log, warn } = opts;
  const runStart = Date.now();

  log(`Scanning ${input}...`);
  const scanResults = scanDirectory(input);
  log(`Found ${scanResults.length} video file(s).`);

  if (scanResults.length === 0) {
    return { processed: 0, skipped: 0, errors: 0 };
  }

  // Single pre-scan pass: read each .vsmeta file exactly once, caching the parsed
  // result and simultaneously building all derived data (premiere years, folder
  // context).  The cache is reused in processFile() so each .vsmeta is read only
  // once in total rather than three times.
  const vsmetaCount = scanResults.filter(r => r.vsmetaFile !== null).length;
  log(`Pre-scanning metadata... (${vsmetaCount} .vsmeta file(s))`);
  const preScanStart = Date.now();
  const { parsedMetaCache, showPremiereYears, folderContextMap, showsWithNoYear } =
    await buildPreScanData(scanResults, opts);
  log(`Pre-scan complete in ${((Date.now() - preScanStart) / 1000).toFixed(1)}s.`);
  if (showPremiereYears.size > 0) {
    log(`Detected ${showPremiereYears.size} unique show(s) with year data.`);
  }

  // For shows where no year could be determined, ask the user before starting
  // the main migration loop so migration runs without interactive interruptions.
  if (opts.prompt && showsWithNoYear.size > 0) {
    log(`\nCould not determine the year for ${showsWithNoYear.size} show(s).`);
    for (const [showTitle, exampleFile] of showsWithNoYear) {
      const exampleName = path.relative(input, exampleFile);
      const answer = await opts.prompt(
        `Year for "${showTitle}" (e.g. ${exampleName})\nEnter year or press Enter to skip: `
      );
      const parsed = parseInt(answer.trim(), 10);
      if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2100) {
        showPremiereYears.set(showTitle, parsed);
        log(`[info] Year ${parsed} assigned to "${showTitle}" (user-provided).`);
      }
    }
    log('');
  }

  // Group files by their immediate top-level subfolder so we can log progress as
  // each folder is completed and isolate errors to the folder they came from.
  const groups = groupByTopLevelFolder(scanResults, input);

  // Accumulate show-level metadata across all episodes keyed by show folder name
  // Note: We still need this to know where to put tvshow.nfo and to prompt for years
  const showMetaMap = new Map<string, { showTitle: string; year?: number; _nfoPath: string }>();

  const stats = { processed: 0, skipped: 0, errors: 0 };

  let groupIndex = 0;
  for (const [groupKey, groupFiles] of groups) {
    groupIndex++;
    const groupLabel = groupKey || '(root)';
    log(`[${groupIndex}/${groups.size}] ${groupLabel} — ${groupFiles.length} file(s)`);

    for (const { videoFile, vsmetaFile } of groupFiles) {
      try {
        const result = processFile({
          videoFile,
          vsmetaFile,
          outputRoot: output,
          opts,
          showMetaMap,
          showPremiereYears,
          folderContextMap,
          parsedMetaCache,
        });

        if (result === 'skipped') {
          stats.skipped++;
        } else {
          stats.processed++;
        }
      } catch (err) {
        // EEXIST means a destination file already exists and --overwrite was not set.
        // This is treated as a fatal error: stop the entire migration immediately so
        // the user can resolve the collision before any more files are written.
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Note: on Windows err.path is often set to the source rather than the
          // destination by Node's fs internals — use the message text as fallback.
          const destHint = (err as NodeJS.ErrnoException & { dest?: string }).dest ??
            (err as Error).message;
          throw new Error(
            `Output file already exists (use --overwrite to replace it):\n` +
            `  Source:      ${videoFile}\n` +
            `  Destination: ${destHint}`
          );
        }
        warn(`Error processing ${videoFile}: ${(err as Error).message}`);
        stats.errors++;
      }
    }
  }

  // Write JSON report (skipped in dry-run)
  if (!dryRun) {
    const reportPath = path.join(output, 'migration-report.json');
    log(`Generating JSON report: ${reportPath}`);
    try {
      const records: ParsedNfo[] = [];
      for await (const nfoPath of crawlDir(output)) {
        try {
          records.push(await parseNfo(nfoPath));
        } catch {
          // skip bad NFOs
        }
      }
      const movies = buildMoviesJson(records);
      const shows = buildTvShowsJson(records);
      fs.writeFileSync(reportPath, JSON.stringify({ movies, shows }, null, 2), 'utf8');
      log(`  JSON report: ${reportPath}`);
    } catch (err) {
      warn(`[error] Could not generate JSON report: ${(err as Error).message}`);
    }
  }

  const elapsed = Date.now() - runStart;
  const elapsedStr = elapsed >= 60000
    ? `${Math.floor(elapsed / 60000)}m ${Math.round((elapsed % 60000) / 1000)}s`
    : `${(elapsed / 1000).toFixed(1)}s`;
  log(`Total time: ${elapsedStr}`);

  return stats;
}

// ---------------------------------------------------------------------------
// Pre-scan
// ---------------------------------------------------------------------------

interface PreScanData {
  /** Parsed .vsmeta content keyed by absolute file path — reused in processFile() */
  parsedMetaCache: Map<string, VsMetaData>;
  /** Premiere year (minimum across all episodes) per normalised show title */
  showPremiereYears: Map<string, number>;
  /** Show/season context per source directory, built from siblings that have .vsmeta */
  folderContextMap: Map<string, FolderContext>;
  /**
   * TV show titles for which no year could be determined from filenames, folder
   * names, or .vsmeta data — maps normalised title → an example video file path.
   * Used to prompt the user for a year before migration begins.
   */
  showsWithNoYear: Map<string, string>;
}

/**
 * Metadata inferred for a source directory from the siblings that have .vsmeta.
 * Used to fill in missing metadata for episodes that lack their own .vsmeta file.
 */
interface FolderContext {
  /** Show title from a sibling episode's .vsmeta (undefined if none readable) */
  showTitle?: string;
  /** Season number shared by episodes in this folder (undefined if not determinable) */
  season?: number;
  /** True when at least one sibling in this folder was identified as a TV show episode */
  isShow: boolean;
}

/**
 * Two-phase pre-scan:
 *
 * Phase 1 — reads all .vsmeta files concurrently (up to 32 in parallel) using
 *   async I/O.  On a NAS this alone reduces pre-scan time by ~20-30× compared to
 *   sequential reads.  Images are skipped (skipImages: true) because a full image
 *   decode would consume hundreds of MB of RAM for large libraries; images are
 *   loaded on-demand in processFile() only for files that actually need them.
 *
 * Phase 2 — derives showPremiereYears and folderContextMap from the cached metadata
 *   in a single synchronous loop (no I/O).
 */
async function buildPreScanData(scanResults: ScanResult[], opts: MigrateOptions): Promise<PreScanData> {
  const parsedMetaCache = new Map<string, VsMetaData>();

  // --- Phase 1: concurrent async reads ---
  const vsmetaEntries = scanResults.filter(
    (r): r is ScanResult & { vsmetaFile: string } => r.vsmetaFile !== null
  );

  let preScanDone = 0;
  const preScanTotal = vsmetaEntries.length;
  // Thresholds at every 10% for progress logging (non-verbose only shows these;
  // verbose mode also logs the individual file path via the else branch below).
  const progressThresholds = new Set(
    Array.from({ length: 10 }, (_, i) => Math.ceil(preScanTotal * (i + 1) / 10))
  );

  await runWithConcurrency(vsmetaEntries, 32, async ({ vsmetaFile }) => {
    try {
      const buf = await fs.promises.readFile(vsmetaFile);
      // skipImages: true — skip base64 JPEG decoding; saves ~700 KB RAM per file
      // and eliminates needless CPU work.  Images are loaded separately in processFile().
      const meta = parseVsMeta(buf, { skipImages: true });
      parsedMetaCache.set(vsmetaFile, meta);
    } catch (err) {
      opts.warn(`  [warn] Could not parse ${vsmetaFile}: ${(err as Error).message}`);
      // Absent from cache → processFile() treats it the same as "no .vsmeta".
    }
    const n = ++preScanDone;
    if (progressThresholds.has(n)) {
      // No leading spaces — visible even without --verbose
      opts.log(`[pre-scan] ${n}/${preScanTotal} (${Math.round(n / preScanTotal * 100)}%)`);
    } else {
      // Two leading spaces — verbose-only (filtered by CLI log function)
      opts.log(`  [pre-scan] ${path.relative(opts.input, vsmetaFile)}`);
    }
  });

  // --- Phase 2: derive show years and folder context from cached metadata ---
  const showYearsMap = new Map<string, number[]>();

  type DirItem = { videoFile: string; meta: VsMetaData; isShow: boolean; hasVsmeta: boolean };
  const byFolder = new Map<string, DirItem[]>();

  for (const { videoFile, vsmetaFile } of scanResults) {
    const meta = (vsmetaFile ? parsedMetaCache.get(vsmetaFile) : undefined) ?? emptyMeta();
    const isShow = detectMediaType(videoFile, meta, opts.type) === 'show';

    const dir = path.dirname(videoFile);
    const arr = byFolder.get(dir) ?? [];
    arr.push({ videoFile, meta, isShow, hasVsmeta: !!vsmetaFile });
    byFolder.set(dir, arr);

    if (vsmetaFile && isShow) {
      const parsed = parsePath(videoFile);
      const sourceShowName = inferShowName(videoFile, opts.input);
      const title = resolveShowTitle(meta, sourceShowName, parsed);
      if (title) {
        const year =
          parsed.year ||
          (meta.year ? meta.year : undefined) ||
          (meta.releaseDate ? extractYear(meta.releaseDate) : undefined);
        // Guard against corrupt vsmeta values (e.g. year = 4) that would produce
        // implausible folder names like "Arthur (4)".
        if (year && year >= 1900 && year <= 2100) {
          const existing = showYearsMap.get(title) ?? [];
          existing.push(year);
          showYearsMap.set(title, existing);
        }
      }
    }
  }

  // Premiere year = earliest year seen across all episodes of a show
  const showPremiereYears = new Map<string, number>();
  for (const [title, years] of showYearsMap) {
    showPremiereYears.set(title, Math.min(...years));
  }

  // Build folder context from items that have .vsmeta and were identified as shows
  const folderContextMap = new Map<string, FolderContext>();
  for (const [dir, items] of byFolder) {
    const ctx: FolderContext = { isShow: false };
    for (const { meta, isShow, hasVsmeta } of items) {
      if (!hasVsmeta || !isShow) continue;
      ctx.isShow = true;
      if (!ctx.showTitle && meta.title) ctx.showTitle = meta.title;
      if (ctx.season == null && meta.season != null) ctx.season = meta.season;
    }
    if (ctx.isShow) folderContextMap.set(dir, ctx);
  }

  // --- Phase 3: find TV show titles that have no determinable year ---
  const extractFolderYear = (videoFile: string, name?: string): number | undefined => {
    if (!name) return undefined;

    // Try the immediate folder name
    const parens = name.match(/\((\d{4})\)/);
    if (parens) return parseInt(parens[1], 10);
    const parsed = parsePath(videoFile); // Use full videoFile path for context
    if (parsed.year && parsed.year >= 1900 && parsed.year <= 2100) {
      return parsed.year;
    }

    // If not found, walk up the directory tree from the video file
    let currentPath = path.dirname(videoFile);
    for (let i = 0; i < 5; i++) {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break; // reached filesystem root

      const parentFolderName = path.basename(parentPath);
      const parentParens = parentFolderName.match(/\((\d{4})\)/);
      if (parentParens) return parseInt(parentParens[1], 10);

      // Pass the full parentPath to parsePath for context
      const parentParsed = parsePath(parentPath);
      if (parentParsed.year && parentParsed.year >= 1900 && parentParsed.year <= 2100) {
        return parentParsed.year;
      }

      currentPath = parentPath;
    }

    return undefined;
  };

  const showsWithNoYear = new Map<string, string>(); // title → example file path
  for (const { videoFile, vsmetaFile } of scanResults) {
    // Shallow-clone so we can safely mutate for folder-context inheritance below.
    const meta = { ...((vsmetaFile ? parsedMetaCache.get(vsmetaFile) : undefined) ?? emptyMeta()) };

    // Only inherit folder context when the file has no vsmeta of its own.
    // A file with its own vsmeta that explicitly marks it as a movie (contentType 1)
    // should never be overridden by a show sibling in the same folder.
    const hasOwnMovieMeta = vsmetaFile !== null && meta.contentType === 1;
    if (!hasOwnMovieMeta && meta.contentType !== 2 && meta.season == null && meta.episode == null) {
      const folderCtx = folderContextMap.get(path.dirname(videoFile));
      if (folderCtx?.isShow) {
        if (folderCtx.showTitle) meta.title = folderCtx.showTitle;
        meta.contentType = 2;
      }
    }

    if (detectMediaType(videoFile, meta, opts.type) !== 'show') continue;

    const parsed = parsePath(videoFile);
    const sourceShowName = inferShowName(videoFile, opts.input);
    const title = resolveShowTitle(meta, sourceShowName, parsed);
    if (!title) continue;
    if (showPremiereYears.has(title)) continue; // year already known (incl. from sibling vsmeta)
    if (showsWithNoYear.has(title)) continue;   // already noted

    const fileYear = parsed.year || extractFolderYear(videoFile, sourceShowName);
    if (fileYear) continue; // file-path year will supply the year at runtime

    showsWithNoYear.set(title, videoFile);
  }

  return { parsedMetaCache, showPremiereYears, folderContextMap, showsWithNoYear };
}

/**
 * Group scan results by their immediate top-level subdirectory relative to inputRoot.
 * Files sitting directly in inputRoot are grouped under the empty-string key.
 * The returned Map preserves directory-listing order.
 */
function groupByTopLevelFolder(
  scanResults: ScanResult[],
  inputRoot: string
): Map<string, ScanResult[]> {
  const groups = new Map<string, ScanResult[]>();
  for (const item of scanResults) {
    const rel = path.relative(inputRoot, item.videoFile);
    const sepIdx = rel.indexOf(path.sep);
    const groupKey = sepIdx === -1 ? '' : rel.slice(0, sepIdx);
    const arr = groups.get(groupKey) ?? [];
    arr.push(item);
    groups.set(groupKey, arr);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Per-file processing
// ---------------------------------------------------------------------------


interface ProcessFileArgs {
  videoFile: string;
  vsmetaFile: string | null;
  outputRoot: string;
  opts: MigrateOptions;
  showMetaMap: Map<string, { showTitle: string; year?: number; _nfoPath: string }>;
  /** Premiere year per normalised show title, computed by the pre-scan pass */
  showPremiereYears: Map<string, number>;
  /** Show/season info inferred from sibling .vsmeta files, keyed by directory */
  folderContextMap: Map<string, FolderContext>;
  /** Pre-parsed .vsmeta content — avoids re-reading files already parsed in pre-scan */
  parsedMetaCache: Map<string, VsMetaData>;
}

function processFile({
  videoFile,
  vsmetaFile,
  outputRoot,
  opts,
  showMetaMap,
  showPremiereYears,
  folderContextMap,
  parsedMetaCache,
}: ProcessFileArgs): 'ok' | 'skipped' {
  const { type, move, hardlink, dryRun, overwrite, noImages, log, warn } = opts;
  // dryRun takes priority over wetRun
  const effectiveWetRun = opts.wetRun && !dryRun;

  // Use the pre-parsed result from the cache — avoids re-reading the file a second time.
  const meta: VsMetaData = { ...((vsmetaFile ? parsedMetaCache.get(vsmetaFile) : undefined) ?? emptyMeta()) };

  const nameWithoutExt = path.basename(videoFile, path.extname(videoFile));
  const parsed = parsePath(videoFile); // Use parsePath for full context

  // For files that are not positively identified as TV show episodes by their own
  // vsmeta, inherit key fields from sibling episodes in the same folder that DO have
  // .vsmeta files.
  // Guard: never apply folder context to a file that has its own vsmeta explicitly
  // marking it as a movie (contentType 1).  Mixed folders (e.g. a show episode and
  // several movies in the same directory) would otherwise cause every movie in the
  // folder to be reclassified as a show episode.
  let inferredFromFolder = false;
  const hasOwnMovieMeta = vsmetaFile !== null && meta.contentType === 1;
  if (!hasOwnMovieMeta && meta.contentType !== 2 && meta.season == null && meta.episode == null) {
    const folderCtx = folderContextMap.get(path.dirname(videoFile));
    if (folderCtx?.isShow) {
      if (folderCtx.showTitle) meta.title = folderCtx.showTitle;
      meta.contentType = 2; // TV show — ensures detectMediaType() returns 'show'
      if (parsed.episode === undefined && folderCtx.season != null) {
        meta.season = folderCtx.season;
      }
      inferredFromFolder = true;
    }
  }

  // Detect media type
  const mediaType = detectMediaType(videoFile, meta, type);

  if (mediaType === 'movie') {
    const paths = computeMoviePaths(outputRoot, videoFile, meta, parsed);

    log(`  [movie] ${path.basename(videoFile)} → ${paths.folder}`);
    if (dryRun) return 'ok';

    ensureDir(paths.folder);

    // Copy/move video file (or write placeholder in wet-run)
    copyOrMoveOrPlaceholder(videoFile, paths.videoFile, move, hardlink, effectiveWetRun, overwrite);

    // Copy .vsmeta (DS Video compatibility)
    if (vsmetaFile) {
      copyOrMoveOrPlaceholder(vsmetaFile, paths.vsmetaFile, false, hardlink, effectiveWetRun, overwrite);

      // Call converters on the NEW vsmeta location
      if (!noImages) {
        const imgResult = convertVsMetaToJpeg(paths.vsmetaFile, { overwrite, dryRun: effectiveWetRun });
        if (imgResult.status === 'ERROR') warn(`    [image error] ${imgResult.message}`);
      }

      const nfoResult = convertVsMetaToNfo(paths.vsmetaFile, { overwrite, dryRun: false }); // Always write NFO even in wet-run
      if (nfoResult.status === 'ERROR') warn(`    [nfo error] ${nfoResult.message}`);
    }
  } else {
    // Infer show name from the source folder structure if possible
    const sourceShowName = inferShowName(videoFile, opts.input);

    // If vsmeta didn't provide a show title, use the one from the filename parser
    if (!meta.title && parsed.showTitle) {
      meta.title = parsed.showTitle;
      meta.contentType = 2;
    }

    // Look up the pre-computed premiere year for this show
    const showTitleKey = resolveShowTitle(meta, sourceShowName, parsed);
    const premiereYear = showPremiereYears.get(showTitleKey);

    let paths = computeShowPaths(
      outputRoot,
      videoFile,
      meta,
      parsed,
      parsed,
      sourceShowName,
      premiereYear
    );

    // --- Extras detection -------------------------------------------------------
    if (parsed.episode === undefined && isExtrasFile(nameWithoutExt)) {
      const extrasFolder = path.join(paths.showFolder, 'Extras');
      const origBasename = path.basename(videoFile);
      const extrasVideoFile = path.join(extrasFolder, origBasename);

      log(`  [extra] ${origBasename} → "${paths.showKey}" Extras/`);
      if (dryRun) return 'ok';

      ensureDir(extrasFolder);
      copyOrMoveOrPlaceholder(videoFile, extrasVideoFile, move, hardlink, effectiveWetRun, overwrite);

      // Carry the .vsmeta sidecar alongside so DS Video still recognises the file
      if (vsmetaFile) {
        const newVsmetaPath = path.join(extrasFolder, path.basename(vsmetaFile));
        copyOrMoveOrPlaceholder(vsmetaFile, newVsmetaPath, false, hardlink, effectiveWetRun, overwrite);

        // Convert images/nfo for extras too? The user didn't specify, but converters handle it.
        if (!noImages) convertVsMetaToJpeg(newVsmetaPath, { overwrite, dryRun: effectiveWetRun });
        convertVsMetaToNfo(newVsmetaPath, { overwrite, dryRun: false });
      }

      // Accumulate show-level metadata so we can prompt for year if needed
      if (!showMetaMap.has(paths.showKey)) {
        const showTitle = paths.showKey.replace(/\s*\(\d{4}\)$/, '');
        const yearStr = paths.showKey.match(/\((\d{4})\)$/)?.[1];
        showMetaMap.set(paths.showKey, {
          showTitle,
          year: yearStr ? parseInt(yearStr, 10) : undefined,
          _nfoPath: paths.showNfoFile,
        });
      }

      return 'ok';
    }

    // Clamp implausible season / episode numbers.
    // vsmeta data occasionally contains overflow values (e.g. episode = 2^64-1)
    // that produce colliding file names. Clamp anything beyond sane TV ranges to
    // Season 00 / Episode 00 so the file is preserved without colliding.
    const episodeOverflow = paths.episode > 9999 || !Number.isSafeInteger(paths.episode);
    if (paths.season > 50 || episodeOverflow) {
      const clampedMeta = { ...meta, season: 0, episode: 0 };
      paths = computeShowPaths(
        outputRoot,
        videoFile,
        clampedMeta,
        null,
        parsed,
        sourceShowName,
        premiereYear
      );
      warn(`  [warn] Implausible season/episode for "${path.basename(videoFile)}" — placing in Season 00.`);
    }

    const seNum = `S${formatSeason(paths.season)}E${formatEpisode(paths.episode)}`;
    const inferNote = inferredFromFolder ? ' [no .vsmeta — folder-inferred]' : '';
    log(`  [show]  ${path.basename(videoFile)} → "${paths.showKey}" ${seNum} [${paths.numberSource}]${inferNote}`);
    if (dryRun) return 'ok';

    ensureDir(paths.seasonFolder);

    // Copy/move video (or write placeholder in wet-run)
    copyOrMoveOrPlaceholder(videoFile, paths.videoFile, move, hardlink, effectiveWetRun, overwrite);

    // Copy .vsmeta (or placeholder)
    if (vsmetaFile) {
      copyOrMoveOrPlaceholder(vsmetaFile, paths.vsmetaFile, false, hardlink, effectiveWetRun, overwrite);

      if (!noImages) {
        const imgResult = convertVsMetaToJpeg(paths.vsmetaFile, { overwrite, dryRun: effectiveWetRun });
        if (imgResult.status === 'ERROR') warn(`    [image error] ${imgResult.message}`);
      }

      const nfoResult = convertVsMetaToNfo(paths.vsmetaFile, { overwrite, dryRun: false });
      if (nfoResult.status === 'ERROR') warn(`    [nfo error] ${nfoResult.message}`);
    }

    // Accumulate show metadata for tracking
    if (!showMetaMap.has(paths.showKey)) {
      const showTitle = paths.showKey.replace(/\s*\(\d{4}\)$/, '');
      const year = paths.showKey.match(/\((\d{4})\)$/)?.[1];
      showMetaMap.set(paths.showKey, {
        showTitle,
        year: year ? parseInt(year, 10) : undefined,
        _nfoPath: paths.showNfoFile,
      });
    }
  }

  return 'ok';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try to infer the show name from the directory structure above the video file.
 *
 * Strategy: walk up the folder path from the episode file and return the
 * first folder that is NOT a season folder (Season N, S01, etc.).
 * Handles structures like:
 *   TV/Breaking Bad/Season 1/ep.mkv         → "Breaking Bad"
 *   Breaking Bad/Season 1/ep.mkv            → "Breaking Bad"
 *   Breaking Bad/ep.mkv                     → "Breaking Bad"
 *   TV Shows/Breaking Bad (2008)/S01/ep.mkv → "Breaking Bad (2008)"
 *   Dark Angel Season 2/ep.mkv              → "Dark Angel"
 */
function inferShowName(videoFile: string, inputRoot: string): string | undefined {
  const rel = path.relative(inputRoot, videoFile);
  // Folder parts only (strip the filename)
  const parts = rel.split(path.sep).slice(0, -1);

  if (parts.length === 0) return undefined;

  // Walk from innermost to outermost, return the first non-season folder
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const isSeasonFolder =
      /^Season\s+\d+$/i.test(part) ||
      /^[Ss]\d{1,2}$/.test(part);
    if (!isSeasonFolder) {
      // Handle DS Video folders like "Dark Angel Season 2" where the show name and
      // season number are combined into one folder (instead of a nested "Season 2"
      // subfolder).  Strip the trailing "Season N" / "SN" suffix so all seasons of
      // the same show share the same normalised name.
      const embeddedSeason = part.match(/^(.+?)\s+(?:Season\s+\d+|S\d{1,2})$/i);
      return embeddedSeason ? embeddedSeason[1].trim() : part;
    }
  }
  return undefined;
}

/**
 * Run `fn` on each item in `items` with at most `limit` concurrent async invocations.
 * Avoids the external p-limit dependency by using a simple worker-pool pattern.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try {
        await fn(items[idx]);
      } catch {
        // fn is expected to handle its own errors (e.g. via try/catch + opts.warn).
        // This catch is a safety net: if fn ever rejects unexpectedly, we swallow the
        // rejection here so this worker continues processing remaining items instead of
        // terminating — which would also silently abandon items already claimed by i++.
      }
    }
  });
  await Promise.all(workers);
}


/** Return a blank VsMetaData with all required fields defaulted. */
function emptyMeta(): VsMetaData {
  return {
    contentType: 1,
    title: '',
    originalTitle: '',
    episodeTitle: '',
    year: 0,
    releaseDate: '',
    locked: false,
    plot: '',
    tmdbId: '',
    imdbId: '',
    contentRating: '',
    rating: 0,
    actors: [],
    directors: [],
    genres: [],
    writers: [],
  };
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Copy `src` to `dest`.
 *
 * Without overwrite: uses COPYFILE_EXCL so the OS rejects atomically if dest
 * already exists — surfaces the collision to the caller as EEXIST.
 * With overwrite: uses plain copyFileSync (allows replacement).
 */
function copyFile(src: string, dest: string, overwrite: boolean): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
}

/**
 * Move `src` to `dest`.
 *
 * Without overwrite: throws if dest already exists to prevent silent data loss
 * (POSIX rename() is atomic-replace which would destroy the existing file).
 * With overwrite: unlinks dest first, then renames.
 */
function moveFile(src: string, dest: string, overwrite: boolean): void {
  ensureDir(path.dirname(dest));
  if (overwrite) {
    // Don't use fs.existsSync — SMB/NAS caches return stale results.
    try { fs.unlinkSync(dest); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  } else if (fs.existsSync(dest)) {
    const err = Object.assign(new Error(`Destination already exists: ${dest}`), {
      code: 'EEXIST',
      dest,
    });
    throw err;
  }
  fs.renameSync(src, dest);
}

/**
 * Write a small .txt placeholder file at `dest + '.txt'` indicating what the
 * real file would be.  Used in wet-run mode instead of copying the source file.
 *
 * Throws if the placeholder already exists so wet-run behaves consistently with
 * the real copy/move path — every file either lands or produces a visible error.
 */
function writePlaceholder(src: string, dest: string): void {
  const placeholderPath = dest + '.txt';
  ensureDir(path.dirname(placeholderPath));
  const content =
    `[WET RUN PLACEHOLDER]\n` +
    `This file represents: ${path.basename(dest)}\n` +
    `Source: ${src}\n` +
    `Destination: ${dest}\n` +
    `Run without --wet-run to copy the real file.\n`;
  // 'wx' flag: throws EEXIST if placeholder already exists.
  fs.writeFileSync(placeholderPath, content, { encoding: 'utf8', flag: 'wx' });
}

/**
 * Create a hardlink from `src` to `dest`.
 *
 * A hardlink occupies zero additional disk space — both paths point at the same
 * underlying data.  Requires both paths to be on the same volume.
 *
 * Without overwrite: throws EEXIST if dest already exists.
 * With overwrite: unlinks the existing dest entry first (safe — the original
 * source inode is unaffected), then creates the new hardlink.
 */
function hardlinkFile(src: string, dest: string, overwrite: boolean): void {
  ensureDir(path.dirname(dest));
  // Attempt the link directly first — fast path when dest doesn't exist yet.
  try {
    fs.linkSync(src, dest);
    return;
  } catch (linkErr) {
    if ((linkErr as NodeJS.ErrnoException).code !== 'EEXIST') throw linkErr;

    // dest already exists
    if (!overwrite) {
      const err = Object.assign(new Error(`Destination already exists: ${dest}`), {
        code: 'EEXIST',
        dest,
      });
      throw err;
    }

    // overwrite mode: link to a unique temp name, then unlink dest and rename.
    // Why temp-first rather than unlink-then-link?
    //   SMB/NAS caches can report the destination as absent (ENOENT from unlinkSync)
    //   yet still reject the subsequent linkSync with EEXIST because the server
    //   hasn't propagated the delete yet.  By linking to a fresh temp name first
    //   (guaranteed not to exist) we avoid that race.
    // Why unlink before rename rather than rename directly?
    //   Windows SMB rejects rename when the destination already exists (EPERM).
    //   POSIX rename() would replace atomically, but the Windows SMB dialect does not.
    //   So we: (1) link to temp, (2) unlink existing dest, (3) rename temp → dest.
    const tmpDest = `${dest}.hlnk-tmp.${process.hrtime.bigint()}`;
    fs.linkSync(src, tmpDest);
    try { fs.unlinkSync(dest); } catch (unlinkErr) {
      if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        try { fs.unlinkSync(tmpDest); } catch { /* best-effort cleanup */ }
        throw unlinkErr;
      }
    }
    fs.renameSync(tmpDest, dest);
  }
}

function copyOrMoveOrPlaceholder(
  src: string,
  dest: string,
  move: boolean,
  hardlink: boolean,
  wetRun: boolean,
  overwrite: boolean
): void {
  if (wetRun) {
    writePlaceholder(src, dest);
  } else if (move) {
    moveFile(src, dest, overwrite);
  } else if (hardlink) {
    hardlinkFile(src, dest, overwrite);
  } else {
    copyFile(src, dest, overwrite);
  }
}
