# ds-video-to-jellyfin

A Node.js CLI tool (and library) that reorganizes a [Synology DS Video](https://www.synology.com/en-us/dsm/packages/VideoStation) collection into a [Jellyfin](https://jellyfin.org)-compatible folder structure — while **keeping DS Video fully functional** throughout the transition.

## How it works

DS Video stores metadata in proprietary binary `.vsmeta` files alongside each video. Jellyfin expects a specific folder layout and Kodi-standard `.nfo` XML files.

This tool:

1. **Scans** your DS Video library recursively for video files
2. **Parses** adjacent `.vsmeta` files to extract metadata (title, plot, genres, cast, artwork, etc.)
3. **Auto-detects** whether each file is a movie or a TV show episode
4. **Reorganizes** files into the Jellyfin folder structure
5. **Generates `.nfo` files** (Jellyfin reads these)
6. **Preserves `.vsmeta` files** alongside the video (DS Video keeps reading these)
7. **Extracts artwork** (poster.jpg, fanart.jpg) from the `.vsmeta` embedded images

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

You can also import individual utilities:

```typescript
import { parseVsMeta } from 'ds-video-to-jellyfin';
import { readFileSync } from 'fs';

const meta = parseVsMeta(readFileSync('myvideo.mkv.vsmeta'));
console.log(meta.title, meta.season, meta.episode);
```

## Supported input structures

The tool handles various DS Video folder layouts:

```
/library/Movie Title (2020).mkv
/library/Movies/Movie Title (2020)/movie.mkv
/library/TV/Show Name/Season 1/S01E01.mkv
/library/TV/Show Name/1x01 Episode Title.mkv
/library/TV/Show Name/Season 1 Episode 1.mkv
```

## Movie vs TV show auto-detection

Each file is classified in priority order:

| # | Signal | Example |
|---|--------|---------|
| 1 | `.vsmeta` content type / season+episode fields | content type = 2 → show |
| 2 | Filename episode pattern | `S01E03`, `1x03` → show |
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

## Migration reports (CSV)

After every real or wet run, two CSV files are written to the **output root directory**:

| File | Contents |
|------|----------|
| `migration-shows.csv` | One row per TV show season |
| `migration-movies.csv` | One row per movie |

> CSV files are **not** produced during `--dry-run` (no files are written in that mode).

### `migration-shows.csv`

| Column | Description |
|--------|-------------|
| Name | Show title (without year) |
| Year | Premiere year |
| Season | Season number — `0` means Season 00 / Specials |
| Episodes | Number of episode files written in this season |
| Source Directory | Folder the source episode files came from |
| Output Directory | Output season folder the files were placed in |

```
Name,Year,Season,Episodes,Source Directory,Output Directory
Breaking Bad,2008,1,7,V:\Video\TV\Breaking Bad\Season 1,V:\Output\Breaking Bad (2008)\Season 01
Breaking Bad,2008,2,13,V:\Video\TV\Breaking Bad\Season 2,V:\Output\Breaking Bad (2008)\Season 02
Looney Tunes Cartoons,2009,0,156,V:\Video\TV\Looney Tunes,V:\Output\Looney Tunes Cartoons (2009)\Season 00
```

### `migration-movies.csv`

| Column | Description |
|--------|-------------|
| Name | Movie title |
| Year | Release year |
| Source Path | Full path to the source video file |
| Output Path | Full path to the output video file |

```
Name,Year,Source Path,Output Path
Inception,2010,V:\Video\Movies\Inception (2010).mkv,V:\Output\Inception (2010)\Inception (2010).mkv
The Dark Knight,2008,V:\Video\Movies\The Dark Knight.mkv,V:\Output\The Dark Knight (2008)\The Dark Knight (2008).mkv
```

Use these files to cross-check the migration against your source library — sort by episode count to spot seasons with an unexpected number of files, filter by source directory to verify a specific folder was fully processed, or diff two CSV snapshots to see what changed between runs. Each file is overwritten on every run so it always reflects the most recent migration.

## Development

```bash
git clone https://github.com/aldarondo/ds-video-to-jellyfin
cd ds-video-to-jellyfin
npm install
npm run build
npm test
```

## License

MIT
