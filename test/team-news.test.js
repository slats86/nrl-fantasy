'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {normalizeName,resolvePlayer,availabilityType,parseReturn,compareRosters,classifyReplacement,reconcileReports,mergeTeamListHistory,inferVersion,freshness,dedupeAvailability}=require('../lib/team-news');
const {discoverLateMailLinks}=require('../scripts/fetch-team-news');

const player=(name,number,position='Prop')=>({playerName:name,number,position,playerId:name});
test('name matching safely handles apostrophes, hyphens and same-name players by club',()=>{
  const players=[{id:1,first_name:"J'maine",last_name:'Hopgood',squad_id:500031},{id:2,first_name:'J maine',last_name:'Hopgood',squad_id:500011},{id:3,first_name:'Charnze',last_name:'Nicoll-Klokstad',squad_id:500032}];
  assert.equal(normalizeName("J’maine Hopgood"),'j maine hopgood');
  assert.deepEqual(resolvePlayer("J’maine Hopgood",'Eels',players),{playerId:1,identity:'matched'});
  assert.equal(resolvePlayer('Charnze Nicoll Klokstad','Warriors',players).playerId,3);
});
test('injury, suspension, rest and non-selection remain distinct',()=>{
  assert.equal(availabilityType('ACL'),'injury');assert.equal(availabilityType('suspended two games'),'suspension');assert.equal(availabilityType('rested'),'rest');assert.equal(availabilityType('not selected'),'non-selection');
  assert.deepEqual(parseReturn('Round 20-21'),{returnLabel:'Round 20-21',expectedReturnRound:20,expectedReturnRoundEnd:21,returnConfirmed:false});
});
test('direct replacements are confirmed only with an explicit matching claim',()=>{
  const before=[player('Player A',1)],after=[player('Player B',2)];
  assert.equal(classifyReplacement(before,after).accuracy,'derived');
  assert.equal(classifyReplacement(before,after,{unavailable:'Player A',replacement:'Player B'}).accuracy,'confirmed');
  assert.equal(classifyReplacement(before,after,{unavailable:'Player A',replacement:'Player C'}).accuracy,'derived');
});
test('multi-player positional reshuffles retain the complete sequence and stay uncertain',()=>{
  const before=[player('Player A',1,'Halfback'),player('Player B',6,'Five-Eighth'),player('Player D',14,'Interchange')];
  const after=[player('Player B',7,'Halfback'),player('Player C',6,'Five-Eighth'),player('Player D',13,'Lock')];
  const result=classifyReplacement(before,after);assert.equal(result.accuracy,'possible');assert.equal(result.relationship,null);assert.equal(result.sequence.length,4);assert.ok(result.sequence.some(x=>x.kind==='moved'));
});
test('Tuesday lists advance to 24-hour and final snapshots without overwriting history',()=>{
  const base={id:'m1',startsAt:'2026-07-20T10:00:00Z',home:'A',away:'B',snapshots:[{id:'s1',capturedAt:'2026-07-14T06:00:00Z',teams:{A:[player('A',1)],B:[player('B',2)]}}]};
  const update={...base,snapshots:[{id:'s2',capturedAt:'2026-07-19T09:00:00Z',teams:{A:[player('C',3)],B:[player('B',2)]}}]};
  const merged=mergeTeamListHistory([base],[update])[0];assert.equal(merged.snapshots.length,2);assert.equal(merged.snapshots[1].version,'24-hour');assert.equal(inferVersion(base.startsAt,'2026-07-20T09:00:00Z'),'final');
});
test('newer official conflict wins while earlier reports remain visible',()=>{
  const reports=[{playerId:1,status:'out',injury:'calf',sourceTier:'publication',sourceUpdatedAt:'2026-07-14T01:00:00Z',sourceUrl:'a'},{playerId:1,status:'available',injury:'cleared',sourceTier:'official_nrl',sourceUpdatedAt:'2026-07-14T02:00:00Z',sourceUrl:'b'}];
  const [current]=reconcileReports(reports);assert.equal(current.status,'available');assert.equal(current.history.length,1);assert.equal(current.history[0].status,'out');
});
test('duplicate reports collapse and freshness honestly reports outages',()=>{
  const old={id:'x',sourceUpdatedAt:'2026-01-01'},newer={id:'x',sourceUpdatedAt:'2026-02-01'};assert.deepEqual(dedupeAvailability([old,newer]),[newer]);assert.equal(freshness(new Date(),false),'source-unavailable');assert.equal(freshness(Date.now()-25*36e5,true),'stale');
});
test('Late Mail discovery preserves multi-digit round numbers',()=>{assert.deepEqual(discoverLateMailLinks('<a href="/news/2026/07/09/nrl-late-mail-round-19-all-eyes-on-stars/">Late Mail</a>'),[[19,'https://www.nrl.com/news/2026/07/09/nrl-late-mail-round-19-all-eyes-on-stars/']])});
test('generated official snapshot is structurally complete and source-attributed',()=>{
  const data=JSON.parse(fs.readFileSync(require.resolve('../public/team-news.json'),'utf8'));assert.ok(data.availability.length>50);assert.ok(data.teamLists.length>=7);assert.ok(data.availability.every(x=>x.publisher&&x.sourceUrl&&x.checkedAt&&x.accuracy));assert.ok(data.availability.some(x=>x.type==='rest'));assert.ok(data.suspensions.every(x=>x.type==='suspension'));assert.ok(data.lateMail.length>0);assert.ok(data.teamLists.every(x=>[18,19].includes(x.round)));assert.ok(data.changes.every(x=>!x.summary.match(/^(.+) out — \1 added/)));
});
