# ds-video-to-jellyfin

A Node.js CLI tool (and library) that migrates a [Synology DS Video](https://www.synology.com/en-us/dsm/packages/VideoStation) collection to a [Jellyfin](https://jellyfin.org)-compatible folder structure. Files are reorganized, `.nfo` metadata is generated, and artwork is extracted — all from the existing `.vsmeta` sidecar files DS Video already wrote.

> **Note:** The core parsing and organization modules are backed by **100% unit test coverage**.

## How it works

DS Video stores metadata in proprietary binary `.vsmeta` files alongside each video. Jellyfin expects a specific folder layout and Kodi-standard `.nfo` XML files.

This tool:

1. **Scans** your DS Video library recursively for video files.
2. **Parses** adjacent `.vsmeta` files using `vsmeta-parser`.
3. **Auto-detects** media type (movie vs. TV show) using metadata and path-aware patterns.
4. **Reorganizes** files into the Jellyfin folder structure — copying, moving, or hardlinking.
5. **Generates `.nfo` files** using `vsmeta-to-nfo`.
6. **Preserves `.vsmeta` files** alongside the video so DS Video keeps working if needed.
7. **Extracts artwork** (poster, fanart, thumbnail) using `vsmeta-to-jpeg`.

## Migration strategy

```
1. Dry run — preview what would happen (nothing written)
2. Wet run — validate folder structure and .nfo files without copying large video files
3. Full run — copy, move, or hardlink everything to a new Jellyfin-compatible output
4. Add output directory to Jellyfin → reads .nfo files, scans artwork
5. (Optional) Keep DS Video working in parallel by also adding the output directory there
```

**Recommended:** use `--hardlink` on a single-volume NAS. Hardlinks create zero extra disk usage — both the original and Jellyfin paths point to the same data.

## Output structure

### Movies

```
output/
└── Some Great Movie (2020)/
    ├── Some Great Movie (2020).mkv        ← video (copied, moved, or hardlinked)
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
  -i, --input <path>              Source directory (your DS Video library)  [required]
  -o, --output <path>             Output directory for Jellyfin layout      [required]
  -t, --type <movies|shows|auto>  Force content type (default: auto)
  --move                          Move files instead of copying
  --hardlink                      Hardlink instead of copying (zero extra disk space;
                                  requires source and output on the same volume)
  --dry-run                       Preview without writing any files
  --wet-run                       Create folders and .nfo files; replace video/image
                                  files with .txt placeholders
  --no-images                     Skip image extraction
  --overwrite                     Overwrite existing output files
  --years-file <path>             JSON file mapping TV show titles to premiere years
                                  (avoids interactive prompts for shows with no
                                  detectable year in filenames or .vsmeta)
  -v, --verbose                   Detailed per-file progress output
  -V, --version                   Show version
  -h, --help                      Show help
```

## Examples

```bash
# Preview what would happen (safe, nothing is written)
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --dry-run

# Wet run: validate folder layout and .nfo files without copying large video files
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --wet-run

# Hardlink everything (zero extra disk space — recommended for single-volume NAS)
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --hardlink

# Copy everything to a new Jellyfin-compatible structure
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin

# Move files (frees up source disk space, modifies original structure)
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --move

# Force a single folder to be treated as TV shows
ds-video-to-jellyfin -i /volume1/video/MyShow -o /volume1/jellyfin --type shows

# Re-run to add new content to an existing output (overwrites changed files)
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin --hardlink --overwrite

# Suppress year prompts for shows whose year isn't in filenames or .vsmeta
ds-video-to-jellyfin -i /volume1/video -o /volume1/jellyfin \
  --hardlink --years-file /path/to/show-years.json
```

### `--years-file` format

A plain JSON object mapping show title to premiere year. Titles must match what the tool
resolves (usually the `.vsmeta` title or the top-level folder name):

```json
{
  "Mystery Science Theater 3000": 1988,
  "Star Trek": 1966
}
```

## Programmatic API

```typescript
import { migrate } from 'ds-video-to-jellyfin';

await migrate({
  input: '/path/to/ds-video-library',
  output: '/path/to/output',
  type: 'auto',      // 'movies' | 'shows' | 'auto'
  move: false,
  hardlink: true,    // zero extra disk space; requires same volume
  dryRun: false,
  wetRun: false,
  noImages: false,
  overwrite: false,
  log: console.log,
  warn: console.warn,
});
```

## Supported input structures

The tool handles varied DS Video folder layouts:

```
/library/Movie Title (2020).mkv
/library/Movies/Movie Title (2020)/movie.mkv
/library/TV/Show Name (2020)/Season 1/S01E01.mkv
/library/TV/Show Name/1x01 Episode Title.mkv
/library/TV/Show Name/Season 1 Episode 1.mkv
/library/Show Name Season 2/ep.mkv          ← embedded season in folder name
```

## Movie vs TV show auto-detection

Each file is classified using the following priority order:

| Priority | Signal | Result |
|----------|--------|--------|
| 1 | `--type movies` or `--type shows` flag | forced |
| 2 | Ancestor folder matches `Season N` or `S01` pattern | → show |
| 3 | Ancestor folder name contains **"movie"** | → movie (overrides vsmeta) |
| 4 | `.vsmeta` content type = 2, or has season/episode fields | → show |
| 5 | Filename matches `S01E01` or `1x01` episode pattern | → show |
| 6 | Ancestor folder name contains **"show"** | → show |
| 7 | Default | → movie |

Path signals (rows 2–3) take priority over `.vsmeta` content type (row 4). This means a file
inside `Movies/SomeSeries/Season 1/` is correctly identified as a TV show despite the "movie"
keyword — the season folder wins.

Use `--type movies` or `--type shows` to override detection for an entire run.

## Metadata sources

| Source | Priority | Used for |
|--------|----------|----------|
| `.vsmeta` embedded data | 1st (best) | All metadata fields |
| Filename / path pattern parsing | 2nd | Season/episode numbers, title, year |
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
