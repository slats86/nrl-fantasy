# Live Round, Home Dashboard and Navigation Implementation

## Status

Approved for implementation. This specification supersedes conflicting dashboard, navigation, live-round and player-history details in earlier design documents while preserving their unrelated requirements.

The approved visual reference is `design/home-dashboard-navigation-approved.png`.

## Objective

Deliver one coherent release that:

1. fixes the missing live Match Centre component breakdown;
2. makes Classic, every Custom league and every Draft league use the same canonical current/live round;
3. restores every verified historical season in Player Game History;
4. verifies reliable team autosave and multi-device synchronisation;
5. standardises equivalent action labels;
6. replaces the Home and navigation structure with the approved design.

Do not implement these as isolated screen patches. Round selection, live statistics and freshness must be shared application services consumed consistently by all relevant screens.

## Non-negotiable safeguards

- Start from the latest fetched `origin/main`, not an old Windows checkout.
- Preserve all existing production users, sessions, leagues, memberships, teams, selections, picks, scores, Draft state and preferences.
- Use an isolated PostgreSQL database for every mutating test.
- Never use production writes for browser verification. Globally intercept and fail every non-GET/HEAD production request.
- Do not use season averages as substitutes for missing game statistics.
- Do not accept identity-ambiguous player history or statistics.
- Passive live refresh must never persist a team, lineup, pick or score.
- Do not weaken authentication, ownership checks, league isolation, lockout rules or concurrency protection.
- Retain every existing user-selectable colour theme.

## 1. Canonical round context

### Problem

Match Centre recognises live Round 20 while Classic, Custom and Draft still render Round 19 headers, prior-round `FINAL` scores and incorrect completed/live/to-play counts. This proves those screens select their round independently from stale persisted state.

### Required model

Create one server-authoritative `currentRoundContext` derived from the validated official rounds/fixtures feed and shared live cache. It must expose at least:

- `season`
- `currentRound`
- `liveRound`
- `lastCompletedRound`
- `state`: `pre_lockout`, `live`, `provisional_final` or `final`
- first lockout and next lockout timestamps
- games complete, live and to play
- source update timestamp, cache age and stale state
- verified fixtures and player appearances for the selected round

Selection rules:

1. Prefer the verified round containing a currently live fixture.
2. Otherwise use the verified current/upcoming scheduled round when its lockout window is current.
3. Use the maximum verified completed round only for last-result/history displays.
4. Never allow a stale saved team round, older cached payload, bye marker or incomplete response to move the application backwards.
5. An official correction may update the current context, but it must update all consumers atomically.

### Consumers

The exact same context must drive:

- Home round strip and competition rows;
- Classic header, live score panel, cards and score breakdown;
- every Custom league independently;
- every Draft league independently, including matchups;
- supported State of Origin/Custom-format views;
- Match Centre;
- player current-season form and game history.

Lineups and competition scoring remain league-scoped. Only round/fixture/live-stat truth is shared.

### Round transitions

Test and support:

- scheduled to lockout;
- lockout to live;
- live corrections;
- final game to provisional round final;
- confirmed round final to next scheduled round;
- byes, DNPs, zero scores and late inclusions;
- a second device opening with stale locally cached round data.

No screen may show Round 19 labels with Round 20 fixtures or scores.

## 2. Live team scoring in every competition

- Resolve each selected player against the canonical round fixtures and live player feed.
- Apply each competition's own rules for starters, bench, emergencies, auto-subs, captain, vice-captain and custom scoring.
- Show a visible provisional total when scoring is available.
- Show completed, playing now and to play counts based on verified Round 20 appearances, not the previous round.
- Cards must show `LIVE`, `TO PLAY`, `FINAL`, `DNP` or `BYE` only when verified for the canonical round.
- Do not display a previous-round score beneath a current-round label.
- Draft matchup totals and opponent state must update from the same canonical context.
- Two Custom and two Draft leagues must remain completely isolated while refreshing simultaneously.
- Preserve the user's open league, selected tab, expanded breakdown and scroll position across refreshes.

## 3. Match Centre live component breakdown

### Problem

The Match Centre receives an official live Fantasy total but its player modal reports that detailed components are pending, even when authorised official live match components are available.

### Required behaviour

- Ingest detailed live components through the existing authorised official data path and central live cache.
- Join by verified official match ID and verified player identity/ID, never name alone.
- Do not make one upstream request per modal open or per player.
- Reuse the bounded timeout, retry, validation, deduplication and stale-cache behaviour of the central live feed.
- Show stat count, scoring value/rule and points contribution grouped under useful categories such as scoring, running, defence, discipline and kicking.
- Include positive and negative contributions.
- Show `Provisional` and `Updated <time>` while live.
- Reconcile calculated component points to the displayed official Fantasy total.
- If the official total is newer than its component payload, show the real available components plus an explicit `Component reconciliation pending` difference. Never invent components and never fill gaps with season averages.
- Apply official Match Centre scoring in Match Centre. Competition-specific score breakdowns must use that league's own scoring configuration.
- Official corrections must replace earlier provisional values without double counting.

## 4. Player Game History seasons

### Problem

The season selector contains only 2026 for players with verified earlier seasons, and season positions can incorrectly show as unavailable.

### Required behaviour

- Build the season list from every verified game-history row associated with the resolved player identity.
- Include every season that has at least one verified game record, newest first.
- Default to the current season when available, otherwise the newest verified season.
- Selecting a season must update the complete game list and its summary: games, average, total points, high score, average minutes and positions played.
- Derive positions/roles from verified match records when supplied.
- Retain games with partially unavailable fields and mark only those fields unavailable.
- Preserve selected season during round expansion, profile interactions and responsive rerenders.
- Reject another player's records even when names are similar or a player changed club.
- Test players spanning multiple seasons, club changes, position changes, partial historical fields and current-season-only rookies.

## 5. Team autosave and multi-device behaviour

A separate Save Team button is not required. User team mutations must autosave through the authenticated server API.

Required UI states:

- `Saving...` immediately after a mutation;
- `Saved <time>` after the server confirms persistence;
- `Save failed - Retry` on failure;
- a leave/reload warning while a mutation is unresolved.

Required behaviour:

- Debounce only where it cannot lose intermediate user intent.
- Flush safely on visibility change/navigation where possible.
- Use versioning or equivalent stale-write protection so simultaneous devices cannot silently overwrite a newer server team.
- On conflict, fetch authoritative state and show a clear resolution/retry message.
- Refresh on a second device without losing the first device's confirmed changes.
- Team selection, trade, captain, vice-captain and lineup changes must persist; live polling must not produce autosave writes.
- Verify failure/retry, rapid sequential changes, reload immediately after change and two simultaneous authenticated browser contexts.

## 6. Action naming convention

Equivalent actions must use identical visible and accessible names.

- `View team`: open a Classic, Custom or Draft team.
- `Manage competitions`: open the competition management/directory area.
- `Show all competitions` / `Show fewer`: expand or collapse Home competition rows.
- `Open league`: only when opening a league overview rather than a team.
- `Manage team`: reserve for a genuinely distinct management-only action; do not use it when `View team` is the destination.

Audit the whole application for equivalent actions, including aria-labels, mobile labels and screen-reader names. Do not change labels whose outcomes are genuinely different.

## 7. Desktop navigation

Use exactly this primary order:

1. Home
2. Classic
3. Custom
4. Draft
5. Leagues
6. Match Centre
7. Players
8. Team News

Use one combined `Settings & Help` destination at the bottom of the sidebar.

Definitions:

- `Classic`: the user's official-style team.
- `Custom`: all Custom leagues, including State of Origin as a Custom competition format.
- `Draft`: all Draft leagues.
- `Leagues`: joined competitions, standings, invitations and create/join/discovery actions across formats.
- `Team News`: official weekly lists, late changes, injuries, suspensions, expected returns and named replacements with attribution/freshness.

State of Origin must no longer appear as a primary navigation item. Preserve its independent data, teams, picks, scores, memberships and permissions; fold it into Custom at the routing/presentation layer without destructive migration.

## 8. Mobile navigation

Permanent bottom navigation must contain exactly, in this order:

1. Home
2. Leagues
3. Match Centre
4. Players
5. Team News

Provide a prominent segmented selector for `Classic | Custom | Draft` at the top of the team/competition experience, matching the approved design. It may also be visible on Home as a quick context switch if it does not replace the Home title or round context.

Settings & Help belongs in the account/menu panel. Preserve notification access and authenticated account controls.

## 9. Home dashboard

Implement the approved visual reference faithfully across all existing themes.

Home must answer, in order:

1. What round is active and when is the next lockout?
2. What urgently needs the user to act?
3. How are all of the user's competitions tracking?
4. What official team/player news changed?
5. What fixtures are live or next?

### Round strip

Show canonical round, live/scheduled/final status, next lockout, games complete and a Match Centre deep link.

### Needs attention

Only urgent/actionable items belong here, for example:

- late withdrawal from a selected team;
- captain or vice-captain not playing;
- incomplete lineup near lockout;
- player locked in an invalid slot;
- Draft pick/waiver action deadline;
- save conflict or failure.

Informational news does not belong in alerts.

### My competitions

- Keep the compact row design.
- Show four priority rows initially with deterministic ordering and allow expansion.
- Show format, team/league name, state, provisional team total, completed/live/to-play counts and matchup/rank where relevant.
- Use `View team` consistently.
- Do not show individual player score lists; those belong in team screens and Match Centre.
- Handle duplicate league names using format/owner/code context without exposing confusing duplicate identities.

### Official team news

- Show Tuesday team lists, late changes, injury/return information and named replacements.
- Show source attribution and freshness.
- Support all-club and relevant-to-my-players filtering.
- Retain the existing Sydney-time Tuesday 4 pm refresh/scheduler and resilient ingestion requirements.

### This round

Show a concise fixture snapshot only. Do not recreate the full Match Centre.

### Removed content

Do not show redundant shortcut cards for Players, Injuries or Match Centre at the bottom. Those destinations already exist in desktop/mobile navigation. End the page cleanly after Team News and This Round.

## 10. Accessibility and responsive requirements

- Supported widths: 320, 375, 390, 768, 1024, 1440 and 1920 px.
- No horizontal page overflow at any supported width or 200% zoom.
- Minimum 44x44 CSS-pixel touch targets for interactive controls.
- Maintain logical keyboard order, visible focus, semantic buttons/links and accurate accessible names.
- Segmented controls must expose selected state.
- Live totals may announce meaningful changes politely, but polling must not repeatedly steal focus or spam screen readers.
- Honour reduced motion.
- Minimum readable body text and accessible contrast in every colour theme.

## 11. API, cache and failure behaviour

- Prefer one validated server endpoint or cohesive endpoint set for round context and live stats rather than duplicating client derivation.
- Include cache/freshness metadata in responses.
- Bound all upstream timeouts/retries and retain the last validated payload during temporary failure.
- Mark stale data visibly; never relabel stale Round 19 data as Round 20.
- Unknown/missing/ambiguous player joins must remain unavailable and observable rather than guessed.
- Log structured request IDs, round decisions, upstream freshness and reconciliation discrepancies without secrets or personal data.

## 12. Required test coverage

### Unit/API

- canonical round resolver precedence;
- stale saved round cannot override live verified round;
- corrections and transition ordering;
- player/match identity joins;
- component-total reconciliation;
- season enumeration and identity rejection;
- action-label mapping and deep-link targets;
- cache timeout, retry, stale and invalid-payload handling.

### Isolated PostgreSQL

- multiple Custom and Draft leagues remain isolated;
- round-scoped lineups/selections survive restart;
- autosave versions and concurrency conflicts;
- no migration loss or unintended modification of legacy Origin data;
- transactional rollback and idempotent migrations.

### Playwright

- authenticated Classic, two Custom and two Draft contexts;
- Round 19 stale local state while verified Round 20 is live;
- all team screens and Home switch to Round 20 together;
- live totals/components, corrections, DNP, bye, captain/vice and auto-sub behaviour;
- Draft matchup opponent totals;
- Match Centre live component modal with real rows and reconciliation state;
- Player Game History with at least two historical seasons;
- autosave saving/saved/error/conflict states across two browser contexts;
- exact desktop/mobile navigation and labels;
- Home content and absence of redundant shortcuts/player-score duplication;
- all themes and required widths;
- no console errors, broken links, bad reads, focus loss or overflow.

Run the complete existing regression suite, not only focused new tests.

## 13. Delivery and production verification

1. Update `PRODUCT_TEST_REPORT.md` with evidence and explicit exclusions.
2. Commit intentionally on a new branch from current main.
3. Push and open a protected PR.
4. Wait for required CI on the exact head commit and merge normally.
5. Confirm Railway serves the merge commit and `/health` plus PostgreSQL `/ready` pass.
6. Run the production monitor.
7. Perform read-only production verification at 1440x1000 and 390x844 with a global non-GET/HEAD interceptor.
8. During the live round, verify the same players/totals/components between Match Centre, Classic, Custom and Draft.
9. Verify historical seasons for multiple known veteran players.
10. Report any platform/upstream limitation separately from application defects.

No production user, league, team, pick, score, preference or database record may be modified during verification.

