# Compact My Competitions redesign

Implement only the Home dashboard `My competitions` presentation shown in `design/competitions-section-approved.png`.

This is a UI refinement of the dashboard delivered in PR #67 and reported in PR #68. Do not redesign or remove the Home command centre, APIs, alerts, Team News, scheduler, ingestion, persistence or multi-league model.

## Approved visual direction

Replace the large tiled competition cards with one compact full-width panel containing horizontal competition rows.

The current problems to remove are:

- Six oversized cards occupying most of the first screen.
- Repeated large `Awaiting lockout` headings.
- Empty dash metrics.
- `No matchup` filler on formats without a matchup.
- Repeated update timestamps that dominate useful information.
- Equal visual emphasis for ready, inactive and action-required competitions.

## Desktop layout

- Keep the `LIVE ROUND` kicker and `My competitions` heading.
- Add a small competition-count chip beside the heading.
- Replace `View all competitions` with the quieter `Manage competitions` link.
- Use one bordered panel with compact horizontal rows separated by subtle dividers.
- Show at most four competition rows initially.
- Finish with one compact footer showing the number hidden and `Show all N`.
- When expanded, show all competitions in the same compact row format and change the control to `Show fewer`.
- Avoid nested oversized cards, unnecessary blank space and horizontal scrolling.

Each row contains:

1. A small format icon/badge and format label.
2. League name as the primary label.
3. Team name as secondary text.
4. One prominent status badge.
5. One meaningful contextual summary.
6. One compact action button.

The row itself may be clickable, but its action button and accessible label must make the destination explicit.

## Dynamic states

Do not hardcode the example text in the concept. Derive each state from the existing server-authoritative competition summary.

### Action required

Examples:

- `ACTION REQUIRED` · `3 positions still open` · `Fix team`
- `CAPTAIN REQUIRED` · `Choose a captain before lockout` · `Fix team`
- `DRAFT NOW` · `Your turn · 01:24 remaining` · `Draft now`

This state sorts first and uses amber/red severity styling consistent with existing themes.

### Live

Examples:

- `LIVE` · `824 pts · 7 playing · 4 remaining` · `Open team`
- `LIVE MATCHUP` · `824–798 vs Sharks` · `Open matchup`

Live state sorts after unresolved action-required competitions and uses the normal live treatment.

### Ready / scheduled

Examples:

- `TEAM READY` · `21/21 selected · Lockout Fri 7:50 pm` · `Manage`
- `DRAFT COMPLETE` · `Round 20 · Matchup pending` · `Open`
- `SCHEDULED` · `Round 20 starts Fri 7:50 pm` · `Open`

Ready/scheduled rows are visually calm and must not repeat a giant `Awaiting lockout` label.

### Final / complete

Examples:

- `FINAL` · `1,126 pts · 3rd of 12` · `View results`
- `SEASON COMPLETE` · `Final rank 2 of 8` · `View`

### Missing or unavailable data

- Never render misleading zeroes.
- Never render empty metric grids or rows of dashes.
- Omit concepts that do not apply to the competition format.
- Use one concise explanation such as `Score available after lockout` or `Live data temporarily unavailable` only when useful.
- Preserve the existing stale/freshness indication, but put a short stale marker in the relevant row rather than repeating full timestamps in every normal row.

## Competition identity

- Preserve explicit competition, league and team IDs for every row and action.
- League name and team name must remain distinguishable.
- Multiple leagues with the same display name must still open the correct context.
- Classic, every Custom league, every Draft league and supported Origin competitions remain independent.
- No score, matchup, rank, team state or destination may leak between rows.

## Ordering

Use this deterministic priority:

1. Action required.
2. Draft turn/expiring action.
3. Live.
4. Scheduled/ready.
5. Final/season complete.

Keep stable ordering inside each group. Expanding/collapsing must not reorder equivalent rows unexpectedly.

## Mobile layout

At mobile widths, retain the compact list rather than reverting to large cards.

- Each competition is one compact stacked row/card.
- First line: format, league and status.
- Second line: team and contextual summary.
- Third line only when necessary: full-width action button.
- Do not use a horizontal carousel.
- Do not hide an action-required competition behind `Show all`.
- Keep touch targets at least 44px.
- Avoid clipped names, horizontal overflow and excessive vertical whitespace.

## Accessibility

- Use semantic headings and a list/table-like relationship appropriate to the final markup.
- Status must not rely on colour alone.
- Every icon needs an accessible name or must be decorative.
- Buttons must identify the league/team destination, e.g. `Fix team in My Custom League`.
- Expanded/collapsed control must expose `aria-expanded` and the controlled region.
- Preserve visible focus, keyboard order, screen-reader announcements and reduced-motion behaviour.

## Performance and resilience

- Reuse the existing dashboard summary response; do not introduce one request per row.
- Do not change scheduler or ingestion behaviour.
- A row with partial data must not block other rows or Home navigation.
- Do not add duplicate polling or rerender loops.
- Preserve Home state when returning from a competition.

## Tests

Update the relevant unit/API assertions only where presentation contracts changed, and add Playwright coverage for:

- Six competitions render as four initial rows plus `Show all 6`.
- Expanding reveals all six and `Show fewer` restores the compact state.
- Action-required competitions remain visible before expansion.
- No `Awaiting lockout`, empty dash grid or inapplicable `No matchup` filler appears.
- Classic, two Custom, two Draft and one Origin row each deep-link to the correct independent context.
- Action-required, live, ready, scheduled, final, stale and partial-data states.
- Duplicate display names still open the correct league ID.
- Desktop and mobile at 320, 375, 390, 768, 1024, 1440 and 1920px.
- All four themes, keyboard use, 200% zoom and zero horizontal overflow.
- Existing alerts, Team News and scheduled ingestion tests remain unchanged and passing.

Run the complete existing static/API/PostgreSQL/Playwright suite because this section touches shared Home rendering.

## Delivery

- Update `PRODUCT_TEST_REPORT.md` with a focused UI delta.
- Publish through a protected PR and confirm required CI.
- Confirm Railway deployment and production monitor.
- Production verification must block all non-GET/HEAD requests and must not modify any production user, league, team, pick, score, preference or database record.
- Verify the approved compact section at 1440px and 390px with no browser errors or overflow.
