'use strict';

const fs = require('fs');
const path = require('path');
const {validateFeed} = require('../live-data');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.NRL_FANTASY_DATA_URL || 'https://fantasy.nrl.com/data/nrl';

async function fetchJson(name, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(BASE + '/' + name + '.json', {
        signal: controller.signal,
        headers: {'Accept': 'application/json', 'User-Agent': 'NRL-Fantasy-The-Squad-Data-Bot/1.0'},
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(name + '.json returned HTTP ' + response.status);
      return validateFeed(name, await response.json());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

async function writeAtomic(file, value) {
  const target = path.join(ROOT, 'public', file + '.json');
  const temporary = target + '.tmp';
  await fs.promises.writeFile(temporary, JSON.stringify(value));
  await fs.promises.rename(temporary, target);
}

async function main() {
  const [players, rounds] = await Promise.all([fetchJson('players'), fetchJson('rounds')]);
  await Promise.all([writeAtomic('players', players), writeAtomic('rounds', rounds)]);
  const current = rounds.filter(round => ['active', 'complete'].includes(String(round.status).toLowerCase())).sort((a, b) => b.id - a.id)[0];
  console.log(JSON.stringify({players: players.length, rounds: rounds.length, currentRound: current && current.id, currentStatus: current && current.status}));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {fetchJson, writeAtomic};
