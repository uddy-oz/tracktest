import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogAlbums, catalogArtists, catalogOrigin, catalogPaths } from "../src/lib/publicCatalog.ts";
import { catalogDocument, catalogRobots, catalogSitemap } from "./public-catalog-html.ts";
import { discoverySurface } from "../src/lib/featuredDiscovery.ts";

test("curated releases and artists generate unique, indexable pages", () => {
  assert.ok(catalogAlbums.length >= 94);
  assert.ok(catalogArtists.every(artist => artist.albums.length > 0));
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of catalogPaths) {
    assert.match(path, /^\/(artists|albums)(\/[a-z0-9-]+)?$/);
    const page = catalogDocument(path);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("<h1>"));
    assert.ok(page.head.includes(`rel="canonical" href="${catalogOrigin}${path}"`));
    assert.ok(page.head.includes('property="og:description"'));
    assert.ok(page.head.includes(`property="og:url" content="${catalogOrigin}${path}"`));
    titles.add(page.head.match(/<title>(.*?)<\/title>/)?.[1] ?? "");
    descriptions.add(page.head.match(/name="description" content="([^"]+)"/)?.[1] ?? "");
  }
  assert.equal(titles.size, catalogPaths.length);
  assert.equal(descriptions.size, catalogPaths.length);
});

test("directory genre links and breadcrumbs are usable without scripts", () => {
  for (const path of ["/artists", "/albums"]) {
    const page = catalogDocument(path);
    const anchors = [...page.body.matchAll(/href="#([^"]+)"/g)];
    assert.equal(anchors.length, 4);
    for (const [, id] of anchors) assert.ok(page.body.includes(`<h2 id="${id}">`));
  }
  for (const { artist, album } of catalogAlbums) {
    const page = catalogDocument(album.path);
    assert.match(page.body, /aria-label="Breadcrumb"/);
    assert.ok(page.body.includes(`<li><a href="${artist.path}">`));
  }
});

test("exact edition and discovery attribution survive each play link", () => {
  for (const { artist, album } of catalogAlbums) {
    for (const [path, surface] of [[artist.path, "artist_page"], [album.path, "album_page"]]) {
      const links = [...catalogDocument(path).body.matchAll(/href="(\/play\?[^"]+)"/g)]
        .map(([, href]) => new URL(href.replaceAll("&amp;", "&"), catalogOrigin));
      const link = links.find(url => url.searchParams.get("album_id") === album.id);
      assert.ok(link);
      assert.equal(link.searchParams.get("album"), album.title);
      assert.equal(discoverySurface(link.search, false), surface);
    }
  }
});

test("every curated edition has an exact artwork slot with a static fallback", () => {
  const directory = catalogDocument("/albums").body;
  for (const { artist, album } of catalogAlbums) {
    const slot = `data-cover="${album.id}"><svg`;
    assert.ok(directory.includes(slot), album.id);
    assert.ok(catalogDocument(artist.path).body.includes(slot), album.id);
    assert.ok(catalogDocument(album.path).body.includes(slot), album.id);
  }
});

test("unknown catalog routes stay out of the sitemap and use a noindex 404", () => {
  const invalid = catalogDocument("/albums/not-a-release");
  assert.equal(invalid.status, 404);
  assert.match(invalid.head, /"noindex"/);
  assert.doesNotMatch(invalid.head, /rel="canonical"/);
  const sitemap = catalogSitemap();
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, catalogPaths.length + 3);
  assert.ok(catalogPaths.every(path => sitemap.includes(`<loc>${catalogOrigin}${path}</loc>`)));
  assert.match(catalogRobots, /Sitemap: https:\/\/stanzer\.app\/sitemap\.xml/);
});
