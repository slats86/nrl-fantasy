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

The remaining code work must be performed in a network-enabled environment:

1. Install and pin `pg`.
2. Add migrations for users, sessions, password resets, leagues, teams, picks, and scores.
3. Import existing JSON records transactionally and record migration completion.
4. Keep JSON as a local-development fallback only.
5. Add PostgreSQL integration tests and failure/retry tests.
6. Configure Railway pre-deploy migrations.
7. Verify backup and restore procedures before disabling JSON production writes.

## Rollout requirements

- Set `ADMIN_EMAILS` in Railway before score administration is needed.
- Do not deploy the hardening branch until PostgreSQL migration and logged-in browser tests pass.
- Test at 320, 375, 390, 768, 1024, 1440, and 1920 pixel widths.
- Test account migration, login, logout, registration, password reset, league creation/joining, pick updates, owner controls, and score administration.
