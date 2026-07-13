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

module.exports = {parseInitialPlayerId, hasSeasonStats};
