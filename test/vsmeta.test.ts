/**
 * Tests for the .vsmeta binary parser.
 *
 * Unit tests build synthetic buffers using the real protobuf field layout.
 * Integration tests run against the actual .vsmeta example files (skipped if absent).
 *
 * Confirmed field numbers (from real file analysis):
 *   field  1 varint  – contentType (1=movie, 2=TV show)
 *   field  2 string  – title
 *   field  3 string  – originalTitle
 *   field  4 string  – episodeTitle
 *   field  5 varint  – year
 *   field  6 string  – releaseDate "YYYY-MM-DD"
 *   field  8 string  – plot
 *   field  9 string  – JSON with TMDb data
 *   field 10 bytes   – cast/crew nested message
 *   field 11 string  – contentRating ("R", "PG-13", …)
 *   field 12 varint  – rating × 10 (MAX_UINT64 = unrated)
 *   field 17 string  – poster image (base64 JPEG, movies)
 *   field 19 bytes   – episode details nested message (TV shows)
 *   field 21 bytes   – backdrop nested message (movies)
 */

import path from 'path';
import fs from 'fs';
import { parseVsMeta, VsMetaData } from '../src/parsers/vsmeta';

// ---------------------------------------------------------------------------
// Binary building helpers (mirror of the actual protobuf encoding)
// ---------------------------------------------------------------------------

function encodeVarint(value: bigint | number): number[] {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  const bytes: number[] = [];
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v));
  return bytes;
}

function tag(fieldNum: number, wireType: number): number[] {
  return encodeVarint((fieldNum << 3) | wireType);
}

function varintField(fieldNum: number, value: bigint | number): number[] {
  return [...tag(fieldNum, 0), ...encodeVarint(value)];
}

function stringField(fieldNum: number, str: string): number[] {
  const data = Buffer.from(str, 'utf8');
  return [...tag(fieldNum, 2), ...encodeVarint(data.length), ...data];
}

function bytesField(fieldNum: number, data: Buffer): number[] {
  return [...tag(fieldNum, 2), ...encodeVarint(data.length), ...data];
}

/** Create a base64-encoded JPEG string field (as stored in .vsmeta field 17 / ep field 7). */
function base64JpegField(fieldNum: number): number[] {
  // Minimal JPEG: SOI (FF D8) + EOI (FF D9)
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const b64 = jpegBytes.toString('base64');
  return stringField(fieldNum, b64);
}

/** Build a field-19 TV episode nested message. */
function buildEpisodeDetails(opts: {
  season: number;
  episode: number;
  year: number;
  airDate: string;
  plot: string;
  withImage?: boolean;
}): Buffer {
  const fields: number[] = [
    ...varintField(1, opts.season),
    ...varintField(2, opts.episode),
    ...varintField(3, opts.year),
    ...stringField(4, opts.airDate),
    ...stringField(6, opts.plot),
  ];
  if (opts.withImage) {
    fields.push(...base64JpegField(7));
  }
  return Buffer.from(fields);
}

/** Build a field-10 cast/crew nested message. */
function buildCastBlock(actors: string[], directors: string[], genres: string[], writers: string[]): Buffer {
  const fields: number[] = [];
  for (const a of actors)    fields.push(...stringField(1, a));
  for (const d of directors) fields.push(...stringField(2, d));
  for (const g of genres)    fields.push(...stringField(3, g));
  for (const w of writers)   fields.push(...stringField(4, w));
  return Buffer.from(fields);
}

/** Assemble a complete fake .vsmeta buffer from an array of pre-encoded field bytes. */
function buildVsMeta(fields: number[]): Buffer {
  return Buffer.from(fields);
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('parseVsMeta', () => {
  it('throws when buffer is too small', () => {
    expect(() => parseVsMeta(Buffer.from([0x08]))).toThrow('too small');
  });

  it('parses contentType=1 (movie)', () => {
    const buf = buildVsMeta(varintField(1, 1));
    const result = parseVsMeta(buf);
    expect(result.contentType).toBe(1);
  });

  it('parses contentType=2 (TV show)', () => {
    const buf = buildVsMeta(varintField(1, 2));
    const result = parseVsMeta(buf);
    expect(result.contentType).toBe(2);
  });

  it('defaults contentType to 1 when field 1 is absent', () => {
    const buf = buildVsMeta(stringField(2, 'My Movie'));
    const result = parseVsMeta(buf);
    expect(result.contentType).toBe(1);
  });

  it('parses title (field 2)', () => {
    const buf = buildVsMeta(stringField(2, 'The Dark Knight'));
    expect(parseVsMeta(buf).title).toBe('The Dark Knight');
  });

  it('parses originalTitle (field 3)', () => {
    const buf = buildVsMeta(stringField(3, 'Le Chevalier Noir'));
    expect(parseVsMeta(buf).originalTitle).toBe('Le Chevalier Noir');
  });

  it('parses episodeTitle (field 4)', () => {
    const buf = buildVsMeta(stringField(4, 'Why so serious?'));
    expect(parseVsMeta(buf).episodeTitle).toBe('Why so serious?');
  });

  it('parses year varint (field 5)', () => {
    const buf = buildVsMeta(varintField(5, 2008));
    expect(parseVsMeta(buf).year).toBe(2008);
  });

  it('parses releaseDate (field 6)', () => {
    const buf = buildVsMeta(stringField(6, '2008-07-18'));
    expect(parseVsMeta(buf).releaseDate).toBe('2008-07-18');
  });

  it('parses plot (field 8)', () => {
    const buf = buildVsMeta(stringField(8, 'When the menace known as the Joker...'));
    expect(parseVsMeta(buf).plot).toBe('When the menace known as the Joker...');
  });

  it('parses contentRating string (field 11)', () => {
    const buf = buildVsMeta(stringField(11, 'PG-13'));
    expect(parseVsMeta(buf).contentRating).toBe('PG-13');
  });

  it('parses rating from field 12 varint (value / 10)', () => {
    const buf = buildVsMeta(varintField(12, 90)); // 9.0
    expect(parseVsMeta(buf).rating).toBeCloseTo(9.0);
  });

  it('ignores MAX_UINT64 rating sentinel (means "unrated")', () => {
    const buf = buildVsMeta(varintField(12, 18446744073709551615n));
    expect(parseVsMeta(buf).rating).toBe(0);
  });

  it('parses TMDb JSON (field 9) for IMDB/TMDb IDs', () => {
    const json = JSON.stringify({
      'com.synology.TheMovieDb': {
        reference: { imdb: 'tt0468569', themoviedb: 155 },
        rating: { themoviedb: 9.2 },
      },
    });
    const buf = buildVsMeta(stringField(9, json));
    const result = parseVsMeta(buf);
    expect(result.imdbId).toBe('tt0468569');
    expect(result.tmdbId).toBe('155');
    expect(result.rating).toBeCloseTo(9.2);
  });

  it('prefers field 12 rating over JSON rating when field 12 is set first', () => {
    // field 12 comes before field 9 in message order → field 12 wins
    const json = JSON.stringify({
      'com.synology.TheMovieDb': { rating: { themoviedb: 9.2 } },
    });
    const buf = buildVsMeta([
      ...varintField(12, 81), // 8.1
      ...stringField(9, json),
    ]);
    // field 12 sets rating to 8.1; field 9 only fills if rating === 0
    expect(parseVsMeta(buf).rating).toBeCloseTo(8.1);
  });

  it('parses cast/crew nested message (field 10)', () => {
    const castBuf = buildCastBlock(
      ['Bryan Cranston', 'Aaron Paul'],
      ['Vince Gilligan'],
      ['Drama', 'Thriller'],
      ['Sam Catlin']
    );
    const buf = buildVsMeta(bytesField(10, castBuf));
    const result = parseVsMeta(buf);
    expect(result.actors).toContain('Bryan Cranston');
    expect(result.actors).toContain('Aaron Paul');
    expect(result.directors).toContain('Vince Gilligan');
    expect(result.genres).toContain('Drama');
    expect(result.writers).toContain('Sam Catlin');
  });

  it('decodes base64 JPEG poster from field 17', () => {
    const buf = buildVsMeta(base64JpegField(17));
    const result = parseVsMeta(buf);
    expect(result.posterImage).toBeDefined();
    expect(result.posterImage![0]).toBe(0xff);
    expect(result.posterImage![1]).toBe(0xd8);
  });

  it('returns undefined posterImage when field 17 data is not valid base64 JPEG', () => {
    const notBase64Jpeg = stringField(17, 'not-jpeg-data');
    const buf = buildVsMeta(notBase64Jpeg);
    expect(parseVsMeta(buf).posterImage).toBeUndefined();
  });

  it('parses TV show episode details from field 19', () => {
    const epBuf = buildEpisodeDetails({
      season: 5,
      episode: 14,
      year: 2013,
      airDate: '2013-09-15',
      plot: 'Walter faces the consequences.',
    });
    // Movie type byte first, then episode details
    const outerBuf = buildVsMeta([
      ...varintField(1, 2),         // contentType=2 (TV)
      ...stringField(2, 'Breaking Bad'),
      ...bytesField(19, epBuf),
    ]);
    const result = parseVsMeta(outerBuf);
    expect(result.contentType).toBe(2);
    expect(result.title).toBe('Breaking Bad');
    expect(result.season).toBe(5);
    expect(result.episode).toBe(14);
    expect(result.airDate).toBe('2013-09-15');
    expect(result.episodePlot).toBe('Walter faces the consequences.');
    // Should propagate to outer fields
    expect(result.year).toBe(2013);
    expect(result.releaseDate).toBe('2013-09-15');
    expect(result.plot).toBe('Walter faces the consequences.');
  });

  it('decodes episode thumbnail from field 19 -> field 7', () => {
    const epBuf = buildEpisodeDetails({
      season: 1, episode: 1, year: 2020, airDate: '2020-01-01', plot: 'Test',
      withImage: true,
    });
    const buf = buildVsMeta([
      ...varintField(1, 2),
      ...bytesField(19, epBuf),
    ]);
    const result = parseVsMeta(buf);
    expect(result.posterImage).toBeDefined();
    expect(result.posterImage![0]).toBe(0xff);
    expect(result.posterImage![1]).toBe(0xd8);
  });

  it('decodes backdrop from field 21 nested message', () => {
    // field 21 inner message: field 1 = base64 JPEG
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const b64 = jpegBytes.toString('base64');
    const innerMsg = Buffer.from(stringField(1, b64)); // inner field 1
    const buf = buildVsMeta(bytesField(21, innerMsg));
    const result = parseVsMeta(buf);
    expect(result.backdropImage).toBeDefined();
    expect(result.backdropImage![0]).toBe(0xff);
    expect(result.backdropImage![1]).toBe(0xd8);
  });

  it('parses multiple outer fields together (movie)', () => {
    const buf = buildVsMeta([
      ...varintField(1, 1),
      ...stringField(2, 'Inception'),
      ...stringField(3, 'Inception'),
      ...stringField(4, 'Your mind is the scene of the crime.'),
      ...varintField(5, 2010),
      ...stringField(6, '2010-07-16'),
      ...stringField(8, 'A thief who steals corporate secrets...'),
      ...stringField(11, 'PG-13'),
      ...varintField(12, 87),  // rating 8.7
    ]);
    const result = parseVsMeta(buf);
    expect(result.contentType).toBe(1);
    expect(result.title).toBe('Inception');
    expect(result.episodeTitle).toBe('Your mind is the scene of the crime.');
    expect(result.year).toBe(2010);
    expect(result.releaseDate).toBe('2010-07-16');
    expect(result.plot).toBe('A thief who steals corporate secrets...');
    expect(result.contentRating).toBe('PG-13');
    expect(result.rating).toBeCloseTo(8.7);
  });

  it('does not crash on unknown wire types or extra fields', () => {
    // Insert a 64-bit field (wire type 1) that the parser should skip
    const unknown64bitField = [
      (99 << 3) | 1, // field 99, wire type 1
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // 8 bytes
    ];
    const buf = buildVsMeta([
      ...stringField(2, 'Safe Movie'),
      ...unknown64bitField,
      ...stringField(6, '2023-01-01'),
    ]);
    const result = parseVsMeta(buf);
    expect(result.title).toBe('Safe Movie');
    expect(result.releaseDate).toBe('2023-01-01');
  });

  it('skips all image fields when skipImages:true', () => {
    const buf = buildVsMeta([
      ...varintField(1, 1),
      ...stringField(2, 'No Images Movie'),
      ...base64JpegField(17), // poster
    ]);
    const result = parseVsMeta(buf, { skipImages: true });
    expect(result.title).toBe('No Images Movie');
    expect(result.posterImage).toBeUndefined();
    expect(result.backdropImage).toBeUndefined();
  });

  it('skipImages:true still parses all non-image fields correctly', () => {
    const epBuf = buildEpisodeDetails({
      season: 2, episode: 3, year: 2021,
      airDate: '2021-04-01', plot: 'Plot text',
      withImage: true,
    });
    const buf = buildVsMeta([
      ...varintField(1, 2),
      ...stringField(2, 'My Show'),
      ...bytesField(19, epBuf),
    ]);
    const result = parseVsMeta(buf, { skipImages: true });
    expect(result.contentType).toBe(2);
    expect(result.title).toBe('My Show');
    expect(result.season).toBe(2);
    expect(result.episode).toBe(3);
    expect(result.airDate).toBe('2021-04-01');
    expect(result.posterImage).toBeUndefined(); // skipped
  });

  it('skipImages:false (explicit) still decodes images', () => {
    const buf = buildVsMeta(base64JpegField(17));
    const result = parseVsMeta(buf, { skipImages: false });
    expect(result.posterImage).toBeDefined();
    expect(result.posterImage![0]).toBe(0xff);
  });

  it('decodes episode backdrop from field 19 -> field 10 (nested image)', () => {
    // field 10 inside episode details is a nested image message (same as outer field 21)
    // inner field 1 = base64 JPEG
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const b64 = jpegBytes.toString('base64');
    const innerImageMsg = Buffer.from(stringField(1, b64));
    // Build episode details with field 10 (backdrop) instead of field 7 (thumbnail)
    const epFields: number[] = [
      ...varintField(1, 1), // season
      ...varintField(2, 1), // episode
      ...varintField(3, 2020),
      ...stringField(4, '2020-01-01'),
      ...stringField(6, 'plot'),
      ...bytesField(10, innerImageMsg), // backdrop
    ];
    const epBuf = Buffer.from(epFields);
    const buf = buildVsMeta([...varintField(1, 2), ...bytesField(19, epBuf)]);
    const result = parseVsMeta(buf);
    expect(result.backdropImage).toBeDefined();
    expect(result.backdropImage![0]).toBe(0xff);
    expect(result.backdropImage![1]).toBe(0xd8);
  });

  it('skips 32-bit wire type fields without crashing', () => {
    const fixed32Field = [
      (99 << 3) | 5, // field 99, wire type 5 (32-bit)
      0x01, 0x02, 0x03, 0x04, // 4 bytes
    ];
    const buf = buildVsMeta([
      ...stringField(2, 'Fixed32 Movie'),
      ...fixed32Field,
      ...varintField(5, 2020),
    ]);
    const result = parseVsMeta(buf);
    expect(result.title).toBe('Fixed32 Movie');
    expect(result.year).toBe(2020);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — run against the real example files
// ---------------------------------------------------------------------------

const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');

function exampleFile(name: string): string {
  return path.join(EXAMPLES_DIR, name);
}

function exampleExists(name: string): boolean {
  return fs.existsSync(exampleFile(name));
}

describe('parseVsMeta (integration — real .vsmeta files)', () => {
  const escapeFile = 'Escape.Plan.2.Hades.2018.1080p.BluRay.x264-[YTS.AM].mp4.vsmeta';
  const fantasticFile = 'Fantastic.Beasts.and.Where.to.Find.Them.2016 (high).mp4.vsmeta';
  const alienFile = 'Alien.Earth.2024.S01E03.Metamorphosis.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv.vsmeta';

  describe('Escape Plan 2 (movie)', () => {
    let result: VsMetaData;
    beforeAll(() => {
      if (!exampleExists(escapeFile)) return;
      result = parseVsMeta(fs.readFileSync(exampleFile(escapeFile)));
    });

    const skip = () => !exampleExists(escapeFile);

    it('content type is movie', () => {
      if (skip()) return;
      expect(result.contentType).toBe(1);
    });

    it('title is correct', () => {
      if (skip()) return;
      expect(result.title).toBe('Escape Plan 2: Hades');
    });

    it('year is 2018', () => {
      if (skip()) return;
      expect(result.year).toBe(2018);
    });

    it('release date is correct', () => {
      if (skip()) return;
      expect(result.releaseDate).toBe('2018-06-05');
    });

    it('episodeTitle is "He\'s back."', () => {
      if (skip()) return;
      expect(result.episodeTitle).toBe("He's back.");
    });

    it('plot contains "Ray Breslin"', () => {
      if (skip()) return;
      expect(result.plot).toContain('Ray Breslin');
    });

    it('content rating is "R"', () => {
      if (skip()) return;
      expect(result.contentRating).toBe('R');
    });

    it('rating is approximately 5.1', () => {
      if (skip()) return;
      expect(result.rating).toBeCloseTo(5.1, 1);
    });

    it('actors includes Sylvester Stallone', () => {
      if (skip()) return;
      expect(result.actors).toContain('Sylvester Stallone');
    });

    it('directors includes Steven C. Miller', () => {
      if (skip()) return;
      expect(result.directors).toContain('Steven C. Miller');
    });

    it('genres includes Action', () => {
      if (skip()) return;
      expect(result.genres).toContain('Action');
    });

    it('imdbId is correct', () => {
      if (skip()) return;
      expect(result.imdbId).toBe('tt6513656');
    });

    it('poster image is a JPEG buffer', () => {
      if (skip()) return;
      expect(result.posterImage).toBeDefined();
      expect(result.posterImage![0]).toBe(0xff);
      expect(result.posterImage![1]).toBe(0xd8);
      expect(result.posterImage!.length).toBeGreaterThan(1000);
    });

    it('backdrop image is a JPEG buffer', () => {
      if (skip()) return;
      expect(result.backdropImage).toBeDefined();
      expect(result.backdropImage![0]).toBe(0xff);
      expect(result.backdropImage![1]).toBe(0xd8);
    });

    it('has no season or episode', () => {
      if (skip()) return;
      expect(result.season).toBeUndefined();
      expect(result.episode).toBeUndefined();
    });
  });

  describe('Fantastic Beasts (movie)', () => {
    let result: VsMetaData;
    beforeAll(() => {
      if (!exampleExists(fantasticFile)) return;
      result = parseVsMeta(fs.readFileSync(exampleFile(fantasticFile)));
    });

    const skip = () => !exampleExists(fantasticFile);

    it('content type is movie', () => {
      if (skip()) return;
      expect(result.contentType).toBe(1);
    });

    it('title is correct', () => {
      if (skip()) return;
      expect(result.title).toBe('Fantastic Beasts and Where to Find Them');
    });

    it('year is 2016', () => {
      if (skip()) return;
      expect(result.year).toBe(2016);
    });

    it('content rating is "PG-13"', () => {
      if (skip()) return;
      expect(result.contentRating).toBe('PG-13');
    });

    it('rating is approximately 7.3', () => {
      if (skip()) return;
      expect(result.rating).toBeCloseTo(7.3, 1);
    });

    it('poster image is a JPEG buffer', () => {
      if (skip()) return;
      expect(result.posterImage).toBeDefined();
      expect(result.posterImage![0]).toBe(0xff);
    });
  });

  describe('Alien: Earth S01E03 (TV show)', () => {
    let result: VsMetaData;
    beforeAll(() => {
      if (!exampleExists(alienFile)) return;
      result = parseVsMeta(fs.readFileSync(exampleFile(alienFile)));
    });

    const skip = () => !exampleExists(alienFile);

    it('content type is TV show', () => {
      if (skip()) return;
      expect(result.contentType).toBe(2);
    });

    it('title is "Alien: Earth"', () => {
      if (skip()) return;
      expect(result.title).toBe('Alien: Earth');
    });

    it('season is 1', () => {
      if (skip()) return;
      expect(result.season).toBe(1);
    });

    it('episode is 3', () => {
      if (skip()) return;
      expect(result.episode).toBe(3);
    });

    it('air date is 2025-08-12', () => {
      if (skip()) return;
      expect(result.airDate).toBe('2025-08-12');
    });

    it('episode plot is non-empty', () => {
      if (skip()) return;
      expect(result.episodePlot).toBeTruthy();
      expect((result.episodePlot ?? '').length).toBeGreaterThan(10);
    });

    it('episode thumbnail (posterImage) is a JPEG buffer', () => {
      if (skip()) return;
      expect(result.posterImage).toBeDefined();
      expect(result.posterImage![0]).toBe(0xff);
      expect(result.posterImage![1]).toBe(0xd8);
    });

    it('episode backdrop (backdropImage) is a JPEG buffer', () => {
      if (skip()) return;
      expect(result.backdropImage).toBeDefined();
      expect(result.backdropImage![0]).toBe(0xff);
      expect(result.backdropImage![1]).toBe(0xd8);
    });
  });
});
