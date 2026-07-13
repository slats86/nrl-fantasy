# Product test report

Date: 13 July 2026
Branch: `agent/round19-live-data-pipeline`

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

Production verification will be appended after CI, merge and Railway deployment; no production user, league or team data is used for this read-only verification.

The first post-deploy cache-header probe found `HEAD /api/rounds` returning 404 because the new live routes admitted only GET. GET data and health were correct, but this cache-validation regression was fixed immediately by admitting GET and HEAD and adding an empty-body/ETag/cache-header server test before final production sign-off.

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

Round 19 gate results: 34 core/unit/API tests passed with one PostgreSQL test skipped by the generic command; the isolated PostgreSQL invocation passed 1/1; the complete Playwright suite passed 15/15 across 320, 375, 390, 768, 1024, 1440 and 1920 pixel coverage; the read-only real-feed Round 19 UI smoke passed at 1440 and 390 pixels with no browser errors.

## Remaining risks and manual checks

- Playwright covers browser viewport emulation, touch-sized controls, and keyboard focus; a final physical iOS Safari and Android Chrome pass remains useful for OS keyboard, safe-area, and installed-PWA behavior.
- Password-reset content and the full UI flow are tested through a permission-restricted test capture. Actual Resend inbox delivery is an external-service smoke and must not expose the reset link in logs.
- FootyStatistics and NRL feeds are external, mutable services. The resolver caches successful identity mappings in-process and rejects incomplete identity/detail payloads, but continued scheduled audit/monitoring is required.
- Draft is intentionally a local AI sandbox. Networked multiplayer Draft is not advertised or represented as implemented.
- Production verification is restricted to read-only health/data checks and disposable accounts removed through the normal account-deletion route.
