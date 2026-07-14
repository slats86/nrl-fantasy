const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseInitialPlayerId, hasSeasonStats, playerSlug, playerNameKey, searchQueryVariants, findSearchPlayerId, findSearchPlayerPath,
  hasStatComponents, hasCompleteSeasonDetails, payloadMatchesPlayer, mergeHistoricalPlayerStats, buildOfficialPayload
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
  assert.equal(findSearchPlayerPath([{
    id: 15, first_name: 'Tino', last_name: "Fa'asuamaleaui", player_path: '/gld/tino-faasuamaleaui'
  }], {name: "Tino Fa'asuamaleaui", slug: 'tino-fa-asuamaleaui'}), '/gld/tino-faasuamaleaui');
  assert.equal(findSearchPlayerPath([{...results[4], player_path: '/mel/../admin'}], 'josh-king'), null);
  assert.equal(playerNameKey("Tino Fa'asuamaleaui"), playerNameKey('tino-faasuamaleaui'));
  assert.deepEqual(searchQueryVariants("Tino Fa'asuamaleaui"), ["Tino Fa'asuamaleaui", 'Tino Faasuamaleaui']);
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
  assert.equal(hasCompleteSeasonDetails({stats: [detailed(18)]}, 2026, {'18': 80, '19': 0}), true);
  assert.equal(hasStatComponents({fantasy_points: 83}), false);
  assert.equal(hasStatComponents({tackles: 0, metres_gained: 0}), true);
});

test('dynamic resolution covers every club and position without player-specific mappings', () => {
  const players = require('../public/players.json').filter(player =>
    Object.keys(player.stats && player.stats.scores || {}).some(round => Number(round) > 14));
  const samples = [];
  for (const squadId of new Set(players.map(player => player.squad_id)))
    samples.push(players.find(player => player.squad_id === squadId));
  for (const position of [1, 2, 3, 4, 5, 6])
    samples.push(players.find(player => player.positions.includes(position)));
  const unique = [...new Map(samples.map(player => [player.id, player])).values()];
  unique.forEach((player, index) => {
    const name = player.first_name + ' ' + player.last_name;
    const expected = {name, slug: playerSlug(name), squadId: player.squad_id, positions: player.positions};
    const results = [
      {id: 800000 + index, first_name: player.first_name, last_name: player.last_name,
        squad_id: -1, positions: '99', player_path: '/bad/' + playerSlug(name)},
      {id: 900000 + index, player_id: player.id, first_name: player.first_name, last_name: player.last_name,
        squad_id: player.squad_id, positions: player.positions.join(','), player_path: '/club/' + playerSlug(name)}
    ];
    assert.equal(findSearchPlayerId(results, expected), String(900000 + index));
  });
  assert.equal(new Set(unique.map(player => player.squad_id)).size, 17);
  assert.deepEqual([...new Set(unique.flatMap(player => player.positions))].sort(), [1, 2, 3, 4, 5, 6]);
  const implementation = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8') +
    fs.readFileSync(path.join(__dirname, '..', 'footystatistics.js'), 'utf8');
  assert.doesNotMatch(implementation, /Valentine Holmes|Liam Henry|Jayden Campbell|500845|100007929|100001622/);
});

test('payload identity rejects another player even when rounds and scores look current', () => {
  const expected = {name: 'Player One', slug: 'player-one', squadId: 1, positions: [4]};
  assert.equal(payloadMatchesPlayer({player:{first_name:'Player', last_name:'One', squad_id:1, positions:'4'}}, expected), true);
  assert.equal(payloadMatchesPlayer({player:{first_name:'Player', last_name:'Two', squad_id:1, positions:'4'}}, expected), false);
  assert.equal(payloadMatchesPlayer({player:{first_name:'Player', last_name:'One', squad_id:2, positions:'4'}}, expected), false);
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
  assert.equal(buildOfficialPayload(player, rounds, {'18': {}}, 2026, 1627).stats.length, 0);
});

test('official current stats retain verified historical games and round context', () => {
  const current = {current_season: 2026, stats: [
    {year: 2026, round_id: 18, match_id: 118, match_type: 'nrl', fantasy_points: 80, tackles: 12}
  ]};
  const resolved = {current_season: 2025, stats: [
    {year: 2026, round_id: 14, match_id: 114, match_type: 'nrl', fantasy_points: 30},
    {year: 2025, round_id: 27, match_id: 127, match_type: 'nrl', position_match: 'Halfback', number: '7', fantasy_points: 74},
    {year: 2025, round_id: 26, match_id: 126, match_type: 'nrl', position_match: 'Fullback', number: '14', fantasy_points: 58}
  ], round_strip: [{round: 26, played: true}, {round: 27, played: true}]};
  const merged = mergeHistoricalPlayerStats(current, resolved, 2026);
  assert.deepEqual(merged.stats.map(row => [row.year, row.round_id]), [[2026, 18], [2025, 27], [2025, 26]]);
  assert.equal(merged.stats.some(row => row.year === 2026 && row.round_id === 14), false);
  assert.equal(merged.stats.find(row => row.round_id === 27).position_match, 'Halfback');
  assert.deepEqual(merged.round_strips[2025], resolved.round_strip);
});
