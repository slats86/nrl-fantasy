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

function findSearchPlayerId(results, slug) {
  if (!Array.isArray(results)) return null;
  const wanted = playerSlug(slug);
  const match = results.find(player => {
    const fullName = [player.first_name, player.nickname, player.last_name].filter(Boolean).join(' ');
    const regularName = [player.first_name, player.last_name].filter(Boolean).join(' ');
    return playerSlug(fullName) === wanted || playerSlug(regularName) === wanted;
  });
  return match && /^\d+$/.test(String(match.id || match.player_id || ''))
    ? String(match.id || match.player_id) : null;
}

function buildOfficialPayload(player, rounds, details, year, sourcePlayerId) {
  const stats = Object.entries(details || {}).filter(([round]) => /^\d+$/.test(round)).map(([round, values]) => {
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

module.exports = {parseInitialPlayerId, hasSeasonStats, findSearchPlayerId, buildOfficialPayload};
