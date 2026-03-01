# DS Video to Jellyfin - Project Evaluation

This document outlines how `ds-video-to-jellyfin` operates, its modular architecture based on specialized packages, current limitations, and recommendations for future development.

## 1. Modular Architecture & Reliability
The project has been refactored to delegate core responsibilities to a suite of specialized, reusable packages. This reduces the internal codebase and leverages community-maintained logic. Furthermore, all core sub-modules in this repository have achieved **100% line coverage** in their unit tests, serving as a reliable foundation.

- **Metadata Parsing:** Uses `vsmeta-parser` for robust Synology `.vsmeta` binary parsing.
- **Artwork Extraction:** Uses `vsmeta-to-jpeg` to extract posters and fanart from `.vsmeta` headers.
- **NFO Generation:** Uses `vsmeta-to-nfo` to convert `.vsmeta` data into Jellyfin-compatible XML.
- **Filename/Path Parsing:** Uses `parse-torrent-path` for context-aware extraction of titles, years, seasons, and episodes.
- **Reporting:** Uses `nfo-to-json` to aggregate all generated `.nfo` files into a consolidated JSON migration report.

## 2. How It Works

### 2.1 Pre-scan Phase
Coordinated in `src/migrator.ts`, the tool performing a concurrent pre-scan of all `.vsmeta` files.
- **Caching:** Builds a `parsedMetaCache` to ensure each `.vsmeta` is read and parsed only once.
- **Context Establishment:** Gathers show premiere years and establishes "folder context", allowing files without `.vsmeta` to inherit metadata from siblings in the same directory.

### 2.2 Path-Aware Identification
The tool uses `parse-torrent-path` with **full absolute paths**.
- **Context Extraction:** By passing the full path, the parser can look at parent directory names (e.g., "Season 01", "Show Name (2020)") to resolve metadata that might be missing from the filename itself.
- **Detection Logic (`src/detectors/media-type.ts`):** Prioritizes `.vsmeta` flags, followed by path-aware filename patterns, season folder structures, and finally environmental keywords like "Movies" or "TV Shows".

### 2.3 Organization & Migration
The tool safely reorganizes files into the standard Jellyfin layout:
- `Movie (Year)` folders for films.
- `Show (Year)/Season XX` folders for series.
- Preserves original `.vsmeta` files alongside the video to maintain DS Video compatibility.

## 3. Current Limitations

### 3.1 Path-Aware Context Gaps
While `parse-torrent-path` is path-aware, it currently only checks the immediate parent folder. Deeply nested structures (e.g., `Show/Disc 01/S01E01.mkv`) still rely on some manual "up-tree" walking in the `ds-video-to-jellyfin` codebase.

### 3.2 Legacy Pattern Complexity
DS Video uses some non-standard naming conventions (e.g., standalone `- 7 -` episode numbers or mashed titles like `ShowName2006`). These are currently handled via local fallback wrappers in `src/utils/filename-parser.ts`.

### 3.3 Multipart & Absolute Numbering
- **Anime:** Absolute episode numbering (e.g., Episode 1054) is still largely treated as `Season 00` if not explicitly mapped.
- **Multipart Episodes:** Double episodes (e.g., `S01E01-02`) only capture the first episode ID for file naming and NFO generation.

## 4. Recommendations for Future Development

### 1. Upstream Legacy Patterns
Move the DS Video specific regex patterns (e.g., standalone episode numbers, mashed year-titles) into `parse-torrent-path` as optional handlers. This would eliminate the need for `src/utils/filename-parser.ts` wrappers.

### 2. Enhance Multi-Level Path Parsing
Improve `parse-torrent-path` (or a dedicated context library) to perform multi-level path walking for year and show title extraction, replacing the manual walking logic currently in `show-organizer.ts` and `migrator.ts`.

### 3. Dedicated Media Classifier
Extract the logic in `src/detectors/media-type.ts` into a standalone library (`media-type-classifier`). This generic "best-guess" engine (prioritizing metadata > filename > path keywords) is useful for many media projects.

### 4. High-Level Orchestrator Library
Create a library (`vsmeta-to-jellyfin-content`) that wraps `vsmeta-to-jpeg` and `vsmeta-to-nfo`. This would allow calling a single function to handle all metadata sidecar generation, further thinning out the `migrator.ts` logic.

### 5. Third-Party API Integration
Integrate TMDB/TVDB fallbacks when both `.vsmeta` and path heuristics fail to identify a release year or correct title.
