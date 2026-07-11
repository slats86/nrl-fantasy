# Database backup and recovery

## Scheduled backup

GitHub Actions runs `.github/workflows/database-backup.yml` daily at 02:17 Australia/Sydney during standard time (03:17 during daylight saving). It can also be run manually from the Actions tab before a risky release.

Configure these GitHub Actions repository secrets:

- `PRODUCTION_DATABASE_URL`: Railway's public production PostgreSQL URL. Never use the private `.railway.internal` address because GitHub runners are outside Railway.
- `BACKUP_PASSPHRASE`: a unique, high-entropy passphrase stored in a password manager outside GitHub.

The workflow creates a PostgreSQL custom-format dump, encrypts it with AES-256 through GnuPG, deletes the plaintext dump, and retains the encrypted artifact for 14 days. Download access follows repository Actions permissions.

## Monthly restore test

Never test a restore against production. Download an artifact from GitHub Actions and restore it only into the isolated Postgres Test service.

From a trusted Linux environment with GnuPG and PostgreSQL 17 client tools:

```bash
sha256sum --check nrl-fantasy.dump.gpg.sha256
gpg --output nrl-fantasy.dump --decrypt nrl-fantasy.dump.gpg
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" nrl-fantasy.dump
rm -f nrl-fantasy.dump
```

After restoring, compare the `users`, `leagues`, `teams`, `picks`, and `scores` counts with production and run the authenticated browser suite against the isolated environment.

## Recovery rules

- Store the backup passphrase outside GitHub; losing it makes every artifact unusable.
- Rotate both repository secrets immediately if a database URL or passphrase is exposed.
- Keep the Postgres Test database isolated from the production application.
- Perform and record a restore test at least monthly and after changing the database schema or backup workflow.
