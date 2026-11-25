import { dailyPickCatalog } from "./dailyPickCatalog.ts";
import { getDailyGoalPeriod } from "./dailyGoals.ts";

export const DAILY_PICK_CATALOG_VERSION = 1;
type Genre = keyof typeof dailyPickCatalog;
const dayMs = 86_400_000;
const genres = Object.keys(dailyPickCatalog) as Genre[];

export function dailyPickHash(id: string) {
  let hash = 2166136261;
  for (const char of `${DAILY_PICK_CATALOG_VERSION}:${id}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

const byStableHash = (a: string, b: string) => dailyPickHash(a) - dailyPickHash(b) || (a < b ? -1 : a > b ? 1 : 0);
export const dailyPickPool = genres.flatMap(genre => dailyPickCatalog[genre].flatMap(([artist, releases]) =>
  releases.map(([id, title, year]) => ({ id: `itunes:US:${id}`, title, year, artist, genre }))));
const buckets = genres.map(genre => ({
  albums: dailyPickPool.filter(album => album.genre === genre).sort((a,b) => byStableHash(a.id,b.id)),
  artists: dailyPickCatalog[genre].map(([artist]) => artist).sort(byStableHash).map(artist => ({artist, genre})),
}));
const wrap = (index: number, length: number) => ((index % length) + length) % length;

export function getDailyPicks(now: Date) {
  const period = getDailyGoalPeriod(now);
  const day = Math.floor(Date.parse(period.start) / dayMs);
  const offset = wrap(day, genres.length);
  const ordered = [...buckets.slice(offset), ...buckets.slice(0, offset)];
  // Two consecutive positions in each fixed ring advance by two each UTC day.
  const albums = [0, 1].flatMap(index => ordered.map(bucket => bucket.albums[wrap(day * 2 + index, bucket.albums.length)]));
  const artists = ordered.map(bucket => bucket.artists[wrap(day * 2, bucket.artists.length)])
    .concat(ordered.slice(0, 2).map(bucket => bucket.artists[wrap(day * 2 + 1, bucket.artists.length)]));
  return { albums, artists, day: period.start.slice(0, 10), endsAt: Date.parse(period.end) };
}

export function formatDailyPickCountdown(now: Date, endsAt: number) {
  const minutes = Math.max(0, Math.ceil((endsAt - now.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m` : "soon";
}
