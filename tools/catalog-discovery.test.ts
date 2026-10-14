import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areSameArtistIdentity,
  createImmutableQuestionSnapshot,
  deduplicateCatalogTracks,
  filterPlaylistsByCategory,
  normalizeCatalogArtistMetadata,
  normalizeCatalogPlaylistMetadata,
  paginateCatalogItems,
  type CatalogIdentifier,
  type CatalogTrack,
} from "../src/lib/catalog.ts";

const availability = Object.freeze({
  status: "available" as const,
  storefronts: Object.freeze(["test"]),
  gameplayEnabled: false,
});

function identifier(
  kind: CatalogIdentifier["kind"],
  id: string,
  provider = "test"
): CatalogIdentifier {
  return { provider, kind, id, storefront: "ca" };
}

function track(changes: Partial<CatalogTrack> = {}): CatalogTrack {
  return {
    catalogId: identifier("track", "track-1"),
    name: "The Song",
    artwork: {
      url: null,
      alt: "The Song artwork",
      rightsStatus: "mock",
    },
    availability,
    externalUrl: null,
    artistIds: [identifier("artist", "artist-1")],
    artistName: "The Artist",
    albumId: identifier("album", "album-1"),
    durationMs: 203_000,
    isrc: "CAABC1234567",
    explicit: false,
    ...changes,
  };
}

test("track deduplication preserves the first identity, ISRC, and equivalent version", () => {
  const unique = deduplicateCatalogTracks([
    track(),
    track({ catalogId: identifier("track", "track-1"), isrc: "OTHER" }),
    track({ catalogId: identifier("track", "track-2") }),
    track({
      catalogId: identifier("track", "track-3"),
      name: "The Song (Deluxe Edition)",
      isrc: null,
      durationMs: 203_400,
    }),
    track({
      catalogId: identifier("track", "track-4"),
      name: "Another Song",
      isrc: null,
    }),
  ]);

  assert.deepEqual(
    unique.map((item) => item.catalogId.id),
    ["track-1", "track-4"]
  );
});

test("artist identity uses stable provider identifiers instead of display names", () => {
  const artistA = identifier("artist", "42", "provider-a");
  const sameArtist = identifier("artist", "42", "provider-a");
  const sameNumericIdElsewhere = identifier("artist", "42", "provider-b");
  const album = identifier("album", "42", "provider-a");

  assert.equal(areSameArtistIdentity(artistA, sameArtist), true);
  assert.equal(areSameArtistIdentity(artistA, sameNumericIdElsewhere), false);
  assert.equal(areSameArtistIdentity(artistA, album), false);
});

test("pagination is bounded, stable, and reports a continuation cursor", () => {
  const items = ["a", "b", "c", "d", "e"];
  const first = paginateCatalogItems(items, { limit: 2 });
  const second = paginateCatalogItems(items, {
    cursor: first.nextCursor,
    limit: 2,
  });
  const final = paginateCatalogItems(items, {
    cursor: second.nextCursor,
    limit: 2,
  });

  assert.deepEqual(first, { items: ["a", "b"], nextCursor: "2", total: 5 });
  assert.deepEqual(second.items, ["c", "d"]);
  assert.equal(second.nextCursor, "4");
  assert.deepEqual(final.items, ["e"]);
  assert.equal(final.nextCursor, null);
});

test("playlist categories filter independently from the source collection", () => {
  const playlists = [
    normalizeCatalogPlaylistMetadata({
      catalogId: identifier("playlist", "afrobeats-1"),
      name: "Afrobeats One",
      categoryIds: ["afrobeats"],
    }),
    normalizeCatalogPlaylistMetadata({
      catalogId: identifier("playlist", "pop-1"),
      name: "Pop One",
      categoryIds: ["pop"],
    }),
    normalizeCatalogPlaylistMetadata({
      catalogId: identifier("playlist", "afrobeats-2"),
      name: "Afrobeats Two",
      categoryIds: ["afrobeats", "2010s-hits"],
    }),
  ];
  const afrobeats = filterPlaylistsByCategory(playlists, "afrobeats");

  assert.equal(afrobeats.length, 2);
  assert.ok(
    afrobeats.every((playlist) => playlist.categoryIds.includes("afrobeats"))
  );
  assert.deepEqual(filterPlaylistsByCategory(playlists, "all"), playlists);
});

test("question snapshots are deterministic, deeply frozen, and source-specific", () => {
  const source = {
    kind: "artist" as const,
    catalogId: identifier("artist", "artist-1"),
    title: "The Artist",
    subtitle: "Discography",
    availability,
  };
  const questions = [
    {
      id: "q1",
      correctTrackId: identifier("track", "track-1"),
      optionTrackIds: [
        identifier("track", "track-1"),
        identifier("track", "track-2"),
      ],
      cueOffsetMs: 8_000,
    },
  ];

  const first = createImmutableQuestionSnapshot({
    source,
    seed: "room-42",
    generatedAt: "2026-10-14T00:00:00.000Z",
    questions,
  });
  const second = createImmutableQuestionSnapshot({
    source,
    seed: "room-42",
    generatedAt: "2027-01-01T00:00:00.000Z",
    questions,
  });
  const differentSeed = createImmutableQuestionSnapshot({
    source,
    seed: "room-43",
    questions,
  });

  assert.equal(first.snapshotId, second.snapshotId);
  assert.notEqual(first.snapshotId, differentSeed.snapshotId);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.source.availability.storefronts), true);
  assert.equal(Object.isFrozen(first.questions[0]?.optionTrackIds), true);
});

test("missing artist and playlist metadata receives safe display fallbacks", () => {
  const artist = normalizeCatalogArtistMetadata({
    catalogId: identifier("artist", "missing-artist"),
    name: "  ",
  });
  const playlist = normalizeCatalogPlaylistMetadata({
    catalogId: identifier("playlist", "missing-playlist"),
    name: null,
    description: "",
    curatorName: null,
    trackCount: -1,
  });

  assert.equal(artist.name, "Unknown artist");
  assert.equal(artist.artwork.url, null);
  assert.deepEqual(artist.genres, []);
  assert.equal(playlist.name, "Untitled playlist");
  assert.equal(playlist.description, "Description unavailable.");
  assert.equal(playlist.curatorName, "Unknown curator");
  assert.equal(playlist.trackCount, null);
  assert.equal(playlist.availability.gameplayEnabled, false);
});
