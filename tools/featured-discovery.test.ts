import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSharedAlbumId } from "../src/lib/albumShareId.ts";
import { analyticsProperties } from "../src/lib/analytics.ts";
import { discoveryPlayPath, discoverySurface, featuredAlbums, featuredArtists } from "../src/lib/featuredDiscovery.ts";

test("the curated album editions are unique and cover all four requested genres", () => {
  assert.equal(featuredAlbums.length, 8);
  assert.equal(featuredArtists.length, 6);
  assert.equal(new Set(featuredAlbums.map(album => album.id)).size, 8);
  assert.ok(featuredAlbums.every(album => parseSharedAlbumId(album.id)));
  assert.deepEqual(new Set(featuredAlbums.map(album => album.genre)), new Set(["Hip Hop", "Afrobeats", "R&B", "Pop"]));
});

test("featured album links preserve the edition and safely encode query text", () => {
  const link = new URL(discoveryPlayPath("GIVĒON & Friends", "home_feature", "itunes:US:1627365840"), "https://stanzer.app");
  assert.equal(link.pathname, "/play");
  assert.equal(link.searchParams.get("album"), "GIVĒON & Friends");
  assert.equal(link.searchParams.get("album_id"), "itunes:US:1627365840");
  assert.equal(discoverySurface(link.search, false), "home_feature");
  assert.equal(discoverySurface(link.search, true), "score_share");
  assert.equal(discoverySurface("?discovery=outside-allow-list", false), "search");
});

test("the discovery funnel projects only safe dimensions", () => {
  const props = { surface: "home_feature" as const, lookup: "exact" as const, album_id: "itunes:US:1627365840", query: "raw search" };
  assert.deepEqual(analyticsProperties(props), {surface: "home_feature", lookup: "exact", album_id: "itunes:US:1627365840"});
});
