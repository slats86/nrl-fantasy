'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Pool} = require('pg');
const {createDatabase} = require('../db');
test('PostgreSQL migrates JSON and persists all entities transactionally', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const databaseName = new URL(process.env.TEST_DATABASE_URL).pathname.replace(/^\//, '');
  assert.match(databaseName, /test/i, 'refusing to reset a PostgreSQL database not explicitly named as a test database');
  const admin = new Pool({connectionString:process.env.TEST_DATABASE_URL,
    ssl:process.env.PGSSL === 'disable' ? false : {rejectUnauthorized:false}});
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await admin.end();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-pg-'));
  fs.writeFileSync(path.join(dir, 'soo-users.json'), JSON.stringify({'owner@example.com':{email:'owner@example.com',userId:'OWNER1',name:'Owner',salt:'salt',hash:'hash',iterations:310000,leagueCode:'ABC123',teamId:'TEAM1',sessions:[{hash:'session-a',expires:Date.now()+60000},{hash:'session-b',expires:Date.now()+60000}]}}));
  fs.writeFileSync(path.join(dir, 'soo-leagues.json'), JSON.stringify({ABC123:{name:'Test',ownerId:'OWNER1',created:Date.now(),teams:[{id:'TEAM1',userId:'OWNER1',name:'Owners',version:3,picks:{1:{FB:123}}}]}}));
  fs.writeFileSync(path.join(dir, 'soo-scores.json'), JSON.stringify({'1:123':42}));
  let db = createDatabase({connectionString:process.env.TEST_DATABASE_URL,dataDir:dir});
  try {
    await db.migrate();
    const initial = await db.saveAppState('owner@example.com',{classic:{squad:[123]},customLeague:{name:'Test Custom'}},0);
    assert.deepEqual({ok:initial.ok,version:initial.version},{ok:true,version:1});
    const concurrent = await Promise.all([
      db.saveAppState('owner@example.com',{classic:{squad:[456]}},1),
      db.saveAppState('owner@example.com',{classic:{squad:[789]}},1)
    ]);
    assert.equal(concurrent.filter(result=>result.ok).length,1);
    assert.equal(concurrent.filter(result=>!result.ok).length,1);
    let state=await db.load();
    assert.equal(state.users['owner@example.com'].teamId,'TEAM1');
    assert.equal(state.users['owner@example.com'].appStateVersion,2);
    assert.ok([[456],[789]].some(squad=>JSON.stringify(squad)===JSON.stringify(state.users['owner@example.com'].appState.classic.squad)));
    assert.equal(state.users['owner@example.com'].sessions.length,2);
    assert.equal(state.leagues.ABC123.teams[0].picks[1].FB,123);
    assert.equal(state.leagues.ABC123.teams[0].version,3);
    assert.equal(state.scores['1:123'],42);
    const corruptUsers=structuredClone(state.users),corruptLeagues=structuredClone(state.leagues);
    corruptUsers['owner@example.com'].name='Must Roll Back';
    corruptLeagues.ABC123.teams[0].picks[1].FB='not-an-integer';
    await assert.rejects(db.saveAccountState(corruptUsers,corruptLeagues));
    state=await db.load();
    assert.equal(state.users['owner@example.com'].name,'Owner');
    assert.equal(state.leagues.ABC123.teams[0].picks[1].FB,123);
    await db.close();
    db=createDatabase({connectionString:process.env.TEST_DATABASE_URL,dataDir:dir});
    await db.migrate();state=await db.load();
    assert.equal(state.users['owner@example.com'].appStateVersion,2);
    assert.equal(state.users['owner@example.com'].sessions.length,2);
    assert.equal(state.leagues.ABC123.teams[0].version,3);
  } finally { await db.close().catch(()=>{}); fs.rmSync(dir,{recursive:true,force:true}); }
});
