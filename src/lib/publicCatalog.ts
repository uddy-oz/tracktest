import { dailyPickCatalog } from "./dailyPickCatalog.ts";

export const catalogOrigin = "https://stanzer.app";
export const catalogSlug = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const artistCatalogPath = (artist: string) => `/artists/${catalogSlug(artist)}`;
export const albumCatalogPath = (title: string, id: string) =>
  `/albums/${catalogSlug(title) || "release"}-${id.split(":").at(-1)}`;

export const catalogArtists = Object.entries(dailyPickCatalog).flatMap(([genre, groups]) =>
  groups.map(([name, releases]) => ({
    name, genre, path: artistCatalogPath(name),
    albums: releases.map(([number, title, year]) => {
      const id = `itunes:US:${number}`;
      return { id, title, year, path: albumCatalogPath(title, id) };
    }),
  })));

export const catalogAlbums = catalogArtists.flatMap(artist => artist.albums.map(album => ({ artist, album })));
export const catalogPaths = ["/artists", "/albums", ...catalogArtists.map(a => a.path), ...catalogAlbums.map(a => a.album.path)];
if (new Set(catalogPaths).size !== catalogPaths.length) throw new Error("Duplicate public catalog route");
