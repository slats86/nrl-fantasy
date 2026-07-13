'use strict';

const LIVE_STATUSES = new Set(['active', 'live', 'in_progress', 'in-progress', 'playing']);
const FINAL_STATUSES = new Set(['complete', 'completed', 'final', 'full_time', 'full-time']);

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (LIVE_STATUSES.has(status)) return 'live';
  if (FINAL_STATUSES.has(status)) return 'complete';
  return 'scheduled';
}

function roundState(round, now = Date.now()) {
  const matches = Array.isArray(round && round.matches) ? round.matches : [];
  const statuses = matches.map(match => normalizedStatus(match.status));
  const status = normalizedStatus(round && round.status);
  const start = Date.parse(round && round.start) || Math.min(...matches.map(match => Date.parse(match.date)).filter(Number.isFinite));
  const end = Date.parse(round && round.end) || Math.max(...matches.map(match => Date.parse(match.date)).filter(Number.isFinite));
  const anyLive = status === 'live' || statuses.includes('live');
  const allFinal = matches.length > 0 && statuses.every(value => value === 'complete');
  return {
    round,
    id: Number(round && round.id),
    status: anyLive ? 'live' : (status === 'complete' || allFinal ? 'complete' : 'scheduled'),
    anyLive,
    allFinal,
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null,
    started: Number.isFinite(start) && start <= now
  };
}

function selectCurrentRound(rounds, now = Date.now()) {
  const states = (Array.isArray(rounds) ? rounds : []).map(round => roundState(round, now)).filter(item => Number.isFinite(item.id));
  const live = states.filter(item => item.anyLive).sort((a, b) => b.id - a.id)[0];
  if (live) return live;
  const active = states.filter(item => item.status === 'scheduled' && item.started && (!item.end || item.end >= now - 6 * 60 * 60 * 1000))
    .sort((a, b) => b.id - a.id)[0];
  if (active) return active;
  const complete = states.filter(item => item.status === 'complete').sort((a, b) => b.id - a.id)[0];
  if (complete) return complete;
  return states.filter(item => item.status === 'scheduled').sort((a, b) => (a.start || Infinity) - (b.start || Infinity))[0] || null;
}

function refreshDelay(state, now = Date.now(), hidden = false) {
  if (hidden) return 15 * 60 * 1000;
  if (!state) return 5 * 60 * 1000;
  if (state.anyLive) return 30 * 1000;
  if (state.status === 'scheduled' && state.start && state.start > now) {
    const untilStart = state.start - now;
    return untilStart <= 10 * 60 * 1000 ? 30 * 1000 : Math.min(5 * 60 * 1000, Math.max(60 * 1000, untilStart - 10 * 60 * 1000));
  }
  if (state.status === 'scheduled' && state.started) return 90 * 1000;
  return 15 * 60 * 1000;
}

function validateFeed(name, value) {
  if (!Array.isArray(value)) throw new Error(name + ' feed is not an array');
  if (name === 'players' && value.length < 100) throw new Error('players feed failed size validation');
  if (name === 'rounds' && (value.length < 20 || !value.every(round => Number.isFinite(Number(round.id)))))
    throw new Error('rounds feed failed schema validation');
  return value;
}

module.exports = {normalizedStatus, roundState, selectCurrentRound, refreshDelay, validateFeed};
