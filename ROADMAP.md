# ds-video-to-jellyfin — Roadmap

## Current Milestone
Run dry runs against V:\Movies and V:\TV Shows; once each passes cleanly 2x, schedule wet runs for evening execution

### 🔨 In Progress
- **[Code]** Wet run — Movies: scheduled for 8:00 PM tonight (Windows Task Scheduler)
- **[Code]** Wet run — TV Shows: scheduled for 9:00 PM tonight (Windows Task Scheduler, staggered)

### 🟢 Ready (Next Up)
- **[Human]** After wet runs complete: verify `V:\jellyfin\Movies` and `V:\jellyfin\TV Shows` look correct
- **[Human]** Add `V:\jellyfin\Movies` and `V:\jellyfin\TV Shows` to Jellyfin library
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
