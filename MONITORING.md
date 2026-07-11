# Production monitoring

## Automated checks

`.github/workflows/production-monitor.yml` checks production every 15 minutes and can be run manually after a deployment. It verifies:

- `/health` is reachable and reports `ok: true`.
- `/ready` reports `ok: true` and `storage: postgresql`.
- The homepage returns the expected application shell.

GitHub Actions schedules can be delayed during platform congestion, so this is a lightweight availability signal rather than a formal uptime guarantee. Railway's deployment health check remains responsible for preventing an unhealthy release from receiving traffic.

## Notification setup

In GitHub notification settings, enable email notifications for failed Actions workflows on watched repositories. Keep the `nrl-fantasy` repository watched for Actions activity so a failed monitor or backup reaches the repository owner.

## Failure response

1. Confirm the failure from a second network by opening `/health` and `/ready`.
2. Check the latest Railway deployment and application logs.
3. If a new deployment caused the outage, use Railway's previous successful deployment while the defect is investigated.
4. If `/health` passes but `/ready` fails, check PostgreSQL availability, connection limits, and `DATABASE_URL` before changing application code.
5. If only the homepage check fails, inspect the deployed `index.html`, response size, and Railway routing/custom-domain status.
6. Record the cause and corrective action in the pull request or an issue.

## Manual smoke check

```bash
gh workflow run "Production monitor"
gh run list --workflow production-monitor.yml --limit 1
```

Run this after production deployment, domain/DNS changes, Railway configuration changes, and database maintenance.

## Scheduled data updater

The data updater uses GitHub's short-lived workflow token to push `bot/nrl-data-refresh`, create or update a pull request, explicitly run CI on that branch, and enable auto-merge. No long-lived bot credential is stored. Automated data changes remain subject to the same required `test` check as human changes.
