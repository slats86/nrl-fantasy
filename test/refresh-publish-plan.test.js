'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {publishPlan, signature} = require('../scripts/refresh-publish-plan');

function indexWith(patch) {
  return `<html>\nconst __NRL_PATCH__=${JSON.stringify(patch)};// [nrl-data]\n</html>\n`;
}

function fixture() {
  return {
    players: [{
      id: 1, first_name: 'Payne', last_name: 'Haas', squad_id: 10, original_squad_id: 10,
      status: 'active', is_bye: false, locked: false, transfer_round: null, positions: [1],
      original_positions: [1], cost: 800,
      stats: {scores: {26: 60}, prices: {26: 800000}, selections: 1000, selections_info: {r: 1}, adp: 4.2, owned_by: 30, avg_points: 55}
    }],
    rounds: [{id: 27, status: 'scheduled', matches: [{id: 2701, status: 'scheduled', home_score: null, away_score: null}]}],
    teamNews: {
      latestRound: 23, sourceHash: 'abc', lastAttempt: '2026-08-05T01:43:41.413Z',
      checkedAt: '2026-08-05T01:43:41.413Z', generatedAt: '2026-08-05T01:43:41.413Z',
      lastSuccess: '2026-08-05T01:43:41.413Z', freshness: 'fresh',
      availability: [{playerName: 'Haas', checkedAt: '2026-08-01T00:00:00.000Z'}], teamLists: []
    },
    indexHtml: indexWith({maxR: 26})
  };
}

function withCompletedRound(snapshot) {
  const next = structuredClone(snapshot);
  next.rounds[0].status = 'complete';
  next.rounds[0].matches[0].status = 'complete';
  next.rounds[0].matches[0].home_score = 20;
  next.rounds[0].matches[0].away_score = 18;
  next.players[0].stats.scores = {26: 60, 27: 44};
  next.players[0].stats.prices = {26: 800000, 27: 820000};
  next.players[0].cost = 820;
  next.indexHtml = indexWith({maxR: 27, off: {'0': {27: 44}}});
  return next;
}

test('ownership churn and team-news timestamps are not new round data', () => {
  const main = fixture();
  const candidate = structuredClone(main);
  candidate.players[0].stats.selections = 1400;
  candidate.players[0].stats.selections_info = {r: 2};
  candidate.players[0].stats.adp = 3.1;
  candidate.players[0].stats.owned_by = 44;
  candidate.teamNews.lastAttempt = '2026-11-16T03:52:32.775Z';
  candidate.teamNews.checkedAt = '2026-11-16T03:52:32.775Z';
  candidate.teamNews.freshness = 'stale';
  candidate.teamNews.availability[0].checkedAt = '2026-11-16T03:52:32.775Z';
  const plan = publishPlan({candidate, main, branch: null});
  assert.equal(signature(candidate), signature(main));
  assert.equal(plan.publish, false);
  assert.equal(plan.obsolete, true);
  assert.match(plan.reason, /No new round data since main/);
});

test('an open refresh branch is left untouched when the round snapshot is unchanged', () => {
  const main = fixture();
  const branch = withCompletedRound(main);
  const candidate = structuredClone(branch);
  candidate.players[0].stats.adp = 9;
  candidate.teamNews.lastAttempt = '2026-11-16T04:00:00.000Z';
  const plan = publishPlan({candidate, main, branch});
  assert.equal(plan.publish, false);
  assert.equal(plan.changed, false);
  assert.equal(plan.obsolete, false);
  assert.match(plan.reason, /no commit was pushed/);
});

test('a new completed round still publishes', () => {
  const main = fixture();
  const candidate = withCompletedRound(main);
  const plan = publishPlan({candidate, main, branch: null});
  assert.equal(plan.publish, true);
  assert.equal(plan.obsolete, false);
  assert.equal(plan.round, 27);
  assert.equal(plan.status, 'complete');
});

test('a worktree that matches main does not close a refresh branch with newer round data', () => {
  const main = fixture();
  const branch = withCompletedRound(main);
  const plan = publishPlan({candidate: structuredClone(main), main, branch});
  assert.equal(plan.publish, false);
  assert.equal(plan.obsolete, false);
  assert.match(plan.reason, /still differs/);
});

test('matching main and the refresh branch closes the obsolete pull request', () => {
  const main = fixture();
  const branch = structuredClone(main);
  branch.players[0].stats.selections = 1;
  branch.teamNews.lastAttempt = '2026-11-16T00:00:00.000Z';
  const plan = publishPlan({candidate: structuredClone(main), main, branch});
  assert.equal(plan.publish, false);
  assert.equal(plan.obsolete, true);
});

test('the fetch workflow publishes only a changed round snapshot', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../.github/workflows/fetch-data.yml'), 'utf8');
  assert.match(yaml, /node scripts\/refresh-publish-plan\.js/);
  assert.match(yaml, /steps\.prepare\.outputs\.obsolete == 'true'/);
  assert.equal(yaml.includes("steps.prepare.outputs.changed == 'false'"), false);
});
