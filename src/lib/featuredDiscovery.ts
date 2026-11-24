const albums = [
  ["1471277623", "good kid, m.A.A.d city", "Kendrick Lamar", "Hip Hop", "hip-hop"],
  ["1756305992", "HEIS", "Rema", "Afrobeats", "afrobeats"],
  ["1239977075", "Ctrl", "SZA", "R&B", "rnb"],
  ["269572838", "Thriller", "Michael Jackson", "Pop", "pop"],
  ["1587040935", "The Melodic Blue", "Baby Keem", "Hip Hop", "hip-hop"],
  ["1704311790", "I Told Them...", "Burna Boy", "Afrobeats", "afrobeats"],
  ["1627365840", "Give Or Take", "GIVĒON", "R&B", "rnb"],
  ["1745741774", "Radical Optimism", "Dua Lipa", "Pop", "pop"],
] as const;

export const featuredAlbums = albums.map(([collectionId, title, artist, genre, tone]) => ({
  id: `itunes:US:${collectionId}`, title, artist, genre, tone,
}));

export const featuredArtists = [
  ["Kendrick Lamar", "Hip Hop"], ["Rema", "Afrobeats"], ["SZA", "R&B"],
  ["Michael Jackson", "Pop"], ["Burna Boy", "Afrobeats"], ["Dua Lipa", "Pop"],
] as const;

export type DiscoverySurface = "home_feature" | "home_search" | "artist" | "search" | "score_share";

export function discoveryPlayPath(query: string, surface: DiscoverySurface, albumId?: string) {
  const params = new URLSearchParams({ album: query.trim(), discovery: surface });
  if (albumId) params.set("album_id", albumId);
  return `/play?${params}`;
}

export function discoverySurface(search: string, scoreLink: boolean): DiscoverySurface {
  if (scoreLink) return "score_share";
  const source = new URLSearchParams(search).get("discovery");
  return source === "home_feature" || source === "home_search" || source === "artist" ? source : "search";
}
