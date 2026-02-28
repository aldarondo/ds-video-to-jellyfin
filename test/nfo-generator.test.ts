import { generateMovieNfo } from '../src/generators/movie-nfo';
import { generateShowNfo, mergeShowMeta, ShowNfoInput } from '../src/generators/show-nfo';
import { generateEpisodeNfo } from '../src/generators/episode-nfo';
import { VsMetaData } from '../src/parsers/vsmeta';

/** Build a complete VsMetaData with sensible defaults and optional overrides. */
function makeMeta(overrides: Partial<VsMetaData> = {}): VsMetaData {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateMovieNfo
// ---------------------------------------------------------------------------

describe('generateMovieNfo', () => {
  it('generates valid XML with all fields', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta({
        title: 'The Dark Knight',
        releaseDate: '2008-07-18',
        year: 2008,
        episodeTitle: 'Why so serious?',
        plot: 'When the menace known as the Joker wreaks havoc...',
        genres: ['Action', 'Crime'],
        directors: ['Christopher Nolan'],
        writers: ['Jonathan Nolan'],
        actors: ['Christian Bale', 'Heath Ledger'],
        rating: 9.0,
        contentRating: 'PG-13',
        imdbId: 'tt0468569',
        tmdbId: '155',
      }),
      parsed: { title: 'The Dark Knight', year: 2008 },
    });

    expect(nfo).toContain('<movie>');
    expect(nfo).toContain('</movie>');
    expect(nfo).toContain('<title>The Dark Knight</title>');
    expect(nfo).toContain('<tagline>Why so serious?</tagline>');
    expect(nfo).toContain('<year>2008</year>');
    expect(nfo).toContain('<genre>Action</genre>');
    expect(nfo).toContain('<genre>Crime</genre>');
    expect(nfo).toContain('<director>Christopher Nolan</director>');
    expect(nfo).toContain('<credits>Jonathan Nolan</credits>');
    expect(nfo).toContain('<name>Christian Bale</name>');
    expect(nfo).toContain('<name>Heath Ledger</name>');
    expect(nfo).toContain('<rating>9</rating>');
    expect(nfo).toContain('<mpaa>PG-13</mpaa>');
    expect(nfo).toContain('type="imdb"');
    expect(nfo).toContain('tt0468569');
    expect(nfo).toContain('type="tmdb"');
    expect(nfo).toContain('155');
    expect(nfo).toContain('<premiered>2008-07-18</premiered>');
  });

  it('uses parsed title fallback when meta title is empty', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta(),
      parsed: { title: 'Fallback Title', year: 2020 },
    });
    expect(nfo).toContain('<title>Fallback Title</title>');
    expect(nfo).toContain('<year>2020</year>');
  });

  it('prefers meta.year over parsed.year', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta({ title: 'Test', year: 2022 }),
      parsed: { title: 'Test', year: 1999 },
    });
    expect(nfo).toContain('<year>2022</year>');
    expect(nfo).not.toContain('<year>1999</year>');
  });

  it('extracts year from releaseDate when meta.year is 0', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta({ title: 'Test', releaseDate: '2019-05-01' }),
      parsed: { title: 'Test' },
    });
    expect(nfo).toContain('<year>2019</year>');
  });

  it('escapes XML special characters in title', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta({ title: 'Movie & "Stuff" <Cool>' }),
      parsed: { title: 'Movie & "Stuff" <Cool>' },
    });
    expect(nfo).toContain('Movie &amp; &quot;Stuff&quot; &lt;Cool&gt;');
    expect(nfo).not.toContain('<Cool>');
  });

  it('omits empty optional fields', () => {
    const nfo = generateMovieNfo({
      meta: makeMeta({ title: 'Simple Movie' }),
      parsed: { title: 'Simple Movie' },
    });
    expect(nfo).not.toContain('<plot></plot>');
    expect(nfo).not.toContain('<rating>0</rating>');
    expect(nfo).not.toContain('<mpaa></mpaa>');
    expect(nfo).not.toContain('<genre>');
    expect(nfo).not.toContain('<director>');
  });
});

// ---------------------------------------------------------------------------
// generateShowNfo
// ---------------------------------------------------------------------------

describe('generateShowNfo', () => {
  it('generates tvshow.nfo XML with all fields', () => {
    const nfo = generateShowNfo({
      showTitle: 'Breaking Bad',
      year: 2008,
      plot: 'A high school chemistry teacher...',
      genres: ['Drama', 'Crime'],
      actors: ['Bryan Cranston', 'Aaron Paul'],
      directors: ['Vince Gilligan'],
      contentRating: 'TV-MA',
      rating: 9.5,
      imdbId: 'tt0903747',
      tmdbId: '1396',
    });
    expect(nfo).toContain('<tvshow>');
    expect(nfo).toContain('</tvshow>');
    expect(nfo).toContain('<title>Breaking Bad</title>');
    expect(nfo).toContain('<year>2008</year>');
    expect(nfo).toContain('<genre>Drama</genre>');
    expect(nfo).toContain('<name>Bryan Cranston</name>');
    expect(nfo).toContain('<director>Vince Gilligan</director>');
    expect(nfo).toContain('<mpaa>TV-MA</mpaa>');
    expect(nfo).toContain('tt0903747');
    expect(nfo).toContain('1396');
  });

  it('omits missing optional fields', () => {
    const nfo = generateShowNfo({ showTitle: 'Minimal Show' });
    expect(nfo).toContain('<tvshow>');
    expect(nfo).not.toContain('<genre>');
    expect(nfo).not.toContain('<director>');
  });
});

// ---------------------------------------------------------------------------
// mergeShowMeta
// ---------------------------------------------------------------------------

describe('mergeShowMeta', () => {
  it('fills missing show metadata from episode vsmeta', () => {
    const acc: ShowNfoInput = { showTitle: 'My Show' };
    mergeShowMeta(acc, makeMeta({
      genres: ['Sci-Fi'],
      directors: ['Jane Doe'],
      actors: ['John Smith'],
      contentRating: 'TV-14',
      rating: 8.2,
      releaseDate: '2020-01-15',
      imdbId: 'tt1234567',
    }));
    expect(acc.genres).toEqual(['Sci-Fi']);
    expect(acc.directors).toEqual(['Jane Doe']);
    expect(acc.actors).toEqual(['John Smith']);
    expect(acc.contentRating).toBe('TV-14');
    expect(acc.rating).toBe(8.2);
    expect(acc.year).toBe(2020);
    expect(acc.imdbId).toBe('tt1234567');
  });

  it('fills year from meta.year when releaseDate is absent', () => {
    const acc: ShowNfoInput = { showTitle: 'My Show' };
    mergeShowMeta(acc, makeMeta({ year: 2021 }));
    expect(acc.year).toBe(2021);
  });

  it('fills plot from episode meta when acc.plot is empty', () => {
    const acc: ShowNfoInput = { showTitle: 'My Show' };
    mergeShowMeta(acc, makeMeta({ plot: 'A story about...' }));
    expect(acc.plot).toBe('A story about...');
  });

  it('fills rating from episode meta when acc.rating is unset', () => {
    const acc: ShowNfoInput = { showTitle: 'My Show' };
    mergeShowMeta(acc, makeMeta({ rating: 7.5 }));
    expect(acc.rating).toBe(7.5);
  });

  it('does not overwrite already-set fields', () => {
    const acc: ShowNfoInput = {
      showTitle: 'My Show',
      genres: ['Action'],
      rating: 9.0,
      imdbId: 'tt9999999',
    };
    mergeShowMeta(acc, makeMeta({
      genres: ['Drama'],
      rating: 5.0,
      imdbId: 'tt0000000',
    }));
    expect(acc.genres).toEqual(['Action']);  // not overwritten
    expect(acc.rating).toBe(9.0);           // not overwritten
    expect(acc.imdbId).toBe('tt9999999');   // not overwritten
  });
});

// ---------------------------------------------------------------------------
// generateEpisodeNfo
// ---------------------------------------------------------------------------

describe('generateEpisodeNfo', () => {
  it('generates episodedetails XML with all fields', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta({
        contentType: 2,
        season: 1,
        episode: 1,
        episodePlot: 'Walter White is diagnosed with cancer.',
        airDate: '2008-01-20',
        releaseDate: '2008-01-20',
        rating: 8.9,
        contentRating: 'TV-MA',
        directors: ['Vince Gilligan'],
        writers: ['Vince Gilligan'],
        imdbId: 'tt0959621',
      }),
      parsedEpisode: { season: 1, episode: 1, episodeTitle: 'Pilot' },
      parsedTitle: { title: 'Breaking Bad S01E01 Pilot' },
      showTitle: 'Breaking Bad',
    });

    expect(nfo).toContain('<episodedetails>');
    expect(nfo).toContain('</episodedetails>');
    expect(nfo).toContain('<title>Pilot</title>');
    expect(nfo).toContain('<showtitle>Breaking Bad</showtitle>');
    expect(nfo).toContain('<season>1</season>');
    expect(nfo).toContain('<episode>1</episode>');
    expect(nfo).toContain('<aired>2008-01-20</aired>');
    expect(nfo).toContain('<director>Vince Gilligan</director>');
    expect(nfo).toContain('<credits>Vince Gilligan</credits>');
    expect(nfo).toContain('tt0959621');
  });

  it('falls back to parsedEpisode when vsmeta has no season/episode', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta(),
      parsedEpisode: { season: 2, episode: 5, episodeTitle: 'Some Episode' },
      parsedTitle: { title: 'Some Show' },
      showTitle: 'Some Show',
    });
    expect(nfo).toContain('<season>2</season>');
    expect(nfo).toContain('<episode>5</episode>');
    expect(nfo).toContain('<title>Some Episode</title>');
  });

  it('defaults to season 1 episode 1 when nothing is known', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta(),
      parsedEpisode: null,
      parsedTitle: { title: 'Unknown' },
      showTitle: 'Unknown Show',
    });
    expect(nfo).toContain('<season>1</season>');
    expect(nfo).toContain('<episode>1</episode>');
  });

  it('uses episodePlot over show plot', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta({
        plot: 'Show-level plot',
        episodePlot: 'Episode-specific plot',
      }),
      parsedEpisode: null,
      parsedTitle: { title: 'Test' },
      showTitle: 'Test Show',
    });
    expect(nfo).toContain('Episode-specific plot');
    expect(nfo).not.toContain('Show-level plot');
  });

  it('uses show plot when episodePlot is absent', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta({ plot: 'Show-level plot' }),
      parsedEpisode: null,
      parsedTitle: { title: 'Test' },
      showTitle: 'Test Show',
    });
    expect(nfo).toContain('Show-level plot');
  });

  it('uses releaseDate as aired fallback when airDate is absent', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta({ releaseDate: '2021-03-10' }), // no airDate
      parsedEpisode: null,
      parsedTitle: { title: 'Test' },
      showTitle: 'Test Show',
    });
    expect(nfo).toContain('<aired>2021-03-10</aired>');
  });

  it('prefers airDate over releaseDate for aired field', () => {
    const nfo = generateEpisodeNfo({
      meta: makeMeta({ airDate: '2021-01-01', releaseDate: '2021-06-15' }),
      parsedEpisode: null,
      parsedTitle: { title: 'Test' },
      showTitle: 'Test Show',
    });
    expect(nfo).toContain('<aired>2021-01-01</aired>');
    expect(nfo).not.toContain('2021-06-15');
  });
});
