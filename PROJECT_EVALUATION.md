# DS Video to Jellyfin - Project Evaluation

This document outlines how `ds-video-to-jellyfin` operates, the mechanisms it uses for metadata extraction and media detection, its current limitations, and recommended feature improvements for future development or AI pair-programming sessions.

## 1. What It Does
The tool migrates a Synology DS Video repository into a Jellyfin-compatible structure without breaking DS Video functionality. 
- **Scanning & Parsing:** Scans the target directory for video files and their accompanying `.vsmeta` files.
- **Classification:** Auto-detects whether each video is a Movie or a TV Show.
- **Extraction:** Extracts embedded metadata (title, year, plot, cast, ratings, etc.) and artwork (posters, fanart/backdrops) from `.vsmeta` files or `@eaDir` Synology cache.
- **Reorganization:** Generates a Jellyfin-compliant folder structure (`Movie (Year)` and `Show (Year)/Season XX`).
- **NFO Generation:** Creates standard `.nfo` XML files used by Jellyfin, Emby, and Kodi.

## 2. How It Does It
The core processing is coordinated primarily in `src/migrator.ts`.

1. **Pre-scan Phase:** Efficiently reads all `.vsmeta` files concurrently to build a `parsedMetaCache`. It gathers context about TV show premiere years and establishes "folder context" (so episodes missing their own `.vsmeta` can inherit the show name and season from siblings).
2. **Identification (`src/detectors/media-type.ts`):** 
   - Uses strict rules in priority order: `vsmeta` content-type flags $\rightarrow$ filename parsing (SxxExx) $\rightarrow$ Season folder structures $\rightarrow$ parent folder keywords ("Movies", "TV Shows").
3. **Filename Parsing (`src/utils/filename-parser.ts`):** 
   - Relies on RegEx patterns to extract season and episode numbers (e.g., `S01E01`, `1x01`, `Season 1 Episode 1`).
   - Extracts movie titles and years by looking for standard formats (e.g., `Title (2020)`, `Title.2020`, or embedded years like `Name2006`).
4. **Metadata Parsing (`src/parsers/vsmeta.ts`):** 
   - Implements a custom protobuf-style deserializer for the proprietary binary format, extracting strings, integers, and base64 encoded JPEGs.
5. **Moving & Organizing:** Evaluates the detected metadata to determine the output paths, safely copying or moving the video, `.vsmeta`, and extracted images.

## 3. Potential Limitations

### 3.1 Limitations in Movie Detection
- **Brittle Regex for Titles/Years:** While `filename-parser.ts` covers standard conventions (e.g., `Movie (Year)`), it may fail to find years in obscure file names. If the year isn't in `.vsmeta` and isn't extractable from the filename, the output folder will simply be the title without a year.
- **Special Characters:** Heavy reliance on removing separators (`.` or `_`) can sometimes incorrectly mangle legitimately hyphenated or dotted titles.

### 3.2 Limitations in TV Show Detection
- **Absolute Episode Numbers (Anime):** The tool struggles with long-running series or anime that use consecutive absolute episode numbers (e.g., Episode 1054) rather than distinct Season/Episode pairs. The migrator clamps any season parsed > 50 into `Season 00` (Specials), effectively breaking organization for such shows.
- **Multipart Episodes:** Double or multipart episodes (e.g., `S01E01-02` or `1x01-02`) aren't natively processed to output multi-episode NFO or formatting; the parser only captures the first matched episode ID.
- **Premiere Year Extraction:** The tool finds the lowest year across all episodes to determine a TV Show's premiere year. However, if a directory contains reboots or same-name shows (e.g., *Doctor Who 1963* vs. *Doctor Who 2006*) and folder hierarchies fail to distinguish them clearly, they run the risk of being merged under the earliest year or improperly flagged as separate shows unnecessarily.
- **Strict Extras Patterns:** Supplementary content (e.g., bloopers, trailers) is only identified through a hardcoded regex array (`bts`, `featurette`, `deleted scenes`). If an extra is not explicitly named with one of these keywords, it gets parsed as a regular episode or movie.

## 4. Potential Feature Improvements

1. **Third-Party API Fallback (TMDB/TVDB/OMDB)**
   - **Feature:** If `vsmeta` and filename heuristics fail to populate the release year or standard title, query an external API.
   - **Benefit:** Highly increases the accuracy of folder organization and prevents "Unknown Year" manual CLI prompts.

2. **Anime / Absolute Numbering Support**
   - **Feature:** Add a switch or detection mechanism for absolute formats, converting them into absolute episode `.nfo` elements or determining Season/Episode layouts using an API like AniDB.
   - **Benefit:** Prevents anime collections from being dumped entirely into `Season 00`.

3. **Improve Interactive CLI Wizard**
   - **Feature:** Extend the basics of the existing interactive console prompt to better intercept files that fail to parse successfully, explicitly allowing the user to define the Type, Title, Season, and Episode.
   - **Benefit:** Gives users an easy way to fix edge cases generated by parsing errors without having to touch their file system or `.vsmeta` files.

4. **Custom Folder Layout Templates**
   - **Feature:** Allow customization of the output path (e.g., template strings like `{ShowTitle} ({Year})/{SeasonFolder}/{ShowTitle} - S{s}E{e}`).
   - **Benefit:** Some users prefer different organization techniques (e.g., "Season 1" vs "Season 01") or different delimiters.
