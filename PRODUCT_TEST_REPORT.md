# Product test report

Date: 15 July 2026
Branches: `agent/round19-live-data-pipeline`, production-verification follow-ups, `agent/player-stats-approved-design`, `agent/team-news-hub`, `agent/players-hub-approved`, `agent/player-game-history`, and `agent/complete-players-hub`

## Live My Team scoring delta (16 July 2026)

The confirmed My Team inconsistency was an application defect: team cards always selected `current round - 1` and stored lineup history while Match Centre selected the verified in-memory live feed. A single canonical selector now distinguishes verified `LIVE` (including a genuine zero), `FINAL`, `YET TO PLAY`, `BYE`, `DNP` and retained `STALE` values. Match Centre, Classic, every Custom league, every completed Draft league and the supported Origin team view consume that selector. No scheduler, ingestion, membership, lineup, Draft, preference or production-data write path changed.

Every team screen now places an accessible provisional-score panel directly below its competition heading. It reports completed/playing/to-play counts, freshness and stale/reconciliation state, and an expandable contribution breakdown. Player cards retain raw points while the total independently applies the explicit league's captain multiplier, vice-captain DNP fallback, bench scoring, position-eligible emergencies and existing active chip rules. The compact mobile panel is sticky without covering cards or navigation; the central poll refresh preserves scroll and an open breakdown and does not save live-derived state.

Pre-publication verification:

- Focused deterministic Playwright: 5/5 scenarios passed, including Match Centre parity, scheduled versus live zero, captain/vice fallback, bench/emergency rules, corrections, stale/final lifecycle, passive no-write behavior, mobile stickiness and Classic/two Custom/two Draft isolation.
- `npm run check`: 51/51 applicable static, unit and API tests passed; the isolated PostgreSQL case was the only intentional generic-run skip.
- Isolated PostgreSQL 18 `nrl_fantasy_test`: 1/1 migration, transaction, concurrency and restart-persistence integration test passed.
- Complete Playwright regression suite: 48/48 passed at the release head across the existing desktop, mobile, accessibility, multi-device and product-flow matrix.

Protected CI initially exposed a moving-upstream fixture assumption in the existing Match Centre test: Round 20 was marked scheduled only at round level while its real, now-live match statuses remained active, so the generic selector correctly chose Round 20 instead of the synthetic Round 19. The fixture now normalizes match statuses before activating its target round; the exact affected scenario passed locally before the PR rerun. This was a test-contract correction, not an application defect.

No upstream-data defect or new legal/licensing concern was found during implementation. Live values remain dependent on the existing upstream feed and are labelled stale rather than replaced when refresh fails. Production verification is constrained to GET/HEAD with a global browser request guard and browser-local response interception; it does not authenticate as, read, or modify a real production user.

## Compact My competitions UI delta (16 July 2026)

The approved `design/COMPETITIONS_SECTION_REDESIGN.md` and `design/competitions-section-approved.png` were imported unchanged. Only the Home `My competitions` presentation changed: the oversized tiled grid is now one compact, semantic full-width list with four initially visible rows, a competition-count chip, quiet Manage link, hidden-count footer, `Show all N`/`Show fewer` control and stacked mobile rows. Existing Home APIs, server-authoritative membership model, alerts, Team News, polling, scheduler, ingestion and persistence code were not modified.

Rows retain explicit competition, team and league IDs and derive action-required, Draft-turn, live/matchup, ready, scheduled, final/season-complete, stale and partial-data presentations from the existing summary. Missing concepts are omitted rather than rendered as `—`, `Awaiting lockout` or `No matchup`. Stable client presentation ordering keeps unresolved actions visible in the initial four. Buttons name the exact league/team destination, and expansion exposes `aria-expanded`/`aria-controls` without adding requests or polling.

Verification before publication:

- `npm run check`: 51/51 applicable static, unit and API tests passed; the separately gated PostgreSQL case was the only skip.
- Isolated PostgreSQL 18 `nrl_fantasy_test`: 1/1 migration, transaction, persistence and concurrency test passed.
- Focused Home Playwright: 6/6 passed, covering six competitions as four initial rows, expansion/collapse, action priority, duplicate display names, actual Classic/two Custom/two Draft/Origin deep-link calls, every required visual state, alerts/news isolation, all four themes, reduced motion, keyboard semantics, 200% zoom, 44px mobile targets and zero overflow at 320, 375, 390, 768, 1024, 1440 and 1920px.
- Definitive complete Playwright suite against a freshly reset isolated PostgreSQL schema: 43/43 passed in 7.1 minutes. An earlier run exposed a pre-existing test race in which a prior device's queued 700 ms save could advance the mock version after deliberate stale/current contexts loaded. The test now lets that queue settle before taking the two snapshots; the application multi-device behavior was not changed, and the focused scenario plus complete suite passed.

No critical or high application defect was found in this presentation-only change. No upstream-data or legal/licensing behavior changed. Railway/GitHub provider limitations and the deliberate exclusions from the PR #67/#68 audit remain applicable.

Protected delivery and production verification: PR #71 passed the required CI twice—first on feature commit `e7b35ed`, then on exact up-to-date head `9d50c59` after protected `main` received concurrent bot data refreshes—and merged as `b3bef4b`. Railway process uptime reset on handover, `/ready` reported PostgreSQL and the production monitor passed health, readiness and application-shell GETs. A global browser route guard rejected every non-GET/HEAD method before network dispatch. At 1440×1000 and 390×844, the deployed UI showed four initial rows with both action-required competitions visible, expanded to all six, exposed the correct accessible expansion state, omitted legacy filler and had zero browser errors or horizontal overflow. Browser-local identity/read responses exercised the deployed presentation without reading or modifying a real production account, league, team, pick, score, preference or database record.

## Home command centre release delta from PR #66 / `a1653d1` (15 July 2026)

### Delivered scope

Home is now a server-authoritative cross-competition command centre. Its global Sydney-time round header, independently resilient urgent-alert queue, and deterministic competition grid cover Classic plus every membership-derived Custom, Draft and Origin team without accepting user-supplied league IDs. Cards retain league-specific score, rank, matchup, Draft-turn, freshness and deep-link state; the duplicated Classic player-by-player live panel is removed. Team News is a distinct, cursor-paginated feed ordered by My players, Watchlist, represented clubs and league-wide relevance, with attribution, confirmation and freshness states. User-scoped Home responses are authenticated and private/no-store; the public status route exposes coverage without internal source failures.

Automatic ingestion now uses a frequent UTC workflow with an `Australia/Sydney` guard: five-minute checks from Tuesday 15:55–16:30, fifteen-minute checks through 18:00 when incomplete, and early exit once fixture-aware expected-club coverage is valid. Schema-v2 snapshots record attempt/success, source version/hash, expected/received clubs and validation errors. Invalid, partial, empty and older candidates preserve the verified snapshot; publication is atomic and unchanged content is idempotent.

### Defects found and fixed

| Severity | Finding | Resolution and regression coverage |
|---|---|---|
| High | Identical Team News fetches produced different hashes because volatile per-fetch `checkedAt` fields were included, defeating idempotency and risking duplicate publication work. | Hashing now excludes retrieval-only metadata recursively. A live changed publication followed by an identical authorised-source fetch returned `changed:false`; unit coverage varies top-level and nested retrieval times. |
| High | A rapid first-login appearance save could race the debounced cloud write, so reload on another device could reopen onboarding. | Onboarding completion now queues its authoritative cloud save immediately. The complete multi-device browser suite covers persistence and stale/concurrent edits. |
| Test contract | Round 20/schema-v2 ingestion exposed two assertions hardcoded to Round 19/schema v1. | Assertions now validate current/previous-round bounds, schema-v2 hash and complete expected/received club coverage. |

### Verification before publication

- `npm run check`: 51/51 applicable static, unit and API tests passed; the separately gated PostgreSQL test was the only skip.
- Isolated PostgreSQL 18 database `nrl_fantasy_test`: 1/1 integration test passed after a disposable-schema reset, including migration, transactional persistence, rollback, compare-and-swap and restart behavior.
- Complete Playwright suite against a second clean isolated PostgreSQL schema: 41/41 passed in 4.9 minutes. New coverage includes Classic plus two Custom and two Draft cards, owned/joined membership, score/matchup/Draft isolation, stale-device and disjoint concurrent edits, widget failure isolation, alerts/news separation, acknowledgement/dismissal, all four themes, keyboard/status semantics, 200% zoom, reduced motion, 44px mobile targets and zero overflow at 320, 375, 390, 768, 1024, 1440 and 1920px.
- Focused ingestion audit: live authorised NRL Round 20 import validated 16/16 expected clubs with zero source or validation failures; the immediate repeat was unchanged. Deterministic AEST/AEDT boundary tests passed. Round pipeline remained Round 19 complete with seven finals and 238/238 non-zero scorers. `npm audit --omit=dev` reported zero vulnerabilities.

### Separation of findings and deliberate limits

- Application defects: the two confirmed high defects above were fixed with regression coverage. No unresolved critical or high application defect remains before publication.
- Upstream data: the authorised NRL source supplied 15 Round 19/20 matches, 93 availability records and one suspension at verification time. Source completeness and timestamps remain externally controlled; invalid/partial/outage states now preserve the last verified snapshot and surface operational status.
- Legal/licensing: only concise factual records and links from the existing authorised NRL sources are stored/displayed; no private, premium or full-article content was accessed or reproduced. Formal rights review remains outside this engineering audit.
- Railway/GitHub limitations: protected checks, merge, Railway handover and served health can be observed but provider policy and interruption-free edge routing cannot be independently guaranteed.
- Protected delivery and production: PR #67 passed the required `test` check on exact head `39929b4` (51 applicable static/unit/API tests, isolated PostgreSQL integration and 41 browser tests) and merged as `550d040`. Railway process uptime reset on handover; `/ready` returned `{ok:true,storage:"postgresql"}` and the production monitor passed health, readiness and application-shell GETs. Public Team News status returned Round 20 source version, 16/16 club coverage and zero validation errors; HEAD returned safe public caching and an empty body.
- Strictly read-only production UI verification passed at 1440×1000 and 390×844. A global route interceptor rejected every method other than GET/HEAD before network dispatch; browser-local identity and Home read responses exercised the deployed UI without a production account. Five isolated Classic/Custom/Draft cards rendered, urgent alerts remained distinct from attributed Team News, freshness was visible, and both layouts had zero overflow or browser errors. No production identity, database, account, league, team, pick, score or preference was read or modified.
- Unsafe/unfinished checks: no production mutation, physical-device test, destructive restore, real email delivery, production scheduler invocation or provider database inspection was attempted. Scheduled ingestion was verified deterministically and through live authorised reads locally; the next GitHub cron/Railway execution remains platform-timed monitoring evidence rather than a safe on-demand production mutation.

## Full product audit of current main (15 July 2026)

### Scope and audit-contract limitation

Commit `19420ae` on `origin/main` was audited after the Players Hub, season-aware Game History and multiple Custom/Draft league merges. The requested `design/FULL_PRODUCT_AUDIT.md` is absent from the current tree, every fetched remote branch and repository history. The executable contract used instead was `design/PLAYERS_HUB_IMPLEMENTATION.md`, `design/MULTI_LEAGUE_IMPLEMENTATION.md`, the existing product report, CI workflow and all repository test/audit scripts. This missing source document is an explicitly unfinished documentation input; no requirement from the two present implementation specifications was omitted.

No confirmed critical or high application defect was found in this pass, so no application code or regression test was changed. Audit artifacts and this report were refreshed through the protected PR workflow. Existing visual baselines were preserved.

### Application verification

- `npm run check`: 47 executed static/unit/API tests passed; only the separately gated PostgreSQL case was skipped.
- Isolated PostgreSQL 18 database `nrl_fantasy_test`: 1/1 integration test passed. It reset only the explicitly test-named database and covered legacy JSON migration, two legacy Custom/Draft formats, shared membership and ownership ordering, league/team/draft relationships, retry-safe idempotence, transaction rollback, concurrent compare-and-swap and restart persistence.
- Complete Playwright suite against a clean `nrl_fantasy_test` PostgreSQL schema: 37/37 passed in 7.4 minutes. All mutating browser traffic was local and PostgreSQL-backed. A preliminary run correctly exposed test-fixture contamination from the migration seed (`owner@example.com`); after resetting only the disposable schema, the definitive complete run was green.
- Multi-league coverage passed for multiple independent Custom and Draft leagues, explicit switching, same-player cross-league independence, owner/member authorization, invitation validation, IDOR denial, stale same-league edits, simultaneous different-league edits, server-authoritative Draft turns, shared reload, migration and restart persistence. Desktop/mobile switchers and cards were overflow-free at 320, 375, 390, 768, 1024, 1440 and 1920 pixels.
- Players Hub and Game History coverage passed for all required widths, themes and strict 375/1440 visuals; search focus, combined filters/reset/sort, Watch, bounded three-player Compare, truthful injury distinctions, empty/stale states, profile/back restoration, current/2025 seasons, per-match positions/roles, summaries, missing details, mobile round navigation and readable expanded components.
- Round 19 pipeline summary/details passed: seven final fixtures, 238/238 scorers non-zero and 14/14 club detail samples with components. `npm audit --omit=dev` reported zero vulnerabilities.

### Read-only production verification

Production health, readiness and application-shell GET checks passed; `/ready` reported PostgreSQL storage. A global browser route guard aborted every production request not using GET or HEAD. Desktop 1440×1000 and mobile 390×844 then passed Players Hub, Nicholas Hynes 2026/2025 Game History, Custom and Draft league directories, Round 19 final state and horizontal-overflow/error checks. The guard intercepted two attempted `PUT /api/app-state` autosaves per viewport; none reached production. No production account, league, team, pick, score or preference was created, read through a real identity, or modified.

The complete production player audit checked 379/379 players successfully with zero unresolved identities, ambiguity, missing expected rounds, component gaps, upstream failures or effective failures. Updated evidence is in `reports/player-stats-production-audit.json` and `.md`.

### Separated findings and limitations

- Application defects: none confirmed at critical or high severity. No lower-severity regression failed a required gate.
- Upstream data: FootyStatistics current-season detail is stale for all 379 audited players. The authorised official NRL fallback supplied complete identity-safe current rows and components, so effective application results remained 379/379. This dependency still requires scheduled monitoring.
- Legal/licensing: no new source, scraper, data redistribution or licensing behavior was introduced or changed. Existing official NRL/FootyStatistics usage was functionally tested, but this engineering audit is not a legal opinion; formal rights review remains outside repository-verifiable scope.
- Railway/GitHub platform: Railway handover continuity and GitHub protected-branch enforcement are externally controlled. The audit can confirm CI, merge, deployment health/readiness and the served commit behavior, but cannot guarantee interruption-free Railway edge routing or independently prove provider policy beyond their reported state.
- Unsafe/unfinished checks: no production mutation, physical iOS/Android device test, real email-delivery test, destructive restore, production migration replay or production database inspection was attempted. Those checks remain deliberately excluded. The missing `design/FULL_PRODUCT_AUDIT.md` remains the only unavailable requested audit artifact.

## Approved Players Hub and Player Stats regressions (14 July 2026)

### Areas and exact scenarios tested

The Players destination now matches `design/players-hub-approved-concept.png`: desktop retains the established navigation rail and uses current-data summary cards, a wide search/compare row, All Players/Watchlist/Market Movers/Injuries views, combinable filters, sorting and a dense accessible results table. Mobile uses dedicated cards, horizontally scrollable views and quick filters, a full-height filter sheet with individually removable selected-filter chips, and a persistent comparison tray only after selection. Watch and Compare controls are independent from the keyboard-accessible player identity target, and comparison accepts two or three players while visibly enforcing the three-player limit. Market Movers defaults to price-change order and shows the actual current-versus-Round-1 movement without changing any pricing formula.

Every displayed value comes from the existing player, fixture, watchlist, named-team and authorised Team News sources. Break-even remains an honest unavailable value because no trusted feed field exists. The Injuries view and summary now count only records classified as injuries; rest, suspension and generic unavailability remain distinct player statuses and are not mislabelled as injuries. When the source is unavailable, the hub retains the last verified status information with a warning or displays an explicit unavailable state, and never fabricates, scrapes or infers injury facts.

Player profiles retain the form chart, fixtures, Watch/Compare and current Role & Minutes summary. Expanded Scoring, Running, Defence, Discipline and Kicking cards use 14px bold headings, 15px labels, 16px bold values, 1.45 line height, stronger contrast, larger padding and balanced wrapping (three-plus-two at normal desktop widths, two columns at constrained desktop widths and five only at very wide widths). Mobile accordions retain every supplied statistic with 48px category targets and the same 15px/16px label/value minimums.

The removed aggregate history table is replaced by one `Game history` section. Its accessible season selector defaults to 2026 and exposes every season for which verified match rows or round context are returned. The official feed remains authoritative for current-season rows; verified prior-year rows and round strips from the same dynamically resolved FootyStatistics identity are appended without admitting stale current-year records. Each selected season has its own games, average, total, high, average-minutes and positions summary. Desktop uses a contained readable table; mobile uses full-width round cards and the established full-screen breakdown. Round, date, opponent/home-away, position, starting/interchange role, minutes, price, break-even and Fantasy points are displayed only when the selected season supplies them. Bye, injury, suspension, rest and non-selection statuses remain distinct, and unknown reasons/details say `Not available` without borrowing current statistics or averages.

Playwright covers 320, 375, 390, 768, 1024, 1440 and 1920 pixels; punctuation-normalized multi-character search with focus retention; combined filters, individual chip removal and reset; every sorting path; Watch; bounded three-player comparison; profile/back query, view, filter, sort and scroll restoration; honest empty/stale states; 44px mobile targets; all selectable themes; current/previous season selection; multiple positions in one season; starting/interchange roles; selected-season summaries; preserved season state; distinct absence statuses; fantasy-only games with unavailable details; mobile/desktop equivalence; expanded-component typography and wrapping; real post-Round-14 components; no horizontal overflow; and unexpected console/page errors. Strict local and CI visual baselines cover the desktop hub, mobile cards, mobile filter sheet, mobile comparison tray, Player Stats at 375px/1440px and the mobile multi-season Game history viewport.

### Issues found, root cause and fix

| Severity | Issue and root cause | Fix applied | Regression coverage |
|---|---|---|---|
| High | The Players destination was a legacy split panel with Smart Picks above a wide table and no purpose-built mobile research flow. | Replaced it with one shared filtered/sorted view model rendered as an approved desktop hub and dedicated mobile cards/filter sheet/comparison tray. | Seven-width structural suite and strict 375px/1440px local/CI visuals. |
| High | The aggregate historical table could not provide truthful match-level opponent, role, price, break-even or component details, while the current fallback discarded verified prior-year rows when replacing stale current data. | Added an identity-safe additive merge: official current rows replace stale current rows, and only prior-year rows/round strips from the validated resolved identity are retained. Replaced the aggregate table with one season-selector Game history on desktop/mobile. | Pure merge regression plus multi-season, multi-position, role, summary, status, missing-detail, persistence and visual browser coverage. |
| Medium | At 1024px the wide Game history table's intrinsic width escaped into document-level horizontal overflow despite having a scroll wrapper. | Constrained the profile grid to `minmax(0,1fr)` and paint-contained the internal horizontal scrollport. | No-overflow assertions at all seven supported widths, including 1024px. |
| Medium | Expanded component cards used 8–10px typography and forced five narrow cards into one row. | Raised typography/line-height/contrast/padding and introduced balanced responsive spans with a connected selected-row border. | Computed font/line-height/contrast checks plus 1024px/1440px wrapping assertions. |
| Medium | The first hub renderer recomputed and resorted all 556 players for every result row, making mobile rerenders approach the interaction timeout. | Compute one immutable view model per render and share it across all desktop rows and mobile cards. | Filter, reset, Watch and Compare interactions complete within the full browser suite. |
| Medium | The steady-form filter compared `steady` with the model's `flat` value and could never return a result. Search also compared raw punctuation, so equivalent apostrophe/hyphen input could miss a player. | Normalized the display filter state and applied the existing punctuation-safe name normalization to player, club and position search. | Real steady-result and `fa asu`/`Fa'asuamaleaui` search regressions with retained input focus. |
| Medium | The Players Injuries view treated every availability record—including rest and suspension—as an injury, inflating the summary and losing the source distinction. | Split the authorised availability map from an injury-only map; preserved Rested and Suspended labels while limiting the Injuries tab/count to injury facts. | Mixed-source fixture assertion proves every injury result is classified as injury and non-injury availability remains excluded. |
| Medium | Mobile filters could only be reset together, Market Movers lacked price-change context, the three-player ceiling was invisible, and returning from a profile lost scroll position. | Added removable selected-filter chips, actual price deltas/default mover sorting, a visible maximum message, and complete session navigation-state restoration. | Mobile interaction/visual baselines plus query/filter/sort/view/scroll restoration coverage. |
| Medium | Added browser registration traffic exhausted the intentional authentication limiter before legacy responsive tests. | Players Hub UI tests use browser-local read-only session/app-state interception because they do not test persistence; real authentication and limiter tests remain unchanged. | Complete suite passes under the production-equivalent sensitive-route limits. |
| Medium | A delayed application-state rerender could reset in-progress Draft creation fields to defaults between typing and submission. | Draft name, team name, size and pick position now remain in transient UI state across rerenders and are cleared only after successful creation. | The complete Classic/Custom/Draft product flow retains `Audit Draft League` and passes in the full suite. |

Final local gates for the completed hub: `npm run check` passed 46 executed unit/API tests with the explicit PostgreSQL case intentionally skipped; the isolated PostgreSQL migration/persistence suite passed 1/1 against `nrl_fantasy_test`; and the complete Playwright suite passed 35/35 in 2.7 minutes. CI-mode Player Stats, mobile Game history, desktop/mobile Players Hub, mobile filter sheet and comparison tray visual checks passed 6/6. The PR #63 Game History structure, visuals and data tests remained green and its implementation was not modified. No scoring formula, player-ID resolution decision, upstream correction behavior or Match Centre polling code was changed, and no production user, team, league, pick, score or preference data was accessed or modified.

## Team News central hub (14 July 2026)

### Areas and exact scenarios tested

Team News is a primary desktop and mobile destination with Overview, Injuries, Team Lists, Changes & Replacements, Late Mail, and Suspensions & Returns views. The dashboard uses a compact personalised subset and an update count; relevance includes Classic and custom squads, league squads, watchlists, followed players/clubs, and status changes since the prior Team News visit.

The official-source importer was run against the live NRL Casualty Ward, Team Lists topic/current and preceding round pages, Late Mail, and 2026 Judiciary report. The verified snapshot contains 88 availability facts, 12 official match team sheets across Rounds 18–19, 12 final-team publication events, and the current match suspension. Of the 88 availability names, 81 match the application dataset exactly and four resolve safely through same-club first-name aliases (Seb/Sebastian, Mitch/Mitchell and Api/Apisai). Three official Casualty Ward names are not present in the current Fantasy player dataset and remain explicitly unresolved rather than being attached to a different player.

Desktop testing covers the full injury table, source metadata, search and every requested filter, round/match/list-version selection, current-versus-prior round comparison, complete reshuffle sequences, replacement comparison, follow actions, player-profile navigation and source links. At 320, 375, 390 and 768 pixels the table is replaced by expandable cards, controls scroll horizontally, bottom navigation remains visible and the page has no horizontal overflow. The same hub was exercised at 1024, 1440 and 1920 pixels and under Modern Lime, Electric Blue, Stadium Gold, Teal & Coral and Light Editorial.

Pure regression fixtures cover exact and alias identity, same-name players resolved by club, injury/suspension/rest/non-selection separation, return-round ranges, explicit confirmed replacements, derived direct replacements, uncertain multi-player reshuffles, Tuesday-to-24-hour-to-final history, conflicting reports, duplicate reports, multi-digit Late Mail round discovery, and upstream outage freshness. API coverage verifies JSON content type, ETag, no-cache policy, HEAD handling, source attribution, and structural completeness. Playwright checks keyboard-accessible tabs/cards, retained search focus, safe external links, player integration, dashboard personalisation, stale-source announcements, all target widths/themes, and unexpected browser errors.

### Issues found, root cause and fix

| Severity | Issue and root cause | Fix applied | Regression coverage |
|---|---|---|---|
| High | Availability was split between a hardcoded named-team string and user-maintained injury-chip flags, with no sourced central model. | Added a generated, source-attributed Team News domain, no-cache API, retained history, freshness state, hub UI and shared availability indicators. User fantasy preferences remain separate. | Unit parser/classifier tests, API structural tests and complete Team News Playwright suite. |
| High | A one-out/one-in diff was treated as a direct replacement even when other players moved positions. | A direct relationship now requires exactly two changes. Multi-step reshuffles retain the complete sequence, carry `possible` accuracy and have no asserted direct replacement. | Confirmed, derived and multi-player reshuffle fixtures. |
| High | Identity enrichment between fetches could look like a withdrawal and re-addition of the same player. | Roster comparisons use stable punctuation-normalized names within the known club roster; official IDs remain metadata, not diff identity. | Generated snapshot rejects self-replacement changes; alias/same-name fixtures. |
| Medium | Multi-digit Late Mail URLs were greedily parsed as Round 9 instead of Round 19. | Round extraction is now anchored to the complete `round-N` slug segment. | Explicit Round 19 link-discovery regression. |
| Medium | A failed source refresh could erase usable information. | Import failures retain the last verified committed snapshot; the browser retains its in-memory snapshot, marks it source-unavailable and substantially reduces hidden-page work. | Import fallback logic and stale-source browser scenario. |
| Medium | Browser search rerendered the directory on each keystroke and could lose focus. | The current selection is restored to the replacement input after render. | Search focus and apostrophe-name browser test. |
| Medium | Repeated UI-test registration/login traffic exhausted intentional sensitive-route limits. | Team News read-only tests use isolated local session/app-state routes and never weaken application rate limiting. | Complete suite under the real shared rate-limit configuration. |

The scheduled data workflow now adds `public/team-news.json` to its dedicated bot update and runs every 15 minutes during Tuesday’s team-list release window, every 10 minutes during active NRL match windows, and every four hours otherwise. Import requests have 12-second timeouts, three bounded attempts and identified user-agent headers. Successful no-change runs remain successful. Browser refresh is every five minutes while the Team News hub is visible, every 30 minutes elsewhere, paused while hidden, and immediate on return.

Remaining limitation: official NRL pages are the active production sources because they have the highest requested priority. The reconciliation model supports official-club and publication tiers and retains superseded conflicts, but supplementary club/publication crawlers are not enabled until a source is reviewed for stable structured facts and permitted automated access. The hub never fills an official gap with an unattributed or guessed report.

Final local gates: `npm run check` passed 45 tests with the isolated PostgreSQL case intentionally skipped in that command; the PostgreSQL integration test then passed separately against `nrl_fantasy_test`; and the complete Playwright suite passed all 23 tests in 5.0 minutes with no unexpected page/console errors. The live Team News import completed with zero upstream failures. No production account, league, team, pick, score or preference was read or modified.

## Approved Player Stats redesign (14 July 2026)

### Areas and scenarios tested

The supplied `design/player-stats-approved-concept.png` was treated as the visual authority. The player directory continues to use its existing search, club/position filters, sorting and comparison flow; selecting any player now opens a dedicated Player Stats screen rather than the oversized generic modal.

Desktop coverage verifies the compact identity/status/action header, six-metric strip, Score/Price/Minutes/PPM form chart, accessible round values, explicit BYE/DNP gaps, season reference line, role/minutes visual, real future opponents, and expandable grouped game rows. Mobile coverage verifies the Player Stats app bar, two-column metrics, persistent Watch/Compare actions, compact chart, horizontal recent-round strip, dedicated full-screen match breakdown, Back/Close/Escape behavior, bottom navigation, safe-area spacing and no horizontal overflow.

All seven required widths (320, 375, 390, 768, 1024, 1440 and 1920) are exercised. State coverage includes long real player names, multi-position eligibility, players with byes, non-playing rounds, complete match components, and a Fantasy score whose detailed components are genuinely unavailable. The unavailable state explicitly says that no averages were substituted. Electric Blue visual baselines are stored for 375px and 1440px; refreshed comparison captures are in `reports/player-stats-375.png`, `reports/player-stats-1440.png`, and `reports/player-stats-mobile-round-375.png`.

Every existing colour scheme remains driven by the shared theme tokens: Modern Lime, Electric Blue, Stadium Gold, Teal & Coral and Light Editorial. Availability remains the restrained lime status highlight while chart selections follow the chosen scheme. Watchlist changes still use the persisted application state, Compare uses the existing comparison flow, and detailed stats continue through the universal player-ID resolver and post-Round-14 data path.

### Issues found, root cause and fix

| Severity | Issue and root cause | Fix applied | Regression coverage |
|---|---|---|---|
| High | Player profiles were rendered inside one oversized generic modal, producing a cramped mobile spreadsheet and no structured desktop hierarchy. | Added one universal profile renderer with responsive overview, chart, role, fixtures, expandable game log and mobile round screen. | Structural and visual Playwright coverage at every supported width. |
| Medium | A stale or mismatched upstream stat row could appear as a game even when the player’s club had a bye. | Fixture identity and bye state now take precedence; impossible bye appearances are rejected and displayed as BYE gaps. | Bye chart/recent-round assertions and disabled non-game controls. |
| Medium | The existing global `.watch-btn` positioning rule pulled the new Watch action out of the profile header. | Scoped a static profile action override while retaining card-star behavior elsewhere. | Desktop/mobile screenshots plus persisted Watch keyboard interaction. |
| Medium | Returning from the mobile match breakdown preserved a deep scroll position, which could hide the compact profile header. | Restored the overview at the top and moved mobile Back/Player Stats/Close behavior into the app-level and round-level headers. | Escape/back assertions and 375px visual baseline. |
| Medium | Adding new disposable-account browser tests exceeded the application’s intentional registration rate limit during the older suite. | Reused one isolated authenticated test state and allowed the pre-existing 1440px test to log into its earlier disposable account when the registration ceiling is reached. Production rate limiting was not weakened. | Complete Playwright suite under the real rate-limit configuration. |
| Low | Visual baselines inherited the host operating system’s font rasterizer, producing different desktop text pixels between local Linux and GitHub’s Ubuntu image. | Maintain separate full, readable local/CI baselines selected explicitly by environment; production typography and the strict 1.2% pixel-difference tolerance remain unchanged. CI uploads failure evidence for review. | Local and CI 375px/1440px baselines. |
| Low | A cross-device test used a fixed delay only 400ms longer than the intentional cloud-save debounce, which could reload before a queued save completed on a busy CI runner. | Await the application’s real queued cloud-save promise after its debounce instead of increasing an arbitrary sleep. | Cross-device Classic/Custom persistence and concurrent conflict test. |
| Low | The password-reset test accepted the earlier welcome-email capture based only on its recipient, then sometimes inspected it before the reset email arrived. | Poll for the recipient and reset-token content together, proving the reset message itself is ready. | Complete registration/reset/session-revocation/account-deletion flow. |
| Low | The first CI visual artifact captured an async detailed-stat loading state, and its worker restart retried registration for the same disposable account. | Await the profile load with a stable visual-test detail response and reuse the disposable login after an expected duplicate registration. | Stable full-screen local/CI baselines after worker restarts. |

No real data was replaced by mock values in application code. Break-even remains present as a metric but shows an honest unavailable state because the current application feeds do not supply a trustworthy break-even value. Per-match position uses the player’s real eligible primary position because the current detailed feed does not provide a reliable game-specific position field.

## Round 19 live-data incident (13 July 2026)

### Root cause and pipeline evidence

The official NRL Fantasy feeds were current: Round 19 was `complete`, all seven final NRL scores were present, 238 players had non-zero Round 19 Fantasy scores, and the official per-player detail feed contained match components. The application and production API were stale after the first game: Round 19 remained `active`, six matches remained `scheduled` at 0-0, and player Round 19 scores were absent.

The scheduled **Fetch NRL Fantasy Data** workflow was running and reporting success. Its latest run generated commit `b09b646` on `bot/nrl-data-refresh` with complete Round 19 data, but PR #22 had been open since 11 July with auto-merge enabled and no attached status checks. Bot pushes made with `GITHUB_TOKEN` do not trigger another `pull_request` workflow, while `gh workflow run ci.yml` produced a detached workflow-dispatch check. Branch protection therefore kept the PR permanently blocked while every scheduled fetch still appeared successful.

Two runtime defects compounded that publishing failure:

- `/api/players` and `/api/rounds` served deploy-time files with `max-age=300, stale-while-revalidate=3600`; browser polling could only re-read stale deployed assets and intermediary caches could retain them for an hour.
- Both the scheduled transformer and browser transformer discarded team scores until a match was marked `complete`, so provisional live NRL team scores could never appear.

### Fix and controlled refresh design

- The server now reads the validated official NRL feed through a 30-second shared in-memory cache with overlapping-request deduplication, 8-second upstream timeouts, two bounded attempts, schema/size validation, explicit source/age/stale headers, and a deploy snapshot fallback carrying an HTTP `Warning`. Client-facing feed responses use `no-cache, max-age=0, must-revalidate`.
- The browser uses only same-origin feed routes, deduplicates refresh calls, times each request out after eight seconds, retries once, and retains the last usable state with a visible recoverable stale-data warning.
- Polling runs every 30 seconds only while a match is live, every 30 seconds in the final ten minutes before kickoff, at a reduced cadence between games, and every 15 minutes after all games are final. Hidden pages stop their timer; returning pages refresh immediately.
- The Match Centre preserves live team scores, round-wide player scores and individual match state. Official corrections replace provisional values on the next poll. Detailed current-round components are revalidated after five minutes instead of being cached forever in browser state.
- A subtle last-updated time is shown without blocking navigation or disabling the Match Centre during background refresh.
- Fetching, transformation and auditing moved into locally runnable scripts. The workflow now runs every ten minutes across the full east-coast NRL match window, updates one dedicated branch/PR using an exact force-with-lease, waits for full CI on the exact bot commit, and merges only after CI succeeds. A no-change fetch is explicitly successful; invalid or more-than-one-round-behind data fails.

### Exact Round 19 local verification

The focused audit checked all seven fixtures and the top scorer from every participating club against the official source. It found 238/238 Round 19 scorers with non-zero scores and 14/14 club detail samples with non-empty components. Examples include Nicholas Hynes (107 points; 17 tackles, 83 metres, two tries, 11 goals), Zac Hosking (83; 28 tackles, 124 metres, three tries), and Haumole Olakau'atu (62; 26 tackles, 145 metres, one try).

The real local application endpoint returned Round 19 complete with final scores `6-32`, `0-66`, `16-40`, `28-12`, `26-24`, `18-19`, and `22-18`. `/api/player-stats/502490?slug=nicholas-hynes` resolved Nicholas Hynes dynamically to FootyStatistics ID 1606 and returned the official Round 19 fallback with the same 107-point detailed components above.

### Exact production verification

PRs #53, #54 and #55 passed the protected `test` check and merged as `792e4d6`, `1d77c21` and `f86fd97`. Railway served the final application with a reset process uptime, `/health` returning `{ok:true}`, and `/ready` returning `{ok:true,storage:"postgresql"}`. Railway's edge briefly returned its fallback 502 during each handover; the new instances became healthy within the next probe. Application readiness was green after handover, but completely interruption-free Railway edge routing remains platform-dependent.

The repaired data workflow was then dispatched on `f86fd97`. It found a genuine upstream player correction, created/updated the single bot PR #56, ran CI for exact bot commit `998ec16`, published the required `test` status, merged normally as `ec3ccf1`, and closed obsolete PR #22. This proves the changed-data, protected-CI and automatic-merge path; it did not silently report success while leaving a stale PR.

Final production data verification found Round 19 `complete`, lifted at `2026-07-13T11:19:14+10:00`, with all matches final at `6-32`, `0-66`, `16-40`, `28-12`, `26-24`, `18-19` and `22-18`. `HEAD /api/rounds` returned 200 with an ETag, `no-cache, max-age=0, must-revalidate`, `X-NRL-Data-Stale: false`, and live memory/upstream source metadata.

Production detailed-stat samples agreed with the official component audit: Nicholas Hynes resolved dynamically to internal ID 1606 and returned 107 points, 17 tackles, 83 metres, two tries and 11 goals; Zac Hosking resolved to 1624 and returned 83 points, 28 tackles, 124 metres and three tries; Haumole Olakau'atu resolved to 1656 and returned 62 points, 26 tackles, 145 metres and one try. The read-only UI verifier used browser-local authentication interception (no production account or writes), waited for passive startup refresh, and passed Round 19 finals plus the Hynes detail modal at 1440×900 and 390×844 with no browser errors or horizontal overflow.

The first post-deploy cache-header probe found `HEAD /api/rounds` returning 404 because the new live routes admitted only GET. GET data and health were correct, but this cache-validation regression was fixed immediately by admitting GET and HEAD and adding an empty-body/ETag/cache-header server test before final production sign-off.

The read-only production UI verifier then exposed that its explicit `autoRefresh()` call was masking a startup gap: the timer chain only began after a refresh had already occurred. Bootstrap now starts `autoRefresh()` automatically. Browser coverage asserts that feed requests and Round 19 live state appear before the test invokes any refresh, and the production verifier now waits for passive polling instead of calling it.

## Scope and environments

The application was tested back to front with disposable accounts and isolated storage. Local HTTP/API tests use temporary JSON directories. PostgreSQL tests refuse to run unless the database name contains `test`; the audit used the disposable `nrl_fantasy_test` database on a local PostgreSQL instance. No production user, league, team, or database data was modified.

Automated browser coverage uses independent Playwright contexts at 320, 375, 390, 768, 1024, 1440, and 1920 pixels. It records uncaught page errors and unexpected console errors, checks horizontal overflow, keyboard dialog behavior, touch-target size, internal links, theme contrast, and desktop/mobile player-stat rendering.

## Scenarios exercised

- Registration through the UI, duplicate registration, valid and invalid login, independent concurrent sessions, refresh/browser-restart persistence, per-device logout, session expiry, password-reset request/reset, reset-token reuse rejection, old-session revocation, and password-confirmed account deletion.
- First-login appearance choice, two-step tutorial, theme persistence after reload, account-level cross-device state, and all five colour schemes.
- Classic auto-complete, full 21-player squad, unique players, starter position eligibility, salary-cap arithmetic, captain/vice-captain uniqueness, trades, clearing, and saving.
- Custom league creation through the UI, custom auto-complete, captaincy, trades, clearing, cap handling, and strict isolation from Classic state.
- Classic AI league creation and ladder setup; multiple Custom and Draft league creation/joining, independent Draft lobbies, AI fill, player availability and per-league state.
- State of Origin league creation/joining, malformed/unknown codes, duplicate joins/creates, owner-only removal, member restrictions, locked-game picks, scoring administration authorization, simultaneous owner/member saves, duplicate prevention, and stale-version rejection.
- Cross-device Classic and Custom changes in both directions, independent user cookies, one-device logout, successful disjoint team saves, and detection of competing writes from the same account.
- Dashboard, primary/secondary navigation, loading/error states, settings/help, browser back-compatible page state, modal close/Escape/focus trapping, and mobile bottom navigation.
- Match Centre fixtures, player rows, match-specific detailed-stat modals, Player search/club/position filters, sorting, comparisons, profiles, and game logs.
- Live-score refresh with routed current feed data, player locking inputs, automatic UI update, recoverable login failure, and a visible retry path after cloud-save interruption.
- API authentication/authorization, ownership, malformed and oversized JSON, unknown resources, unsupported methods, safe error bodies, content types, request IDs, rate limits, duplicate requests, version preconditions, stale writes, account cleanup, and removal of destructive public administration routes.
- PostgreSQL migration from legacy JSON, two-session persistence, app/team versions, concurrent state writes, transaction rollback, retry behavior, and persistence after closing and reopening the database connection.
- Compression, ETags/304 responses, cacheable assets, manifest/icon delivery, security headers, and health/readiness behavior.
- Internal-link crawl, HTTPS external-link validation, `noopener` behavior, labels/ARIA live regions, keyboard navigation, visible focus, dialog focus containment, mobile viewport fit, touch targets, and WCAG AA text contrast across every selectable theme.

## Player-statistics verification

The batch audit read the complete application player dataset and checked all 367 players with source-recorded appearances after Round 14. It used limited concurrency, delay, retry, identity matching, resolved FootyStatistics IDs, expected rounds, and non-fantasy component validation.

- 367/367 effective successes
- 367 dynamically resolved internal IDs
- 0 unresolved or ambiguous matches
- 0 missing expected rounds
- 0 rounds with fantasy points but no available components
- 0 upstream failures

The detailed report is in `reports/player-stats-audit.json` and `reports/player-stats-audit.md`. The audit records 367 rejected incomplete official-ID candidates before successful dynamic resolution; these are the stale duplicates the resolver is designed to bypass.

Real local endpoint and UI checks also confirmed:

| Player | Official ID | Resolved ID | Verified detail |
|---|---:|---:|---|
| Valentine Holmes | 500845 | 1627 | Round 18: 80 points, 12 tackles, 219 metres, 2 tries, 4 goals |
| Liam Henry | 100007929 | 1724 | Round 18: 83 points, 45 tackles, 180 metres, 1 try |
| Jayden Campbell | 100001622 | 1596 | Rounds 15-17 include tackles, metres, tries/goals where supplied |

Match Centre modals and Player profile game logs passed for all three players on desktop and mobile using the real local proxy, not mocked fantasy-point-only responses.

## Defects found and fixed

| Severity | Issue and root cause | Fix | Regression coverage |
|---|---|---|---|
| High | Logging in on a second device invalidated the first device because each user stored one session. | Store, expire, revoke, migrate, and persist multiple hashed sessions; logout revokes only the calling session and password reset revokes all. | API lifecycle, browser restart, two contexts, expiry, PostgreSQL reload. |
| High | Cloud state and SoO team saves used last-write-wins, allowing stale tabs to overwrite newer devices. | Added monotonic versions, transactional compare-and-swap, `428` preconditions, `409` conflict payloads, and client conflict recovery. | Concurrent API/PostgreSQL writes and two-browser conflict test. |
| High | Custom auto-complete, clear, captaincy, chips, trades, bye planning, and round rollover referenced Classic state. | Routed every shared operation through the active team state and persisted Custom history/counters independently. | UI creation, auto-complete, captain/vice, trade, clear, cross-device isolation. |
| High | Completed State of Origin picks could be changed by calling the API directly. | Validate pick keys/IDs and reject changes to locked games server-side with `423`. | API and browser locked-pick assertions. |
| High | Custom and Draft state was singular per account, so a second same-format league could overwrite teams, picks, rules and Draft state from the first. | Added immutable league-scoped records, memberships, teams, picks, fixtures and scores; ID-aware authorization; per-league client contexts; and a lossless legacy migration. Draft invitations now assign authenticated members to independent lobby slots. | Three-user API lifecycle, isolated PostgreSQL migration, all-width league UI, multi-context disjoint/stale writes and same-player cross-league Draft tests. |
| High | A member's Draft pick persisted in the pick ledger but did not advance the shared Draft snapshot, so another device could reload the pre-pick roster. | Made live Draft turns server-authoritative: the API validates the current snake-draft slot, records the pick, updates the correct roster/log/turn atomically, and returns the new shared state. League switching refreshes only the selected league. | Owner/member turn authorization, two sequential live picks, shared-state reload, stale-version and cross-league isolation assertions. |
| Medium | A trade adjusted bank in shared slot helpers and then debited the price difference a second time. | Removed the duplicate adjustment and retained one atomic old-price/new-price calculation. | Exact bank arithmetic assertion. |
| Medium | Concurrent registration and league creation could create duplicate state; storage writes could interleave. | Added pending-registration/league guards, serialized snapshot writes, and combined account-state persistence. | Duplicate and simultaneous submission tests. |
| Medium | Signing out from a page whose last auth tab was Register left Forgot Password inaccessible. | Reset the auth view to Sign In on logout. | Complete UI account lifecycle. |
| Medium | A failed cloud save was silent except for a console warning. | Added a persistent, accessible “Cloud save interrupted” notice with Retry; local changes remain available. | Routed `503`, retry, and recovered-save browser test. |
| Medium | Light Editorial secondary text missed 4.5:1 contrast on the page background. | Darkened the secondary text token. | Programmatic contrast checks for text/card/background pairs in all themes. |
| Medium | Small mobile controls could fall below a practical touch target. | Applied 40px interactive and 42px form-control minimums at mobile widths. | Visible-control bounding-box audit at 320px plus all-width overflow suite. |
| Medium | Proxy-aware rate limiting trusted the user-controlled first forwarded address. | Use the proxy-appended final forwarded address. | Spoofed-header rate-limit regression. |
| Medium | Malformed cloud records and arbitrary SoO pick keys/IDs were accepted. | Added top-level state types, numeric bounds, allowed positions, valid ID range, and duplicate-player filtering. | Malformed-state and pick-validation API tests. |

## Test commands and evidence

- `npm run check`
- `PGSSL=disable TEST_DATABASE_URL="$TEST_DATABASE_URL" node --test test/postgres.integration.test.js`
- `npm run test:browser`
- `npm run fetch:nrl-data`
- `npm run audit:round-pipeline`
- `npm run audit:round-pipeline:details`
- `npm run smoke:round-ui -- http://127.0.0.1:32189 --round=19`
- `npm run audit:player-stats`
- `npm run smoke:player-ui -- --base-url=http://127.0.0.1:32290`

Round 19 gate results: 35 core/unit/API tests passed with one PostgreSQL test skipped by the generic command; the isolated PostgreSQL invocation passed 1/1; the complete Playwright suite passed 15/15 across 320, 375, 390, 768, 1024, 1440 and 1920 pixel coverage; the read-only real-feed Round 19 UI smoke passed at 1440 and 390 pixels with no browser errors.

Player Stats redesign gate results: `npm run check` passed 35/35 executed core/unit/API tests (with the isolated PostgreSQL case intentionally skipped by that generic command); the explicit disposable PostgreSQL suite passed 1/1; and the complete Playwright suite passed 19/19. The browser run includes the seven viewport widths, cross-device/product flows, both approved visual baselines, mobile round selection, all themes, unavailable components, no unexpected console errors, and horizontal-overflow checks.

## Multiple Custom and Draft leagues

The singular Custom/Draft account fields remain as compatibility aliases only. The authoritative model is an addressable collection of immutable league IDs, and every active screen binds explicitly to one selected league. Successful switches flush changed team state before rebinding; unchanged state is content-hashed so ordinary navigation does not create version churn.

PostgreSQL now stores league identity/rules/lifecycle, memberships and roles, user teams and versions, Draft picks, fixtures and scores in league-scoped tables with foreign keys, uniqueness constraints and lookup indexes. The `002_multi_custom_draft_leagues` migration reads existing application state without deleting it, groups shared legacy codes into one league, retains the complete Custom/Draft payload, preserves explicit ownership even when member rows are encountered first, and is transactional/idempotent. JSON development storage performs the equivalent compatibility import.

The new API provides authenticated create/list/detail/join/manage/delete/leave, team compare-and-swap saves, Draft compare-and-swap state and league-scoped Draft picks. It rejects IDOR reads, non-owner management, incompatible/invalid/expired/full invitations, duplicate membership, duplicate same-league players, stale devices and missing version preconditions. Creation/join requests are idempotent, rapid UI submissions are deduplicated, and the configurable account limit is returned by the server and displayed in My Leagues.

Draft participants carry authenticated user identity in shared state. Joining replaces one open/AI lobby slot, each browser derives its own `me` index, and the live pick endpoint atomically validates the current human turn before advancing the roster, log and pick number. The same player remains independently draftable in separate leagues, and leaving restores only that member's lobby slot. Custom rules, corrections, layouts, teams, lineups, captaincy, history and scoring remain isolated from Classic and every other Custom league.

Validation evidence:

- `npm run check`: 47 executed tests passed; the PostgreSQL test was intentionally skipped by this generic command.
- Disposable PostgreSQL `nrl_fantasy_test`: 1/1 passed, covering two legacy formats, shared membership, ownership order, record relationships, rollback, retry-safe migration and restart persistence.
- Complete Playwright suite: 37/37 passed in 7.6 minutes, covering 320, 375, 390, 768, 1024, 1440 and 1920 pixels.
- The three-user API suite creates multiple Custom and Draft leagues for one owner, joins additional leagues owned by another user, verifies independent names/selections, identical Custom players across leagues, same-player Draft isolation, owner/member turn enforcement and shared Draft persistence after reload, owner transfer, permissions, invitations, IDOR and stale conflicts.
- Multiple browser contexts save different leagues concurrently without collision; competing saves to one league produce a recoverable conflict instead of silent overwrite. League cards and switchers have no horizontal overflow at every supported width.

## Remaining risks and manual checks

- Playwright covers browser viewport emulation, touch-sized controls, and keyboard focus; a final physical iOS Safari and Android Chrome pass remains useful for OS keyboard, safe-area, and installed-PWA behavior.
- Password-reset content and the full UI flow are tested through a permission-restricted test capture. Actual Resend inbox delivery is an external-service smoke and must not expose the reset link in logs.
- FootyStatistics and NRL feeds are external, mutable services. The resolver caches successful identity mappings in-process and rejects incomplete identity/detail payloads, but continued scheduled audit/monitoring is required.
- Draft timers and AI auto-picks run in the active browser while authoritative rosters/picks and Draft state are league-scoped on the server. A future horizontally scaled deployment should add a server-side Draft clock/coordinator before enabling multiple application instances for one live room.
- Production verification is restricted to read-only health/data checks and browser-local authentication interception; it creates or modifies no production account, league, team or database data.
