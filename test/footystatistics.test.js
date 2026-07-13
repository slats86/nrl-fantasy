const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseInitialPlayerId, hasSeasonStats, findSearchPlayerId, findSearchPlayerPath,
  hasStatComponents, hasCompleteSeasonDetails, buildOfficialPayload
} = require('../footystatistics');

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
    {id: 1627, player_id: 500845, first_name: 'Valentine', last_name: 'Holmes'}
  ];
  assert.equal(findSearchPlayerId(results, 'valentine-holmes'), '1627');
  assert.equal(findSearchPlayerId(results, 'unrelated-player'), null);
});

test('FootyStatistics search safely matches nicknames, apostrophes, hyphens and common names', () => {
  const results = [
    {id: 10, first_name: 'Joseph', nickname: 'Joey', last_name: 'Manu', player_path: '/syd/joey-manu'},
    {id: 11, first_name: "J'maine", last_name: 'Hopgood', player_path: '/par/j-maine-hopgood'},
    {id: 12, first_name: 'Dallin', last_name: 'Watene-Zelezniak', player_path: '/nzw/dallin-watene-zelezniak'},
    {id: 13, first_name: 'Josh', last_name: 'King-Togia', player_path: '/sti/josh-king-togia'},
    {id: 14, first_name: 'Josh', last_name: 'King', player_path: '/mel/josh-king'}
  ];
  assert.equal(findSearchPlayerId(results, 'joey-manu'), '10');
  assert.equal(findSearchPlayerId(results, 'j-maine-hopgood'), '11');
  assert.equal(findSearchPlayerId(results, 'dallin-watene-zelezniak'), '12');
  assert.equal(findSearchPlayerId(results, 'josh-king'), '14');
  assert.equal(findSearchPlayerPath(results, 'josh-king'), '/mel/josh-king');
  assert.equal(findSearchPlayerPath([{...results[4], player_path: '/mel/../admin'}], 'josh-king'), null);
});

test('stale 2026 records ending at Round 14 are rejected in favour of complete detail', () => {
  const scores = {'13': 65, '14': 41, '16': 19, '17': 35, '18': 80};
  const detailed = round => ({
    year: 2026, round_id: round, match_type: 'nrl', fantasy_points: scores[String(round)],
    tackles: 10, metres_gained: 150, tries: 0, goals: 0
  });
  const stale = {stats: [detailed(13), detailed(14)]};
  const fantasyOnlyLate = {stats: [detailed(13), detailed(14), {
    year: 2026, round_id: 16, match_type: 'nrl', fantasy_points: 19
  }]};
  const resolved = {stats: Object.keys(scores).map(Number).map(detailed)};
  assert.equal(hasCompleteSeasonDetails(stale, 2026, scores), false);
  assert.equal(hasCompleteSeasonDetails(fantasyOnlyLate, 2026, scores), false);
  assert.equal(hasCompleteSeasonDetails(resolved, 2026, scores), true);
  assert.equal(hasStatComponents({fantasy_points: 83}), false);
  assert.equal(hasStatComponents({tackles: 0, metres_gained: 0}), true);
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
