'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {selectCurrentRound, refreshDelay, normalizedStatus, validateFeed} = require('../live-data');
const {buildPatch, updateIndex} = require('../scripts/update-nrl-data');
const {summary} = require('../scripts/audit-round-pipeline');

const seasonData = 'const FEEDIDS=[101,102]; const SQUAD_FEED_IDS=[1,2,3];';
const player = score => ({id: 101, stats: {scores: score, prices: {18: 500000, 19: 510000, 20: 520000}}});
const match = (status, home = 10, away = 8) => ({id: 1901, status, home_squad_id: 1, away_squad_id: 2,
  home_squad_name: 'Home', away_squad_name: 'Away', home_score: home, away_score: away, date: '2026-07-10T20:00:00+10:00'});
const round = (id, status, matches = [match(status)]) => ({id, status, start: `2026-07-${id === 18 ? '03' : id === 19 ? '10' : '16'}T20:00:00+10:00`, matches});
const validPlayers = value => [value, ...Array.from({length: 99}, (_, index) => ({id: 1000 + index, stats: {scores: {}, prices: {}}}))];
const validRounds = values => {
  const ids = new Set(values.map(value => value.id));
  return values.concat(Array.from({length: 27}, (_, index) => index + 1).filter(id => !ids.has(id)).map(id => ({id, status: 'scheduled', matches: []}))).slice(0, 27);
};

test('current round advances 18 to live/final 19 and future 20 without special cases', () => {
  assert.equal(selectCurrentRound([round(18, 'complete')]).id, 18);
  assert.equal(selectCurrentRound([round(18, 'complete'), round(19, 'active', [match('active')])]).id, 19);
  assert.equal(selectCurrentRound([round(18, 'complete'), round(19, 'complete')]).id, 19);
  assert.equal(selectCurrentRound([round(19, 'complete'), round(20, 'active', [match('live')])]).id, 20);
});

test('scheduled, live and completed fixtures normalize across upstream status variants', () => {
  assert.equal(normalizedStatus('scheduled'), 'scheduled');
  assert.equal(normalizedStatus('in_progress'), 'live');
  assert.equal(normalizedStatus('full_time'), 'complete');
});

test('transformation retains live team scores and safely replaces provisional corrections', () => {
  const scheduled = buildPatch(validPlayers(player({18: 50})), validRounds([round(18, 'complete'), round(19, 'scheduled', [match('scheduled', 0, 0)])]), seasonData);
  assert.deepEqual(scheduled.fix[19].games[0].slice(2), [null, null]);
  const live = buildPatch(validPlayers(player({18: 50, 19: 61})), validRounds([round(18, 'complete'), round(19, 'active', [match('active', 12, 8)])]), seasonData);
  assert.deepEqual(live.fix[19].games[0].slice(2), [12, 8]);
  const corrected = buildPatch(validPlayers(player({18: 50, 19: 64})), validRounds([round(18, 'complete'), round(19, 'complete', [match('complete', 14, 8)])]), seasonData);
  assert.deepEqual(corrected.fix[19].games[0].slice(2), [14, 8]);
  assert.equal(corrected.off[0][19], 64);
  assert.equal(corrected.maxR, 19);
});

test('refresh cadence is frequent only live, reduced while hidden and stopped after final', () => {
  const live = selectCurrentRound([round(19, 'active', [match('active')])]);
  const final = selectCurrentRound([round(19, 'complete')]);
  assert.equal(refreshDelay(live), 30000);
  assert.equal(refreshDelay(live, Date.now(), true), 900000);
  assert.equal(refreshDelay(final), 900000);
});

test('round audit rejects missing score data and reports current fixtures', () => {
  const result = summary([round(19, 'complete')], [player({19: 64})], 19);
  assert.equal(result.round, 19); assert.equal(result.playersWithScores, 1);
  assert.equal(result.matches[0].status, 'complete');
});

test('feed validation and embedded patch replacement fail safely on malformed data', () => {
  assert.throws(() => validateFeed('rounds', [{id: 19}]), /validation/);
  assert.throws(() => updateIndex('<html></html>', {maxR: 19}), /pattern/);
});
