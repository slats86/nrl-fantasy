'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {playerSlug, payloadMatchesPlayer, hasStatComponents} = require('../footystatistics');

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true];
}));
const production = Boolean(args['read-only']);
const baseUrl = String(args['base-url'] || (production ? 'https://nrl.the-squad.com.au' : 'http://127.0.0.1:32289')).replace(/\/$/, '');
const concurrency = Math.max(1, Math.min(6, Number(args.concurrency) || 3));
const delayMs = Math.max(50, Number(args.delay) || 175);
const outputPrefix = String(args['output-prefix'] || (production ? 'reports/player-stats-production-audit' : 'reports/player-stats-audit'));
const players = require('../public/players.json').filter(player =>
  Object.entries(player.stats && player.stats.scores || {}).some(([round, score]) =>
    Number(round) > 14 && score !== null && score !== undefined && Number(score) !== 0)
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {headers: {'Cache-Control': 'no-cache'}});
      if (response.status === 429 || response.status >= 500) throw new Error('HTTP ' + response.status);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(400 * attempt);
    }
  }
  throw lastError;
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error('local audit server exited before becoming ready');
    try { if ((await fetch(baseUrl + '/health')).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('local audit server did not become ready');
}

async function auditPlayer(player) {
  await sleep(delayMs);
  const name = player.first_name + ' ' + player.last_name;
  const slug = playerSlug(name);
  const expectedRounds = Object.entries(player.stats && player.stats.scores || {})
    .filter(([round, score]) => Number(round) > 14 && score !== null && score !== undefined && Number(score) !== 0)
    .map(([round]) => Number(round));
  const base = {name, slug, officialId: player.id, resolvedId: null, expectedRounds};
  try {
    const response = await fetchWithRetry(baseUrl + '/api/player-stats/' + player.id + '?slug=' + encodeURIComponent(slug));
    const payload = await response.json();
    const resolvedId = response.headers.get('x-footystatistics-player-id');
    const resolution = response.headers.get('x-footystatistics-resolution') || payload.resolution_status || 'unknown';
    const method = response.headers.get('x-footystatistics-resolution-method') || payload.resolution_method || 'unknown';
    const ambiguous = response.headers.get('x-footystatistics-ambiguous') === 'true';
    const source = response.headers.get('x-player-stats-source') || 'unknown';
    const fallbackReason = response.headers.get('x-player-stats-fallback-reason') || '';
    const identityValid = payloadMatchesPlayer(payload, {
      name, slug, squadId: player.squad_id, positions: player.positions
    });
    const current = Array.isArray(payload.stats) ? payload.stats.filter(stat =>
      Number(stat.year) === new Date().getFullYear() && stat.match_type === 'nrl') : [];
    const missingExpectedRounds = expectedRounds.filter(round => !current.some(stat => Number(stat.round_id) === round));
    const roundsWithoutComponents = expectedRounds.filter(round => {
      const stat = current.find(item => Number(item.round_id) === round); return !stat || !hasStatComponents(stat);
    });
    const ok = response.ok && identityValid && !missingExpectedRounds.length && !roundsWithoutComponents.length;
    return {...base, resolvedId, resolution, method, ambiguous, source, fallbackReason,
      status: response.status, identityValid, missingExpectedRounds, roundsWithoutComponents, ok, error: payload.error || null};
  } catch (error) {
    return {...base, resolution: 'upstream-failure', method: 'none', ambiguous: false, source: 'none',
      fallbackReason: 'upstream-failure', status: 0, identityValid: false,
      missingExpectedRounds: expectedRounds, roundsWithoutComponents: [], ok: false, error: error.message};
  }
}

async function runPool(items) {
  const results = new Array(items.length); let next = 0;
  async function worker() {
    while (next < items.length) { const index = next++; results[index] = await auditPlayer(items[index]); }
  }
  await Promise.all(Array.from({length: concurrency}, worker)); return results;
}

function category(results, predicate) { return results.filter(predicate).map(result => ({
  name: result.name, officialId: result.officialId, resolvedId: result.resolvedId,
  rounds: result.missingExpectedRounds.length ? result.missingExpectedRounds : result.roundsWithoutComponents,
  reason: result.fallbackReason || result.error || result.resolution
})); }

function markdown(report) {
  const s = report.summary;
  const lines = ['# Player statistics audit', '', `Generated: ${report.generatedAt}`, `Target: ${report.target}`,
    '', '## Summary', '', '| Metric | Count |', '|---|---:|',
    `| Total players checked | ${s.totalPlayersChecked} |`, `| Successfully resolved | ${s.successfullyResolvedPlayers} |`,
    `| Effective successes | ${s.effectiveSuccesses} |`, `| Unresolved | ${s.unresolvedPlayers} |`,
    `| Ambiguous searches | ${s.ambiguousSearchResults} |`, `| Stale upstream records | ${s.staleRecords} |`,
    `| Missing expected rounds | ${s.playersMissingExpectedRounds} |`,
    `| Fantasy rounds without components | ${s.playersWithRoundsWithoutComponents} |`,
    `| Upstream failures | ${s.upstreamFailures} |`, `| Effective failures | ${s.effectiveFailures} |`,
    '', '## Players', '', '| Player | Official ID | Resolved ID | Resolution | Source | Identity | Missing rounds | Component gaps | Result |',
    '|---|---:|---:|---|---|---|---|---|---|'];
  for (const result of report.players) lines.push(`| ${result.name.replace(/\|/g, '\\|')} | ${result.officialId} | ${result.resolvedId || '—'} | ${result.resolution}/${result.method} | ${result.source} | ${result.identityValid ? 'yes' : 'no'} | ${result.missingExpectedRounds.join(', ') || '—'} | ${result.roundsWithoutComponents.join(', ') || '—'} | ${result.ok ? 'PASS' : 'FAIL'} |`);
  return lines.join('\n') + '\n';
}

(async () => {
  let server = null;
  try {
    if (!production && !args['base-url']) {
      server = spawn(process.execPath, ['server.js'], {cwd: path.join(__dirname, '..'),
        env: {...process.env, PORT: '32289', APP_URL: baseUrl, DATA_DIR: '/tmp/nrl-player-audit'}, stdio: 'ignore'});
      await waitForServer(server);
    }
    const results = await runPool(players);
    const report = {generatedAt: new Date().toISOString(), target: baseUrl, readOnly: production, summary: {
      totalPlayersChecked: results.length,
      successfullyResolvedPlayers: results.filter(result => result.resolution === 'resolved').length,
      effectiveSuccesses: results.filter(result => result.ok).length,
      unresolvedPlayers: results.filter(result => result.resolution !== 'resolved').length,
      ambiguousSearchResults: results.filter(result => result.ambiguous).length,
      staleRecords: results.filter(result => result.fallbackReason === 'incomplete-details').length,
      playersMissingExpectedRounds: results.filter(result => result.missingExpectedRounds.length).length,
      playersWithRoundsWithoutComponents: results.filter(result => result.roundsWithoutComponents.length).length,
      upstreamFailures: results.filter(result => result.fallbackReason === 'upstream-failure' || result.resolution === 'upstream-failure').length,
      effectiveFailures: results.filter(result => !result.ok).length
    }, categories: {
      unresolvedPlayers: category(results, result => result.resolution !== 'resolved'),
      ambiguousSearchResults: category(results, result => result.ambiguous),
      staleRecords: category(results, result => result.fallbackReason === 'incomplete-details'),
      missingExpectedRounds: category(results, result => result.missingExpectedRounds.length),
      roundsWithoutComponents: category(results, result => result.roundsWithoutComponents.length),
      upstreamFailures: category(results, result => result.fallbackReason === 'upstream-failure' || result.resolution === 'upstream-failure')
    }, players: results};
    fs.mkdirSync(path.dirname(outputPrefix), {recursive: true});
    fs.writeFileSync(outputPrefix + '.json', JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(outputPrefix + '.md', markdown(report));
    const s = report.summary;
    process.stdout.write(`Player stats audit: checked ${s.totalPlayersChecked}; effective successes ${s.effectiveSuccesses}; resolved ${s.successfullyResolvedPlayers}; unresolved ${s.unresolvedPlayers}; ambiguous ${s.ambiguousSearchResults}; stale ${s.staleRecords}; missing rounds ${s.playersMissingExpectedRounds}; component gaps ${s.playersWithRoundsWithoutComponents}; upstream failures ${s.upstreamFailures}; effective failures ${s.effectiveFailures}.\nReports: ${outputPrefix}.json, ${outputPrefix}.md\n`);
    if (s.effectiveFailures) process.exitCode = 1;
  } finally { if (server) server.kill('SIGTERM'); }
})().catch(error => { process.stderr.write('Player stats audit failed: ' + error.message + '\n'); process.exit(1); });
