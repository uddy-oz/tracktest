export type SpotifyAlbum = {
  id: string;
  title: string;
  artist: string;
  year: string;
  imageUrl: string;
};

export type SpotifyTrack = {
  id: string;
  name: string;
};

export async function searchSpotifyAlbums(query: string): Promise<SpotifyAlbum[]> {
  const accessToken = localStorage.getItem("spotify_access_token");

  if (!accessToken) {
    throw new Error("You need to connect Spotify first.");
  }

  const params = new URLSearchParams({
    q: query,
    type: "album",
    limit: "6",
  });

  const response = await fetch(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to search Spotify albums.");
  }

  const data = await response.json();

  return data.albums.items.map((album: any) => ({
    id: album.id,
    title: album.name,
    artist: album.artists[0]?.name || "Unknown artist",
    year: album.release_date?.slice(0, 4) || "Unknown year",
    imageUrl: album.images[0]?.url || "",
  }));
}
export async function getSpotifyAlbumTracks(albumId: string): Promise<SpotifyTrack[]> {
  const accessToken = localStorage.getItem("spotify_access_token");

  if (!accessToken) {
    throw new Error("You need to connect Spotify first.");
  }

  const response = await fetch(
    `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to get album tracks.");
  }

  const data = await response.json();

  return data.items.map((track: any) => ({
    id: track.id,
    name: track.name,
  }));
}