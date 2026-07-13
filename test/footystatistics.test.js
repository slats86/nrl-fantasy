const test = require('node:test');
const assert = require('node:assert/strict');
const {parseInitialPlayerId, hasSeasonStats, findSearchPlayerId} = require('../footystatistics');

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
