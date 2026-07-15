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
  const legacyCustom={name:'Legacy Custom',created:1700000000000,league:{code:'CSTM2345',name:'Legacy Custom',size:8,isOwner:true},settings:{scoreMode:'custom'},team:{name:'Owners Custom',squad:[123],history:{}}};
  const legacyDraft={phase:'lobby',created:1700000001000,league:{code:'DRFT2345',name:'Legacy Draft',size:8,isOwner:true,participants:[{name:'Owners Draft',isMe:true}]},teams:null,history:{}};
  fs.writeFileSync(path.join(dir, 'soo-users.json'), JSON.stringify({
    'owner@example.com':{email:'owner@example.com',userId:'OWNER1',name:'Owner',salt:'salt',hash:'hash',iterations:310000,leagueCode:'ABC123',teamId:'TEAM1',sessions:[{hash:'session-a',expires:Date.now()+60000},{hash:'session-b',expires:Date.now()+60000}],appStateVersion:1,appState:{classic:{squad:[123]},customLeague:legacyCustom,draft:legacyDraft}},
    'member@example.com':{email:'member@example.com',userId:'MEMBER1',name:'Member',salt:'salt2',hash:'hash2',iterations:310000,sessions:[],appStateVersion:1,appState:{customLeague:{...legacyCustom,league:{...legacyCustom.league,isOwner:false},team:{name:'Members Custom',squad:[456],history:{}}}}}
  }));
  fs.writeFileSync(path.join(dir, 'soo-leagues.json'), JSON.stringify({ABC123:{name:'Test',ownerId:'OWNER1',created:Date.now(),teams:[{id:'TEAM1',userId:'OWNER1',name:'Owners',version:3,picks:{1:{FB:123}}}]}}));
  fs.writeFileSync(path.join(dir, 'soo-scores.json'), JSON.stringify({'1:123':42}));
  let db = createDatabase({connectionString:process.env.TEST_DATABASE_URL,dataDir:dir});
  try {
    await db.migrate();
    let migrated=await db.load();
    assert.equal(Object.keys(migrated.fantasyLeagues).length,2,'one shared Custom and one Draft league migrate without duplication');
    const migratedCustom=Object.values(migrated.fantasyLeagues).find(league=>league.format==='custom');
    const migratedDraft=Object.values(migrated.fantasyLeagues).find(league=>league.format==='draft');
    assert.equal(migratedCustom.members.length,2);assert.equal(migratedCustom.ownerId,'OWNER1');assert.equal(migratedCustom.members.filter(member=>member.role==='owner').length,1);
    assert.deepEqual(migratedCustom.teams.find(team=>team.userId==='OWNER1').state.team.squad,[123]);
    assert.deepEqual(migratedCustom.teams.find(team=>team.userId==='MEMBER1').state.team.squad,[456]);
    assert.equal(migratedDraft.draftState.phase,'lobby');
    const initial = await db.saveAppState('owner@example.com',{classic:{squad:[123]},customLeague:{name:'Test Custom'}},1);
    assert.deepEqual({ok:initial.ok,version:initial.version},{ok:true,version:2});
    const concurrent = await Promise.all([
      db.saveAppState('owner@example.com',{classic:{squad:[456]}},2),
      db.saveAppState('owner@example.com',{classic:{squad:[789]}},2)
    ]);
    assert.equal(concurrent.filter(result=>result.ok).length,1);
    assert.equal(concurrent.filter(result=>!result.ok).length,1);
    let state=await db.load();
    assert.equal(state.users['owner@example.com'].teamId,'TEAM1');
    assert.equal(state.users['owner@example.com'].appStateVersion,3);
    assert.ok([[456],[789]].some(squad=>JSON.stringify(squad)===JSON.stringify(state.users['owner@example.com'].appState.classic.squad)));
    assert.equal(state.users['owner@example.com'].sessions.length,2);
    assert.equal(state.leagues.ABC123.teams[0].picks[1].FB,123);
    assert.equal(state.leagues.ABC123.teams[0].version,3);
    assert.equal(state.scores['1:123'],42);
    const fantasySnapshot=structuredClone(state.fantasyLeagues);
    fantasySnapshot[migratedCustom.id].teams.find(team=>team.userId==='OWNER1').state={squad:[789],marker:'independent'};
    await db.saveFantasyLeagues(fantasySnapshot);
    const corruptFantasy=structuredClone(fantasySnapshot);
    corruptFantasy[migratedCustom.id].teams[0].membershipId='MISSING-MEMBERSHIP';
    await assert.rejects(db.saveFantasyLeagues(corruptFantasy));
    state=await db.load();assert.equal(state.fantasyLeagues[migratedCustom.id].teams.find(team=>team.userId==='OWNER1').state.marker,'independent','failed fantasy transaction rolls back');
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
    assert.equal(state.users['owner@example.com'].appStateVersion,3);
    assert.equal(state.users['owner@example.com'].sessions.length,2);
    assert.equal(state.leagues.ABC123.teams[0].version,3);
    assert.equal(Object.keys(state.fantasyLeagues).length,2,'migration is idempotent after restart');
    assert.equal(state.fantasyLeagues[migratedCustom.id].teams.find(team=>team.userId==='OWNER1').state.marker,'independent');
  } finally { await db.close().catch(()=>{}); fs.rmSync(dir,{recursive:true,force:true}); }
});
