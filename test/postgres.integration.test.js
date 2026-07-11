'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createDatabase} = require('../db');
test('PostgreSQL migrates JSON and persists all entities transactionally', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-pg-'));
  fs.writeFileSync(path.join(dir, 'soo-users.json'), JSON.stringify({'owner@example.com':{email:'owner@example.com',userId:'OWNER1',name:'Owner',salt:'salt',hash:'hash',iterations:310000,leagueCode:'ABC123',teamId:'TEAM1'}}));
  fs.writeFileSync(path.join(dir, 'soo-leagues.json'), JSON.stringify({ABC123:{name:'Test',ownerId:'OWNER1',created:Date.now(),teams:[{id:'TEAM1',userId:'OWNER1',name:'Owners',picks:{1:{FB:123}}}]}}));
  fs.writeFileSync(path.join(dir, 'soo-scores.json'), JSON.stringify({'1:123':42}));
  const db = createDatabase({connectionString:process.env.TEST_DATABASE_URL,dataDir:dir});
  try { await db.migrate(); await db.saveAppState('owner@example.com',{classic:{squad:[123]},customLeague:{name:'Test Custom'}}); const state=await db.load(); assert.equal(state.users['owner@example.com'].teamId,'TEAM1'); assert.deepEqual(state.users['owner@example.com'].appState.classic.squad,[123]); assert.equal(state.users['owner@example.com'].appState.customLeague.name,'Test Custom'); assert.equal(state.leagues.ABC123.teams[0].picks[1].FB,123); assert.equal(state.scores['1:123'],42); }
  finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
