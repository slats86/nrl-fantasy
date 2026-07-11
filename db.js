'use strict';

const fs = require('fs');
const path = require('path');
const {Pool} = require('pg');

const MIGRATION = '001_initial_json_import';

function json(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function readLegacySnapshot(dataDir) {
  const users = json(path.join(dataDir, 'soo-users.json'));
  const leagues = json(path.join(dataDir, 'soo-leagues.json'));
  const scores = json(path.join(dataDir, 'soo-scores.json'));
  const counts = {
    users: Object.keys(users).length,
    leagues: Object.keys(leagues).length,
    scores: Object.keys(scores).length
  };
  return {users, leagues, scores, counts, total: counts.users + counts.leagues + counts.scores};
}

function createDatabase({connectionString, dataDir, pool: suppliedPool}) {
  if (!connectionString && !suppliedPool) return null;
  const pool = suppliedPool || new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: 30000,
    ssl: process.env.PGSSL === 'disable' ? false : {rejectUnauthorized: false}
  });

  async function retry(operation, attempts = 3) {
    let error;
    for (let i = 0; i < attempts; i++) {
      try { return await operation(); } catch (e) {
        error = e;
        if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 100 * (2 ** i)));
      }
    }
    throw error;
  }

  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function migrate() {
    await retry(() => transaction(async client => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS users (
          email text PRIMARY KEY, user_id text UNIQUE NOT NULL, name text NOT NULL, salt text NOT NULL,
          password_hash text NOT NULL, iterations integer NOT NULL, league_code text, team_id text
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash text PRIMARY KEY, user_email text NOT NULL REFERENCES users(email) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS password_resets (
          token_hash text PRIMARY KEY, user_email text NOT NULL REFERENCES users(email) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL, used_at timestamptz
        );
        CREATE TABLE IF NOT EXISTS app_states (
          user_email text PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
          state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS leagues (
          code text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL, created_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS teams (
          id text PRIMARY KEY, league_code text NOT NULL REFERENCES leagues(code) ON DELETE CASCADE,
          user_id text NOT NULL, name text NOT NULL, UNIQUE (league_code, user_id)
        );
        CREATE TABLE IF NOT EXISTS picks (
          team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE, game smallint NOT NULL,
          position text NOT NULL, player_id bigint NOT NULL, PRIMARY KEY (team_id, game, position)
        );
        CREATE TABLE IF NOT EXISTS scores (
          game smallint NOT NULL, player_id bigint NOT NULL, points numeric NOT NULL,
          PRIMARY KEY (game, player_id)
        );
        CREATE INDEX IF NOT EXISTS sessions_user_email_idx ON sessions(user_email);
        CREATE INDEX IF NOT EXISTS teams_league_code_idx ON teams(league_code);
      `);
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [MIGRATION]);
      if (done.rowCount) return;
      const {users, leagues, scores, counts, total} = readLegacySnapshot(dataDir);
      if (!total) {
        console.warn('[migration] no legacy JSON records found; leaving initial import pending');
        return;
      }
      for (const user of Object.values(users)) await insertUser(client, user);
      for (const [code, league] of Object.entries(leagues)) await insertLeague(client, code, league);
      for (const [key, points] of Object.entries(scores)) {
        const [game, playerId] = key.split(':').map(Number);
        if (Number.isInteger(game) && Number.isSafeInteger(playerId)) await client.query('INSERT INTO scores VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [game, playerId, points]);
      }
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [MIGRATION]);
      console.log('[migration] imported legacy JSON', counts);
    }));
  }

  async function insertUser(client, user) {
    if (!user || !user.email || !user.userId || !user.hash) return;
    await client.query(`INSERT INTO users(email,user_id,name,salt,password_hash,iterations,league_code,team_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(email) DO NOTHING`,
    [user.email, user.userId, user.name, user.salt, user.hash, user.iterations || 10000, user.leagueCode || null, user.teamId || null]);
    if (user.appState && typeof user.appState === 'object') await client.query(
      'INSERT INTO app_states(user_email,state,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_email) DO UPDATE SET state=EXCLUDED.state,updated_at=now()',
      [user.email, JSON.stringify(user.appState)]);
    const sessionHash = user.tokenHash || (user.token ? require('crypto').createHash('sha256').update(user.token).digest('hex') : null);
    if (sessionHash && user.tokenExpires) await client.query('INSERT INTO sessions VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [sessionHash, user.email, new Date(user.tokenExpires)]);
    if (user.resetTokenHash && user.resetExpires) await client.query('INSERT INTO password_resets(token_hash,user_email,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user.resetTokenHash, user.email, new Date(user.resetExpires)]);
  }

  async function insertLeague(client, code, league) {
    if (!league) return;
    await client.query('INSERT INTO leagues VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [code, league.name, league.ownerId, new Date(league.created || Date.now())]);
    for (const team of league.teams || []) {
      await client.query('INSERT INTO teams VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [team.id, code, team.userId, team.name]);
      for (const [game, picks] of Object.entries(team.picks || {})) for (const [position, playerId] of Object.entries(picks || {}))
        await client.query('INSERT INTO picks VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [team.id, Number(game), position, playerId]);
    }
  }

  async function load() {
    const [ur, sr, rr, ar, lr, tr, pr, scr] = await Promise.all([
      pool.query('SELECT * FROM users'), pool.query('SELECT * FROM sessions'), pool.query('SELECT * FROM password_resets WHERE used_at IS NULL'),
      pool.query('SELECT * FROM app_states'),
      pool.query('SELECT * FROM leagues'), pool.query('SELECT * FROM teams'), pool.query('SELECT * FROM picks'), pool.query('SELECT * FROM scores')
    ]);
    const users = {}, leagues = {}, scores = {};
    for (const row of ur.rows) users[row.email] = {userId: row.user_id, email: row.email, name: row.name, salt: row.salt, hash: row.password_hash, iterations: row.iterations, leagueCode: row.league_code || undefined, teamId: row.team_id || undefined};
    for (const row of sr.rows) if (users[row.user_email]) Object.assign(users[row.user_email], {tokenHash: row.token_hash, tokenExpires: +new Date(row.expires_at)});
    for (const row of rr.rows) if (users[row.user_email]) Object.assign(users[row.user_email], {resetTokenHash: row.token_hash, resetExpires: +new Date(row.expires_at)});
    for (const row of ar.rows) if (users[row.user_email]) Object.assign(users[row.user_email], {appState: row.state, appStateUpdated: +new Date(row.updated_at)});
    for (const row of lr.rows) leagues[row.code] = {name: row.name, ownerId: row.owner_id, created: +new Date(row.created_at), teams: []};
    const teams = {};
    for (const row of tr.rows) { const team = {id: row.id, userId: row.user_id, name: row.name, picks: {}}; teams[row.id] = team; if (leagues[row.league_code]) leagues[row.league_code].teams.push(team); }
    for (const row of pr.rows) if (teams[row.team_id]) (teams[row.team_id].picks[row.game] ||= {})[row.position] = Number(row.player_id);
    for (const row of scr.rows) scores[row.game + ':' + row.player_id] = Number(row.points);
    return {users, leagues, scores};
  }

  async function saveUsers(users) { return retry(() => transaction(async c => { await c.query('DELETE FROM sessions'); await c.query('DELETE FROM password_resets'); await c.query('DELETE FROM users'); for (const u of Object.values(users)) await insertUser(c, u); })); }
  async function saveLeagues(leagues) { return retry(() => transaction(async c => { await c.query('DELETE FROM leagues'); for (const [code, league] of Object.entries(leagues)) await insertLeague(c, code, league); })); }
  async function saveAccountState(users, leagues) { return retry(() => transaction(async c => {
    await c.query('DELETE FROM sessions'); await c.query('DELETE FROM password_resets'); await c.query('DELETE FROM users');
    await c.query('DELETE FROM leagues');
    for (const u of Object.values(users)) await insertUser(c, u);
    for (const [code, league] of Object.entries(leagues)) await insertLeague(c, code, league);
  })); }
  async function saveScores(scores) { return retry(() => transaction(async c => { await c.query('DELETE FROM scores'); for (const [key, points] of Object.entries(scores)) { const [g,p] = key.split(':').map(Number); await c.query('INSERT INTO scores VALUES($1,$2,$3)', [g,p,points]); } })); }
  async function saveAppState(email, state) { return retry(() => pool.query(
    'INSERT INTO app_states(user_email,state,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_email) DO UPDATE SET state=EXCLUDED.state,updated_at=now()',
    [email, JSON.stringify(state)])); }
  async function ping() { await pool.query('SELECT 1'); }
  return {migrate, load, saveUsers, saveLeagues, saveAccountState, saveScores, saveAppState, ping, close: () => pool.end(), retry};
}

module.exports = {createDatabase, readLegacySnapshot};
