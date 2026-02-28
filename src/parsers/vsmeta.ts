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
 *     field  4 (string)  – episode title for TV shows; tagline for movies
 *     field  5 (varint)  – year (0 for TV shows; year is in field 19)
 *     field  6 (string)  – release date "YYYY-MM-DD" (omitted for TV shows)
 *     field  7 (varint)  – locked flag (1 = metadata is locked)
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
 *                            field 5 (varint)  = show locked flag (1 = locked)
 *                            field 6 (string)  = episode plot
 *                            field 7 (string)  = episode thumbnail: base64-encoded JPEG
 *                            field 8 (string)  = MD5 hash of thumbnail
 *                            field 9 (string)  = JSON with TMDb backdrop/poster URLs
 *                            field 10 (bytes)  = episode backdrop: nested image message
 *                                                  (same structure as outer field 21)
 *     field 21 (bytes)   – backdrop/fanart nested message (movies only):
 *                            field 1 (string)  = base64-encoded JPEG
 *                            field 2 (string)  = MD5 hash of backdrop
 *                            field 3 (varint)  = Unix timestamp (seconds)
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
  /** Show/movie title (field 2) */
  title: string;
  /** Original title, often the same as title (field 3) */
  originalTitle: string;
  /** Episode title for TV shows; tagline for movies (field 4) */
  episodeTitle: string;
  /** Release year (field 5; for TV shows use airDate/year from field 19) */
  year: number;
  /** Release date "YYYY-MM-DD" (field 6; for TV shows populated from episode air date) */
  releaseDate: string;
  /** Metadata is locked/frozen (field 7) */
  locked: boolean;
  /** Plot / synopsis (field 8; for TV shows populated from episode plot) */
  plot: string;

  /** TMDb movie/show ID (from JSON in field 9) */
  tmdbId: string;
  /** IMDb ID, e.g. "tt1234567" (from JSON in field 9) */
  imdbId: string;

  /** Content rating string, e.g. "R", "PG-13" (field 11) */
  contentRating: string;
  /** Audience rating 0-10 (field 12 ÷ 10, or from JSON fallback) */
  rating: number;

  /** Actor names (field 10, sub-field 1) */
  actors: string[];
  /** Director names (field 10, sub-field 2) */
  directors: string[];
  /** Genre names (field 10, sub-field 3) */
  genres: string[];
  /** Writer names (field 10, sub-field 4) */
  writers: string[];

  /** Decoded poster JPEG (field 17 for movies; episode thumbnail for TV shows) */
  posterImage?: Buffer;
  /** Decoded backdrop/fanart JPEG (field 21 for movies; episode backdrop for TV shows) */
  backdropImage?: Buffer;
  /** MD5 hex string of the backdrop image (field 21 sub-field 2) */
  backdropMd5?: string;
  /** Unix timestamp (seconds) embedded in the backdrop image message (field 21 sub-field 3) */
  backdropTimestamp?: number;

  // TV-show episode fields (sourced from field 19)
  /** Season number (field 19, sub-field 1) */
  season?: number;
  /** Episode number (field 19, sub-field 2) */
  episode?: number;
  /** Episode air date "YYYY-MM-DD" (field 19, sub-field 4) */
  airDate?: string;
  /** Episode-specific plot (field 19, sub-field 6) */
  episodePlot?: string;
  /** Show-level locked flag (field 19, sub-field 5; TV shows only) */
  showLocked?: boolean;
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

/** Parsed contents of a nested image message (outer field 21 / episode field 10). */
export interface BackdropData {
  /** Decoded JPEG image (sub-field 1, base64-encoded) */
  image?: Buffer;
  /** MD5 hex string of the image (sub-field 2) */
  md5?: string;
  /** Unix timestamp in seconds (sub-field 3) */
  timestamp?: number;
}

/**
 * Parse a "nested image" protobuf message (outer field 21 / episode field 10).
 *   field 1 (string) = base64-encoded JPEG
 *   field 2 (string) = MD5 hex hash
 *   field 3 (varint) = Unix timestamp (seconds)
 */
function parseNestedImageMessage(buf: Buffer): BackdropData {
  const result: BackdropData = {};
  let pos = 0;
  while (pos < buf.length) {
    const [fieldNum, wireType, newPos] = readTag(buf, pos);
    pos = newPos;
    if (wireType === WIRE_LENGTH) {
      const [data, nextPos] = readLengthDelimited(buf, pos);
      pos = nextPos;
      switch (fieldNum) {
        case 1: result.image = tryDecodeBase64Jpeg(data); break;
        case 2: try { result.md5 = data.toString('ascii'); } catch { /* ignore */ } break;
      }
    } else if (wireType === WIRE_VARINT) {
      const [val, nextPos] = readVarint(buf, pos);
      pos = nextPos;
      if (fieldNum === 3) result.timestamp = Number(val);
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return result;
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
  locked: boolean;
  thumbnail?: Buffer;
  backdrop?: BackdropData;
}

/** Parse field 19 – the TV episode details nested message. */
function parseEpisodeDetails(buf: Buffer, skipImages = false): EpisodeDetails {
  const result: EpisodeDetails = {
    season: 0,
    episode: 0,
    year: 0,
    airDate: '',
    plot: '',
    locked: false,
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
        case 5: result.locked  = val !== 0n;  break;
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
          // Episode backdrop: nested image message (same structure as outer field 21)
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
    episodeTitle: '',
    year: 0,
    releaseDate: '',
    locked: false,
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
          result.contentType = (Number(val) === 2 ? 2 : 1);
          break;
        case 5:
          result.year = Number(val);
          break;
        case 7:
          result.locked = val !== 0n;
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
          try { result.episodeTitle = data.toString('utf8'); } catch { /* ignore */ }
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
          // TV episode details – nested message
          const ep = parseEpisodeDetails(data, skipImages);
          result.season      = ep.season;
          result.episode     = ep.episode;
          result.airDate     = ep.airDate;
          result.episodePlot = ep.plot;
          result.showLocked  = ep.locked;
          if (ep.thumbnail)        result.posterImage      = ep.thumbnail;
          if (ep.backdrop?.image)  result.backdropImage    = ep.backdrop.image;
          if (ep.backdrop?.md5)    result.backdropMd5      = ep.backdrop.md5;
          if (ep.backdrop?.timestamp !== undefined) result.backdropTimestamp = ep.backdrop.timestamp;
          // Fill outer fields from episode data when not already set
          if (ep.year > 0 && result.year === 0)  result.year        = ep.year;
          if (ep.airDate && !result.releaseDate) result.releaseDate = ep.airDate;
          if (ep.plot && !result.plot)           result.plot        = ep.plot;
          break;
        }
        case 21: {
          // Movie backdrop/fanart: nested image message
          if (!skipImages) {
            const bd = parseNestedImageMessage(data);
            result.backdropImage     = bd.image;
            result.backdropMd5       = bd.md5;
            result.backdropTimestamp = bd.timestamp;
          }
          break;
        }
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
