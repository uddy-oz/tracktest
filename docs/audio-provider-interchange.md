# Interchangeable quiz audio

Share My Score is independent of the audio provider: it renders the StanZer wordmark and result into a PNG and links to Single Player with a prefilled album search. It does not include album artwork, clips, room codes, or challenge identifiers.

## Where the current provider is coupled

- Discovery already has a provider-neutral `CatalogAdapter` in `src/lib/catalog.ts`. The Apple Music catalog adapter is for discovery, not a playback integration.
- Solo in `src/Components/Quiz.tsx` loads tracks and resolves missing previews through the existing music lookup, then uses an HTML audio element and gates the answer clock on observed playback. Challenge replay feeds the same engine a stored clip URL; it does not have a separate player.
- Multiplayer's trusted server question assembly in `api/arena-question-set.js` resolves and filters Apple preview URLs. Room playback and readiness use those clips while server-controlled timing and scoring remain independent of discovery. Party Mode has host-only audio.
- The reviewed Shareable Challenges migration (`supabase/20261123_solo_shareable_challenges.sql`) stores and validates Apple preview URLs. A frontend adapter alone cannot make a second provider compatible with existing challenge creation. Do not modify that reviewed migration or reinterpret existing links.

## Incremental integration plan

1. Introduce a versioned clip reference with provider, stable clip ID, storefront or availability context, and a stable excerpt identifier. Wrap current URL-based data as the legacy variant; leave stored results and snapshots untouched.
2. Add a provider resolver on the server that validates references and issues permitted playback descriptors. Keep media credentials server-side; do not accept arbitrary client URLs. Discovery and playback should be separate contracts, since catalog access does not confer playback rights.
3. Keep the existing HTML audio transport for direct clips. Define a transport contract around prepare, gesture unlock, play, pause, seek, elapsed-time observation, and failure. A licensed SDK may not support all of these; certify Solo first and leave multiplayer disabled for that provider until offset, readiness, and cross-device synchronization tests pass.
4. When the provider is selected, review an additive persistence change for new references in Challenge and Arena. Preserve each challenge's exact excerpt and options, and use the same excerpt across multiplayer peers. If unavailable, fail safely rather than silently swapping tracks mid-question. Do not persist credential-bearing playback URLs or audio bytes.

No adapter, migration, or feature flag is changed in this release. Before integrating any new audio source, confirm rights for the specific gameplay modes, territories, devices, and use of excerpts; API access alone does not establish that permission.
