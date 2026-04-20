#!/usr/bin/env node
/**
 * ds-video-to-jellyfin CLI
 *
 * Reorganizes a Synology DS Video collection into a Jellyfin-compatible
 * folder structure. Preserves .vsmeta files so DS Video continues to work
 * during the transition period.
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { migrate } from './migrator.js';

// __dirname is dist/ after tsup compilation, so package.json is one level up
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
) as { version: string };

const program = new Command();

program
  .name('ds-video-to-jellyfin')
  .description(
    'Reorganize a Synology DS Video collection into a Jellyfin-compatible folder structure.\n' +
    'Preserves .vsmeta files alongside the video files so DS Video keeps working\n' +
    'while you transition to Jellyfin.'
  )
  .version(pkg.version)
  .requiredOption('-i, --input <path>', 'Source directory to scan (your DS Video library)')
  .requiredOption('-o, --output <path>', 'Output directory for the Jellyfin-compatible structure')
  .option(
    '-t, --type <type>',
    'Force content type: "movies", "shows", or "auto" (default)',
    (val) => {
      if (!['movies', 'shows', 'auto'].includes(val)) {
        throw new Error(`--type must be one of: movies, shows, auto`);
      }
      return val as 'movies' | 'shows' | 'auto';
    },
    'auto'
  )
  .option('--move', 'Move files instead of copying (frees up space but modifies source)')
  .option('--hardlink', 'Create hardlinks instead of copying (zero extra disk space; both paths share the same data; requires same volume)')
  .option('--dry-run', 'Preview what would happen without writing any files')
  .option(
    '--wet-run',
    'Create folders and .nfo files; write a .txt placeholder instead of copying each video/image file'
  )
  .option('--no-images', 'Skip extracting poster and fanart images')
  .option('--overwrite', 'Overwrite existing files in the output directory')
  .option('-v, --verbose', 'Show detailed progress for each file')
  .option(
    '--years-file <path>',
    'JSON file mapping TV show titles to premiere years (avoids interactive year prompts)'
  )
  .addHelpText(
    'after',
    `
Examples:
  # Preview what would happen (safe, nothing written)
  $ ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --dry-run

  # Wet run: creates folders and .nfo files, video files replaced with .txt placeholders
  $ ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --wet-run

  # Copy files to new structure (keeps originals intact)
  $ ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin

  # Force everything in a folder to be treated as TV shows
  $ ds-video-to-jellyfin -i /volume1/video/MyShow -o /volume1/jellyfin --type shows

  # Move files and overwrite existing output
  $ ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --move --overwrite
`
  );

program.parse();

const options = program.opts<{
  input: string;
  output: string;
  type: 'movies' | 'shows' | 'auto';
  move: boolean;
  hardlink: boolean;
  dryRun: boolean;
  wetRun: boolean;
  images: boolean;
  overwrite: boolean;
  verbose: boolean;
  yearsFile?: string;
}>();

// Resolve paths
const inputPath = path.resolve(options.input);
const outputPath = path.resolve(options.output);

if (!fs.existsSync(inputPath)) {
  console.error(`Error: input directory does not exist: ${inputPath}`);
  process.exit(1);
}

// Guard against output being the same as, or nested inside, the input.
// On a --move run this would cause already-moved video files to be rescanned
// as source files, leading to errors or double-processing.
const inputWithSep = inputPath.endsWith(path.sep) ? inputPath : inputPath + path.sep;
if (outputPath === inputPath || outputPath.startsWith(inputWithSep)) {
  console.error('Error: output directory must not be the same as or nested inside the input directory.');
  process.exit(1);
}

if (options.dryRun) {
  console.log('DRY RUN — no files will be written.\n');
} else if (options.wetRun) {
  console.log('WET RUN — folders and .nfo files will be created; video/image files replaced with .txt placeholders.\n');
}

const log = (msg: string) => {
  // In verbose mode print everything; otherwise print only top-level messages
  // (those not indented with two spaces, which are per-file detail lines).
  if (options.verbose || !msg.startsWith('  ')) {
    console.log(msg);
  }
};

const warn = (msg: string) => {
  console.warn(msg);
};

// Load years override map from --years-file if provided
let yearsMap: Record<string, number> = {};
if (options.yearsFile) {
  const yearsFilePath = path.resolve(options.yearsFile);
  if (!fs.existsSync(yearsFilePath)) {
    console.error(`Error: --years-file not found: ${yearsFilePath}`);
    process.exit(1);
  }
  yearsMap = JSON.parse(fs.readFileSync(yearsFilePath, 'utf8')) as Record<string, number>;
}

// Lazily create a readline interface only if the user is actually prompted
// (i.e. at least one show has no determinable year).  Creating it eagerly
// would keep Node's event loop alive and delay process exit in the common
// case where all shows already have year information.
let rl: readline.Interface | undefined;
const prompt = (question: string): Promise<string> => {
  // Extract show title from question: Year for "TITLE" (e.g. ...)
  const match = question.match(/^Year for "([^"]+)"/);
  if (match) {
    const title = match[1];
    if (yearsMap[title] !== undefined) {
      const year = String(yearsMap[title]);
      console.log(`[years-file] "${title}" → ${year}`);
      return Promise.resolve(year);
    }
  }
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return new Promise(resolve => rl!.question(question, resolve));
};

// Ensure output directory exists (unless dry-run)
if (!options.dryRun) {
  fs.mkdirSync(outputPath, { recursive: true });
}

migrate({
  input: inputPath,
  output: outputPath,
  type: options.type,
  move: options.move ?? false,
  hardlink: options.hardlink ?? false,
  dryRun: options.dryRun ?? false,
  wetRun: options.wetRun ?? false,
  noImages: !options.images,
  overwrite: options.overwrite ?? false,
  log,
  warn,
  prompt,
  // All entries in the years-file act as overrides — they win over vsmeta-detected
  // years so they can correct wrong DS Video metadata, not just fill gaps.
  overrideYears: Object.keys(yearsMap).length > 0
    ? new Map(Object.entries(yearsMap))
    : undefined,
})
  .then((result) => {
    rl?.close();
    console.log('\nDone.');
    console.log(`  Processed : ${result.processed}`);
    console.log(`  Skipped   : ${result.skipped}`);
    console.log(`  Errors    : ${result.errors}`);

    if (!options.dryRun) {
      console.log(`  Report    : migration-report.json`);
    }

    if (options.dryRun) {
      console.log('\nThis was a dry run. Run without --dry-run to apply changes.');
    } else if (options.wetRun) {
      console.log('\nThis was a wet run. Video/image files have been replaced with .txt placeholders.');
      console.log('Re-run without --wet-run to copy the real files.');
    }
    process.exit(result.errors > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    rl?.close();
    console.error('Fatal error:', (err as Error).message);
    process.exit(1);
  });
