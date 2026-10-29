# Future progression and recommendations (proposal only)

No feature in this proposal is implemented by the lifecycle repair.

## Existing foundation

`badges.ts` already contains Skill, Artist Mastery, Daily Streak, Winning Streak,
Arena 1v1, Arena Lobby, Party, and Championship families. Multiplayer stats include
wins, clean sheets, comeback/dominant wins, response times, and winning streaks.
Use these canonical records rather than a parallel achievement counter.

`dailyGoals.ts` currently derives goals from lifetime history, not a calendar
window. Its "Beat Your Album Best" foundation checks repeat plays rather than
actual improvement. Resolve those semantics before adding weekly rewards. Keep
daily attendance and consecutive multiplayer wins as distinct streak families.

## Smallest safe sequence

1. Audit existing badge requirements against authoritative results. Add tiered
   progression only where it rewards a meaningfully different accomplishment,
   not another copy of First Blood, Rival, Clean Sheet, or Quick Draw.
2. Add calendar-scoped, opt-in weekly challenges using explicit UTC boundaries,
   a versioned definition, and immutable result identity. Prefer participation,
   genuine personal-best improvement, and artist variety over raw win farming.
   Guests get temporary progress only. Do not add rewards until server-validated
   completion and idempotency are in place.
3. Build deterministic Solo recommendation candidates from artists/albums already
   played: unfinished mastery, a real personal-best opportunity, another known
   album by a favorite stable artist ID, plus one diverse discovery candidate.
4. Rank locally or server-side with a transparent weighted formula using recency,
   past accuracy, repeat fatigue, and catalog preview availability. Show short
   reasons such as "Continue mastering this artist"; never imply AI is involved.
5. For shared lobby recommendations, aggregate members' opt-in artist preferences,
   score broad overlap rather than only the host's favorites, penalize recent
   repeats, and let the host choose. Freeze only the final album through the
   existing trusted preparation pipeline. Never expose another player's private
   history or rely on guest preferences persisting across sessions.

## Cost, privacy, and testing

No paid AI or recommendation API is necessary. Reuse existing catalog searches,
permitted metadata caching, and bounded candidate lists; do not preload audio
for recommendation cards. Store stable catalog identifiers rather than guessing
artist identity from accent-folded names. Existing music licensing exposure still
requires independent resolution before expanding music uses.

Test cold-start accounts, guests, one-player dominance, disjoint artist tastes,
missing catalog records/previews, weekly boundaries, duplicate result delivery,
and untrusted result manipulation. First ship suggestions without rewards or
global ranking effects, then evaluate real usage before adding challenges.
