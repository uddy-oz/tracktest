# StanZer

**Prove you're a superfan.**

[Open the live app](https://tracktest-xwee.vercel.app)

StanZer is a competitive album quiz game. Players identify songs from five second previews, earn speed-based points, build a badge collection, climb public rankings, and compete in synchronized multiplayer rooms.

## Features

- Smart artist and album search backed by the iTunes Search and Lookup APIs
- Dynamic solo quizzes with a three-second start countdown and ten-second answers
- Speed scoring, streak feedback, perfect runs, achievement badges, and player tiers
- Local guest stats plus Supabase-backed accounts, profiles, progression, and featured badges
- Public profiles and Global Arena leaderboards
- Synchronized Duel, Group Lobby, and host-audio-only Party Mode
- Public rooms, private invite links and codes, rematches, reconnect recovery, leaving, and forfeits
- Responsive dark game interface for desktop and mobile

## Game Modes

- **Single Player:** Master an album, improve personal records, and unlock achievements.
- **Duel:** Two players receive the same questions, choices, clips, and shared start time.
- **Group Lobby:** Three to ten players compete against a live room leaderboard.
- **Party Mode:** One host device plays the music while everyone else answers on their own device.
- **Championship:** Presented in the interface as a future mode; tournament gameplay is not implemented yet.

## Architecture

StanZer is a React 19 and TypeScript application built with Vite.

- `src/App.tsx` owns the lightweight route/view state and session-level progression refreshes.
- `src/Components` contains the Home, Single Player, Multiplayer, profile, leaderboard, badge, and authentication interfaces.
- `src/lib` contains iTunes access, Supabase clients, Arena room operations, local/cloud stats, profile helpers, badge rules, sounds, and player identity calculations.
- `api` contains the Vercel serverless proxies used for production iTunes requests.
- `supabase` contains the base schema and additive SQL migrations for profiles, stats, leaderboards, Arena rooms, RLS, room lifecycle, multiplayer progression, and Party Mode.
- `localStorage` remains the guest fallback; authenticated progression uses Supabase as the cross-device source of truth.

No service-role key is used by the browser. Supabase Row Level Security and security-definer RPCs constrain room membership, host actions, answers, and progression writes.

## Multiplayer Synchronization

The host generates one quiz question set when a room starts. That set, including answer choices, correct answers, clip offsets, and room start data, is stored with the Arena room so every client renders the same game.

Duel and Group Lobby use shared timestamps plus persisted per-player progress. Clients refresh room state and subscribe to relevant Supabase changes; final placement is resolved from score, accuracy, and average answer time.

Party Mode uses a server-authoritative question state machine implemented by Supabase RPCs:

1. The server records the current question index and the countdown, answer, and reveal boundaries.
2. Clients estimate server-clock offset and render from those shared timestamps.
3. Only the authenticated room host can publish audio state or skip unavailable audio.
4. Non-host clients never call the clip playback path; they only receive the shared timer, choices, feedback, and leaderboard.
5. Answers are accepted once per player and question through a unique server-side answer ledger. Scoring and duplicate rejection are authoritative.
6. Any room member may request a safe timeline sync at a phase boundary, so one slow or backgrounded client cannot pause the room.
7. Stale asynchronous room refreshes and audio promises are ignored client-side, preventing an older request from rolling the UI back or affecting the next question.

## Setup

### Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- A Vercel account only if deploying the included production API proxies

### Install

```bash
git clone https://github.com/uddy-oz/tracktest.git
cd tracktest
npm install
```

Create `.env.local` with the public Supabase project values:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Optional legacy/integration helpers also recognize these names when those paths are enabled:

```env
VITE_SPOTIFY_CLIENT_ID=your-client-id
VITE_SPOTIFY_REDIRECT_URI=your-callback-url
VITE_YOUTUBE_API_KEY=your-api-key
```

Never place a Supabase service-role key or another private secret in a `VITE_` variable.

### Database

Run `supabase/tracktest_arena_stats.sql` for the base stats schema, then apply the dated SQL migrations in dependency order. The latest Party Mode implementation requires:

- `supabase/20260721_party_host_audio_authority.sql`
- `supabase/20260721_unified_progression_and_multiplayer_badges.sql`
- `supabase/20260722_party_authoritative_timeline.sql`

All migrations are additive and should be reviewed against the target Supabase project before execution.

### Development

```bash
npm run dev
```

### Production Build

```bash
npm.cmd run build
```

## Testing

There is currently no automated end-to-end multiplayer suite, so release verification combines TypeScript/Vite compilation with a multi-device manual matrix.

1. Run `npm.cmd run build`.
2. Verify album and exact-title searches, album selection, Solo scoring, audio fallback, result saving, and restart.
3. Open two authenticated sessions for Duel; test public/private join, synchronized questions, rematch, refresh recovery, leave, and forfeit.
4. Open at least three sessions for Group Lobby; confirm shared questions, live rankings, completion ordering, and room cleanup.
5. Open a Party room with one host and multiple players; confirm audio plays only on the host, all answer clocks match, duplicate answers are rejected, blocked host audio skips for everyone, and a backgrounded tab rejoins the current server phase.
6. Confirm cloud totals, ranks, badges, profiles, and Global Arena data refresh after completed games.
7. Repeat the active-game checks on a laptop and phone viewport.

## Current Limitations

- iTunes preview availability varies by album, track, and storefront region.
- Browser autoplay policies can still reject host playback; Party Mode provides one retry and then advances the authoritative timeline with a safe skipped question.
- Multiplayer depends on network access to Supabase. Server timestamps reduce drift, but UI updates are not frame-perfect on high-latency connections.
- Championship tournament gameplay is not implemented.
- The repository does not yet include automated browser or multi-client integration tests.
- The production bundle currently triggers Vite's advisory warning for a JavaScript chunk larger than 500 kB.

## Built with Codex and GPT-5.6

Codex was used throughout development as an engineering collaborator: inspecting the existing code before edits, implementing scoped React and TypeScript changes, drafting additive Supabase migrations and RLS policies, tracing cross-device state bugs, running production builds, and documenting manual verification. Changes were made incrementally so Solo play, authentication, local fallback, cloud progression, profiles, badges, leaderboards, and existing multiplayer modes could remain working while the product expanded.

In this final GPT-5.6 pass, Codex reviewed the Party Mode server timeline, host-only audio path, Realtime/polling refreshes, reconnect behavior, and async browser audio handling. It identified and fixed a production race where an older room request or delayed audio promise could update the interface after a newer authoritative state had arrived. The pass added monotonic room-refresh and question-run guards, then rebuilt the project and completed the submission documentation and licensing.

The product owner made the central product decisions: the StanZer identity and superfan positioning; five-second clips and ten-second answers; the scoring and reveal cadence; the distinction between Solo, Duel, Group Lobby, and Kahoot-style Party Mode; host-only Party audio; badge and rank goals; the dark purple visual direction; and the priority on laptop/phone testing with real accounts. Codex supported those decisions with implementation, review, and verification rather than choosing the product direction independently.

## License

StanZer is available under the [MIT License](LICENSE).
