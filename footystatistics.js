'use strict';

function parseInitialPlayerId(source) {
  const match = String(source || '').match(/\binitialPlayerId\s*:\s*(\d+)\b/);
  return match ? match[1] : null;
}

function hasSeasonStats(payload, year) {
  return Boolean(payload && Array.isArray(payload.stats) && payload.stats.some(stat =>
    Number(stat.year) === Number(year) && stat.match_type === 'nrl'
  ));
}

function playerSlug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function playerNameKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[\u2018\u2019'`]/g, '').replace(/[^a-z0-9]/g, '');
}

function searchQueryVariants(value) {
  const original = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  return [...new Set([
    original,
    original.replace(/[\u2018\u2019'`]/g, ''),
    original.replace(/[-\u2010-\u2015]/g, ' ')
  ].map(query => query.trim().replace(/\s+/g, ' ')).filter(Boolean))];
}

function numericPositions(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,/]/);
  return values.map(Number).filter(position => Number.isInteger(position) && position > 0);
}

function searchPlayerSelection(results, expected) {
  if (!Array.isArray(results)) return null;
  const criteria = typeof expected === 'string' ? {slug: expected} : (expected || {});
  const wanted = playerNameKey(criteria.name || criteria.slug);
  const wantedPositions = numericPositions(criteria.positions);
  const matches = results.filter(player => [
    player.name,
    [player.first_name, player.last_name].filter(Boolean).join(' '),
    [player.nickname, player.last_name].filter(Boolean).join(' '),
    [player.first_name, player.nickname, player.last_name].filter(Boolean).join(' ')
  ].some(name => playerNameKey(name) === wanted)).map(player => {
    const positions = numericPositions(player.positions || player.positions_list);
    let score = 0;
    if (playerNameKey(player.slug || String(player.player_path || '').split('/').pop()) === wanted) score += 4;
    if (criteria.squadId && Number(player.squad_id) === Number(criteria.squadId)) score += 8;
    if (wantedPositions.length && positions.some(position => wantedPositions.includes(position))) score += 3;
    if (player.player_id && String(player.id) !== String(player.player_id)) score += 2;
    if (player.active === true) score += 1;
    return {player, score};
  }).sort((a, b) => b.score - a.score);
  if (!matches.length) return {player: null, ambiguous: false, candidates: []};
  const top = matches.filter(match => match.score === matches[0].score);
  const ids = new Set(top.map(match => String(match.player.id || match.player.player_id || '')));
  return {player: top[0].player, ambiguous: ids.size > 1, candidates: matches.map(match => match.player)};
}

function findSearchPlayer(results, expected) {
  const selection = searchPlayerSelection(results, expected);
  return selection && !selection.ambiguous ? selection.player : null;
}

function findSearchPlayerId(results, expected) {
  const match = findSearchPlayer(results, expected);
  return match && /^\d+$/.test(String(match.id || match.player_id || ''))
    ? String(match.id || match.player_id) : null;
}

function findSearchPlayerPath(results, expected) {
  const criteria = typeof expected === 'string' ? {slug: expected} : (expected || {});
  const match = findSearchPlayer(results, criteria);
  const playerPath = String(match && match.player_path || '');
  const wanted = playerNameKey(criteria.name || criteria.slug);
  return /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(playerPath) &&
    playerNameKey(playerPath.split('/').pop()) === wanted ? playerPath : null;
}

const DETAIL_FIELDS = ['tackles', 'metres_gained', 'tries', 'goals'];
function hasStatComponents(stat) {
  return DETAIL_FIELDS.some(field => stat && stat[field] !== null && stat[field] !== '' &&
    Number.isFinite(Number(stat[field])));
}

function hasCompleteSeasonDetails(payload, year, scores) {
  if (!payload || !Array.isArray(payload.stats)) return false;
  const expectedRounds = Object.entries(scores || {}).filter(([, score]) => score !== null && score !== undefined && Number(score) !== 0)
    .map(([round]) => Number(round)).filter(Number.isFinite);
  if (!expectedRounds.length) return hasSeasonStats(payload, year);
  const currentStats = payload.stats.filter(stat => Number(stat.year) === Number(year) && stat.match_type === 'nrl');
  return expectedRounds.every(round => {
    const stat = currentStats.find(item => Number(item.round_id) === round);
    return hasStatComponents(stat);
  });
}

function payloadMatchesPlayer(payload, expected) {
  const player = payload && payload.player;
  if (!player) return false;
  const wanted = playerNameKey(expected && (expected.name || expected.slug));
  const names = [player.name, [player.first_name, player.last_name].filter(Boolean).join(' '),
    [player.nickname, player.last_name].filter(Boolean).join(' ')];
  if (!names.some(name => playerNameKey(name) === wanted)) return false;
  if (expected.squadId && player.squad_id && Number(expected.squadId) !== Number(player.squad_id)) return false;
  const expectedPositions = numericPositions(expected.positions);
  const actualPositions = numericPositions(player.positions);
  return !expectedPositions.length || !actualPositions.length || actualPositions.some(position => expectedPositions.includes(position));
}

function mergeHistoricalPlayerStats(currentPayload, resolvedPayload, currentYear) {
  const current = currentPayload && typeof currentPayload === 'object' ? currentPayload : {};
  const resolved = resolvedPayload && typeof resolvedPayload === 'object' ? resolvedPayload : {};
  const currentStats = Array.isArray(current.stats) ? current.stats : [];
  const historicalStats = (Array.isArray(resolved.stats) ? resolved.stats : []).filter(stat =>
    stat && stat.match_type === 'nrl' && Number(stat.year) !== Number(currentYear) &&
    Number.isFinite(Number(stat.year)) && Number.isFinite(Number(stat.round_id))
  );
  const seen = new Set();
  const stats = [...currentStats, ...historicalStats].filter(stat => {
    const key = [stat.year, stat.round_id, stat.match_type, stat.match_id || ''].join(':');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => Number(b.year) - Number(a.year) || Number(b.round_id) - Number(a.round_id));
  const roundStrips = Object.assign({}, current.round_strips || {}, resolved.round_strips || {});
  const resolvedSeason = Number(resolved.current_season);
  if (Number.isFinite(resolvedSeason) && Array.isArray(resolved.round_strip))
    roundStrips[resolvedSeason] = resolved.round_strip;
  return Object.assign({}, current, {stats, round_strips: roundStrips});
}

function buildOfficialPayload(player, rounds, details, year, sourcePlayerId) {
  const stats = Object.entries(details || {}).filter(([round, values]) => /^\d+$/.test(round) &&
    ['T', 'TCK', 'MG', 'G'].some(field => values && values[field] !== null && values[field] !== undefined &&
      Number.isFinite(Number(values[field])))).map(([round, values]) => {
    const roundId = Number(round);
    const roundData = (rounds || []).find(item => Number(item.id) === roundId);
    const match = roundData && (roundData.matches || []).find(item =>
      Number(item.home_squad_id) === Number(player.squad_id) || Number(item.away_squad_id) === Number(player.squad_id)
    );
    const isHome = match && Number(match.home_squad_id) === Number(player.squad_id);
    return {
      player_id: player.id, squad_id: player.squad_id, year, round_id: roundId,
      match_id: match ? match.id : null, match_type: 'nrl',
      opponent: match ? (isHome ? match.away_squad_name : match.home_squad_name) : null,
      tries: values.T || 0, try_saves: values.TS || 0, goals: values.G || 0,
      field_goals: values.FG || 0, try_assists: values.TA || 0,
      line_breaks: values.LB || 0, line_break_assists: values.LBA || 0,
      tackles: values.TCK || 0, tackle_breaks: values.TB || 0,
      missed_tackles: values.MT || 0, offloads: values.OFH || 0,
      errors: values.ER || 0, forced_turn_over: values.TO || 0,
      metres_gained: values.MG || 0, kick_metres: values.KM || 0,
      kick_defusals: values.KD || 0, penalties_conceded: values.PC || 0,
      sin_bin: values.SB || 0, send_off: values.SO || 0,
      time_on_ground: values.TOG || 0, forced_drop_out: values.FDO || 0,
      off_game: values.OFG || 0, sai: values.SAI || 0, efig: values.EFIG || 0,
      fantasy_points: player.stats && player.stats.scores ? player.stats.scores[round] : null,
      price: player.stats && player.stats.prices ? player.stats.prices[round] : null,
      round_display: round, round_type: 'nrl',
      home_squad_id: match ? match.home_squad_id : null,
      away_squad_id: match ? match.away_squad_id : null,
      home_squad_name: match ? match.home_squad_name : null,
      away_squad_name: match ? match.away_squad_name : null,
      home_score: match ? match.home_score : null, away_score: match ? match.away_score : null,
      venue_name: match ? match.venue_name : null, match_date: match ? match.date : null,
      match_status: match ? match.status : null
    };
  }).sort((a, b) => b.round_id - a.round_id);
  const summary = player.stats || {};
  return {
    source_player_id: Number(sourcePlayerId),
    player: {
      id: player.id, player_id: player.id, first_name: player.first_name,
      last_name: player.last_name, squad_id: player.squad_id, cost: player.cost,
      status: player.status, positions: Array.isArray(player.positions) ? player.positions.join(',') : player.positions,
      avg_points: summary.avg_points, high_score: summary.high_score, low_score: summary.low_score,
      last_3_avg: summary.last_3_avg, last_5_avg: summary.last_5_avg,
      selections: summary.selections, owned_by: summary.owned_by
    },
    current_season: year, stats, round_strip: [], latest_be: null,
    latest_be_round: null, latest_price_round: null, current_round_cap: null,
    current_magic_number: null, current_magic_round: null
  };
}

module.exports = {
  parseInitialPlayerId, hasSeasonStats, playerSlug, playerNameKey, searchQueryVariants, numericPositions, searchPlayerSelection,
  findSearchPlayer, findSearchPlayerId, findSearchPlayerPath, hasStatComponents,
  hasCompleteSeasonDetails, payloadMatchesPlayer, mergeHistoricalPlayerStats, buildOfficialPayload
};
