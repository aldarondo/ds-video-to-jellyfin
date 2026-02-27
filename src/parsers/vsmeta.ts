/**
 * Parser for Synology DS Video .vsmeta binary metadata files.
 *
 * The format is Protocol Buffer-style with tag-length-value (TLV) encoding:
 *   tag = (field_number << 3) | wire_type
 *   wire types: 0=varint, 1=64-bit, 2=length-delimited, 5=32-bit
 *
 * Confirmed field mapping (from real .vsmeta file analysis):
 *   Outer message:
 *     field  1 (varint)  – content type: 1=movie, 2=TV show
 *     field  2 (string)  – title (show title for TV)
 *     field  3 (string)  – original title
 *     field  4 (string)  – tagline
 *     field  5 (varint)  – year (0 for TV shows; year is in field 19)
 *     field  6 (string)  – release date "YYYY-MM-DD" (omitted for TV shows)
 *     field  8 (string)  – plot (omitted for TV shows; plot is in field 19)
 *     field  9 (string)  – JSON: "com.synology.TheMovieDb" with backdrop/poster URLs,
 *                          rating.themoviedb, reference.imdb, reference.themoviedb
 *     field 10 (bytes)   – cast/crew nested message:
 *                            field 1 (repeated string) = actor names
 *                            field 2 (repeated string) = director names
 *                            field 3 (repeated string) = genre names
 *                            field 4 (repeated string) = writer names
 *     field 11 (string)  – content rating string, e.g. "R", "PG-13" (empty for TV)
 *     field 12 (varint)  – audience rating x 10 (e.g. 51 = 5.1); MAX_UINT64 = unrated
 *     field 17 (string)  – poster image: base64-encoded JPEG (movies only)
 *     field 18 (string)  – MD5 hash of poster (movies only)
 *     field 19 (bytes)   – TV episode details (nested message, TV shows only):
 *                            field 1 (varint)  = season number
 *                            field 2 (varint)  = episode number
 *                            field 3 (varint)  = year
 *                            field 4 (string)  = air date "YYYY-MM-DD"
 *                            field 6 (string)  = episode plot
 *                            field 7 (string)  = episode thumbnail: base64-encoded JPEG
 *                            field 8 (string)  = MD5 hash of thumbnail
 *                            field 9 (string)  = JSON with TMDb backdrop/poster URLs
 *                            field 10 (bytes)  = episode backdrop: nested image message
 *                                                  (same structure as outer field 21;
 *                                                   inner field 1 = base64-encoded JPEG)
 *     field 21 (bytes)   – backdrop/fanart nested message (movies only):
 *                            field 1 (string)  = base64-encoded JPEG
 */

// Wire type constants
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

// Sentinel value meaning "no rating" (stored as MAX_UINT64)
const NO_RATING = BigInt('18446744073709551615');

export interface VsMetaData {
  /** 1 = movie, 2 = TV show */
  contentType: 1 | 2;
  /** Show/movie title */
  title: string;
  /** Original title (often the same as title) */
  originalTitle: string;
  /** Short tagline */
  tagline: string;
  /** Release year (outer field 5, or episode year for TV shows) */
  year: number;
  /** Release date "YYYY-MM-DD" (outer field 6, or episode air date for TV shows) */
  releaseDate: string;
  /** Plot / synopsis */
  plot: string;

  /** TMDb movie/show ID (from JSON field 9) */
  tmdbId: string;
  /** IMDb ID, e.g. "tt1234567" (from JSON field 9) */
  imdbId: string;

  /** Content rating string, e.g. "R", "PG-13" (field 11) */
  contentRating: string;
  /** Audience rating 0-10 (field 12 divided by 10, or from JSON) */
  rating: number;

  /** Actor names (from field 10 nested, sub-field 1) */
  actors: string[];
  /** Director names (from field 10 nested, sub-field 2) */
  directors: string[];
  /** Genre names (from field 10 nested, sub-field 3) */
  genres: string[];
  /** Writer names (from field 10 nested, sub-field 4) */
  writers: string[];

  /** Decoded poster JPEG (field 17 for movies; episode thumbnail for TV) */
  posterImage?: Buffer;
  /** Decoded backdrop/fanart JPEG (field 21 nested for movies; episode backdrop for TV) */
  backdropImage?: Buffer;

  // TV-show episode fields (all sourced from field 19)
  /** Season number */
  season?: number;
  /** Episode number */
  episode?: number;
  /** Episode air date "YYYY-MM-DD" */
  airDate?: string;
  /** Episode-specific plot (same as result.plot for TV) */
  episodePlot?: string;
}

// ---------------------------------------------------------------------------
// Low-level protobuf helpers
// ---------------------------------------------------------------------------

/** Read an unsigned varint from buf at pos; returns [value, newPos]. */
function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return [result, pos];
}

/** Read a tag and return [fieldNumber, wireType, newPos]. */
function readTag(buf: Buffer, pos: number): [number, number, number] {
  const [tag, newPos] = readVarint(buf, pos);
  const fieldNum = Number(tag >> 3n);
  const wireType = Number(tag & 7n);
  return [fieldNum, wireType, newPos];
}

/** Skip past a field of the given wireType at pos; return new pos. */
function skipField(buf: Buffer, pos: number, wireType: number): number {
  switch (wireType) {
    case WIRE_VARINT: {
      while (pos < buf.length && buf[pos++] & 0x80) { /* advance */ }
      return pos;
    }
    case WIRE_64BIT:
      return pos + 8;
    case WIRE_LENGTH: {
      const [len, newPos] = readVarint(buf, pos);
      return newPos + Number(len);
    }
    case WIRE_32BIT:
      return pos + 4;
    default:
      return buf.length; // unknown – bail
  }
}

/** Read a length-delimited field at pos; return [data, newPos]. */
function readLengthDelimited(buf: Buffer, pos: number): [Buffer, number] {
  const [len, newPos] = readVarint(buf, pos);
  const end = newPos + Number(len);
  return [buf.slice(newPos, Math.min(end, buf.length)), end];
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/**
 * Try to base64-decode `data` as a JPEG.
 * Returns the decoded JPEG Buffer, or undefined if data is not a valid base64 JPEG.
 * Handles multiline (MIME-style) base64 correctly via Node.js built-in decoding.
 */
function tryDecodeBase64Jpeg(data: Buffer): Buffer | undefined {
  try {
    const decoded = Buffer.from(data.toString('ascii'), 'base64');
    if (decoded.length >= 2 && decoded[0] === 0xff && decoded[1] === 0xd8) {
      return decoded;
    }
  } catch {
    // ignore decode errors
  }
  return undefined;
}

/**
 * Parse a "nested image" protobuf message (as used in outer field 21).
 * Inner field 1 = base64 JPEG string.  Returns the decoded JPEG or undefined.
 */
function parseNestedImageMessage(buf: Buffer): Buffer | undefined {
  let pos = 0;
  while (pos < buf.length) {
    const [fieldNum, wireType, newPos] = readTag(buf, pos);
    pos = newPos;
    if (wireType === WIRE_LENGTH) {
      const [data, nextPos] = readLengthDelimited(buf, pos);
      pos = nextPos;
      if (fieldNum === 1) {
        return tryDecodeBase64Jpeg(data);
      }
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Nested block parsers
// ---------------------------------------------------------------------------

interface CastBlock {
  actors: string[];
  directors: string[];
  genres: string[];
  writers: string[];
}

/** Parse field 10 – the cast/crew nested message. */
function parseCastBlock(buf: Buffer): CastBlock {
  const actors: string[] = [];
  const directors: string[] = [];
  const genres: string[] = [];
  const writers: string[] = [];

  let pos = 0;
  while (pos < buf.length) {
    const [fieldNum, wireType, newPos] = readTag(buf, pos);
    pos = newPos;
    if (wireType === WIRE_LENGTH) {
      const [data, nextPos] = readLengthDelimited(buf, pos);
      pos = nextPos;
      try {
        const name = data.toString('utf8');
        switch (fieldNum) {
          case 1: actors.push(name); break;
          case 2: directors.push(name); break;
          case 3: genres.push(name); break;
          case 4: writers.push(name); break;
        }
      } catch { /* ignore invalid UTF-8 */ }
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }

  return { actors, directors, genres, writers };
}

interface EpisodeDetails {
  season: number;
  episode: number;
  year: number;
  airDate: string;
  plot: string;
  thumbnail?: Buffer;
  backdrop?: Buffer;
}

/** Parse field 19 – the TV episode details nested message. */
function parseEpisodeDetails(buf: Buffer, skipImages = false): EpisodeDetails {
  const result: EpisodeDetails = {
    season: 0,
    episode: 0,
    year: 0,
    airDate: '',
    plot: '',
  };

  let pos = 0;
  while (pos < buf.length) {
    const [fieldNum, wireType, newPos] = readTag(buf, pos);
    pos = newPos;

    if (wireType === WIRE_VARINT) {
      const [val, nextPos] = readVarint(buf, pos);
      pos = nextPos;
      switch (fieldNum) {
        case 1: result.season  = Number(val); break;
        case 2: result.episode = Number(val); break;
        case 3: result.year    = Number(val); break;
      }
    } else if (wireType === WIRE_LENGTH) {
      const [data, nextPos] = readLengthDelimited(buf, pos);
      pos = nextPos;
      switch (fieldNum) {
        case 4:
          try { result.airDate = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 6:
          try { result.plot = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 7:
          // Episode thumbnail: directly a base64-encoded JPEG
          if (!skipImages) result.thumbnail = tryDecodeBase64Jpeg(data);
          break;
        case 10:
          // Episode backdrop: nested protobuf message (same structure as outer field 21)
          // Inner field 1 = base64-encoded JPEG
          if (!skipImages) result.backdrop = parseNestedImageMessage(data);
          break;
        // Fields 8 (MD5), 9 (JSON with episode TMDb data) – skip
      }
    } else if (wireType === WIRE_64BIT) {
      pos += 8;
    } else if (wireType === WIRE_32BIT) {
      pos += 4;
    } else {
      break; // unknown wire type
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a .vsmeta buffer and return structured metadata.
 * Throws if the buffer is too small to contain valid data.
 *
 * @param options.skipImages When true, image fields are not decoded (faster pre-scan).
 *   posterImage and backdropImage will be undefined in the returned object.
 */
export function parseVsMeta(buf: Buffer, options?: { skipImages?: boolean }): VsMetaData {
  const skipImages = options?.skipImages ?? false;
  if (buf.length < 2) {
    throw new Error('Buffer too small to be a valid .vsmeta file');
  }

  const result: VsMetaData = {
    contentType: 1,
    title: '',
    originalTitle: '',
    tagline: '',
    year: 0,
    releaseDate: '',
    plot: '',
    tmdbId: '',
    imdbId: '',
    contentRating: '',
    rating: 0,
    actors: [],
    directors: [],
    genres: [],
    writers: [],
  };

  let pos = 0;
  while (pos < buf.length) {
    const [fieldNum, wireType, newPos] = readTag(buf, pos);
    pos = newPos;

    if (wireType === WIRE_VARINT) {
      const [val, nextPos] = readVarint(buf, pos);
      pos = nextPos;
      switch (fieldNum) {
        case 1:
          // Content type: 1=movie, 2=TV show
          result.contentType = (Number(val) === 2 ? 2 : 1);
          break;
        case 5:
          result.year = Number(val);
          break;
        case 12:
          // Audience rating x10; MAX_UINT64 means "no rating"
          if (val !== NO_RATING) {
            result.rating = Number(val) / 10;
          }
          break;
      }
    } else if (wireType === WIRE_LENGTH) {
      const [data, nextPos] = readLengthDelimited(buf, pos);
      pos = nextPos;
      switch (fieldNum) {
        case 2:
          try { result.title = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 3:
          try { result.originalTitle = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 4:
          try { result.tagline = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 6:
          try { result.releaseDate = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 8:
          try { result.plot = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 9: {
          // JSON: "com.synology.TheMovieDb" with IMDB/TMDb IDs and rating
          try {
            const json = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
            const tmdb = (json['com.synology.TheMovieDb'] ?? {}) as Record<string, unknown>;
            const ref = tmdb['reference'] as Record<string, unknown> | undefined;
            const ratingObj = tmdb['rating'] as Record<string, unknown> | undefined;
            if (typeof ref?.['imdb'] === 'string')       result.imdbId  = ref['imdb'];
            if (ref?.['themoviedb'] != null)              result.tmdbId  = String(ref['themoviedb']);
            // Use JSON rating as fallback if field 12 was not set
            if (result.rating === 0 && typeof ratingObj?.['themoviedb'] === 'number') {
              result.rating = ratingObj['themoviedb'] as number;
            }
          } catch { /* ignore */ }
          break;
        }
        case 10: {
          const cast = parseCastBlock(data);
          result.actors    = cast.actors;
          result.directors = cast.directors;
          result.genres    = cast.genres;
          result.writers   = cast.writers;
          break;
        }
        case 11:
          // Content rating: "R", "PG-13", "TV-MA", etc.
          try { result.contentRating = data.toString('utf8'); } catch { /* ignore */ }
          break;
        case 17:
          // Movie poster: directly a base64-encoded JPEG
          if (!skipImages) result.posterImage = tryDecodeBase64Jpeg(data);
          break;
        case 18:
          // MD5 hash of poster image – skip
          break;
        case 19: {
          // TV episode details – large nested message
          const ep = parseEpisodeDetails(data, skipImages);
          result.season      = ep.season;
          result.episode     = ep.episode;
          result.airDate     = ep.airDate;
          result.episodePlot = ep.plot;
          if (ep.thumbnail) result.posterImage   = ep.thumbnail;
          if (ep.backdrop)  result.backdropImage = ep.backdrop;
          // Fill outer fields from episode data when not already set
          if (ep.year > 0 && result.year === 0)    result.year        = ep.year;
          if (ep.airDate && !result.releaseDate)   result.releaseDate = ep.airDate;
          if (ep.plot && !result.plot)             result.plot        = ep.plot;
          break;
        }
        case 21:
          // Movie backdrop/fanart: nested protobuf where inner field 1 = base64 JPEG
          if (!skipImages) result.backdropImage = parseNestedImageMessage(data);
          break;
        // All other field numbers are silently ignored
      }
    } else if (wireType === WIRE_64BIT) {
      pos += 8;
    } else if (wireType === WIRE_32BIT) {
      pos += 4;
    } else {
      break; // unknown wire type – bail out
    }
  }

  return result;
}
