'use strict';

const fs = require('fs');
const path = require('path');
const {normalizedStatus, validateFeed} = require('../live-data');

const ROOT = path.join(__dirname, '..');

function buildPatch(players, rounds, seasonData) {
  validateFeed('players', players); validateFeed('rounds', rounds);
  const feedMatch = seasonData.match(/const FEEDIDS=\[([^\]]+)\]/);
  const squadMatch = seasonData.match(/const SQUAD_FEED_IDS=\[([^\]]+)\]/);
  if (!feedMatch || !squadMatch) throw new Error('Could not find FEEDIDS or SQUAD_FEED_IDS');
  const FEEDIDS = JSON.parse('[' + feedMatch[1] + ']');
  const SQUAD_FEED_IDS = JSON.parse('[' + squadMatch[1] + ']');
  const idMap = Object.fromEntries(FEEDIDS.map((id, index) => [id, index]));
  const squadMap = Object.fromEntries(SQUAD_FEED_IDS.map((id, index) => [id, index]));
  const complete = rounds.filter(round => normalizedStatus(round.status) === 'complete').map(round => Number(round.id));
  const maxR = complete.length ? Math.max(...complete) : 0;
  const patch = {maxR, off: {}, price: {}, fix: {}};
  for (const player of players) {
    const index = idMap[player.id];
    if (index == null) continue;
    for (let round = 1; round <= maxR; round++) {
      if (player.stats && player.stats.scores && player.stats.scores[round] != null)
        (patch.off[index] ||= {})[round] = player.stats.scores[round];
      if (player.stats && player.stats.prices && player.stats.prices[round] != null)
        (patch.price[index] ||= {})[round] = Math.round(player.stats.prices[round] / 1000);
    }
  }
  for (const round of rounds) {
    patch.fix[round.id] = {
      byes: (round.bye_squads || []).map(id => squadMap[id]).filter(id => id != null),
      games: (round.matches || []).map(match => {
        const status = normalizedStatus(match.status);
        const started = status === 'live' || status === 'complete';
        return [squadMap[match.home_squad_id], squadMap[match.away_squad_id],
          started && match.home_score != null ? match.home_score : null,
          started && match.away_score != null ? match.away_score : null];
      }).filter(([home, away]) => home != null && away != null)
    };
  }
  return patch;
}

function updateIndex(html, patch) {
  const pattern = /const __NRL_PATCH__=[^/]+\/\/ \[nrl-data\]/;
  if (!pattern.test(html)) throw new Error('Embedded data replacement pattern was not found');
  return html.replace(pattern, 'const __NRL_PATCH__=' + JSON.stringify(patch) + ';// [nrl-data]');
}

function main() {
  const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/players.json'), 'utf8'));
  const rounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/rounds.json'), 'utf8'));
  const seasonData = fs.readFileSync(path.join(ROOT, 'public/assets/season-data.js'), 'utf8');
  const indexPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const patch = buildPatch(players, rounds, seasonData);
  const updated = updateIndex(html, patch);
  if (updated !== html) fs.writeFileSync(indexPath, updated);
  const latest = rounds.filter(round => normalizedStatus(round.status) !== 'scheduled').sort((a, b) => b.id - a.id)[0];
  if (latest && latest.id > patch.maxR + 1) throw new Error('Generated data is more than one round behind the official feed');
  console.log(JSON.stringify({maxR: patch.maxR, latestRound: latest && latest.id, latestStatus: latest && latest.status,
    playersWithScores: Object.keys(patch.off).length, fixtures: Object.keys(patch.fix).length, changed: updated !== html}));
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = {buildPatch, updateIndex};
