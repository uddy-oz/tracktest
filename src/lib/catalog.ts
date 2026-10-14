export type CatalogResourceKind =
  | "album"
  | "artist"
  | "playlist"
  | "track";

export type CatalogIdentifier = Readonly<{
  provider: string;
  kind: CatalogResourceKind;
  id: string;
  storefront?: string;
}>;

export type CatalogRightsStatus =
  | "mock"
  | "licensed"
  | "restricted"
  | "unknown";

export type CatalogArtwork = Readonly<{
  url: string | null;
  alt: string;
  palette?: readonly [string, string];
  rightsStatus: CatalogRightsStatus;
}>;

export type SourceAvailability = Readonly<{
  status: "available" | "unavailable" | "unknown";
  reason?: string;
  storefronts: readonly string[];
  gameplayEnabled: boolean;
}>;

type CatalogEntity = Readonly<{
  catalogId: CatalogIdentifier;
  name: string;
  artwork: CatalogArtwork;
  availability: SourceAvailability;
  externalUrl: string | null;
}>;

export type CatalogArtist = CatalogEntity &
  Readonly<{
    genres: readonly string[];
  }>;

export type CatalogAlbum = CatalogEntity &
  Readonly<{
    artistIds: readonly CatalogIdentifier[];
    artistName: string;
    releaseDate: string | null;
    trackCount: number | null;
    isSingle: boolean;
  }>;

export type CatalogPlaylist = CatalogEntity &
  Readonly<{
    description: string;
    curatorName: string;
    categoryIds: readonly string[];
    trackCount: number | null;
  }>;

export type CatalogTrack = CatalogEntity &
  Readonly<{
    artistIds: readonly CatalogIdentifier[];
    artistName: string;
    albumId: CatalogIdentifier | null;
    durationMs: number | null;
    isrc: string | null;
    explicit: boolean;
  }>;

export type CatalogCategory = Readonly<{
  id: string;
  label: string;
}>;

export type CatalogPageRequest = Readonly<{
  cursor?: string | null;
  limit?: number;
}>;

export type CatalogPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
  total: number;
}>;

export type CatalogRequestContext = Readonly<{
  signal?: AbortSignal;
}>;

export type CatalogAdapter = Readonly<{
  provider: string;
  displayName: string;
  metadataRightsStatus: CatalogRightsStatus;
  playbackEnabled: boolean;
  listCategories: () => readonly CatalogCategory[];
  searchArtists: (
    query: string,
    page?: CatalogPageRequest,
    context?: CatalogRequestContext
  ) => Promise<CatalogPage<CatalogArtist>>;
  searchPlaylists: (
    query: string,
    categoryId?: string | null,
    page?: CatalogPageRequest,
    context?: CatalogRequestContext
  ) => Promise<CatalogPage<CatalogPlaylist>>;
  getArtistTracks: (
    artistId: CatalogIdentifier,
    page?: CatalogPageRequest,
    context?: CatalogRequestContext
  ) => Promise<CatalogPage<CatalogTrack>>;
  getPlaylistTracks: (
    playlistId: CatalogIdentifier,
    page?: CatalogPageRequest,
    context?: CatalogRequestContext
  ) => Promise<CatalogPage<CatalogTrack>>;
}>;

export type QuizSource = Readonly<{
  kind: "album" | "artist" | "playlist";
  catalogId: CatalogIdentifier;
  title: string;
  subtitle: string;
  availability: SourceAvailability;
}>;

export type CatalogQuestionDefinition = Readonly<{
  id: string;
  correctTrackId: CatalogIdentifier;
  optionTrackIds: readonly CatalogIdentifier[];
  cueOffsetMs: number | null;
}>;

export type ImmutableQuestionSnapshot = Readonly<{
  version: 1;
  snapshotId: string;
  provider: string;
  storefront: string | null;
  source: QuizSource;
  seed: string;
  generatedAt: string;
  questions: readonly CatalogQuestionDefinition[];
}>;

type CatalogArtistInput = Readonly<{
  catalogId: CatalogIdentifier;
  name?: string | null;
  genres?: readonly string[] | null;
  artwork?: Partial<CatalogArtwork> | null;
  availability?: Partial<SourceAvailability> | null;
  externalUrl?: string | null;
}>;

type CatalogPlaylistInput = Readonly<{
  catalogId: CatalogIdentifier;
  name?: string | null;
  description?: string | null;
  curatorName?: string | null;
  categoryIds?: readonly string[] | null;
  trackCount?: number | null;
  artwork?: Partial<CatalogArtwork> | null;
  availability?: Partial<SourceAvailability> | null;
  externalUrl?: string | null;
}>;

const DEFAULT_AVAILABILITY: SourceAvailability = Object.freeze({
  status: "unknown",
  storefronts: Object.freeze([]),
  gameplayEnabled: false,
});

function cleanOptionalText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function normalizeArtwork(
  artwork: Partial<CatalogArtwork> | null | undefined,
  fallbackAlt: string
): CatalogArtwork {
  const palette =
    artwork?.palette?.length === 2
      ? Object.freeze([artwork.palette[0], artwork.palette[1]] as const)
      : undefined;

  return Object.freeze({
    url: cleanOptionalText(artwork?.url),
    alt: cleanOptionalText(artwork?.alt) || fallbackAlt,
    palette,
    rightsStatus: artwork?.rightsStatus || "unknown",
  });
}

function normalizeAvailability(
  availability: Partial<SourceAvailability> | null | undefined
): SourceAvailability {
  if (!availability) return DEFAULT_AVAILABILITY;

  return Object.freeze({
    status: availability.status || "unknown",
    reason: cleanOptionalText(availability.reason) || undefined,
    storefronts: Object.freeze([...(availability.storefronts || [])]),
    gameplayEnabled: Boolean(availability.gameplayEnabled),
  });
}

export function normalizeCatalogArtistMetadata(
  input: CatalogArtistInput
): CatalogArtist {
  const name = cleanOptionalText(input.name) || "Unknown artist";

  return Object.freeze({
    catalogId: Object.freeze({ ...input.catalogId }),
    name,
    genres: Object.freeze(
      (input.genres || []).map((genre) => genre.trim()).filter(Boolean)
    ),
    artwork: normalizeArtwork(input.artwork, `${name} artwork`),
    availability: normalizeAvailability(input.availability),
    externalUrl: cleanOptionalText(input.externalUrl),
  });
}

export function normalizeCatalogPlaylistMetadata(
  input: CatalogPlaylistInput
): CatalogPlaylist {
  const name = cleanOptionalText(input.name) || "Untitled playlist";

  return Object.freeze({
    catalogId: Object.freeze({ ...input.catalogId }),
    name,
    description:
      cleanOptionalText(input.description) || "Description unavailable.",
    curatorName: cleanOptionalText(input.curatorName) || "Unknown curator",
    categoryIds: Object.freeze([...(input.categoryIds || [])]),
    trackCount:
      typeof input.trackCount === "number" && input.trackCount >= 0
        ? input.trackCount
        : null,
    artwork: normalizeArtwork(input.artwork, `${name} artwork`),
    availability: normalizeAvailability(input.availability),
    externalUrl: cleanOptionalText(input.externalUrl),
  });
}

export function catalogIdentifierKey(identifier: CatalogIdentifier) {
  return `${identifier.provider}:${identifier.kind}:${identifier.id}`;
}

export function areSameArtistIdentity(
  left: CatalogIdentifier,
  right: CatalogIdentifier
) {
  return (
    left.kind === "artist" &&
    right.kind === "artist" &&
    left.provider === right.provider &&
    left.id === right.id
  );
}

function normalizedFingerprint(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackFingerprint(track: CatalogTrack) {
  const name = normalizedFingerprint(track.name);
  const artist = normalizedFingerprint(track.artistName);
  const durationBucket =
    typeof track.durationMs === "number"
      ? Math.round(track.durationMs / 2000)
      : "unknown";

  return name && artist ? `${name}:${artist}:${durationBucket}` : null;
}

export function deduplicateCatalogTracks(tracks: readonly CatalogTrack[]) {
  const seenIds = new Set<string>();
  const seenIsrcs = new Set<string>();
  const seenFingerprints = new Set<string>();

  return tracks.filter((track) => {
    const idKey = catalogIdentifierKey(track.catalogId);
    const isrc = track.isrc?.trim().toUpperCase() || null;
    const fingerprint = trackFingerprint(track);

    if (
      seenIds.has(idKey) ||
      (isrc && seenIsrcs.has(isrc)) ||
      (fingerprint && seenFingerprints.has(fingerprint))
    ) {
      return false;
    }

    seenIds.add(idKey);
    if (isrc) seenIsrcs.add(isrc);
    if (fingerprint) seenFingerprints.add(fingerprint);
    return true;
  });
}

export function paginateCatalogItems<T>(
  items: readonly T[],
  request: CatalogPageRequest = {}
): CatalogPage<T> {
  const parsedCursor = Number.parseInt(request.cursor || "0", 10);
  const offset = Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
  const requestedLimit = request.limit ?? 6;
  const limit = Math.min(24, Math.max(1, requestedLimit));
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return Object.freeze({
    items: Object.freeze(pageItems),
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length,
  });
}

export function filterPlaylistsByCategory(
  playlists: readonly CatalogPlaylist[],
  categoryId?: string | null
) {
  if (!categoryId || categoryId === "all") return [...playlists];
  return playlists.filter((playlist) =>
    playlist.categoryIds.includes(categoryId)
  );
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function freezeIdentifier(identifier: CatalogIdentifier): CatalogIdentifier {
  return Object.freeze({ ...identifier });
}

export function createImmutableQuestionSnapshot(input: {
  source: QuizSource;
  seed: string;
  generatedAt?: string;
  questions: readonly CatalogQuestionDefinition[];
}): ImmutableQuestionSnapshot {
  const questions = input.questions.map((question) =>
    Object.freeze({
      ...question,
      correctTrackId: freezeIdentifier(question.correctTrackId),
      optionTrackIds: Object.freeze(
        question.optionTrackIds.map(freezeIdentifier)
      ),
    })
  );
  const source = Object.freeze({
    ...input.source,
    catalogId: freezeIdentifier(input.source.catalogId),
    availability: Object.freeze({
      ...input.source.availability,
      storefronts: Object.freeze([...input.source.availability.storefronts]),
    }),
  });
  const canonical = JSON.stringify({
    version: 1,
    provider: source.catalogId.provider,
    storefront: source.catalogId.storefront || null,
    sourceId: catalogIdentifierKey(source.catalogId),
    seed: input.seed,
    questions: questions.map((question) => ({
      id: question.id,
      correctTrackId: catalogIdentifierKey(question.correctTrackId),
      optionTrackIds: question.optionTrackIds.map(catalogIdentifierKey),
      cueOffsetMs: question.cueOffsetMs,
    })),
  });

  return Object.freeze({
    version: 1,
    snapshotId: `catalog-${stableHash(canonical)}`,
    provider: source.catalogId.provider,
    storefront: source.catalogId.storefront || null,
    source,
    seed: input.seed,
    generatedAt: input.generatedAt || new Date().toISOString(),
    questions: Object.freeze(questions),
  });
}
