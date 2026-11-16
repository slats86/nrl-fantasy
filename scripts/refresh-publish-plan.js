'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAIN_REF = process.env.REFRESH_MAIN_REF || 'origin/main';
const BRANCH_REF = process.env.REFRESH_BRANCH_REF || 'origin/bot/nrl-data-refresh';

// Team-news bookkeeping is rewritten on every attempt. Ownership and projection
// fields also move after the season, without any new round result.
const VOLATILE_KEYS = new Set(['checkedAt', 'lastAttempt', 'lastSuccess', 'generatedAt', 'freshness']);
const VOLATILE_STAT_KEYS = new Set([
  'adp', 'owned_by', 'selections', 'selections_info',
  'proj_avg', 'last_3_proj_avg', 'ranks', 'season_rank', 'round_wpr', 'wpr'
]);

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (!VOLATILE_KEYS.has(key)) out[key] = stripVolatile(value[key]);
  }
  return out;
}

function roundPlayer(player) {
  const stats = {...(player.stats || {})};
  for (const key of VOLATILE_STAT_KEYS) delete stats[key];
  return {
    id: player.id,
    first_name: player.first_name ?? null,
    last_name: player.last_name ?? null,
    squad_id: player.squad_id ?? null,
    original_squad_id: player.original_squad_id ?? null,
    status: player.status ?? null,
    is_bye: player.is_bye ?? null,
    locked: player.locked ?? null,
    transfer_round: player.transfer_round ?? null,
    positions: player.positions ?? null,
    original_positions: player.original_positions ?? null,
    cost: player.cost ?? null,
    stats
  };
}

function patchFromIndex(html) {
  const match = String(html || '').match(/const __NRL_PATCH__=(.*);\/\/ \[nrl-data\]/);
  return match ? match[1] : '';
}

function signature(snapshot) {
  const payload = sortKeys({
    rounds: [...(snapshot.rounds || [])].sort((a, b) => Number(a.id) - Number(b.id)),
    players: (snapshot.players || []).map(roundPlayer).sort((a, b) => Number(a.id) - Number(b.id)),
    teamNews: stripVolatile(snapshot.teamNews || {}),
    patch: patchFromIndex(snapshot.indexHtml)
  });
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function currentRound(rounds) {
  const current = [...(rounds || [])]
    .filter(round => ['active', 'complete'].includes(String(round.status).toLowerCase()))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!current) return {round: '', status: ''};
  return {round: current.id, status: String(current.status).toLowerCase()};
}

function publishPlan({candidate, main, branch}) {
  if (!candidate || !main) throw new Error('A candidate snapshot and main snapshot are required');
  const candidateSig = signature(candidate);
  const mainSig = signature(main);
  const branchSig = branch ? signature(branch) : null;
  const matchesMain = candidateSig === mainSig;
  const matchesBranch = branchSig != null && candidateSig === branchSig;
  const publish = !matchesMain && !matchesBranch;
  const obsolete = matchesMain && (branchSig == null || branchSig === mainSig);
  const meta = currentRound(candidate.rounds);
  let reason;
  if (publish) reason = `New round data for Round ${meta.round || 'unknown'} (${meta.status || 'unknown'}); publish.`;
  else if (matchesBranch && !matchesMain) reason = 'No new round data. The open refresh branch already has this snapshot, so no commit was pushed.';
  else if (obsolete) reason = 'No new round data since main. Nothing to publish.';
  else reason = 'No new round data since main. Leaving the open refresh branch in place because it still differs.';
  return {publish, obsolete, changed: publish, reason, signature: candidateSig, ...meta};
}

function readText(ref, file) {
  if (!ref) return fs.readFileSync(path.join(ROOT, file), 'utf8');
  return execFileSync('git', ['show', `${ref}:${file}`], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
}

function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {cwd: ROOT, stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

function snapshotFrom(ref) {
  if (ref && !refExists(ref)) return null;
  return {
    players: JSON.parse(readText(ref, 'public/players.json')),
    rounds: JSON.parse(readText(ref, 'public/rounds.json')),
    teamNews: JSON.parse(readText(ref, 'public/team-news.json')),
    indexHtml: readText(ref, 'index.html')
  };
}

function planAgainstRefs(mainRef = MAIN_REF, branchRef = BRANCH_REF) {
  const main = snapshotFrom(mainRef);
  if (!main) throw new Error(`Could not read data files from ${mainRef}`);
  return publishPlan({candidate: snapshotFrom(null), main, branch: snapshotFrom(branchRef)});
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(planAgainstRefs()) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {signature, publishPlan, snapshotFrom, patchFromIndex, planAgainstRefs};
