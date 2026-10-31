# Badge Vault 2.0 audit (2026-10-29)

This is the pre-change audit. For fixes and remaining limitations in the next
local-only implementation, see `achievement-permanence-design.md`.

## Scope and preservation contract

Source inspected: badges.ts, stats.ts/buildArenaProgress, cloudBadgeStats.ts,
dailyGoals.ts, featuredBadges.ts, ProfilePage, BadgeGrid/Card/EarnedPopup,
Quiz/Arena notification call sites, 20261007 progression/backfill SQL,
20261026 authority/question SQL, 20261027 lifecycle SQL and 20261031 lifecycle SQL.
This is a source audit, not a production-data audit. No production access or SQL
changes are part of this branch. All 58 IDs, unlock predicates, tier calculations,
cloud/local result handling and featured selections remain unchanged.

## Systemic findings

- HIGH: achievements are recalculated, not persisted awards. Current daily streak
  and leading perfect-run streak can reset and relock badges. Featured IDs remain
  stored, but current sanitization hides relocked selections. Do not delete IDs;
  plan a server award ledger and legacy reconciliation before changing predicates.
- HIGH: Solo results remain client-reported; localStorage is editable. Generic
  Skill/Mastery predicates aggregate all results, not only eligible competitive
  results. Multiplayer authority does not make those generic predicates tamper-proof.
- Multiplayer aggregates require competitiveProgressionEligible. Server SQL derives
  eligibility from canonical completed rooms/members, rejects guests, and preserves
  immutable historical rematch identity. Unique room/generation/user result identity
  prevents duplicate delivery, not collusion or repeated legitimate win farming.
- Cloud quiz_results query has no pagination; PostgREST's configured row cap can
  omit older achievements. Recent .find() dates are qualifying observations, not
  reliable first unlock dates. Vault deliberately shows no fabricated award dates.
- Daily goals are lifetime, not daily: five perfect runs need not be five albums;
  fast perfect uses lifetime results; beat-best only checks timesPlayed >= 2.
  Arena/Championship goals are hardcoded zero. Leave logic unchanged pending a
  calendar/event design. Timezone/DST and cross-device day boundaries need policy.
- Guest profile remains Create Account only; guests do not get tracking preferences
  or persistent awards. Public profile tracking is read-only/unavailable.

## All 58 definitions

Obtainable = supported by current predicates/data, not a guarantee of historical
availability or resistant to forged Solo data. S = shared Solo/client-trust risk
above; M = canonical multiplayer, but repeat-match/collusion farming remains.
No ID below is removed or reinterpreted by this implementation.

| ID | Current source / exact condition | Obtainable / accuracy / overlap / risk |
|---|---|---|
| first-track | >=1 Single Player or legacy mode-less result | Yes; counts retained history; S |
| perfect-run | any result accuracy ===100 | Yes; same outcome as Flawless Album; S |
| flawless-album | album bestAccuracy >=100 | Yes; overlaps Perfect Run; S |
| quick-hands | any accuracy >=80 and avg <=3s | Yes; progress formula ignores accuracy and shows full on empty history; S |
| speed-demon | any accuracy >=90 and avg <=2s | Yes; same misleading partial progress; stricter Quick Hands; S |
| accuracy-specialist | best result accuracy >=90 | Yes; S |
| perfect-five | >=5 results accuracy ===100 | Yes; repeated album allowed; S |
| album-scholar | >=5 album records bestAccuracy >=100 | Yes; name-keyed versions may count separately; S |
| untouchable | leading recent perfect-result streak >=3 | Yes but relocks after loss; order dependent, not best historical streak; S |
| album-demon | max album timesPlayed >=3 | Yes; replay count, no score improvement required; S |
| replay-king | max album timesPlayed >=5 | Yes; tiered repeat of Album Demon; S |
| album-collector | >=10 album keys | Yes; title/artist keys not catalog IDs; S |
| fifty-questions | overall totalQuestionsAnswered >=50 | Yes; total questions includes unanswered timeouts; S |
| hundred-question-club | same >=100 | Yes; intentional tier ladder; S |
| five-hundred-questions | same >=500 | Yes; same ladder; S |
| one-thousand-questions | same >=1000 | Yes; same ladder; S |
| artist-master | one artist >=3 quizzes AND accuracy >=85 | Yes; progress can exceed target while accuracy fails; S |
| discography-demon | >=5 artist keys | Yes; EXACT duplicate of Five Artist Club at different tier; S |
| deep-discography | >=3 album keys sharing lowercased artist name | Yes; names can collide; S |
| five-artist-club | >=5 artist keys | Yes; duplicate of Discography Demon; S |
| ten-artist-club | >=10 artist keys | Yes; intentional ladder; S |
| album-specialist | same album >=5 plays AND bestAccuracy >=85 | Yes; progress uses max plays without accuracy condition; S |
| three-day-listener | current daily streak >=3 | Yes; relocks when streak expires; S |
| seven-day-locked-in | same >=7 | Yes; intentional ladder; same reset risk; S |
| thirty-day-arena-regular | same >=30 | Yes; intentional ladder; same reset risk; S |
| fourteen-day-music-run | same >=14 | Yes; intentional ladder; same reset risk; S |
| hundred-day-legend | same >=100 | Yes; intentional ladder; same reset risk; S |
| first-blood | arena wins >=1 | Yes; overlaps mode-specific first win; M |
| rival | wins >=5 | Yes; win ladder; M |
| contender | wins >=10 | Yes; win ladder; M |
| arena-veteran | wins >=25 | Yes; win ladder; M |
| arena-legend | wins >=50 | Yes; win ladder; M |
| clean-sheet | cleanSheets >=1 | Yes; not restricted to Duel despite category; M |
| lockdown | cleanSheets >=5 | Yes; ladder; M |
| multiplayer-untouchable | cleanSheets >=10 | Yes; distinct ID from perfect-streak Untouchable; M |
| hot-hand | bestWinStreak >=3 | Yes; EXACT same predicate as Three Peat; M |
| on-fire-multiplayer | bestWinStreak >=5 | Yes; EXACT same predicate as Arena Dynasty; M |
| unstoppable | bestWinStreak >=10 | Yes; win-streak ladder; M |
| quick-draw | qualifying match fastest winning time >0 and <2s | Yes; server round clock; count is matches, not rounds; M |
| lightning | same <1s | Yes; strict boundary, excludes exactly 1s; M |
| photo-finish | winner scoreMargin ===1 | Yes; any eligible mode despite 1v1 category; overlaps Close Call in round scoring; M |
| comeback | comebackWins >=1 | Yes; server trailing >=2 flag; M |
| dominant | dominantWins >=1 | Yes; server >=75% scored rounds flag; M |
| back-to-back-champion | bestWinStreak >=2 | Yes; description implies lobby/championship but includes Duel/Party; M |
| three-peat | bestWinStreak >=3 | Yes; exact duplicate Hot Hand; same description mismatch; M |
| arena-dynasty | bestWinStreak >=5 | Yes; exact duplicate On Fire; same mismatch; M |
| first-1v1-win | duelWins >=1 | Yes; M |
| close-call | Duel win margin 1 round, legacy >0 and <=500 points | Yes; overlaps Photo Finish, legacy branch differs; M |
| dominant-duel | Duel wins with dominantWin flag | Yes; subset of Dominant; M |
| first-lobby-win | Group Lobby wins >=1 | Yes; M |
| lobby-sweeper | Group Lobby win playerCount >=10 | Yes with full lobby; no distinct perfect-answer requirement; M |
| party-starter | eligible Party results wasHost count >=1 | Unavailable in current flow: sync_arena_progression_for_room in 20260916 excludes the Party host from candidates; no replacement host completion event. Existing legacy unlock retained; M |
| room-controller | max playerCount across eligible Party results >=10 | Yes; does NOT require wasHost, so participant can unlock. Counts participants excluding host; Party capacity is 30; M |
| private-challenger | eligible private games >=1 | Yes; M |
| open-arena | eligible public games >=1 | Yes; M |
| championship-winner | championshipWins >=1 | Unavailable: no playable Championship; mapping exists, legacy values retained |
| clutch-player | NO progressById mapping | Unavailable: always zero, no event/aggregate; no Championship mode |
| comeback-king | NO progressById mapping | Unavailable: always zero, no event/aggregate; no Championship mode |

## First implementation decisions

Display-only adapter marks all three Championship definitions coming soon and
Party Starter unavailable until verified host events exist, while
preserving any previously unlocked value. Progress bars never call a locked badge
complete (composite conditions get explicit text). Date field says not recorded.
No unlock requirements, stats, awards, rank formulas or daily goals are changed.
Tracking uses a separate per-user local key; does not write profile data.

## Research and dependency decision

- [Trophy UI](https://ui.trophy.so/) / [source](https://github.com/trophyso/ui):
  collection/progress hierarchy inspiration only. No copied source, artwork,
  Tailwind/shadcn dependencies or Trophy backend/service integration.
- [Motion](https://motion.dev/) is unnecessary for this bounded reveal; use CSS
  opacity/transform, reduced motion and existing queue/sound instead of a new runtime.
- [canvas-confetti](https://github.com/catdad/canvas-confetti) is ISC; no installation
  or confetti canvas needed. Keep celebrations small and avoid gameplay interference.
- [Lucide license](https://lucide.dev/license): ISC (Feather-derived icons MIT).
  lucide-react 1.63.0 explicitly supports React 19. Only named imports; package
  retains its license. No remote icon assets or proprietary artwork.
- [Google achievements](https://developer.android.com/games/pgs/achievements) and
  [Steamworks](https://partner.steamgames.com/doc/features/achievements): inspiration
  for locked/unlocked states, incremental progress and stable IDs. No platform
  SDKs, invented rarity percentages or fabricated unlock dates.

## Next: reliable awards and weekly missions

Review duplicate/misdescribed requirements with product owner first. Add versioned
server-owned award records keyed (user, badge ID, version) with immutable awarded_at,
source result identity and evidence. Backfill only provable historical thresholds;
mark uncertain legacy dates unknown. Preserve all legacy IDs/featured references.
Calendar missions need explicit UTC windows (or chosen user timezone), definitions
frozen per window, result deduplication and server-verified personal-best deltas.
Exclude guests and ineligible/cancelled matches; rate-limit collusive repeat pairs.
Do not add XP/rank rewards until idempotency and abuse tests pass.
