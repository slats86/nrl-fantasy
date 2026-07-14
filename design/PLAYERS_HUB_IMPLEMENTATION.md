# Approved Players Hub implementation

## Visual reference

Use `design/players-hub-approved-concept.png` as the approved visual target. Match the existing production Player Stats visual system rather than treating the concept as a loose wireframe.

## Scope

- Replace the current Players hub presentation with the approved responsive design.
- Preserve the existing individual Player Stats screens and their data resolver.
- Include All Players, Watchlist, Market Movers and Injuries views.
- Include player search, filtering, sorting, watch controls and comparison selection.
- Ensure the mobile experience uses purpose-built cards, filters and a comparison tray rather than a compressed desktop table.
- Preserve all selectable colour themes.
- Include the separate readability and historical-position regression corrections already requested for individual player screens.

## Desktop Players hub

- Retain the established left navigation with Players active.
- Show the Players heading and the subtitle `Search, filter and compare every player`.
- Show summary cards for total players, injured players, watched players and data freshness/current round.
- Every summary number must be computed from current application data. Values in the visual concept are illustrative and must never be hardcoded.
- Provide a wide search field and a visible Compare count/action.
- Provide views for All Players, Watchlist, Market Movers and Injuries.
- Provide filters for position, club, price, availability, ownership and form.
- Provide sorting including form, price, average, last three, break-even, ownership and name.
- Use an information-dense table/card hybrid with player identity, availability, price, average, last three, break-even, PPM, ownership, form trend, watch and compare controls.
- Make the entire player identity area open the individual profile while keeping Watch and Compare as distinct controls.
- Add compact Watchlist and Market Movers summaries only when sufficient width is available; do not compromise the main results area.

## Mobile Players hub

- Use compact stacked player cards.
- Keep search visible near the top.
- Use horizontally scrollable view tabs and filter chips without page overflow.
- Provide a clear Filters action with an active-filter count.
- Each player card shows identity, club, position, availability, price, average, break-even, ownership, form sparkline, Watch and Compare.
- Use a full-height filter sheet with selected-filter chips, reset and result count.
- Use a persistent comparison tray only when at least one player is selected.
- Preserve the established mobile bottom navigation.
- Minimum touch target is 44px.

## Behaviour

- Search must preserve keyboard focus while typing multiple characters.
- Results update without resetting scroll or stealing focus.
- Filters can be combined, removed individually and reset together.
- Selected filters survive navigation to a player and back during the session.
- Watch and Compare actions must not accidentally open the profile.
- Comparison supports up to three players and clearly communicates the limit.
- Empty, loading, error and no-result states must be designed, not blank.
- Data freshness and stale-source warnings must remain accurate.
- Until an authorised injury source is connected, the Injuries view must use only injury data already lawfully available to the application or show an honest unavailable/empty state. Do not scrape, fabricate or infer injuries merely to reproduce the concept.

## Accessibility and readability

- Do not use text below 14px for meaningful desktop data or below 15px for expanded game-stat labels.
- Expanded game-stat values use at least 16px bold text.
- Do not rely on colour alone for injury or availability status.
- Maintain visible keyboard focus, semantic labels and screen-reader announcements.
- Meet WCAG AA contrast in all four themes.
- Support 200% zoom without losing functions or creating horizontal page overflow.

## Historical player information

- Restore `Previous seasons — performance by position` beneath the current-season game log on individual profiles.
- Keep each season/position combination separate.
- Show season, position, games, starts when available, average minutes, average Fantasy points, total Fantasy points and high score when available.
- Restore the current-season Role & Minutes summary.
- Never replace position-specific history with a season-wide average.

## Safety

- Do not change scoring formulas, live polling, the player ID resolver or upstream correction behaviour.
- Do not modify production users, teams, leagues, picks, scores or preferences.
- Keep external writes blocked during production browser verification.
- Preserve the existing audit reports and production visual baselines.

## Required validation

- Run the complete unit and HTML checks.
- Run isolated PostgreSQL integration.
- Run the complete Playwright suite.
- Add Players hub coverage at 320, 375, 390, 768, 1024, 1440 and 1920px.
- Add tests for multi-character search focus, combined filters, filter reset, sorting, Watch, three-player Compare, profile navigation/back-state restoration, empty states and stale states.
- Add tests for historical season/position restoration and desktop scoring-panel font sizes.
- Add strict visual baselines at 375px and 1440px.
- Perform read-only production verification with all non-GET production requests intercepted.
- Commit in a dedicated branch, open a PR, wait for required CI, merge, confirm Railway deployment and verify `/health` and `/ready`.
