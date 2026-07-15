# Multiple custom and draft leagues

## Product requirement

One user may create, own and join multiple Custom leagues and multiple Draft leagues at the same time. The application must not assume there is only one league of either format.

Every league is an independent container with its own:

- League identity, name, code, format and owner.
- Members and permissions.
- Rules and scoring configuration.
- User team name and team selections.
- Picks, starters, interchange, reserves, captain and vice-captain where applicable.
- Draft order, draft state, rosters, waiver/free-agent state and transactions where applicable.
- Fixtures, ladder, scores and history.
- Creation/update timestamps and lifecycle state.

Selections or actions in one league must never appear in or overwrite another league, even when both leagues have the same format.

## Data model and migration

- Scope every league-specific record by immutable `league_id` and the relevant `user_id`/membership ID.
- Do not key Custom or Draft state by user and format alone.
- Enforce appropriate uniqueness, such as one active membership/team per user per league, rather than one team per user per format.
- Keep league codes unique and collision-resistant.
- Preserve all existing production leagues, memberships, teams, picks, scores and ownership during migration.
- Map each existing singular Custom/Draft record to its existing league. Do not duplicate or discard records.
- Migration must be transactional, idempotent and safe to retry.
- Add foreign keys and indexes for league membership, league teams, picks, fixtures and scores.
- Production must fail safely if a league context is missing rather than falling back to another league.

## API and authorisation

- Replace singular assumptions such as `my-league` with league-ID-aware operations while preserving compatibility only where it can resolve unambiguously.
- Every league read/write route must validate authenticated membership and action-specific permissions.
- Never trust a browser-supplied owner, admin, team or user ID without server-side verification.
- Prevent IDOR access between leagues.
- Return a clear conflict when a stale client updates a league/team that changed elsewhere.
- Creation/join endpoints must be idempotent against accidental double submission.
- Apply server-side, configurable anti-abuse limits rather than a hardcoded one-league limit. Display the configured limit and a clear error if reached.

## League hub UX

- Provide a `My Leagues` view grouped or filterable by Classic, Custom and Draft.
- Show every league the user owns or has joined.
- Each card shows league name, format, role, member count, current rank/status and next relevant action.
- Provide distinct `Create league` and `Join league` actions.
- Opening a league establishes an explicit league context visible in the page heading or switcher.
- Provide an accessible league switcher that never silently carries unsaved team changes into another league.
- After creating a league, return the user to that new league—not an arbitrary previously opened league.
- Preserve navigation state when returning to My Leagues.
- Empty, loading, partial, permission-denied and deleted/inactive league states must be designed.

## Team and draft behaviour

- Each Custom league starts with its own independent empty team unless its configured rules explicitly provide another starting state.
- Classic-team selections must never auto-populate a new Custom league.
- A Custom team in League A must never populate League B.
- Each Draft league has an independent roster and draft lifecycle.
- A player drafted in one league remains independently available according to every other league's state.
- Draft room, draft order, picks, timers, auto-picks, roster limits, waivers and free agents must all use the active league ID.
- Switching leagues during an in-progress draft must not corrupt either room.
- Multi-device updates must identify the affected league and refresh only that league's state.

## Invitations and ownership

- Invite and join links/codes identify one specific league and its format.
- Reject expired, invalid, full or incompatible invitations clearly.
- Prevent duplicate membership from repeated join submissions.
- Owners can manage only leagues they own.
- Leaving one league does not affect any other league or delete the user's unrelated teams.
- Ownership transfer or league deletion, if supported, must use explicit confirmation and transactional rules.

## Testing

Use an isolated PostgreSQL database and at least three users. Cover:

- One user creates two Custom and two Draft leagues.
- The same user joins additional Custom and Draft leagues owned by other users.
- Every league has different team selections and team names.
- Saving/reloading/switching does not leak state.
- Two browser contexts edit different leagues simultaneously.
- Two browser contexts edit the same league and receive safe concurrency behaviour.
- Identical player IDs can exist correctly in separate Custom leagues.
- Drafting the same player in two different Draft leagues succeeds independently.
- Drafting a player twice in the same Draft league fails.
- Owner and non-owner permissions across multiple leagues.
- Invalid, duplicate, full and expired invitations.
- Direct-ID access to an unrelated league is denied.
- Existing singular league data migrates without loss.
- Restart persistence, transaction rollback and migration retry.
- Desktop and mobile league list, switcher, creation, joining, team editing and draft room.
- No horizontal overflow at all supported widths.

## Production safety and delivery

- Do not mutate production league/user/team data during browser validation.
- Test all mutating flows against an isolated database.
- Add record-count and relationship checks around the migration.
- Run the complete unit, PostgreSQL and Playwright suites.
- Open a protected PR, wait for CI, merge, confirm Railway migration/deployment, check `/health` and `/ready`, then perform read-only production smoke tests.

