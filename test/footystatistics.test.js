const test = require('node:test');
const assert = require('node:assert/strict');
const {parseInitialPlayerId, hasSeasonStats, findSearchPlayerId, buildOfficialPayload} = require('../footystatistics');

test('FootyStatistics profile source exposes its current internal player ID', () => {
  const source = `function playerHistoryTable() { return { initialPlayerId: 1627, isAuthenticated: true }; }`;
  assert.equal(parseInitialPlayerId(source), '1627');
  assert.equal(parseInitialPlayerId('initialPlayerId: null'), null);
});

test('FootyStatistics payload validation rejects stale duplicate player records', () => {
  assert.equal(hasSeasonStats({stats: [{year: 2025, match_type: 'nrl'}]}, 2026), false);
  assert.equal(hasSeasonStats({stats: [{year: 2026, match_type: 'origin'}, {year: 2026, match_type: 'nrl'}]}, 2026), true);
});

test('FootyStatistics search selects the exact current player record', () => {
  const results = [
    {id: 500845, first_name: 'Val', last_name: 'Holmes'},
    {id: 1627, first_name: 'Valentine', last_name: 'Holmes'}
  ];
  assert.equal(findSearchPlayerId(results, 'valentine-holmes'), '1627');
  assert.equal(findSearchPlayerId(results, 'unrelated-player'), null);
});

test('official NRL fallback preserves the resolved source ID and detailed round stats', () => {
  const player = {
    id: 500845, first_name: 'Valentine', last_name: 'Holmes', squad_id: 500022,
    stats: {scores: {'18': 80}, prices: {'18': 445000}, avg_points: 38.4}
  };
  const rounds = [{id: 18, matches: [{
    id: 1111820, home_squad_id: 500022, away_squad_id: 500023,
    home_squad_name: 'Dragons', away_squad_name: 'Tigers', home_score: 24,
    away_score: 10, venue_name: 'Jubilee Stadium', status: 'complete'
  }]}];
  const payload = buildOfficialPayload(player, rounds, {'18': {T: 1, G: 7, MG: 175, TCK: 12}}, 2026, 1627);
  assert.equal(payload.source_player_id, 1627);
  assert.equal(payload.current_season, 2026);
  assert.equal(payload.stats[0].round_id, 18);
  assert.equal(payload.stats[0].fantasy_points, 80);
  assert.equal(payload.stats[0].tries, 1);
  assert.equal(payload.stats[0].goals, 7);
  assert.equal(payload.stats[0].metres_gained, 175);
  assert.equal(payload.stats[0].opponent, 'Tigers');
});
