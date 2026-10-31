# Badge Vault 2.0: final presentation pass

Branch: `codex/badge-vault-v2`. Local review only; nothing committed or deployed.

## Presentation changes

- Five distinct metallic tier palettes and frames: copper Bronze, cool Silver,
  warm Gold, icy Platinum, and violet/champagne Legendary.
- Locked cards retain recognizable tier color, visible emblems and progress.
  Coming Soon cards use a restrained dashed/etched treatment.
- Existing computed progress powers a Closest to Unlock prompt. It opens the
  existing details dialog; a chosen tracked goal takes priority. No prompt is
  shown for empty progress, and no award or predicted unlock date is invented.
- Clearer card hierarchy, state icons, tracked/collection-highlight accents.
  Collection highlights are not labeled as newly earned without evidence.
- The existing queued reveal has a tier chip, framed emblem and one brief sheen.
  Its timing, sound policy and duplicate protection are unchanged. Each queued
  badge restarts its own visual reveal; reduced motion suppresses animations.

## Scope and checks

Only BadgeCard, BadgeGrid, BadgeEarnedPopup, badge-vault.css and the dedicated
browser check changed in this pass, plus this report. Hash comparison confirmed
all existing files under src/lib, src/hooks, api and supabase remained identical.
No data, rules, identifiers, migrations, security or deployment settings changed.

- Production build including TypeScript: PASS.
- 21 non-database regression commands: PASS.
- Lint: zero errors; 35 existing ArenaPage/Quiz hook warnings.
- Existing Vault browser checks: 360, 390, 430, 768 and 1440px, both themes;
  contrast against semantic surfaces, no horizontal overflow, filters/search,
  keyboard dialogs, tracking and duplicate reveal protection: PASS.
- New presentation checks: next-target/details/track/untrack, five distinct
  tiers, bounded card content at 390/768/1440px, honest empty account: PASS.
- Actual local public profile screenshots include all 58 achievements and
  synthetic unlocked Legendary records. No production records were used.
- Reveal recordings exercise the real component in the labeled local fixture.

Screenshots and recordings are outside Git:
`%LOCALAPPDATA%/StanZer/ui-qa/badge-polish/`.
The local review profile remains `/profile/vault_rc_809e013e` on port 4183.

Physical-device, assistive-technology and production multiplayer tests were not
performed in this strictly presentational pass. Database integration rehearsals
were not repeated because the database and progression files did not change.
Tracking remains local per device, as in the approved release candidate.
