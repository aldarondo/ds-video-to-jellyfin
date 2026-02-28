/**
 * Main migration orchestrator.
 * Coordinates scanning, parsing, path computation, file copying, and NFO generation.
 */

import fs from 'fs';
import path from 'path';

import { parseVsMeta, VsMetaData } from './parsers/vsmeta.js';
import { detectMediaType } from './detectors/media-type.js';
import {
  parseEpisodeFilename,
  parseMovieFilename,
  extractYear,
  formatSeason,
  formatEpisode,
  isExtrasFile,
} from './utils/filename-parser.js';
import { scanDirectory, ScanResult } from './utils/scanner.js';
import { extractImages } from './utils/image-extractor.js';
import { generateMovieNfo } from './generators/movie-nfo.js';
import { generateShowNfo, ShowNfoInput, mergeShowMeta } from './generators/show-nfo.js';
import { generateEpisodeNfo } from './generators/episode-nfo.js';
import { computeMoviePaths } from './organizers/movie-organizer.js';
import { computeShowPaths, resolveShowTitle } from './organizers/show-organizer.js';
import {
  generateShowCsv,
  generateMovieCsv,
  ShowReportRow,
  MovieReportRow,
} from './generators/csv-report.js';

export interface MigrateOptions {
  /** Source directory to scan */
  input: string;
  /** Destination root directory */
  output: string;
  /** Force all content to be treated as movies, shows, or auto-detect */
  type: 'movies' | 'shows' | 'auto';
  /** Move files instead of copying */
  move: boolean;
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
  const { input, output, dryRun, wetRun, log, warn } = opts;

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
  const { parsedMetaCache, showPremiereYears, folderContextMap, showsWithNoYear } =
    await buildPreScanData(scanResults, opts);
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
  const showMetaMap = new Map<string, ShowNfoInput>();

  // Accumulate data for end-of-run CSV reports
  const showSeasonCounts = new Map<string, Map<number, ShowSeasonEntry>>();
  const movieReport = new Map<string, MovieReportRow>();

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
          showSeasonCounts,
          movieReport,
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
          throw new Error(
            `Output file already exists (use --overwrite to replace it):\n` +
            `  Source:      ${videoFile}\n` +
            `  Destination: ${(err as NodeJS.ErrnoException).path ?? (err as Error).message}`
          );
        }
        warn(`Error processing ${videoFile}: ${(err as Error).message}`);
        stats.errors++;
      }
    }
  }

  // Write tvshow.nfo for each discovered show
  for (const [showKey, showInput] of showMetaMap) {
    const showNfoPath = (showInput as ShowNfoInput & { _nfoPath: string })._nfoPath;
    if (!showNfoPath) continue;

    // mergeShowMeta may have set showInput.year from an individual episode's air date
    // rather than the show's actual premiere year.  Overwrite with the pre-computed
    // premiere year (minimum year seen across all episodes of this show), which is
    // the same value already used to name the show folder.
    const premiereYear = showPremiereYears.get(showInput.showTitle);
    if (premiereYear) showInput.year = premiereYear;

    if (!dryRun) {
      ensureDir(path.dirname(showNfoPath));
      if (opts.overwrite || !fs.existsSync(showNfoPath)) {
        fs.writeFileSync(showNfoPath, generateShowNfo(showInput), 'utf8');
      }
    }
    // (tvshow.nfo is a generated file so it's always written in wet-run too)
    log(`  [show nfo] ${showKey} → ${showNfoPath}`);
  }

  // Detect and report shows whose title appears with multiple premiere years.
  // This surfaces cases like "Doctor Who (1963)" and "Doctor Who (2006)" in the
  // same output tree — different eras of the same show treated as separate series.
  // Grouping is by the title portion only (everything before the trailing "(YYYY)").
  {
    const showsByTitle = new Map<string, string[]>();
    for (const showKey of showMetaMap.keys()) {
      const title = showKey.replace(/\s*\(\d{4}\)$/, '');
      const arr = showsByTitle.get(title) ?? [];
      arr.push(showKey);
      showsByTitle.set(title, arr);
    }
    for (const [title, keys] of showsByTitle) {
      if (keys.length > 1) {
        log(`[info] "${title}" found with ${keys.length} premiere years — ` +
          `treating as separate shows: ${keys.join(', ')}`);
      }
    }
  }

  // Write CSV migration reports (skipped in dry-run: no files were actually written)
  if (!dryRun) {
    // --- Shows CSV ---
    if (showSeasonCounts.size > 0) {
      const showRows: ShowReportRow[] = [];
      for (const [showKey, seasonMap] of showSeasonCounts) {
        const showName = showKey.replace(/\s*\(\d{4}\)$/, '');
        const yearMatch = showKey.match(/\((\d{4})\)$/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
        for (const [season, entry] of seasonMap) {
          showRows.push({
            name: showName,
            year,
            season,
            episodes: entry.count,
            sourceDir: entry.sourceDir,
            outputDir: entry.outputDir,
          });
        }
      }
      const showCsvPath = path.join(output, 'migration-shows.csv');
      fs.writeFileSync(showCsvPath, generateShowCsv(showRows), 'utf8');
      log(`CSV report: ${showRows.length} show-season row(s) → ${showCsvPath}`);
    }

    // --- Movies CSV ---
    if (movieReport.size > 0) {
      const movieCsvPath = path.join(output, 'migration-movies.csv');
      fs.writeFileSync(movieCsvPath, generateMovieCsv([...movieReport.values()]), 'utf8');
      log(`CSV report: ${movieReport.size} movie row(s) → ${movieCsvPath}`);
    }
  }

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

  await runWithConcurrency(vsmetaEntries, 32, async ({ vsmetaFile }) => {
    opts.log(`  [pre-scan] ${path.relative(opts.input, vsmetaFile)}`);
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
      const nameWithoutExt = path.basename(videoFile, path.extname(videoFile));
      const parsedTitle = parseMovieFilename(nameWithoutExt);
      const sourceShowName = inferShowName(videoFile, opts.input);
      const title = resolveShowTitle(meta, sourceShowName, parsedTitle);
      if (title) {
        const year =
          parsedTitle.year ||
          (meta.year ? meta.year : undefined) ||
          (meta.releaseDate ? extractYear(meta.releaseDate) : undefined);
        if (year) {
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
  // These are offered to the user for manual year entry when opts.prompt is set.
  // A "no year" show is one whose title is absent from showPremiereYears AND for
  // which the filename and source folder name contain no parseable year.
  // The check mirrors what computeShowPaths() does at runtime:
  //   fileYear = parsedTitle.year || extractYearFromPath(sourceFile, sourceShowName)
  // This extracts years from folder names, checking the immediate folder and
  // walking up parent directories if needed (e.g., for disc folders without their
  // own year but whose parent show folder has one).
  const extractFolderYear = (videoFile: string, name?: string): number | undefined => {
    if (!name) return undefined;

    // Try the immediate folder name
    const parens = name.match(/\((\d{4})\)/);
    if (parens) return parseInt(parens[1], 10);
    const parsed = parseMovieFilename(name);
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

      const parentParsed = parseMovieFilename(parentFolderName);
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

    // Mirror the folder-context inheritance that processFile() applies before type
    // detection: files without their own vsmeta (or with an untyped vsmeta) inherit
    // the show title from siblings in the same folder that DO have a .vsmeta.
    // Without this, a file like "SeaQuest/Season 2/ep-no-vsmeta.avi" would resolve
    // its title from the folder path ("SeaQuest") rather than from the sibling vsmeta
    // ("seaQuest DSV"), missing the year that sibling already contributed to
    // showPremiereYears under the correct title.
    if (meta.contentType !== 2 && meta.season == null && meta.episode == null) {
      const folderCtx = folderContextMap.get(path.dirname(videoFile));
      if (folderCtx?.isShow) {
        if (folderCtx.showTitle) meta.title = folderCtx.showTitle;
        meta.contentType = 2;
      }
    }

    if (detectMediaType(videoFile, meta, opts.type) !== 'show') continue;

    const nameWithoutExt = path.basename(videoFile, path.extname(videoFile));
    const parsedTitle = parseMovieFilename(nameWithoutExt);
    const sourceShowName = inferShowName(videoFile, opts.input);
    const title = resolveShowTitle(meta, sourceShowName, parsedTitle);
    if (!title) continue;
    if (showPremiereYears.has(title)) continue; // year already known (incl. from sibling vsmeta)
    if (showsWithNoYear.has(title)) continue;   // already noted

    const fileYear = parsedTitle.year || extractFolderYear(videoFile, sourceShowName);
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

/** Per-season data accumulated for the CSV report (keyed by season number). */
interface ShowSeasonEntry {
  count: number;
  /** Source folder where the season's episode files came from (first episode seen). */
  sourceDir: string;
  /** Output season folder the episode files were written to. */
  outputDir: string;
}

interface ProcessFileArgs {
  videoFile: string;
  vsmetaFile: string | null;
  outputRoot: string;
  opts: MigrateOptions;
  showMetaMap: Map<string, ShowNfoInput & { _nfoPath?: string }>;
  /** Premiere year per normalised show title, computed by the pre-scan pass */
  showPremiereYears: Map<string, number>;
  /** Show/season info inferred from sibling .vsmeta files, keyed by directory */
  folderContextMap: Map<string, FolderContext>;
  /** Pre-parsed .vsmeta content — avoids re-reading files already parsed in pre-scan */
  parsedMetaCache: Map<string, VsMetaData>;
  /** Accumulates per-show season data for the end-of-run CSV report */
  showSeasonCounts: Map<string, Map<number, ShowSeasonEntry>>;
  /** Accumulates movie rows (keyed by "title|year") for the end-of-run CSV report */
  movieReport: Map<string, MovieReportRow>;
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
  showSeasonCounts,
  movieReport,
}: ProcessFileArgs): 'ok' | 'skipped' {
  const { type, move, dryRun, wetRun, overwrite, noImages, log, warn } = opts;
  // dryRun takes priority over wetRun
  const effectiveWetRun = wetRun && !dryRun;

  // Use the pre-parsed result from the cache — avoids re-reading the file a second time.
  // A missing cache entry for an existing vsmetaFile means parsing failed during
  // pre-scan (already warned); treat it the same as having no .vsmeta.
  //
  // Shallow-clone the cached object before any mutations so that folder-context
  // inheritance and contentType corrections below do not corrupt the shared cache
  // entry for other files processed in this run.
  let meta: VsMetaData = { ...((vsmetaFile ? parsedMetaCache.get(vsmetaFile) : undefined) ?? emptyMeta()) };

  // Parse filename first — we need parsedEpisode before applying folder context so we
  // can decide whether to inherit the season number from siblings.
  const nameWithoutExt = path.basename(videoFile, path.extname(videoFile));
  const parsedEpisode = parseEpisodeFilename(nameWithoutExt);
  const parsedTitle = parseMovieFilename(nameWithoutExt);

  // For files that are not positively identified as TV show episodes by their own
  // vsmeta, inherit key fields from sibling episodes in the same folder that DO have
  // .vsmeta files.  This covers two cases:
  //   1. No .vsmeta at all — emptyMeta defaults contentType to 1 (movie).
  //   2. .vsmeta present but with contentType 1 and no season/episode numbers
  //      (some encoders write incorrect content types).
  // The check must happen BEFORE detectMediaType() so contentType is corrected first.
  let inferredFromFolder = false;
  if (meta.contentType !== 2 && meta.season == null && meta.episode == null) {
    const folderCtx = folderContextMap.get(path.dirname(videoFile));
    if (folderCtx?.isShow) {
      if (folderCtx.showTitle) meta.title = folderCtx.showTitle;
      meta.contentType = 2; // TV show — ensures detectMediaType() returns 'show'
      // Only inherit the season number from siblings when the filename itself provides
      // NO episode info at all.  If parsedEpisode is non-null we let computeShowPaths()
      // use it for both season AND episode — setting meta.season here while leaving
      // meta.episode null would force every episode to E01 and cause filename collisions.
      if (parsedEpisode === null && folderCtx.season != null) {
        meta.season = folderCtx.season;
      }
      inferredFromFolder = true;
    }
  }

  // Detect media type
  const mediaType = detectMediaType(videoFile, meta, type);

  if (mediaType === 'movie') {
    const paths = computeMoviePaths(outputRoot, videoFile, meta, parsedTitle);

    log(`  [movie] ${path.basename(videoFile)} → ${paths.folder}`);
    if (dryRun) return 'ok';

    ensureDir(paths.folder);

    // Copy/move video file (or write placeholder in wet-run)
    copyOrMoveOrPlaceholder(videoFile, paths.videoFile, move, effectiveWetRun);

    // Track for CSV report — same title/year derivation used by computeMoviePaths
    {
      const movieName = meta.title || parsedTitle.title;
      const movieYear =
        meta.year ||
        parsedTitle.year ||
        (meta.releaseDate ? extractYear(meta.releaseDate) : undefined);
      const key = `${movieName}|${movieYear ?? ''}`;
      if (!movieReport.has(key)) {
        movieReport.set(key, {
          name: movieName,
          year: movieYear,
          sourcePath: videoFile,
          outputPath: paths.videoFile,
        });
      }
    }

    // Copy .vsmeta (DS Video compatibility)
    if (vsmetaFile) {
      copyOrMoveOrPlaceholder(vsmetaFile, paths.vsmetaFile, false, effectiveWetRun);
    }

    // Write movie.nfo (always real — it's generated, not copied)
    if (overwrite || !fs.existsSync(paths.nfoFile)) {
      const nfo = generateMovieNfo({ meta, parsed: parsedTitle });
      fs.writeFileSync(paths.nfoFile, nfo, 'utf8');
    }

    // Extract images (or write image placeholders in wet-run).
    // Re-read the .vsmeta for image data — the pre-scan cache skips images to
    // keep RAM usage low across thousands of files.
    if (!noImages) {
      const images = loadImagesForFile(vsmetaFile);
      extractImages({ ...meta, ...images }, videoFile, paths.folder, false, effectiveWetRun, overwrite);
    }
  } else {
    // Infer show name from the source folder structure if possible
    const sourceShowName = inferShowName(videoFile, opts.input);

    // If vsmeta didn't provide a show title, use the one from the filename parser
    if (!meta.title && parsedEpisode?.showTitle) {
      meta.title = parsedEpisode.showTitle;
      meta.contentType = 2; // Ensure it is treated as a TV show title by resolveShowTitle
    }

    // Look up the pre-computed premiere year for this show
    const showTitleKey = resolveShowTitle(meta, sourceShowName, parsedTitle);
    const premiereYear = showPremiereYears.get(showTitleKey);

    let paths = computeShowPaths(
      outputRoot,
      videoFile,
      meta,
      parsedEpisode,
      parsedTitle,
      sourceShowName,
      premiereYear
    );

    // --- Extras detection -------------------------------------------------------
    // Files that carry a recognised bonus/extras keyword (DVD Extras, Making of,
    // Interview, Deleted Scenes, etc.) AND have no parseable SxxExx / NxNN episode
    // pattern are routed to <ShowFolder>/Extras/ with their original filename
    // preserved.  The season/episode machinery (clamping, NFO, CSV tracking) is
    // bypassed entirely — extras are supplementary content, not episodes.
    if (parsedEpisode === null && isExtrasFile(nameWithoutExt)) {
      const extrasFolder = path.join(paths.showFolder, 'Extras');
      const origBasename = path.basename(videoFile);
      const extrasVideoFile = path.join(extrasFolder, origBasename);

      log(`  [extra] ${origBasename} → "${paths.showKey}" Extras/`);
      if (dryRun) return 'ok';

      ensureDir(extrasFolder);
      copyOrMoveOrPlaceholder(videoFile, extrasVideoFile, move, effectiveWetRun);

      // Carry the .vsmeta sidecar alongside so DS Video still recognises the file
      if (vsmetaFile) {
        copyOrMoveOrPlaceholder(
          vsmetaFile,
          path.join(extrasFolder, path.basename(vsmetaFile)),
          false,
          effectiveWetRun
        );
      }

      // Accumulate show-level metadata so tvshow.nfo is still generated even when
      // the show folder contains only extras (no regular episodes).
      if (!showMetaMap.has(paths.showKey)) {
        const showTitle = paths.showKey.replace(/\s*\(\d{4}\)$/, '');
        const yearStr = paths.showKey.match(/\((\d{4})\)$/)?.[1];
        showMetaMap.set(paths.showKey, {
          showTitle,
          year: yearStr ? parseInt(yearStr, 10) : undefined,
          _nfoPath: paths.showNfoFile,
        } as ShowNfoInput & { _nfoPath: string });
      }
      mergeShowMeta(showMetaMap.get(paths.showKey)!, meta);

      // Extract show artwork (poster/fanart) if not already present
      if (!noImages) {
        const posterPath = path.join(paths.showFolder, 'poster.jpg');
        const showHasPoster = fs.existsSync(posterPath) ||
          (effectiveWetRun && fs.existsSync(posterPath + '.txt'));
        if (!showHasPoster || overwrite) {
          const images = loadImagesForFile(vsmetaFile);
          extractImages({ ...meta, ...images }, videoFile, paths.showFolder, false, effectiveWetRun, overwrite);
        }
      }

      return 'ok';
    }
    // ---------------------------------------------------------------------------

    // Clamp implausible season numbers (> 50) to Season 00.
    // Cartoons and other content without formal season structure are often stored
    // in DS Video with an absolute episode number encoded as the season number.
    // Season 00 is the Jellyfin/Kodi convention for specials and unsorted episodes.
    if (paths.season > 50) {
      const originalSeason = paths.season;
      const originalSource = paths.numberSource;

      // When the vsmeta episode is equally implausible (e.g. the same integer overflow
      // that produced the bad season) AND the filename contains no recognisable
      // SxxExx / NxNN pattern, try extracting a leading run of digits from the
      // filename as the episode identifier.
      // Example: "011549DVD Hare Do MM.avi" → episode 11549.
      const clampedMeta = { ...meta, season: 0 };
      if (parsedEpisode === null && (meta.episode ?? 0) > 10000) {
        const leadingDigits = nameWithoutExt.match(/^(\d+)/);
        if (leadingDigits) {
          clampedMeta.episode = parseInt(leadingDigits[1], 10);
        }
      }

      paths = computeShowPaths(
        outputRoot,
        videoFile,
        clampedMeta,
        parsedEpisode,
        parsedTitle,
        sourceShowName,
        premiereYear
      );
      warn(`  [warn] Implausible season ${originalSeason} for "${path.basename(videoFile)}" ` +
        `(source: ${originalSource}) — placing in Season 00.`);
    }

    const seNum = `S${formatSeason(paths.season)}E${formatEpisode(paths.episode)}`;
    const inferNote = inferredFromFolder ? ' [no .vsmeta — folder-inferred]' : '';
    log(`  [show]  ${path.basename(videoFile)} → "${paths.showKey}" ${seNum} [${paths.numberSource}]${inferNote}`);
    if (dryRun) return 'ok';

    ensureDir(paths.seasonFolder);

    // Copy/move video (or write placeholder in wet-run)
    copyOrMoveOrPlaceholder(videoFile, paths.videoFile, move, effectiveWetRun);

    // Track for CSV report — increment episode count for this show+season,
    // recording the source/output directories from the first episode seen.
    {
      const seasonMap = showSeasonCounts.get(paths.showKey) ?? new Map<number, ShowSeasonEntry>();
      const existing = seasonMap.get(paths.season);
      if (existing) {
        existing.count++;
      } else {
        seasonMap.set(paths.season, {
          count: 1,
          sourceDir: path.dirname(videoFile),
          outputDir: paths.seasonFolder,
        });
      }
      showSeasonCounts.set(paths.showKey, seasonMap);
    }

    // Copy .vsmeta (or placeholder)
    if (vsmetaFile) {
      copyOrMoveOrPlaceholder(vsmetaFile, paths.vsmetaFile, false, effectiveWetRun);
    }

    // Write episode .nfo (always real — it's generated, not copied)
    if (overwrite || !fs.existsSync(paths.nfoFile)) {
      const nfo = generateEpisodeNfo({
        meta,
        parsedEpisode,
        parsedTitle,
        showTitle: paths.showKey.replace(/\s*\(\d{4}\)$/, ''),
        // Pass the path-resolved values so the NFO always agrees with the actual
        // season folder and episode filename (e.g. after implausible-season clamping).
        resolvedSeason: paths.season,
        resolvedEpisode: paths.episode,
      });
      fs.writeFileSync(paths.nfoFile, nfo, 'utf8');
    }

    // Accumulate show metadata for tvshow.nfo
    if (!showMetaMap.has(paths.showKey)) {
      const showTitle = paths.showKey.replace(/\s*\(\d{4}\)$/, '');
      const year = paths.showKey.match(/\((\d{4})\)$/)?.[1];
      showMetaMap.set(paths.showKey, {
        showTitle,
        year: year ? parseInt(year, 10) : undefined,
        _nfoPath: paths.showNfoFile,
      } as ShowNfoInput & { _nfoPath: string });
    }
    const showInput = showMetaMap.get(paths.showKey)!;
    mergeShowMeta(showInput, meta);

    // Extract images for show root (poster/fanart) — only from first episode that has them.
    // In wet-run we check for the placeholder file too, to avoid duplicates.
    // Re-read .vsmeta for image data (pre-scan cache skips images to save RAM).
    // Pass overwrite so extractImages respects the same flag as .nfo writes.
    if (!noImages) {
      const posterPath = path.join(paths.showFolder, 'poster.jpg');
      const showHasPoster = fs.existsSync(posterPath) ||
        (effectiveWetRun && fs.existsSync(posterPath + '.txt'));
      if (!showHasPoster || overwrite) {
        const images = loadImagesForFile(vsmetaFile);
        extractImages({ ...meta, ...images }, videoFile, paths.showFolder, false, effectiveWetRun, overwrite);
      }
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

/**
 * Re-read a .vsmeta file to extract image data only (posterImage, backdropImage).
 * Returns an empty object when vsmetaFile is null or the read/parse fails.
 * Called during processFile() — separate from the pre-scan cache which skips images
 * to save RAM.
 */
function loadImagesForFile(
  vsmetaFile: string | null
): Pick<VsMetaData, 'posterImage' | 'backdropImage'> {
  if (!vsmetaFile) return {};
  try {
    const full = parseVsMeta(fs.readFileSync(vsmetaFile));
    return { posterImage: full.posterImage, backdropImage: full.backdropImage };
  } catch {
    return {};
  }
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
 * Uses the COPYFILE_EXCL flag so the OS rejects the operation atomically if
 * `dest` already exists.  This prevents any silent data loss — the error is
 * surfaced to the caller (processFile) which logs it and increments the error
 * counter so the user knows exactly which files collided.
 *
 * Never call this with a pre-existence check that swallows the result; every
 * source file must either land at its destination or produce a visible error.
 */
function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  // COPYFILE_EXCL: throws EEXIST if dest already exists — never silently overwrite.
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
}

/**
 * Move `src` to `dest`.
 *
 * Explicitly checks for a pre-existing destination and throws rather than
 * letting renameSync silently replace it (POSIX rename() is atomic-replace,
 * which would destroy the existing file without warning).
 */
function moveFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) {
    throw new Error(`Destination already exists: ${dest}`);
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

function copyOrMoveOrPlaceholder(
  src: string,
  dest: string,
  move: boolean,
  wetRun: boolean
): void {
  if (wetRun) {
    writePlaceholder(src, dest);
  } else if (move) {
    moveFile(src, dest);
  } else {
    copyFile(src, dest);
  }
}
