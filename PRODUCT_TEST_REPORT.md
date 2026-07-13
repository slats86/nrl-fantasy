# Product test report

Date: 14 July 2026
Branches: `agent/round19-live-data-pipeline`, production-verification follow-ups, and `agent/player-stats-approved-design`

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
- Classic AI league creation, ladder data setup, local Draft creation/start with AI opponents, and truthful local-only Draft labelling.
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
| High | Draft UI offered invitation codes although Draft state was local-only. | Removed the misleading join/invite journey and code sharing, labelled Draft as a local AI sandbox, and prefilled opponents with AI coaches. | Local Draft create/start browser journey. |
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

## Remaining risks and manual checks

- Playwright covers browser viewport emulation, touch-sized controls, and keyboard focus; a final physical iOS Safari and Android Chrome pass remains useful for OS keyboard, safe-area, and installed-PWA behavior.
- Password-reset content and the full UI flow are tested through a permission-restricted test capture. Actual Resend inbox delivery is an external-service smoke and must not expose the reset link in logs.
- FootyStatistics and NRL feeds are external, mutable services. The resolver caches successful identity mappings in-process and rejects incomplete identity/detail payloads, but continued scheduled audit/monitoring is required.
- Draft is intentionally a local AI sandbox. Networked multiplayer Draft is not advertised or represented as implemented.
- Production verification is restricted to read-only health/data checks and browser-local authentication interception; it creates or modifies no production account, league, team or database data.
