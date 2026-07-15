'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {Pool} = require('pg');

const MIGRATION = '001_initial_json_import';
const MULTI_LEAGUE_MIGRATION = '002_multi_custom_draft_leagues';

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
          state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS leagues (
          code text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL, created_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS teams (
          id text PRIMARY KEY, league_code text NOT NULL REFERENCES leagues(code) ON DELETE CASCADE,
          user_id text NOT NULL, name text NOT NULL, version bigint NOT NULL DEFAULT 0, UNIQUE (league_code, user_id)
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
        ALTER TABLE app_states ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS fantasy_leagues (
          id text PRIMARY KEY, code text UNIQUE NOT NULL, format text NOT NULL CHECK (format IN ('custom','draft')),
          name text NOT NULL, owner_id text NOT NULL, rules jsonb NOT NULL DEFAULT '{}'::jsonb,
          draft_state jsonb, draft_version bigint NOT NULL DEFAULT 0, max_members integer NOT NULL DEFAULT 20,
          invite_expires_at timestamptz, status text NOT NULL DEFAULT 'active', create_key text,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(owner_id, create_key)
        );
        CREATE TABLE IF NOT EXISTS fantasy_memberships (
          id text PRIMARY KEY, league_id text NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
          user_id text NOT NULL, role text NOT NULL CHECK (role IN ('owner','member')),
          join_key text, joined_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
          UNIQUE(league_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS fantasy_teams (
          id text PRIMARY KEY, league_id text NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
          membership_id text NOT NULL REFERENCES fantasy_memberships(id) ON DELETE CASCADE,
          user_id text NOT NULL, name text NOT NULL, state jsonb NOT NULL DEFAULT '{}'::jsonb,
          version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(league_id,user_id), UNIQUE(membership_id)
        );
        CREATE TABLE IF NOT EXISTS fantasy_draft_picks (
          league_id text NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
          player_id bigint NOT NULL, team_id text NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
          pick_number integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(league_id,player_id), UNIQUE(league_id,pick_number)
        );
        CREATE TABLE IF NOT EXISTS fantasy_fixtures (
          league_id text NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
          round integer NOT NULL, fixture_no integer NOT NULL,
          home_team_id text NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
          away_team_id text NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
          state jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(league_id,round,fixture_no)
        );
        CREATE TABLE IF NOT EXISTS fantasy_scores (
          league_id text NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
          team_id text NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
          round integer NOT NULL, points numeric NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(league_id,team_id,round)
        );
        CREATE INDEX IF NOT EXISTS fantasy_memberships_user_idx ON fantasy_memberships(user_id) WHERE active;
        CREATE INDEX IF NOT EXISTS fantasy_memberships_league_idx ON fantasy_memberships(league_id) WHERE active;
        CREATE INDEX IF NOT EXISTS fantasy_teams_league_idx ON fantasy_teams(league_id);
        CREATE INDEX IF NOT EXISTS fantasy_draft_picks_team_idx ON fantasy_draft_picks(league_id,team_id);
        CREATE INDEX IF NOT EXISTS fantasy_fixtures_round_idx ON fantasy_fixtures(league_id,round);
        CREATE INDEX IF NOT EXISTS fantasy_scores_round_idx ON fantasy_scores(league_id,round);
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
    await retry(() => transaction(migrateLegacyFantasyLeagues));
  }

  function stableId(prefix, ...parts) {
    return prefix + crypto.createHash('sha256').update(parts.map(value => String(value || '')).join('|')).digest('hex').slice(0, 22).toUpperCase();
  }
  function stableCode(...parts) {
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.createHash('sha256').update(parts.map(value=>String(value||'')).join('|')).digest();
    return Array.from({length:8},(_,i)=>alphabet[bytes[i]%alphabet.length]).join('');
  }
  async function migrateLegacyFantasyLeagues(client) {
    const done=await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[MULTI_LEAGUE_MIGRATION]);
    if(done.rowCount)return;
    const rows=await client.query(`SELECT a.user_email,a.state,u.user_id,u.name FROM app_states a JOIN users u ON u.email=a.user_email FOR UPDATE`);
    let leaguesCreated=0,membershipsCreated=0,teamsCreated=0;
    for(const row of rows.rows){
      for(const format of ['custom','draft']){
        const legacy=format==='custom'?row.state&&row.state.customLeague:row.state&&row.state.draft;
        if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))continue;
        const embeddedCode=String(legacy.league&&legacy.league.code||legacy.code||'').toUpperCase();
        const identity=/^[A-Z2-9]{6,12}$/.test(embeddedCode)?embeddedCode:`${row.user_id}|${legacy.created||''}|${legacy.name||legacy.league&&legacy.league.name||''}`;
        const leagueId=stableId('FL',format,identity);let code=/^[A-Z2-9]{6,12}$/.test(embeddedCode)?embeddedCode:stableCode(format,identity);
        const codeOwner=await client.query('SELECT id FROM fantasy_leagues WHERE code=$1',[code]);if(codeOwner.rowCount&&codeOwner.rows[0].id!==leagueId)code=stableCode(format,identity,leagueId);
        const name=String(legacy.name||legacy.league&&legacy.league.name||`Legacy ${format} league`).slice(0,80);
        const proposedOwner=row.user_id;
        const insertedLeague=await client.query(`INSERT INTO fantasy_leagues(id,code,format,name,owner_id,rules,draft_state,max_members,status,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',to_timestamp($9/1000.0),now()) ON CONFLICT(id) DO NOTHING`,
          [leagueId,code,format,name,proposedOwner,JSON.stringify(format==='custom'?(legacy.settings||{}):{}),format==='draft'?JSON.stringify(legacy):null,Number(legacy.league&&legacy.league.size)||20,Number(legacy.created)||Date.now()]);
        leaguesCreated+=insertedLeague.rowCount;
        if(legacy.league&&legacy.league.isOwner===true){await client.query('UPDATE fantasy_leagues SET owner_id=$1 WHERE id=$2',[row.user_id,leagueId]);await client.query(`UPDATE fantasy_memberships SET role='member' WHERE league_id=$1`,[leagueId]);}
        const persistedLeague=await client.query('SELECT owner_id FROM fantasy_leagues WHERE id=$1',[leagueId]);
        const owner=persistedLeague.rows[0].owner_id;
        const membershipId=stableId('FM',leagueId,row.user_id),teamId=stableId('FT',leagueId,row.user_id);
        const insertedMember=await client.query(`INSERT INTO fantasy_memberships(id,league_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(league_id,user_id) DO NOTHING`,[membershipId,leagueId,row.user_id,owner===row.user_id?'owner':'member']);
        membershipsCreated+=insertedMember.rowCount;
        const teamName=String(format==='custom'?(legacy.team&&legacy.team.name||row.name):(legacy.league&&legacy.league.participants&&legacy.league.participants.find(p=>p.isMe)&&legacy.league.participants.find(p=>p.isMe).name||row.name)).slice(0,60);
        const teamState=format==='custom'?legacy:{legacyDraft:legacy};
        const insertedTeam=await client.query(`INSERT INTO fantasy_teams(id,league_id,membership_id,user_id,name,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(league_id,user_id) DO NOTHING`,[teamId,leagueId,membershipId,row.user_id,teamName,JSON.stringify(teamState)]);
        teamsCreated+=insertedTeam.rowCount;
      }
    }
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[MULTI_LEAGUE_MIGRATION]);
    console.log('[migration] multi-league compatibility',{sourceStates:rows.rowCount,leaguesCreated,membershipsCreated,teamsCreated});
  }

  async function insertUser(client, user) {
    if (!user || !user.email || !user.userId || !user.hash) return;
    await client.query(`INSERT INTO users(email,user_id,name,salt,password_hash,iterations,league_code,team_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(email) DO NOTHING`,
    [user.email, user.userId, user.name, user.salt, user.hash, user.iterations || 10000, user.leagueCode || null, user.teamId || null]);
    if (user.appState && typeof user.appState === 'object') await client.query(
      'INSERT INTO app_states(user_email,state,updated_at,version) VALUES($1,$2,now(),$3) ON CONFLICT(user_email) DO UPDATE SET state=EXCLUDED.state,updated_at=now(),version=EXCLUDED.version',
      [user.email, JSON.stringify(user.appState), Number(user.appStateVersion) || 1]);
    const sessions = Array.isArray(user.sessions) ? user.sessions : [];
    const legacyHash = user.tokenHash || (user.token ? require('crypto').createHash('sha256').update(user.token).digest('hex') : null);
    if (legacyHash && user.tokenExpires && !sessions.some(session => session.hash === legacyHash))
      sessions.push({hash: legacyHash, expires: user.tokenExpires});
    for (const session of sessions) if (session.hash && session.expires)
      await client.query('INSERT INTO sessions VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [session.hash, user.email, new Date(session.expires)]);
    if (user.resetTokenHash && user.resetExpires) await client.query('INSERT INTO password_resets(token_hash,user_email,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user.resetTokenHash, user.email, new Date(user.resetExpires)]);
  }

  async function insertLeague(client, code, league) {
    if (!league) return;
    await client.query('INSERT INTO leagues VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [code, league.name, league.ownerId, new Date(league.created || Date.now())]);
    for (const team of league.teams || []) {
      await client.query('INSERT INTO teams(id,league_code,user_id,name,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [team.id, code, team.userId, team.name, Number(team.version) || 0]);
      for (const [game, picks] of Object.entries(team.picks || {})) for (const [position, playerId] of Object.entries(picks || {}))
        await client.query('INSERT INTO picks VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [team.id, Number(game), position, playerId]);
    }
  }

  async function load() {
    const [ur, sr, rr, ar, lr, tr, pr, scr, flr, fmr, ftr, fdpr, ffr, fsr] = await Promise.all([
      pool.query('SELECT * FROM users'), pool.query('SELECT * FROM sessions'), pool.query('SELECT * FROM password_resets WHERE used_at IS NULL'),
      pool.query('SELECT * FROM app_states'),
      pool.query('SELECT * FROM leagues'), pool.query('SELECT * FROM teams'), pool.query('SELECT * FROM picks'), pool.query('SELECT * FROM scores'),
      pool.query('SELECT * FROM fantasy_leagues'),pool.query('SELECT * FROM fantasy_memberships'),pool.query('SELECT * FROM fantasy_teams'),
      pool.query('SELECT * FROM fantasy_draft_picks'),pool.query('SELECT * FROM fantasy_fixtures'),pool.query('SELECT * FROM fantasy_scores')
    ]);
    const users = {}, leagues = {}, scores = {};
    for (const row of ur.rows) users[row.email] = {userId: row.user_id, email: row.email, name: row.name, salt: row.salt, hash: row.password_hash, iterations: row.iterations, leagueCode: row.league_code || undefined, teamId: row.team_id || undefined};
    for (const row of sr.rows) if (users[row.user_email]) (users[row.user_email].sessions ||= []).push({hash: row.token_hash, expires: +new Date(row.expires_at)});
    for (const row of rr.rows) if (users[row.user_email]) Object.assign(users[row.user_email], {resetTokenHash: row.token_hash, resetExpires: +new Date(row.expires_at)});
    for (const row of ar.rows) if (users[row.user_email]) Object.assign(users[row.user_email], {
      appState: row.state, appStateUpdated: +new Date(row.updated_at), appStateVersion: Number(row.version) || 1
    });
    for (const row of lr.rows) leagues[row.code] = {name: row.name, ownerId: row.owner_id, created: +new Date(row.created_at), teams: []};
    const teams = {};
    for (const row of tr.rows) { const team = {id: row.id, userId: row.user_id, name: row.name, version: Number(row.version) || 0, picks: {}}; teams[row.id] = team; if (leagues[row.league_code]) leagues[row.league_code].teams.push(team); }
    for (const row of pr.rows) if (teams[row.team_id]) (teams[row.team_id].picks[row.game] ||= {})[row.position] = Number(row.player_id);
    for (const row of scr.rows) scores[row.game + ':' + row.player_id] = Number(row.points);
    const fantasyLeagues={};
    for(const row of flr.rows)fantasyLeagues[row.id]={id:row.id,code:row.code,format:row.format,name:row.name,ownerId:row.owner_id,rules:row.rules||{},draftState:row.draft_state,draftVersion:Number(row.draft_version)||0,maxMembers:row.max_members,inviteExpiresAt:row.invite_expires_at?+new Date(row.invite_expires_at):null,status:row.status,createKey:row.create_key||null,created:+new Date(row.created_at),updated:+new Date(row.updated_at),members:[],teams:[],draftPicks:[],fixtures:[],scores:[]};
    for(const row of fmr.rows)if(fantasyLeagues[row.league_id])fantasyLeagues[row.league_id].members.push({id:row.id,userId:row.user_id,role:row.role,joinKey:row.join_key||null,joined:+new Date(row.joined_at),active:row.active});
    for(const row of ftr.rows)if(fantasyLeagues[row.league_id])fantasyLeagues[row.league_id].teams.push({id:row.id,membershipId:row.membership_id,userId:row.user_id,name:row.name,state:row.state||{},version:Number(row.version)||0,created:+new Date(row.created_at),updated:+new Date(row.updated_at)});
    for(const row of fdpr.rows)if(fantasyLeagues[row.league_id])fantasyLeagues[row.league_id].draftPicks.push({playerId:Number(row.player_id),teamId:row.team_id,pickNumber:row.pick_number,created:+new Date(row.created_at)});
    for(const row of ffr.rows)if(fantasyLeagues[row.league_id])fantasyLeagues[row.league_id].fixtures.push({round:row.round,fixtureNo:row.fixture_no,homeTeamId:row.home_team_id,awayTeamId:row.away_team_id,state:row.state||{}});
    for(const row of fsr.rows)if(fantasyLeagues[row.league_id])fantasyLeagues[row.league_id].scores.push({teamId:row.team_id,round:row.round,points:Number(row.points),detail:row.detail||{}});
    return {users, leagues, scores, fantasyLeagues};
  }

  async function insertFantasyLeagues(c,fantasyLeagues,clear=true){
    if(clear)await c.query('DELETE FROM fantasy_leagues');
    for(const league of Object.values(fantasyLeagues)){
      await c.query(`INSERT INTO fantasy_leagues(id,code,format,name,owner_id,rules,draft_state,draft_version,max_members,invite_expires_at,status,create_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[league.id,league.code,league.format,league.name,league.ownerId,JSON.stringify(league.rules||{}),league.draftState==null?null:JSON.stringify(league.draftState),Number(league.draftVersion)||0,league.maxMembers||20,league.inviteExpiresAt?new Date(league.inviteExpiresAt):null,league.status||'active',league.createKey||null,new Date(league.created||Date.now()),new Date(league.updated||Date.now())]);
      for(const member of league.members||[])await c.query(`INSERT INTO fantasy_memberships(id,league_id,user_id,role,join_key,joined_at,active) VALUES($1,$2,$3,$4,$5,$6,$7)`,[member.id,league.id,member.userId,member.role,member.joinKey||null,new Date(member.joined||Date.now()),member.active!==false]);
      for(const team of league.teams||[])await c.query(`INSERT INTO fantasy_teams(id,league_id,membership_id,user_id,name,state,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[team.id,league.id,team.membershipId,team.userId,team.name,JSON.stringify(team.state||{}),Number(team.version)||0,new Date(team.created||Date.now()),new Date(team.updated||Date.now())]);
      for(const pick of league.draftPicks||[])await c.query(`INSERT INTO fantasy_draft_picks(league_id,player_id,team_id,pick_number,created_at) VALUES($1,$2,$3,$4,$5)`,[league.id,pick.playerId,pick.teamId,pick.pickNumber,new Date(pick.created||Date.now())]);
      for(const fixture of league.fixtures||[])await c.query(`INSERT INTO fantasy_fixtures(league_id,round,fixture_no,home_team_id,away_team_id,state) VALUES($1,$2,$3,$4,$5,$6)`,[league.id,fixture.round,fixture.fixtureNo,fixture.homeTeamId,fixture.awayTeamId,JSON.stringify(fixture.state||{})]);
      for(const score of league.scores||[])await c.query(`INSERT INTO fantasy_scores(league_id,team_id,round,points,detail) VALUES($1,$2,$3,$4,$5)`,[league.id,score.teamId,score.round,score.points,JSON.stringify(score.detail||{})]);
    }
  }
  async function saveFantasyLeagues(fantasyLeagues){return retry(()=>transaction(c=>insertFantasyLeagues(c,fantasyLeagues)));}

  async function saveUsers(users) { return retry(() => transaction(async c => { await c.query('DELETE FROM sessions'); await c.query('DELETE FROM password_resets'); await c.query('DELETE FROM users'); for (const u of Object.values(users)) await insertUser(c, u); })); }
  async function saveLeagues(leagues) { return retry(() => transaction(async c => { await c.query('DELETE FROM leagues'); for (const [code, league] of Object.entries(leagues)) await insertLeague(c, code, league); })); }
  async function saveAccountState(users, leagues) { return retry(() => transaction(async c => {
    await c.query('DELETE FROM sessions'); await c.query('DELETE FROM password_resets'); await c.query('DELETE FROM users');
    await c.query('DELETE FROM leagues');
    for (const u of Object.values(users)) await insertUser(c, u);
    for (const [code, league] of Object.entries(leagues)) await insertLeague(c, code, league);
  })); }
  async function saveCompleteAccountState(users,leagues,fantasyLeagues){return retry(()=>transaction(async c=>{
    await c.query('DELETE FROM fantasy_leagues');
    await c.query('DELETE FROM sessions');await c.query('DELETE FROM password_resets');await c.query('DELETE FROM users');await c.query('DELETE FROM leagues');
    for(const u of Object.values(users))await insertUser(c,u);
    for(const [code,league] of Object.entries(leagues))await insertLeague(c,code,league);
    await insertFantasyLeagues(c,fantasyLeagues,false);
  }));}
  async function saveScores(scores) { return retry(() => transaction(async c => { await c.query('DELETE FROM scores'); for (const [key, points] of Object.entries(scores)) { const [g,p] = key.split(':').map(Number); await c.query('INSERT INTO scores VALUES($1,$2,$3)', [g,p,points]); } })); }
  async function saveAppState(email, state, expectedVersion) { return retry(() => transaction(async client => {
    const current = await client.query('SELECT state,updated_at,version FROM app_states WHERE user_email=$1 FOR UPDATE', [email]);
    const row = current.rows[0] || null;
    const version = row ? Number(row.version) : 0;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== version) return {
      ok: false, version, state: row && row.state || null, updatedAt: row ? +new Date(row.updated_at) : null
    };
    const nextVersion = version + 1;
    const saved = await client.query(`INSERT INTO app_states(user_email,state,updated_at,version) VALUES($1,$2,now(),$3)
      ON CONFLICT(user_email) DO UPDATE SET state=EXCLUDED.state,updated_at=now(),version=EXCLUDED.version RETURNING updated_at`,
    [email, JSON.stringify(state), nextVersion]);
    return {ok: true, version: nextVersion, updatedAt: +new Date(saved.rows[0].updated_at)};
  })); }
  async function ping() { await pool.query('SELECT 1'); }
  return {migrate, load, saveUsers, saveLeagues, saveAccountState, saveCompleteAccountState, saveScores, saveAppState, saveFantasyLeagues, ping, close: () => pool.end(), retry};
}

module.exports = {createDatabase, readLegacySnapshot};
