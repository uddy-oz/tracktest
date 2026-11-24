# StanZer product analytics

[StanZer Product Analytics dashboard](https://us.posthog.com/project/763557/dashboard/2404432)

The app uses PostHog's explicit capture endpoint rather than an SDK. No automatic pageviews,
replays, conversion pixels, or feature flag requests are sent. The project settings discard IP
addresses and disable web, web vitals, and recording autocapture. The event payload also opts out
of GeoIP enrichment and person profiles.

## Event contract

| Event | Trigger and counting unit |
| --- | --- |
| `visit` | After auth initializes, once per page boot. Unique counts are per browser installation, not per person. |
| `game_started`, `game_finished` | Solo prepared run and its terminal outcome, linked by an analytics-only random run ID; observed multiplayer participant state for a room/match generation. Starts distinguish first UTC play day from returning browsers. Some finishes are not observed if the browser closes. Deduplication is local, not a globally authoritative match count. |
| `room_created`, `room_joined`, `rematch` | Successful room operations, not button presses. Joining again does not count a duplicate on the same browser. |
| `daily_goal` | Completed goal or sweep observed by the signed-in player's Daily Goals panel, once per browser/account/UTC day. This does not award or change progress. |
| `score_share_opened`, `score_share_action` | Modal opened; Copy Link succeeded, a PNG download was initiated, or native share returned successfully. This does not measure message delivery. |
| `score_link_viewed` | Score link recognized on Single Player. New share links mark the session source for subsequent starts. |
| `audio_playback` | First-clip startup time and observed playback failures; Party measures the host device. Solo also measures time after the countdown. |

Campaign parameters are bucketed into a small approved vocabulary; unknown values become
`other`. No full URL, query string, referrer, username, account ID, score, room code, answer,
preview URL, or raw error text is transmitted. Catalog dimensions use validated public IDs.
Registered, guest and signed-out describe the current event, not distinct cross-device people.
Unmatched starts can indicate unobserved exits but are not independently verified abandonments.

## Local check and release gate

- The ignored `.env.analytics.local` holds only the public write-only project token and US
  ingest host. Never place a personal key or any Supabase credential in `VITE_POSTHOG_*`.
- `npm run dev -- --mode analytics --host 127.0.0.1` loads the local settings. Use an isolated
  Supabase endpoint or browser fixtures. With `VITE_ANALYTICS_LOCAL_TEST=true`, the app dispatches
  sanitized `stanzer:analytics-test` DOM events only on localhost, never HTTP requests to PostHog.
- The production transport requires both the exact production origin and
  `VITE_ENABLE_PRODUCT_ANALYTICS=true`. It is off until the visitor explicitly opts in through
  the Analytics privacy control. Declining or withdrawing has no gameplay effect; withdrawal
  stops future capture and clears the local analytics identifier, attribution and dedup state.
  The browser also honors
  DNT, Global Privacy Control, WebDriver exclusion, and `localStorage["stanzer.analytics.disabled"]="1"`.
  Administrators can mark a test account with trusted app metadata `analytics_excluded: true`
  before sign-in if approved; no production accounts have been changed.
- Before enabling: confirm retention and player disclosure, mark developer browsers and test
  accounts, and verify the live ingestion payload on designated test traffic. Check usage against
  the free allowance, especially if increasing the number of audio events. No paid plan is required.

## Score links

New links carry `album_id=itunes:<STOREFRONT>:<COLLECTION_ID>` and the existing title.
Look up that exact collection first; never auto-start playback. Old links, invalid IDs,
missing catalog results, or failed lookups fall back to the existing title search.
