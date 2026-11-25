import { approvedDailyCoverIds } from "./dailyPickCatalog";

const fixtureEnabled = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DISCOVERY_ART_FIXTURE === "true";
const catalogSourceApproved = import.meta.env.VITE_DISCOVERY_ARTWORK_SOURCE === "itunes";
const localIds = new Set<string>(import.meta.env.DEV
  ? (import.meta.env.VITE_LOCAL_DAILY_COVER_IDS ?? "").split(",").map((id: string) => id.trim())
  : []);
const urls = new Map<string, string>();

export function canLoadDiscoveryArtwork(id: string) {
  return fixtureEnabled || catalogSourceApproved || approvedDailyCoverIds.has(id) || localIds.has(id);
}

export async function resolveDiscoveryArtwork(id: string, signal: AbortSignal) {
  if (signal.aborted || !canLoadDiscoveryArtwork(id)) return;
  if (fixtureEnabled) {
    const edition = Number(id.split(":").at(-1));
    if (!Number.isSafeInteger(edition) || edition % 5 === 0) return; // Exercise the fallback.
    const hue = edition % 360;
    const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="hsl(${hue},55%,20%)"/><circle cx="220" cy="175" r="125" fill="hsl(${(hue + 65) % 360},75%,65%)"/><path d="M0 375L400 125V400H0Z" fill="#111827" opacity=".84"/><text x="26" y="350" fill="white" font-family="sans-serif" font-size="24">LOCAL ART STUDY</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(art)}`;
  }
  const cached = urls.get(id);
  if (cached) return cached;
  const { lookupSharedAlbum } = await import("./spotifyApi");
  if (signal.aborted) return;
  const album = await lookupSharedAlbum(id, signal);
  if (signal.aborted || album?.id !== id || !album.imageUrl) return;
  const url = new URL(album.imageUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".mzstatic.com")) return;
  const artwork = url.href.replace(/600x600(?=bb)/, "400x400");
  urls.set(id, artwork);
  return artwork;
}
