export type DiscoverySurface = "daily_picks" | "home_feature" | "home_search" | "artist" | "artist_page" | "album_page" | "search" | "score_share";

export function discoveryPlayPath(query: string, surface: DiscoverySurface, albumId?: string) {
  const params = new URLSearchParams({ album: query.trim(), discovery: surface });
  if (albumId) params.set("album_id", albumId);
  return `/play?${params}`;
}

export function discoverySurface(search: string, scoreLink: boolean): DiscoverySurface {
  if (scoreLink) return "score_share";
  const source = new URLSearchParams(search).get("discovery");
  return source === "daily_picks" || source === "home_feature" || source === "home_search" || source === "artist" ||
    source === "artist_page" || source === "album_page" ? source : "search";
}
