# Home Dashboard functional redesign

Implement this specification after the multi-league release. The completed full-product audit at main commit `a1653d1` / protected PR #66 is the baseline; do not repeat that full audit immediately.

The Home screen is a cross-competition command centre. It must answer:

1. What needs the user’s attention now?
2. How are all of the user’s teams and leagues performing?
3. What important team news has changed since the user last visited?

It must not duplicate the detailed Classic team screen.

## Operating and data-safety rules

- Preserve all existing production users, leagues, teams, memberships, selections, picks, scores, Draft state and preferences.
- All mutating tests must use an isolated PostgreSQL database and disposable accounts.
- Production verification is read-only and must block every non-GET/HEAD request.
- Retain all four appearance themes and existing accessibility guarantees.
- Use authorised data sources only. Do not bypass authentication, scrape private/premium pages, or reproduce article text.
- Keep source attribution and source timestamps on externally supplied team news.

## 1. Remove the duplicated Classic live-player panel

Remove the Home screen panel that lists every Classic player and their live score. The Classic team screen remains the detailed place for player-by-player live scoring.

Do not remove live scoring itself. Replace the duplicated player list with compact competition-level summaries covering every team and league belonging to the signed-in user.

## 2. My competitions / Live round

Add a first-class `My competitions` section below the round/deadline header.

Render one independently loaded card for:

- The user’s Classic team.
- Every Custom league the user owns or has joined.
- Every Draft league the user owns or has joined.
- Every State of Origin or other supported competition in which the user has a team.

Each card must be scoped by an explicit competition/league/team ID and show only data for that context:

- Competition format and league name.
- Team name.
- Current-round score, or a clearly labelled awaiting/not-started state.
- Live/final/scheduled/stale status.
- Players completed, currently playing and still to play when the format supports a player lineup.
- Rank and rank movement when valid for that league.
- Head-to-head opponent and score when the league uses matchups.
- Draft turn/waiver state when immediately relevant.
- Last successful data update time.
- A single deep-link action such as `Open team`, `Open matchup`, `Draft now` or `Fix team`.

Do not show misleading zeroes for unavailable data. Use `—`, `Awaiting lockout`, `No matchup`, or another explicit state.

The cards must use the same live-score source and freshness rules. Classic cannot receive richer or fresher Home data merely because it is the original format.

### Ordering and responsive behaviour

- Urgent/action-required cards first.
- Then live competitions.
- Then scheduled competitions.
- Then final competitions.
- Preserve deterministic ordering within each group.
- Desktop: responsive grid, normally two or three columns depending on width.
- Mobile: one-column cards; no horizontal carousel required to discover a league.
- The section must support many leagues without freezing the screen. Fetch/render independently and use a `View all competitions` expansion after an initial sensible limit.
- A failed league request must not block other cards or the rest of Home.

## 3. Round header

Keep the round/deadline header, but make it global rather than Classic-specific.

Show:

- Current round.
- Earliest relevant lockout/deadline.
- Countdown using `Australia/Sydney` time.
- Overall live-data freshness.
- Number of competitions needing action.

Remove Classic-only salary, trade and squad metrics from the global hero. Those belong on the Classic card or Classic team screen.

## 4. Urgent alerts only

The Home `Alerts` section is an action queue, not a news feed.

When one or more unresolved alerts exist, place this section directly below the round header and above `My competitions`. When none exist, show one compact `No urgent actions` state rather than reserving a large empty panel.

An alert may appear only when it is time-sensitive, affects the user/account, or requires action. Examples:

- A selected player is ruled out, omitted or moved to reserves.
- Captain or vice-captain is unavailable.
- Team is incomplete or invalid near lockout.
- Salary/position constraint prevents a valid team.
- A save failed or a newer edit from another device caused a conflict.
- Lockout is approaching and an affected lineup is unresolved.
- A Draft turn or waiver deadline is approaching.
- League invitation or owner action is expiring.
- Live data is stale/outage-affected during a match.
- Account/security action is required.

General fixtures, price movement, form, routine team announcements and editorial news must not appear as alerts.

Every alert must contain:

- Severity: `Critical`, `Action required`, or `Warning`.
- Plain-language title and consequence.
- Competition/team context.
- Event/source timestamp.
- One primary deep link that takes the user directly to the fix.
- Stable deduplication key.
- Automatic expiry/resolution rule.

Support mark-as-read and dismiss where safe. Critical unresolved alerts may be acknowledged but must not be permanently hidden. Do not show a numeric badge that counts expired or informational items.

## 5. Team news feed

Add a separate `Team news` section. It must be useful without pretending that news is an alert.

Prioritise in this order:

1. Players selected in any of the user’s Classic, Custom, Draft or Origin teams.
2. Players on the user’s watchlist.
3. Clubs represented across those teams.
4. Remaining league-wide changes.

Group updates into clear types:

- Official team list named.
- Added to starting side.
- Moved to interchange/reserves.
- Omitted.
- Confirmed injury/return.
- Suspension/judiciary outcome.
- Late mail/final-team change.

Each item must show the player/club, what changed, affected round, source, source time and whether it is `Confirmed` or `Estimated`. Never present an inferred replacement or return date as confirmed.

Provide:

- `Since your last visit` marker.
- Team/player/competition relevance labels.
- Filter for `My players`, `Watchlist`, `All teams`.
- A compact initial list and `View all team news`.
- Honest empty, loading, partial, stale and source-unavailable states.

Do not reproduce full articles. Store/display concise factual change records with links to authorised primary or reputable sources.

## 6. Automatic Tuesday team-list refresh

Official NRL club squads are normally announced at 4:00 pm Tuesday. Schedule ingestion using `Australia/Sydney`; do not hardcode a single UTC hour because Sydney changes between AEST and AEDT.

Implement an idempotent server-side/background refresh process:

- Start checking at 3:55 pm Tuesday Sydney time.
- Check at least every five minutes through 4:30 pm.
- If the new-round list is not detected, continue every 15 minutes until 6:00 pm, then fall back to the normal refresh cadence and raise an operational warning.
- Stop the high-frequency window as soon as every expected club list for the upcoming round has been received and validated.
- Recheck later changes using the existing regular data cadence.
- Add fixture-aware checks for squad reductions/late mail and final teams before kickoff when the authorised source supplies them.

Use a frequent UTC scheduler with a Sydney-time guard, or another scheduler that genuinely supports the IANA timezone `Australia/Sydney`. Do not create a brittle cron expression that is correct for only half of the year.

The refresh job must:

- Use bounded timeouts, retries and exponential backoff with jitter.
- Use ETag/Last-Modified/content hash where available.
- Validate round, club coverage, player identity and payload shape before publishing.
- Be transactional/idempotent and deduplicate unchanged events.
- Preserve the last verified snapshot on partial/upstream failure.
- Never replace valid data with an empty or older payload.
- Record last attempt, last success, source version/hash, expected club count, received club count and validation errors.
- Publish update events only after successful validation.
- Refresh/invalidate the Team news cache after a valid change.
- Fail loudly through monitoring after the bounded window, without spamming users.

End users must not need to press a refresh button. A read-only `Last checked` time and stale indicator are appropriate.

## 7. API and storage requirements

Provide server-authoritative read models rather than assembling all league state from browser globals.

Suggested contracts (adapt names to the existing API conventions):

- `GET /api/home/summary`
  - round/deadline/freshness plus lightweight competition summaries.
- `GET /api/home/alerts`
  - active user-scoped actionable alerts only.
- `GET /api/team-news?scope=my-players|watchlist|all&cursor=...`
  - paginated, deduplicated team-list and late-mail events.
- `GET /api/team-news/status`
  - public-safe freshness/coverage state without internal errors or secrets.

Requirements:

- Authenticate all user-scoped endpoints.
- Authorise every league/team included in a response.
- Prevent IDOR by deriving accessible competitions from membership, not user-supplied IDs alone.
- Avoid N+1 queries across many leagues.
- Use cursor pagination for news.
- Return stable machine-readable status codes and traceable JSON errors.
- Do not expose upstream credentials, raw private payloads or source cookies.
- Apply short cache headers only where safe; user-scoped responses must not enter shared public caches.

Persist normalised team-list snapshots/events sufficient to compare the previous and new official lists. Store source, source URL, fetched time, published time, round, club, player identity, named position/status, confirmation level and content hash.

## 8. Resilience and multi-device behaviour

- Home must remain navigable while any one widget is loading or failing.
- Use per-section skeletons, not a page-wide blocking spinner.
- Abort obsolete requests after navigation.
- Prevent duplicate polling after repeated Home visits.
- Pause browser polling while hidden and refresh immediately on resume.
- Server/background ingestion remains independent of whether any browser is open.
- Two devices logged into the same account must receive the same competition list, alert state and team-news data.
- A second-device team change must update the correct league card without overwriting another league.

## 9. Test coverage

Add unit, API, isolated PostgreSQL, concurrency, multi-device and Playwright coverage.

Required scenarios include:

- Classic plus at least two Custom and two Draft leagues appear as separate cards.
- Owned and joined leagues are both included.
- Each card shows its own score, rank, matchup and state with no cross-league leakage.
- The same user can have different players and scores in different leagues.
- A failed/stale league does not freeze other cards or navigation.
- Home does not render the Classic player-by-player live-score duplicate.
- Correct deep link opens the exact league/team/matchup.
- Alert generation, severity, deduplication, dismissal/acknowledgement, automatic resolution and expiry.
- General news never enters the urgent-alert list.
- Team-news relevance ordering and filters across players in multiple leagues.
- First Tuesday snapshot, unchanged refresh, changed list, partial club coverage, invalid payload, older payload, retry exhaustion and recovery.
- Sydney timezone behaviour in both AEST and AEDT, including boundary times around 3:55/4:00/4:30/6:00 pm.
- Final-team/late-mail changes update news and actionable alerts where relevant.
- Server restart and concurrent scheduler invocations do not duplicate events.
- Desktop/mobile layouts at 320, 375, 390, 768, 1024, 1440 and 1920px.
- All four themes, keyboard use, focus, screen-reader status announcements, 200% zoom and reduced motion.
- Zero horizontal overflow and 44px mobile touch targets.

Use deterministic fixture clocks; tests must not depend on the real current Tuesday or the live upstream service.

## 10. Delivery and production verification

- Update `PRODUCT_TEST_REPORT.md`.
- Publish through a protected PR.
- Confirm required CI, Railway migration/pre-deploy and application deployment.
- Run the production monitor.
- Production verification must be read-only and block all non-GET/HEAD requests.
- Verify at desktop and mobile widths that all accessible competition formats render, Home stays responsive, urgent alerts are distinct from Team news and source freshness is visible.
- Do not create, join, edit or delete production teams/leagues during verification.

After this feature passes and is deployed, run a focused post-release audit of Home, alerts, competition summaries, team news and scheduled ingestion, plus the complete existing automated regression suite. Update `PRODUCT_TEST_REPORT.md` as a delta from the PR #66 / `a1653d1` baseline. Do not repeat the entire full-product audit unless the focused work exposes a cross-cutting regression or another substantial release is completed.
