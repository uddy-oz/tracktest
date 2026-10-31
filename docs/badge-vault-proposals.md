# Next achievement proposals (not implemented)

Review alongside badge-vault-audit.md. No new IDs or unlock logic ship in this phase.
Historical = recomputable from retained trustworthy records, subject to pagination
and original data completeness; client-reported Solo is not verified evidence.

| Proposal | Family | Required evidence | Historical support |
|---|---|---|---|
| Second Wind | Personal improvement | same album later score >= previous personal best +20%, >=5 questions | Solo result sequence; client-trust limitation |
| Steady Climb | Personal improvement | three successive personal bests on same album | ordered results, same caveat |
| Range Finder | Artist exploration | ten distinct artists at >=80% quiz accuracy | result history, artist name ambiguity |
| Fresh Ears | Music discovery | complete first attempt at five albums at >=70% | ordered result history, album IDs preferable |
| Seasoned Listener | Musical mastery | ten albums >=80%, each played only once | history, client-trust limitation |
| Lobby Regular | Group participation | complete 20 eligible Group games, no wins required | eligible game_mode results |
| Social Circuit | Competition | complete eligible Duel, Group and Party matches | eligible game_mode results |
| Away Victory | Duel | win five eligible Duels when not host | was_host, eligible outcome |
| Bounce Back | Comebacks | eligible win immediately after three eligible losses | ordered canonical outcomes |
| Party Champion | Party | win five eligible Party games as non-host | eligible outcome, mode, was_host |
| Rivalry Settled | Rivalries | win rematch against same opponent after losing prior generation | NEW immutable opponent and generation event log; current players overwritten |
| Last Second Save | Comebacks | winning answer in final 500ms of server answer window | NEW persisted deadline/response evidence with round result |
| Crowd Favourite | Party | host five completed parties with five distinct participants each | NEW host completion + stable participant event snapshot |
| Passport | Music discovery | play artists from five catalog regions | NEW licensed provider metadata, stable artist ID and verified events |
| Precision Finish | Mastery | win final three scored rounds from tied state | NEW retained ordered verified round outcomes after rematch cleanup |
| Reunion | Group participation | complete games with ten distinct registered opponents | NEW immutable eligible participant snapshot; privacy minimization |

Do not award retroactively from mutable current room membership. Do not treat names
as stable artist/opponent identity. Any awards with rewards must use verified,
deduplicated events, reject guests and ineligible forfeits, and define tie semantics.

## Weekly mission rollout

1. Approve badge audit fixes and migration policy separately; keep 58 legacy IDs.
2. Define mission version, UTC window, qualifying modes and eligibility explicitly.
3. Add immutable server events and idempotent award ledger with unique source IDs.
4. Dry-run historical evidence; show unknown award dates honestly.
5. Test boundary/DST, repeated delivery, rematches, guest exclusion and collusion.
6. Launch opt-in weekly missions without currency/rank rewards first; measure usage.
