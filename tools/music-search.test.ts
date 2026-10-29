import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSpotifyAlbumTracks,
  isSearchableAlbum,
  removeDuplicateAlbums,
  scoreAlbum,
  scoreArtist,
  searchSpotifyAlbums,
  searchSpotifyArtists,
  type ITunesAlbum,
} from "../src/lib/spotifyApi.ts";

const album = (changes: Partial<ITunesAlbum> = {}): ITunesAlbum => ({
  wrapperType: "collection",
  collectionType: "Album",
  collectionId: 1,
  collectionName: "ICEMAN",
  artistId: 10,
  artistName: "Drake",
  trackCount: 12,
  releaseDate: "2026-01-01T00:00:00Z",
  ...changes,
});

test("artist comparisons fold accents without dropping letters", () => {
  for (const [query, artistName] of [["Giveon", "GIVĒON"], ["Beyonce", "Beyoncé"], ["Rosalia", "Rosalía"], ["Sigur Ros", "Sigur Rós"]]) {
    const artist = {artistId: 123, artistName};
    assert.equal(scoreArtist(artist, query), scoreArtist(artist, artistName));
    assert.equal(scoreAlbum(album({artistName}), query), scoreAlbum(album({artistName}), artistName));
  }
});

test("catalog-specific accented query retries are bounded and share the folded cache", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const term = new URL(String(input)).searchParams.get("term");
    const results = term === "GIVĒON"
      ? [{artistId: 981, artistName: "GIVĒON", wrapperType: "artist"}]
      : [];
    return new Response(JSON.stringify({results}), {status: 200});
  };
  try {
    const artists = await searchSpotifyArtists("GIVĒON");
    assert.equal(artists[0]?.name, "GIVĒON");
    assert.equal(calls, 10, "five storefronts, at most one alternate pass");
    assert.deepEqual(await searchSpotifyArtists("Giveon"), artists);
    assert.equal(calls, 10);
  } finally { globalThis.fetch = originalFetch; }
});

test("exact album title outranks an artist-name-only catalog match", () => {
  const exactTitle = scoreAlbum(album(), "ICEMAN");
  const artistOnly = scoreAlbum(
    album({ collectionId: 2, collectionName: "Cold World", artistName: "Iceman" }),
    "ICEMAN",
    "Iceman"
  ) + 40;
  assert.ok(exactTitle > artistOnly);
});

test("exact artist names lead Artist mode", () => {
  const exact = scoreArtist(
    { wrapperType: "artist", artistType: "Artist", artistId: 1, artistName: "Wizkid" },
    "wizkid"
  );
  const partial = scoreArtist(
    { wrapperType: "artist", artistType: "Artist", artistId: 2, artistName: "Wizkid Tribute" },
    "wizkid"
  );
  assert.ok(exact > partial);
});

test("combined artist and album queries favor the matching release", () => {
  const matching = scoreAlbum(album(), "Drake ICEMAN", "Drake");
  const artistCatalogNoise = scoreAlbum(
    album({ collectionId: 3, collectionName: "Ancient Melodies", artistName: "Iceman" }),
    "Drake ICEMAN",
    "Iceman"
  ) + 40;
  assert.ok(matching > artistCatalogNoise);
});

test("standalone singles are excluded while short EPs are preserved", () => {
  assert.equal(
    isSearchableAlbum(album({ collectionName: "New Song - Single", trackCount: 2 })),
    false
  );
  assert.equal(
    isSearchableAlbum(album({ collectionName: "Unlabelled Release", trackCount: 1 })),
    true
  );
  assert.equal(
    isSearchableAlbum(album({ collectionName: "Late Night - EP", trackCount: 2 })),
    true
  );
});

test("identical cross-country releases are deduplicated", () => {
  const releases = removeDuplicateAlbums([
    { id: "itunes:US:1", title: "Made in Lagos", artist: "Wizkid", year: "2020", imageUrl: "us" },
    { id: "itunes:NG:2", title: "Made in Lagos", artist: "Wizkid", year: "2020", imageUrl: "ng" },
    { id: "itunes:US:3", title: "Made in Lagos Deluxe", artist: "Wizkid", year: "2021", imageUrl: "deluxe" },
  ]);
  assert.deepEqual(releases.map((release) => release.id), ["itunes:US:1", "itunes:US:3"]);
});

test("search cancellation, empty results, caching, artist discovery, and unavailable previews", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async (input) => {
    fetchCount += 1;
    const url = new URL(String(input), "https://example.test");
    const entity = url.searchParams.get("entity");
    const term = url.searchParams.get("term") || "";

    await new Promise((resolve) => setTimeout(resolve, 5));

    if (url.pathname.endsWith("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [album()] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (entity === "musicArtist") {
      const results = term.includes("cache artist")
        ? [{
            wrapperType: "artist",
            artistType: "Artist",
            artistId: 55,
            artistName: "Cache Artist",
            primaryGenreName: "Afrobeats",
          }]
        : [];
      return new Response(JSON.stringify({ resultCount: results.length, results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = term.includes("cache album")
      ? [album({ collectionId: 77, collectionName: "Cache Album" })]
      : [];
    return new Response(JSON.stringify({ resultCount: results.length, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.deepEqual(await searchSpotifyAlbums("missing result 92741"), []);

    const controller = new AbortController();
    const cancelled = searchSpotifyAlbums("cancelled search 92741", {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(cancelled, (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError"
    );

    const beforeAlbumSearch = fetchCount;
    const firstAlbums = await searchSpotifyAlbums("cache album 92741");
    const afterAlbumSearch = fetchCount;
    const cachedAlbums = await searchSpotifyAlbums("cache album 92741");
    assert.equal(firstAlbums[0]?.title, "Cache Album");
    assert.deepEqual(cachedAlbums, firstAlbums);
    assert.ok(afterAlbumSearch > beforeAlbumSearch);
    assert.equal(fetchCount, afterAlbumSearch);

    const artists = await searchSpotifyArtists("cache artist 92741");
    assert.equal(artists[0]?.name, "Cache Artist");
    assert.equal(artists[0]?.genre, "Afrobeats");

    const tracks = await getSpotifyAlbumTracks("itunes:US:987654321");
    assert.deepEqual(tracks, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
