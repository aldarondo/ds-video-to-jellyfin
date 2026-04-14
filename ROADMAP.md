# ds-video-to-jellyfin — Roadmap

## Current Milestone
Migrate Movies library to Jellyfin using hardlinks (zero extra disk space)

### 🔨 In Progress
- **[Code]** Movies migration: scheduled for 8:00 PM tonight via Windows Task Scheduler (`ds-video-migrate-movies`)
  - Uses `--hardlink --overwrite` — no disk space cost, both DS Video and Jellyfin see files
  - Dry run passed cleanly: 1929 processed, 0 errors (2026-04-14)
  - Before 8 PM: run `rmdir /S /Q "V:\jellyfin\Movies"` to clear partial wet-run output

### 🟢 Ready (Next Up)
- **[Human]** After migration: verify `V:\jellyfin\Movies` looks correct
- **[Human]** Add `V:\jellyfin\Movies` to Jellyfin library
- **[Human]** Add output directory to DS Video — re-indexes, keeps both working in parallel
- **[Code]** TV Shows migration: dry run, then schedule (after Movies confirmed working)

### 📋 Backlog
- Handle edge case: multi-version files (e.g., Director's Cut + Theatrical)
- Add progress bar for large library scans
- Publish as npm package for broader community use
- Add support for music video detection
- Integration test against a real NAS mount point

### 🔴 Blocked
[Empty]

## ✅ Completed
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
