# Product test report

Date: 13 July 2026
Branch: `agent/comprehensive-product-audit`

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
- `npm run audit:player-stats`
- `npm run smoke:player-ui -- --base-url=http://127.0.0.1:32290`

## Remaining risks and manual checks

- Playwright covers browser viewport emulation, touch-sized controls, and keyboard focus; a final physical iOS Safari and Android Chrome pass remains useful for OS keyboard, safe-area, and installed-PWA behavior.
- Password-reset content and the full UI flow are tested through a permission-restricted test capture. Actual Resend inbox delivery is an external-service smoke and must not expose the reset link in logs.
- FootyStatistics and NRL feeds are external, mutable services. The resolver caches successful identity mappings in-process and rejects incomplete identity/detail payloads, but continued scheduled audit/monitoring is required.
- Draft is intentionally a local AI sandbox. Networked multiplayer Draft is not advertised or represented as implemented.
- Production verification is restricted to read-only health/data checks and disposable accounts removed through the normal account-deletion route.
