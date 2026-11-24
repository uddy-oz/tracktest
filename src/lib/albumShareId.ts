export function parseSharedAlbumId(value: string | null | undefined) {
  const match = /^itunes:([A-Z]{2}):([1-9]\d{0,15})$/.exec(value ?? "");
  return match ? { country: match[1], collectionId: match[2] } : null;
}
