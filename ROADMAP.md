# ds-video-to-jellyfin — Roadmap

## Current Milestone
Movies migration complete — verify output and add to Jellyfin

### 🔨 In Progress
- **[Code]** TV Shows dry run (2026-04-18)

### 🟢 Ready (Next Up)
- **[Code]** TV Shows wet migration — schedule after dry run passes cleanly
- **[Human]** Add `V:\jellyfin\TV Shows` to Jellyfin library (after migration)
- **[Human]** Add output directories to DS Video — re-indexes, keeps both working in parallel

### 📋 Backlog
- Handle edge case: multi-version files (e.g., Director's Cut + Theatrical)
- Add progress bar for large library scans
- Publish as npm package for broader community use
- Add support for music video detection
- Integration test against a real NAS mount point

### 🔴 Blocked
[Empty]

## ✅ Completed
- Movies migration complete — 1929 files, 0 errors, added to Jellyfin ✓ (2026-04-18)
- Fixed folder context contamination bug — movie files with own vsmeta no longer inherit show identity from siblings in the same folder (2026-04-18)
- Fixed `detectMediaType` — "movies" keyword in ancestor path now overrides vsmeta contentType, so DS Video mislabelled files in a Movies folder route correctly (2026-04-18)
- Fixed `--overwrite` flag — now properly wired through to hardlink/copy/move operations, not just NFO/image generation (2026-04-18)
- Added `MST3K DVD 33` → 1988 to show-years.json to prevent interactive prompt blocking background runs (2026-04-18)
- Added `--hardlink` flag to CLI — zero-space migration using NTFS hardlinks (2026-04-14)
- Fixed misleading EEXIST error message that showed source path as destination (2026-04-14)
- Dry run #3 — Movies with hardlink mode: 1929 processed, 0 errors ✓ (2026-04-14)
- Dry run #1 — Movies: 1929 processed, 0 errors ✓ (2026-04-13)
- Dry run #2 — Movies: 1929 processed, 0 errors ✓ (2026-04-13)
- Dry run #1 — TV Shows: 21757 processed, 0 errors ✓ (2026-04-13)
- Dry run #2 — TV Shows: 21757 processed, 0 errors ✓ (2026-04-13)
- Added `--years-file` flag to CLI — injects TV show years from JSON, no interactive prompts
- Created `show-years.json` — 31 MST3K-featured film years + 3 Humans S02 release-group titles
- Full CLI implementation with dry-run and wet-run modes
- .vsmeta parsing via vsmeta-parser
- Movie vs TV auto-detection via parse-torrent-path
- Jellyfin folder structure generation
- .nfo XML generation via nfo-create
- JPEG artwork extraction via vsmeta-to-jpeg
- 100% test coverage on core modules
- Comprehensive README and PROJECT_EVALUATION.md
