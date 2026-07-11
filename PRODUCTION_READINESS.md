# Production-readiness implementation

## Completed locally

- Server-side authorization for team changes and league administration
- Removal of browser-visible and query-string administrative secrets
- Administrator allow-list through `ADMIN_EMAILS`
- Secure expiring HttpOnly cookie sessions with legacy bearer migration
- Hashed session and password-reset tokens at rest
- Migration-compatible asynchronous PBKDF2 password strengthening
- Login, registration, reset, and forgot-password rate limits
- Persistent one-time password-reset records
- Atomic JSON fallback writes with visible error logging
- Restricted CORS, security headers, JSON API errors, and method handling
- Request IDs and structured request logs
- Brotli/gzip compression, ETags, and player-data caching
- Conditional 304 validation for the application shell and large JSON feeds
- Cacheable external assets for embedded player, season, and historical datasets
- `/health` and `/ready` endpoints
- Railway configuration-as-code
- CI, inline-script validation, and API/security regression tests
- Mobile safe-area, narrow-screen, touch-target, and bottom-navigation fixes
- Installable mobile/desktop web-app metadata with standalone display and a scalable app icon
- Keyboard navigation, focus styles, accessible modal behavior, and reduced motion
- Keyboard activation for dynamically rendered cards, tabs, match rows, and player controls
- Authentication form labels, autocomplete metadata, and 12-character password guidance
- Duplicate-submission protection, visible busy states, and announced inline form feedback
- Bounded HTTP lifetimes, early payload rejection, and consistent upstream/API failure responses
- Password-confirmed account deletion with session revocation, league cleanup, and local-data removal
- Dashboard-first authentication and non-blocking league loading with browser regression coverage
- Scheduled data workflow concurrency, timeouts, pinned Playwright, and schema checks
- Fifteen-minute production health, PostgreSQL readiness, and application-shell monitoring
- Structured request-error boundaries with traceable 500 responses and crash-regression coverage
- Weekly npm and GitHub Actions dependency updates, production vulnerability auditing, and sensitive-file ownership

## PostgreSQL cutover

Railway PostgreSQL has been provisioned and referenced by the app as `DATABASE_URL`.

Completed locally:

1. Pinned `pg` and added schemas for users, sessions, password resets, leagues, teams, picks, and scores.
2. Added a transactional, idempotent JSON import recorded in `schema_migrations`.
3. Restricted JSON fallback to non-production environments; production now refuses to start without `DATABASE_URL`.
4. Added bounded database retries, readiness state, unit failure/retry tests, and an opt-in `TEST_DATABASE_URL` integration test.
5. Startup runs migrations before opening the HTTP port, avoiding a redundant short-lived Railway pre-deploy container.

Completed against Railway:

1. PostgreSQL integration and responsive browser suites passed.
2. The legacy snapshot was recovered into PostgreSQL with 11 users, 1 league, and 34 scores.
3. Production readiness reports PostgreSQL and restored account login/password-reset flows pass.
4. Empty legacy snapshots no longer receive a completed-import marker, so startup can retry after a volume becomes available.

Completed operationally:

1. Repository backup and isolated-test database secrets are configured.
2. The encrypted backup workflow completed and produced a verified artifact.
3. The guarded restore workflow restored the backup to the isolated PostgreSQL service and verified record counts.
4. Production monitoring, integration tests, and logged-in responsive browser flows have passed.

Ongoing operations:

1. Repeat the guarded restore test monthly and after database schema or backup-workflow changes.
2. Keep encrypted backup artifacts and their passphrase separate; retain the source JSON snapshot only through the agreed rollback window.

## Rollout requirements

- Set `ADMIN_EMAILS` in Railway before score administration is needed.
- CI requires PostgreSQL migration/integration and logged-in browser tests before changes are merged.
- Test at 320, 375, 390, 768, 1024, 1440, and 1920 pixel widths.
- Test account migration, login, logout, registration, password reset, league creation/joining, pick updates, owner controls, and score administration.

## Responsive browser automation

`npm run test:browser` covers authenticated registration/login state, logout, league creation/joining, pick updates, owner removal controls, score administration, console errors, navigation, and horizontal overflow at 320, 375, 390, 768, 1024, 1440, and 1920 pixels.

The suite passed in the Linux test workspace after Chromium dependencies were installed. Password-reset delivery, rendering, and the reset/login flow were also verified against production.
