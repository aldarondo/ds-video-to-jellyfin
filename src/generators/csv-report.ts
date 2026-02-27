/**
 * Generates CSV migration reports for post-run validation.
 *
 * TV shows  → one row per show+season: Name, Year, Season, Episodes
 * Movies    → one row per movie:       Name, Year
 *
 * Both CSVs are sorted alphabetically by name, then by year, then (for shows)
 * by season number so the output is easy to scan and diff between runs.
 */

export interface ShowReportRow {
  /** Show title (without year suffix) */
  name: string;
  /** Premiere year, if known */
  year?: number;
  /** Season number (0 = specials / Season 00) */
  season: number;
  /** Number of episode files copied or placeholder-written in this season */
  episodes: number;
  /** Source folder the episode files came from */
  sourceDir: string;
  /** Output season folder the episode files were written to */
  outputDir: string;
}

export interface MovieReportRow {
  /** Movie title */
  name: string;
  /** Release year, if known */
  year?: number;
  /** Absolute path to the source video file */
  sourcePath: string;
  /** Absolute path to the output video file */
  outputPath: string;
}

/**
 * Build a CSV string for the TV-show migration report.
 * Header: Name,Year,Season,Episodes,Source Directory,Output Directory
 */
export function generateShowCsv(rows: ShowReportRow[]): string {
  const header = 'Name,Year,Season,Episodes,Source Directory,Output Directory';
  const sorted = [...rows].sort((a, b) => {
    const n = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (n !== 0) return n;
    if ((a.year ?? 0) !== (b.year ?? 0)) return (a.year ?? 0) - (b.year ?? 0);
    return a.season - b.season;
  });
  const lines = sorted.map(r =>
    `${csvField(r.name)},${r.year ?? ''},${r.season},${r.episodes},${csvField(r.sourceDir)},${csvField(r.outputDir)}`
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

/**
 * Build a CSV string for the movie migration report.
 * Header: Name,Year,Source Path,Output Path
 */
export function generateMovieCsv(rows: MovieReportRow[]): string {
  const header = 'Name,Year,Source Path,Output Path';
  const sorted = [...rows].sort((a, b) => {
    const n = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (n !== 0) return n;
    return (a.year ?? 0) - (b.year ?? 0);
  });
  const lines = sorted.map(r =>
    `${csvField(r.name)},${r.year ?? ''},${csvField(r.sourcePath)},${csvField(r.outputPath)}`
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

/**
 * Wrap a CSV field value in double-quotes if it contains a comma, double-quote,
 * or newline character.  Internal double-quotes are escaped by doubling them
 * (RFC 4180 §2.7).
 */
function csvField(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
