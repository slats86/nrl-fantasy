# Live scoring in My Team

Fix the confirmed inconsistency where Match Centre updates current-round player scores live but My Team continues showing previous-round/static values.

## Scope

- Make live player and team scores update automatically inside every supported team view: Classic, each Custom league, each Draft league and supported Origin views where applicable.
- Reuse the existing validated live feed/cache used by Match Centre and Home competition summaries.
- Do not change saved lineups, selections, memberships, Draft state, scoring rules or the ingestion scheduler.
- Do not introduce browser writes merely because a live score changed.

## Root-cause requirement

Remove any team-rendering dependency that always selects `current round - 1` or stored round history while the current round is active.

The team renderer must select a score source explicitly:

1. If the viewed round is active/live and a verified live value exists, use the live value.
2. If the match is scheduled/not started, show `Yet to play` rather than zero.
3. If a player is live but has not recorded a point, show a genuine live `0` only when the feed identifies their match as started.
4. If the match is final, use the final verified score.
5. If data is stale/unavailable, preserve the last verified value and label it stale; never silently substitute an average or previous-round score.

Use one canonical score-selection helper shared by Match Centre, team player cards, team totals, Home competition summaries, matchup totals and league standings. Do not maintain separate live-score interpretations for each screen.

## Team player cards

During a live round, each selected player card must show:

- Current verified Fantasy points.
- `LIVE`, `FINAL`, `YET TO PLAY`, `BYE`, `DNP` or `STALE` state as applicable.
- Captain/vice-captain marker.
- Applied captain multiplier in the team total without falsifying the player’s raw score.
- Auto-sub/emergency status when existing league rules activate it.
- Last update/freshness at the team-section level rather than repeating a large timestamp on every card.

Do not show the previous round grade beside a current live score. Either calculate the grade from the current live score under the existing grading rules or omit the grade until final.

## Visible team live-score panel

Add a clearly visible round-score panel near the top of every team screen. Updating player cards alone is insufficient.

During a live round the panel must show:

- `ROUND N · LIVE` with text and icon/status treatment that does not rely on colour alone.
- A prominent actual provisional team total labelled `Live team score` or `Provisional score`.
- `Completed`, `Playing now` and `To play` player counts.
- Captain multiplier contribution included in the team total under the active competition rules.
- Last successful update time and a concise stale indicator when applicable.
- A compact `View score breakdown` action that reveals which players and rule adjustments contribute to the total.

Do not call this a projection. It is the current verified provisional total from points earned so far. If a separate projection is introduced later, it must be explicitly labelled and visually distinct.

The panel state must change appropriately:

- Before the round: `Round N starts ...` and `Score available after lockout`; no zero presented as a score.
- Live: prominent provisional score and player progress counts.
- Final but awaiting reconciliation: `Provisional final` with freshness/reconciliation messaging.
- Reconciled final: `Final score`.
- Stale/outage: retain the last verified total and label it `Stale` with the last successful update.
- No valid lineup: explain why a score cannot be calculated and provide the appropriate fix-team action.

### Placement and responsive behaviour

- Desktop: place the live-score panel immediately below the team/competition heading and above the field/list view. It may share a compact horizontal summary bar with bank/trades/team-value metrics, but the live score is the primary metric while a round is active.
- Mobile: show a compact score summary directly above the lineup. Keep `score · completed/playing/to-play` visible in a non-obstructive sticky summary while scrolling the team, without covering player cards or navigation.
- Do not require switching tabs, opening Match Centre or scrolling to the bottom to see the team score.
- Preserve all four themes, 200% zoom, 44px touch targets and zero horizontal overflow.

## Team totals and scoring rules

- Calculate the live team total using the exact active lineup snapshot for the current round.
- Apply the correct scoring rules for the explicit competition/league context.
- Respect Classic, Custom and Draft differences, bench scoring, captain/vice-captain multipliers, emergencies/auto-subs, lockouts and any active power/chip rules.
- Do not mutate or persist a live-computed total as user-edited app state.
- Finalisation must reconcile to the authoritative final score without double-counting.
- Score corrections must flow through on the next verified refresh.
- Two leagues containing the same player must show the same raw player score but calculate independent team totals under their own rules.

## Refresh behaviour

- Subscribe My Team views to the same successful live-cache update event as Match Centre.
- Re-render only the affected score/status elements where practical; avoid replacing focused controls or resetting scroll.
- Use the existing central polling interval. Do not add another interval per page, player or league.
- Pause browser polling while hidden and refresh immediately on resume, consistent with Match Centre.
- Navigating from Match Centre to My Team must immediately show the latest in-memory verified values without waiting for another request.
- A failed refresh must not blank existing scores, freeze navigation or trigger a save.

## API and security

- Reuse existing authenticated/public-safe live read endpoints and cache semantics.
- Do not expose upstream secrets or raw private payloads.
- Do not create any new production write during passive live viewing.
- User-scoped team responses must remain membership-authorised and resistant to IDOR.

## Required tests

Add regression coverage with deterministic live fixtures and clocks:

- Match Centre and Classic My Team show the same player score after one live update.
- Every team screen displays a prominent provisional live team total without opening another tab or Match Centre.
- The visible live-total panel changes correctly between pre-round, live, provisional-final, reconciled-final and stale states.
- Completed/playing/to-play counts match the player-card states.
- Mobile sticky score summary remains visible while scrolling without obscuring cards or bottom navigation.
- My Team updates from one verified live score to a corrected score without navigation or manual refresh.
- Scheduled players show `Yet to play`, not zero.
- A live zero is distinguishable from not started/missing data.
- Captain and vice-captain behaviour is correct when captain plays, captain is DNP and vice-captain takes effect.
- Bench/emergency/auto-sub calculations match existing rules.
- Classic, two Custom leagues and two Draft leagues show identical raw player scores but independent totals/rules.
- Duplicate player selections across independent league contexts do not leak lineup or score state.
- League switching uses the correct lineup immediately and never shows the prior league’s total.
- Score correction, stale cache, upstream timeout, recovery, finalisation and round transition.
- Live refresh does not send PUT/POST/PATCH/DELETE or alter persisted app state.
- Refresh preserves focus, open panels and scroll position.
- Desktop/mobile widths and all themes have no overflow or obscured scores.
- Existing Match Centre, Home, league and multi-device tests remain passing.

Run the complete static/API/isolated-PostgreSQL/Playwright suite after the focused tests.

## Production verification

- Publish through a protected PR and confirm CI and Railway deployment.
- Perform strictly read-only production verification while a round is live if possible.
- Globally intercept/block every non-GET/HEAD request.
- Compare at least three currently playing players between Match Centre and their team cards.
- Confirm the team total changes when a verified score changes and remains competition-scoped.
- Verify at 1440px and 390px with no console errors or horizontal overflow.
- Do not modify production users, leagues, teams, picks, scores, preferences or database records.
