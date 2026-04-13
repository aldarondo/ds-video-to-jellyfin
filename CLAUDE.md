# ds-video-to-jellyfin

## What This Project Is
CLI tool + library for migrating Synology DS Video (Video Station) collections to Jellyfin-compatible layouts while keeping DS Video functional. Scans for videos, parses .vsmeta metadata, auto-detects content type (movie vs TV), reorganizes files into Jellyfin folder structure, generates .nfo XML metadata, and extracts artwork. Supports dry-run and wet-run preview modes.

## Tech Stack
- Node.js / TypeScript
- tsup (bundler)
- vitest (testing — 100% coverage on core modules)
- ESLint
- Dependencies: vsmeta-parser, nfo-to-json, nfo-create, parse-torrent-path (sibling libraries)

## Key Decisions
- Dry-run mode is the default — no files moved without explicit `--wet-run` flag
- Depends on sibling npm packages in this GitHub hub (vsmeta-parser, nfo-create, etc.)
- Keeps DS Video functional alongside Jellyfin by symlinking rather than moving where possible
- Production-ready with full test coverage

## Session Startup Checklist
1. Read ROADMAP.md to find the current active task
2. Check MEMORY.md if it exists — it contains auto-saved learnings from prior sessions
3. Run `npm install` if node_modules are stale
4. Run `npm test` to verify all tests pass before making changes
5. Do not make architectural changes without confirming with Charles first

## Key Files
- `src/` — main library and CLI source
- `test/` — vitest test suite
- `dist/` — compiled output
- `README.md` — comprehensive usage documentation
- `PROJECT_EVALUATION.md` — design rationale and trade-offs

---
@~/Documents/GitHub/CLAUDE.md
