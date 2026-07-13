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

module.exports = {parseInitialPlayerId, hasSeasonStats, findSearchPlayerId};
