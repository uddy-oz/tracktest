import { createHash, createSign } from "node:crypto";

const APPLE_API_ORIGIN = "https://api.music.apple.com";
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_STOREFRONT = "us";
const MAX_LIMIT = 25;

const CATEGORY_QUERIES = Object.freeze({
  all: "essential hits",
  editorial: "Apple Music",
  "90s-hits": "90s hits",
  "2000s-hip-hop": "2000s hip-hop",
  "2010s-hits": "2010s hits",
  "2020s-hits": "2020s hits",
  afrobeats: "Afrobeats hits",
  "rnb-classics": "R&B classics",
  pop: "pop hits",
});

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let cachedTokenIdentity = null;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function getPrivateKey() {
  const encoded = process.env.APPLE_MUSIC_PRIVATE_KEY_BASE64?.trim();
  if (encoded) return Buffer.from(encoded, "base64").toString("utf8");
  return process.env.APPLE_MUSIC_PRIVATE_KEY?.replace(/\\n/g, "\n").trim() || "";
}

export function createAppleMusicDeveloperToken(nowSeconds = Math.floor(Date.now() / 1000)) {
  const configuredToken = process.env.APPLE_MUSIC_DEVELOPER_TOKEN?.trim();
  if (configuredToken) return configuredToken;

  const teamId = process.env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = process.env.APPLE_MUSIC_KEY_ID?.trim();
  const privateKey = getPrivateKey();
  if (!teamId || !keyId || !privateKey) return null;
  const keyFingerprint = createHash("sha256").update(privateKey).digest("hex");
  const tokenIdentity = `${teamId}:${keyId}:${keyFingerprint}`;

  if (
    cachedToken &&
    cachedTokenIdentity === tokenIdentity &&
    cachedTokenExpiresAt - nowSeconds > 60 * 60
  ) {
    return cachedToken;
  }

  const expiresAt = nowSeconds + TOKEN_LIFETIME_SECONDS;
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64Url(
    JSON.stringify({ iss: teamId, iat: nowSeconds, exp: expiresAt })
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = createSign("SHA256")
    .update(unsignedToken)
    .end()
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");

  cachedToken = `${unsignedToken}.${signature}`;
  cachedTokenExpiresAt = expiresAt;
  cachedTokenIdentity = tokenIdentity;
  return cachedToken;
}

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(0, parsed))
    : fallback;
}

function safeStorefront(value) {
  const storefront = String(value || process.env.APPLE_MUSIC_STOREFRONT || DEFAULT_STOREFRONT)
    .trim()
    .toLowerCase();
  return /^[a-z]{2}$/.test(storefront) ? storefront : DEFAULT_STOREFRONT;
}

function safeCatalogId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9._-]{1,160}$/.test(id) ? id : null;
}

function artworkUrl(artwork) {
  const template = typeof artwork?.url === "string" ? artwork.url : "";
  if (!template) return null;
  return template
    .replace("{w}", "600")
    .replace("{h}", "600")
    .replace("{f}", "jpg");
}

function availability(storefront, reason) {
  return {
    status: "available",
    reason: reason || "Catalog metadata only; gameplay is not enabled.",
    storefronts: [storefront],
    gameplayEnabled: false,
  };
}

function identifier(kind, id, storefront) {
  return { provider: "apple_music", kind, id, storefront };
}

function artistIdentifiers(resource, storefront) {
  const related = resource?.relationships?.artists?.data;
  if (!Array.isArray(related)) return [];
  return related
    .filter((artist) => artist?.id)
    .map((artist) => identifier("artist", String(artist.id), storefront));
}

function albumIdentifier(resource, storefront) {
  const album = resource?.relationships?.albums?.data?.[0];
  return album?.id ? identifier("album", String(album.id), storefront) : null;
}

function mapArtist(resource, storefront) {
  const attributes = resource?.attributes || {};
  const name = cleanText(attributes.name) || "Unknown artist";
  return {
    catalogId: identifier("artist", String(resource.id), storefront),
    name,
    genres: Array.isArray(attributes.genreNames) ? attributes.genreNames : [],
    artwork: {
      url: artworkUrl(attributes.artwork),
      alt: `${name} artwork`,
      rightsStatus: "restricted",
    },
    availability: availability(storefront),
    externalUrl: typeof attributes.url === "string" ? attributes.url : null,
  };
}

function mapPlaylist(resource, storefront, categoryId) {
  const attributes = resource?.attributes || {};
  const name = cleanText(attributes.name) || "Untitled playlist";
  const description =
    cleanText(attributes.description?.standard) ||
    cleanText(attributes.description?.short) ||
    cleanText(attributes.editorialNotes?.standard) ||
    cleanText(attributes.editorialNotes?.short) ||
    "Description unavailable.";
  const trackTotal = resource?.relationships?.tracks?.meta?.total;
  return {
    catalogId: identifier("playlist", String(resource.id), storefront),
    name,
    description,
    curatorName: cleanText(attributes.curatorName) || "Apple Music",
    categoryIds: categoryId && categoryId !== "all" ? [categoryId] : [],
    trackCount: Number.isFinite(trackTotal) ? trackTotal : null,
    artwork: {
      url: artworkUrl(attributes.artwork),
      alt: `${name} artwork`,
      rightsStatus: "restricted",
    },
    availability: availability(storefront),
    externalUrl: typeof attributes.url === "string" ? attributes.url : null,
  };
}

function mapTrack(resource, storefront) {
  const attributes = resource?.attributes || {};
  const name = cleanText(attributes.name) || "Untitled track";
  return {
    catalogId: identifier("track", String(resource.id), storefront),
    name,
    artistIds: artistIdentifiers(resource, storefront),
    artistName: cleanText(attributes.artistName) || "Unknown artist",
    albumId: albumIdentifier(resource, storefront),
    durationMs: Number.isFinite(attributes.durationInMillis)
      ? attributes.durationInMillis
      : null,
    isrc: cleanText(attributes.isrc) || null,
    explicit: attributes.contentRating === "explicit",
    artwork: {
      url: artworkUrl(attributes.artwork),
      alt: `${name} artwork`,
      rightsStatus: "restricted",
    },
    availability: availability(storefront),
    externalUrl: typeof attributes.url === "string" ? attributes.url : null,
  };
}

function mapAlbum(resource, storefront) {
  const attributes = resource?.attributes || {};
  const name = cleanText(attributes.name) || "Untitled album";
  return {
    catalogId: identifier("album", String(resource.id), storefront),
    name,
    artistIds: artistIdentifiers(resource, storefront),
    artistName: cleanText(attributes.artistName) || "Unknown artist",
    releaseDate: cleanText(attributes.releaseDate) || null,
    trackCount: Number.isFinite(attributes.trackCount) ? attributes.trackCount : null,
    isSingle: attributes.isSingle === true,
    artwork: {
      url: artworkUrl(attributes.artwork),
      alt: `${name} artwork`,
      rightsStatus: "restricted",
    },
    availability: availability(storefront),
    externalUrl: typeof attributes.url === "string" ? attributes.url : null,
  };
}

function nextOffset(next) {
  if (typeof next !== "string") return null;
  try {
    return new URL(next, APPLE_API_ORIGIN).searchParams.get("offset");
  } catch {
    return null;
  }
}

function page(resources, mapper, storefront, currentOffset, categoryId) {
  const data = Array.isArray(resources?.data) ? resources.data : [];
  const nextCursor = nextOffset(resources?.next);
  const reportedTotal = resources?.meta?.total;
  const total = Number.isFinite(reportedTotal)
    ? reportedTotal
    : currentOffset + data.length + (nextCursor ? 1 : 0);
  return {
    items: data.map((item) => mapper(item, storefront, categoryId)),
    nextCursor,
    total,
  };
}

async function appleRequest(path, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${APPLE_API_ORIGIN}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "StanZer/1.0",
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Apple Music catalog request failed (${response.status}).`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const token = createAppleMusicDeveloperToken();
  if (!token) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      code: "APPLE_MUSIC_NOT_CONFIGURED",
      error: "Apple Music catalog credentials are not configured.",
    });
  }

  const action = String(one(req.query.action) || "");
  const storefront = safeStorefront(one(req.query.storefront));
  const limit = Math.max(1, boundedInteger(one(req.query.limit), 6, MAX_LIMIT));
  const offset = boundedInteger(one(req.query.cursor), 0, 10_000);
  const id = safeCatalogId(one(req.query.id));
  const query = cleanText(one(req.query.q)).slice(0, 120);
  const category = String(one(req.query.category) || "all");
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });

  let path;
  let selectPage;
  try {
    switch (action) {
      case "search-artists": {
        params.set("term", query || "popular artists");
        params.set("types", "artists");
        path = `/v1/catalog/${storefront}/search?${params}`;
        selectPage = (payload) => page(payload?.results?.artists, mapArtist, storefront, offset);
        break;
      }
      case "search-playlists": {
        const categoryQuery = CATEGORY_QUERIES[category] || "";
        params.set("term", [query, categoryQuery].filter(Boolean).join(" ") || CATEGORY_QUERIES.all);
        params.set("types", "playlists");
        params.set("include[playlists]", "tracks");
        path = `/v1/catalog/${storefront}/search?${params}`;
        selectPage = (payload) =>
          page(payload?.results?.playlists, mapPlaylist, storefront, offset, category);
        break;
      }
      case "playlist-tracks":
        if (!id) return res.status(400).json({ error: "A valid playlist id is required." });
        path = `/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}/tracks?${params}`;
        selectPage = (payload) => page(payload, mapTrack, storefront, offset);
        break;
      case "artist-tracks":
        if (!id) return res.status(400).json({ error: "A valid artist id is required." });
        params.set("with", "attributes");
        path = `/v1/catalog/${storefront}/artists/${encodeURIComponent(id)}/view/top-songs?${params}`;
        selectPage = (payload) => page(payload, mapTrack, storefront, offset);
        break;
      case "artist-albums":
        if (!id) return res.status(400).json({ error: "A valid artist id is required." });
        path = `/v1/catalog/${storefront}/artists/${encodeURIComponent(id)}/albums?${params}`;
        selectPage = (payload) => page(payload, mapAlbum, storefront, offset);
        break;
      default:
        return res.status(400).json({ error: "Unknown catalog action." });
    }

    const payload = await appleRequest(path, token);
    const result = selectPage(payload);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=86400"
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error("Apple Music catalog API error:", error);
    res.setHeader("Cache-Control", "no-store");
    const status = error?.name === "AbortError" ? 504 : 502;
    return res.status(status).json({
      code: "APPLE_MUSIC_UPSTREAM_ERROR",
      error: "Apple Music catalog metadata is temporarily unavailable.",
    });
  }
}

