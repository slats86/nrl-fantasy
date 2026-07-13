const test = require('node:test');
const assert = require('node:assert/strict');
const {parseInitialPlayerId, hasSeasonStats} = require('../footystatistics');

test('FootyStatistics profile source exposes its current internal player ID', () => {
  const source = `function playerHistoryTable() { return { initialPlayerId: 1627, isAuthenticated: true }; }`;
  assert.equal(parseInitialPlayerId(source), '1627');
  assert.equal(parseInitialPlayerId('initialPlayerId: null'), null);
});

test('FootyStatistics payload validation rejects stale duplicate player records', () => {
  assert.equal(hasSeasonStats({stats: [{year: 2025, match_type: 'nrl'}]}, 2026), false);
  assert.equal(hasSeasonStats({stats: [{year: 2026, match_type: 'origin'}, {year: 2026, match_type: 'nrl'}]}, 2026), true);
});
