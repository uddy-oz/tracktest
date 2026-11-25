# Discovery artwork

The homepage falls back to original StanZer patterns and artist initials.
Catalog IDs verify edition identity, not permission to display artwork.
Review the [Apple Search API terms](https://performance-partners.apple.com/search-api)
and obtain suitable permission before enabling catalog covers, even for a local
demo if the applicable terms require it. Nothing in this implementation
establishes permission.

An album-led card with a direct, approved iTunes purchase badge and a separate
quiz action is a candidate to submit for review, not blanket clearance. The
Search API terms also restrict promotion of other services. Do not substitute a
Listen on Apple Music badge for the Search API's iTunes purchase requirement
without confirmation that the applicable terms permit it.

For blanket catalog coverage, ask Apple or a licensed metadata provider to
confirm the public quiz-homepage placement, covered editions and territories,
attribution, display sizes, and permitted caching. A licensed feed can be
matched once by exact edition identifiers or UPC; the daily rotation then
resolves those images automatically. MusicBrainz and Cover Art Archive may
help with matching but are not a blanket image license. Keep original
graphics when coverage or permission is missing.

For individually cleared test editions, set `VITE_LOCAL_DAILY_COVER_IDS` to a
comma-separated list of storefront-qualified album IDs before starting Vite.
Only albums in the current rotation are looked up. Production builds ignore
this setting; public covers require a separate addition to the reviewed
allowlist in `dailyPickCatalog.ts`.

For artist portraits, prefer directly licensed press images or individually
reviewed Wikimedia Commons files. Check the specific file license and any
attribution or other restrictions before adding a local asset and registering
it in `approvedDailyArtistPhotos`. No portraits are currently approved.
