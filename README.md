# ds-video-to-jellyfin

A Node.js CLI tool (and library) that reorganizes a [Synology DS Video](https://www.synology.com/en-us/dsm/packages/VideoStation) collection into a [Jellyfin](https://jellyfin.org)-compatible folder structure — while **keeping DS Video fully functional** throughout the transition.

> **Note:** The core parsing and organization modules of this project are backed by **100% unit test coverage** to ensure a safe, robust, and reliable media migration experience.

## How it works

DS Video stores metadata in proprietary binary `.vsmeta` files alongside each video. Jellyfin expects a specific folder layout and Kodi-standard `.nfo` XML files.

This tool:

1. **Scans** your DS Video library recursively for video files.
2. **Parses** adjacent `.vsmeta` files using `vsmeta-parser`.
3. **Auto-detects** media type using metadata and **path-aware** patterns from `parse-torrent-path`.
4. **Reorganizes** files into the Jellyfin folder structure.
5. **Generates `.nfo` files** using `vsmeta-to-nfo`.
6. **Preserves `.vsmeta` files** alongside the video.
7. **Extracts artwork** using `vsmeta-to-jpeg`.

The result is a folder structure that works with **both** DS Video and Jellyfin simultaneously.

## Migration strategy

```
1. Within DS Video, go to Settings → Library tab → Export Video Info icon for Movie and TV Show libraries
2. Pre-check the conversion with either a wet or dry run to make sure all files will migrate
3. Run the tool → new output directory with Jellyfin layout
4. Add output directory to DS Video → re-indexes, works as before
5. Add output directory to Jellyfin → reads .nfo files
6. Use both in parallel as long as you need
7. When ready, just stop using DS Video and optionally remove all .vsmeta files.
```

## Output structure

### Movies

```
output/
└── Some Great Movie (2020)/
    ├── Some Great Movie (2020).mkv        ← video (copied or moved)
    ├── Some Great Movie (2020).mkv.vsmeta ← DS Video metadata (copied)
    ├── movie.nfo                          ← Jellyfin metadata (generated)
    ├── poster.jpg
    └── fanart.jpg
```

### TV Shows

```
output/
└── My Favourite Show (2019)/
    ├── tvshow.nfo
    ├── poster.jpg
    ├── fanart.jpg
    └── Season 01/
        ├── My Favourite Show S01E01 Pilot.mkv
        ├── My Favourite Show S01E01 Pilot.mkv.vsmeta
        └── My Favourite Show S01E01 Pilot.nfo
```

## Installation

```bash
npm install -g ds-video-to-jellyfin
```

Or run without installing:

```bash
npx ds-video-to-jellyfin --input /path/to/library --output /path/to/output
```

## Usage

```
ds-video-to-jellyfin [options]

Options:
  -i, --input <path>            Source directory (your DS Video library)  [required]
  -o, --output <path>           Output directory for Jellyfin layout      [required]
  -t, --type <movies|shows|auto>  Force content type (default: auto)
  --move                        Move files instead of copying
  --dry-run                     Preview without writing any files
  --wet-run                     Create folders and .nfo files; replace video/image files with .txt placeholders
  --no-images                   Skip image extraction
  --overwrite                   Overwrite existing output files
  -v, --verbose                 Detailed progress output
  -V, --version                 Show version
  -h, --help                    Show help
```

## Examples

```bash
# Preview what would happen (safe, nothing is written)
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --dry-run

# Wet run: validate folder layout and .nfo files without copying large video files
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --wet-run

# Copy everything to a new Jellyfin-compatible structure
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin

# Force a single folder to be treated as TV shows
ds-video-to-jellyfin -i /volume1/video/MyShow -o /volume1/jellyfin --type shows

# Move (not copy) files to save disk space
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --move

# Re-run to update after adding new content
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --overwrite
```

## Programmatic API

```typescript
import { migrate } from 'ds-video-to-jellyfin';

await migrate({
  input: '/path/to/ds-video-library',
  output: '/path/to/output',
  type: 'auto',
  move: false,
  dryRun: false,
  wetRun: false,
  noImages: false,
  overwrite: false,
  log: console.log,
  warn: console.warn,
});
```

```typescript
import { parseVsMeta } from 'vsmeta-parser';
import { readFileSync } from 'fs';

const meta = parseVsMeta(readFileSync('myvideo.mkv.vsmeta'));
console.log(meta.title, meta.season, meta.episode);
```

## Supported input structures

The tool handles various DS Video folder layouts:

```
/library/Movie Title (2020).mkv
/library/Movies/Movie Title (2020)/movie.mkv
/library/TV/Show Name (2020)/Season 1/S01E01.mkv
/library/TV/Show Name/1x01 Episode Title.mkv
/library/TV/Show Name/Season 1 Episode 1.mkv
```

## Movie vs TV show auto-detection

Each file is classified in priority order:

| # | Signal | Example |
|---|--------|---------|
| 1 | `.vsmeta` content type / season+episode fields | content type = 2 → show |
| 2 | **Path-aware** filename episode pattern | `Season 01/ep1.mkv` → show |
| 3 | Ancestor folder is a season folder | `Season 1/`, `S01/` → show |
| 4 | Ancestor folder name contains **"show"** or **"movie"** (case-insensitive) | `TV Shows/` → show · `Movies/` → movie |
| 5 | Default | → movie |

Step 3 takes priority over step 4, so a file inside `Movies/My Series/Season 1/` is
still correctly detected as a TV show.

Use `--type movies` or `--type shows` to override detection for an entire run.

## Metadata sources

| Source | Priority | Used for |
|--------|----------|----------|
| `.vsmeta` embedded data | 1st (best) | All metadata fields |
| Filename pattern parsing | 2nd | Season/episode, title, year |
| Folder structure | 3rd | Show name, season number |

## Artwork

Artwork is sourced from:
1. Embedded JPEG images in the `.vsmeta` file (poster, backdrop, thumbnail)
2. Synology `@eaDir` thumbnail cache alongside the source file

## Migration report (JSON)

After every real or wet run, a consolidated JSON report is written to the **output root directory**: `migration-report.json`.

This report is generated by `nfo-to-json` and contains structured data for all migrated movies and TV shows, enabling easy programmatic verification or integration with other tools.

## Development

```bash
# Clone the repository
git clone https://github.com/aldarondo/ds-video-to-jellyfin
cd ds-video-to-jellyfin

# Install dependencies
npm install

# Build the project (using tsup)
npm run build

# Run tests (using vitest)
npm test

# Run the CLI from source (using tsx)
npx tsx src/cli.ts --help
```

## License

MIT
