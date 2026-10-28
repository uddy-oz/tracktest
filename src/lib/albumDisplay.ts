/** Presentation only: never rewrite the title stored with historical scores. */
export function getAlbumDisplayTitle(title: string | null | undefined): string {
  const value = title?.trim();
  // "?" is a valid album title (including XXXTENTACION's release).
  return value && !/^[\s\ufffd]+$/.test(value) ? value : "Unknown album";
}
