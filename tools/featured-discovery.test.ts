import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSharedAlbumId } from "../src/lib/albumShareId.ts";
import { analyticsProperties } from "../src/lib/analytics.ts";
import { discoveryPlayPath, discoverySurface } from "../src/lib/featuredDiscovery.ts";
import { dailyPickPool, formatDailyPickCountdown, getDailyPicks } from "../src/lib/dailyPicks.ts";

test("the curated album editions are unique and cover all four requested genres", () => {
  assert.ok(dailyPickPool.length >= 90 && dailyPickPool.length <= 110);
  assert.equal(new Set(dailyPickPool.map(album => album.id)).size, dailyPickPool.length);
  assert.ok(dailyPickPool.every(album => parseSharedAlbumId(album.id)));
  for (let day = 0; day < 366; day++) {
    const date = new Date(Date.UTC(2026, 0, 1 + day));
    const {albums, artists} = getDailyPicks(date);
    const tomorrow = getDailyPicks(new Date(date.getTime() + 86_400_000));
    assert.equal(albums.length, 8);
    assert.equal(new Set(artists.map(item => item.artist)).size, 6);
    assert.equal(new Set(artists.map(item => item.genre)).size, 4);
    for (const genre of ["Hip Hop", "Afrobeats", "R&B", "Pop"]) assert.equal(albums.filter(a => a.genre === genre).length, 2);
    assert.ok(albums.every(a => !tomorrow.albums.some(b => a.id === b.id)));
    assert.ok(artists.every(a => !tomorrow.artists.some(b => a.artist === b.artist)));
  }
});

test("device timezone does not affect selection and countdown reaches the UTC boundary", () => {
  const before = new Date("2026-11-24T23:59:59Z");
  const same = new Date("2026-11-24T16:59:59-07:00");
  const after = new Date("2026-11-25T00:00:00Z");
  assert.deepEqual(getDailyPicks(before), getDailyPicks(same));
  assert.equal(getDailyPicks(before).endsAt, after.getTime());
  assert.equal(formatDailyPickCountdown(before, getDailyPicks(before).endsAt), "1m");
  assert.notEqual(getDailyPicks(before).day, getDailyPicks(after).day);
});

test("featured album links preserve the edition and safely encode query text", () => {
  const link = new URL(discoveryPlayPath("GIVĒON & Friends", "daily_picks", "itunes:US:1627365840"), "https://stanzer.app");
  assert.equal(link.pathname, "/play");
  assert.equal(link.searchParams.get("album"), "GIVĒON & Friends");
  assert.equal(link.searchParams.get("album_id"), "itunes:US:1627365840");
  assert.equal(discoverySurface(link.search, false), "daily_picks");
  assert.equal(discoverySurface(link.search, true), "score_share");
  assert.equal(discoverySurface("?discovery=outside-allow-list", false), "search");
});

test("the discovery funnel projects only safe dimensions", () => {
  const props = { surface: "daily_picks" as const, lookup: "exact" as const, album_id: "itunes:US:1627365840", query: "raw search" };
  assert.deepEqual(analyticsProperties(props), {surface: "daily_picks", lookup: "exact", album_id: "itunes:US:1627365840"});
});
