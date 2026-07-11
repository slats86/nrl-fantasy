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
- `/health` and `/ready` endpoints
- Railway configuration-as-code
- CI, inline-script validation, and API/security regression tests
- Mobile safe-area, narrow-screen, touch-target, and bottom-navigation fixes
- Keyboard navigation, focus styles, accessible modal behavior, and reduced motion
- Authentication form labels, autocomplete metadata, and 12-character password guidance
- Scheduled data workflow concurrency, timeouts, pinned Playwright, and schema checks

## PostgreSQL cutover

Railway PostgreSQL has been provisioned and referenced by the app as `DATABASE_URL`.

Completed locally:

1. Pinned `pg` and added schemas for users, sessions, password resets, leagues, teams, picks, and scores.
2. Added a transactional, idempotent JSON import recorded in `schema_migrations`.
3. Restricted JSON fallback to non-production environments; production now refuses to start without `DATABASE_URL`.
4. Added bounded database retries, readiness state, unit failure/retry tests, and an opt-in `TEST_DATABASE_URL` integration test.
5. Added the Railway pre-deploy migration command.

Still required against Railway before deployment:

1. Run `TEST_DATABASE_URL=<isolated database URL> npm test` and confirm the PostgreSQL integration test passes.
2. Snapshot the JSON volume, run `npm run migrate`, and compare user/league/team/pick/score counts and representative records.
3. Create a backup with `pg_dump --format=custom --no-owner --file=nrl-fantasy.dump "$DATABASE_URL"`.
4. Restore into an isolated database with `pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" nrl-fantasy.dump`, then run the integration and logged-in browser suites against it.
5. Retain the source JSON snapshot through the rollback window; do not point production back to JSON writes.

## Rollout requirements

- Set `ADMIN_EMAILS` in Railway before score administration is needed.
- Do not deploy the hardening branch until PostgreSQL migration and logged-in browser tests pass.
- Test at 320, 375, 390, 768, 1024, 1440, and 1920 pixel widths.
- Test account migration, login, logout, registration, password reset, league creation/joining, pick updates, owner controls, and score administration.

## Responsive browser automation

`npm run test:browser` covers authenticated registration/login state, logout, league creation/joining, pick updates, owner removal controls, score administration, console errors, navigation, and horizontal overflow at 320, 375, 390, 768, 1024, 1440, and 1920 pixels.

This workspace could download Chromium but could not install the host libraries (`libnspr4`, `libnss3`, and `libasound2t64`) because sudo authentication is unavailable. Install them on the browser-test runner, run the suite, and manually verify the password-reset email link before deployment.
