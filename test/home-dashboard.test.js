'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sydneyParts,schedulerDecision,competitionSummaries,teamNewsEvents,relevantNews,activeAlerts,publishTeamNews}=require('../lib/home-dashboard');
const {decisionAt}=require('../scripts/team-news-scheduler');

test('Sydney scheduler handles AEST, AEDT and every release-window boundary',()=>{
  assert.deepEqual(sydneyParts('2026-07-14T05:55:00Z'),{weekday:'Tue',year:2026,month:7,day:14,hour:15,minute:55,total:955});
  assert.equal(sydneyParts('2026-01-13T04:55:00Z').hour,15);
  for(const [time,due,cadence] of [['2026-07-14T05:54:00Z',false,'regular'],['2026-07-14T05:55:00Z',true,'five-minute'],['2026-07-14T06:00:00Z',true,'five-minute'],['2026-07-14T06:30:00Z',true,'five-minute'],['2026-07-14T06:45:00Z',true,'fifteen-minute'],['2026-07-14T08:00:00Z',true,'fifteen-minute'],['2026-07-14T08:01:00Z',false,'regular']]){const result=schedulerDecision(time,{});assert.equal(result.due,due,time);assert.equal(result.cadence,cadence,time)}
  assert.equal(schedulerDecision('2026-07-14T06:00:00Z',{expectedClubCount:16,receivedClubCount:16,validationErrors:[]}).cadence,'complete');
  assert.equal(decisionAt('2026-01-13T05:00:00Z',{teamLists:[]}).cadence,'five-minute');
});

test('competition summaries are membership-scoped, isolated and deterministically ordered',()=>{
  const user={userId:'U1',name:'Owner'},make=(id,format,status='active')=>({id,format,status,name:id,ownerId:'U1',updated:10,members:[{userId:'U1',role:'owner',active:true}],teams:[{id:'T'+id,userId:'U1',name:id+' Team',state:{rank:id==='C2'?2:5},updated:20},{id:'OTHER'+id,userId:'U2',name:'Other'}],scores:[{teamId:'T'+id,round:20,points:id==='C1'?101:202}],fixtures:[{round:20,fixtureNo:1,homeTeamId:'T'+id,awayTeamId:'OTHER'+id}],draftState:format==='draft'?{phase:'draft',me:0,turn:id==='D1'?0:1}:null});
  const leagues={C1:make('C1','custom'),C2:make('C2','custom'),D1:make('D1','draft'),D2:make('D2','draft'),SECRET:{...make('SECRET','custom'),members:[{userId:'U9',active:true}]}};
  const items=competitionSummaries({user,classicTeam:{id:'CLASSIC',name:'Classic Team'},fantasyLeagues:leagues,round:20});
  assert.equal(items.length,5);assert.equal(items[0].id,'D1');assert.equal(items.find(x=>x.id==='C1').score,101);assert.equal(items.find(x=>x.id==='C2').score,202);assert.ok(!items.some(x=>x.id==='SECRET'));assert.equal(items.find(x=>x.id==='C1').matchup.opponentName,'Other');
});

test('news relevance, urgent alert deduplication, resolution and general-news exclusion are honest',()=>{
  const snapshot={latestRound:20,availability:[{id:'A',playerId:7,playerName:'Selected Player',club:'Sharks',type:'injury',summary:'Ruled out',publisher:'NRL.com',sourceUpdatedAt:'2026-07-14T06:00:00Z',accuracy:'confirmed'},{id:'B',playerId:8,playerName:'Watched Player',club:'Storm',type:'rest',summary:'Rested',publisher:'NRL.com',sourceUpdatedAt:'2026-07-14T05:00:00Z',accuracy:'possible'}],changes:[{id:'C',club:'Broncos',summary:'Official list published',round:20,capturedAt:'2026-07-14T04:00:00Z',accuracy:'confirmed'}]};
  const events=relevantNews(teamNewsEvents(snapshot),{teamPlayerIds:new Set([7]),watchlist:new Set([8]),clubs:new Set(['Broncos'])});assert.deepEqual(events.map(x=>x.relevance),['My player','Watchlist','My club']);
  const alerts=activeAlerts({competitions:[{id:'D',leagueName:'Draft',teamName:'Team',draft:{myTurn:true},updatedAt:1,action:{page:'draft'}}],events:[...events,events[0]],deadline:'2026-07-20T00:00:00Z',now:'2026-07-15T00:00:00Z'});assert.equal(alerts.filter(x=>x.key==='team-news:A').length,1);assert.ok(alerts.some(x=>x.key==='draft-turn:D'));assert.ok(!alerts.some(x=>/Official list published/.test(x.consequence)));
  assert.equal(activeAlerts({events,deadline:'2026-07-14T00:00:00Z',now:'2026-07-15T00:00:00Z'}).length,0);
});

test('team-list publication is idempotent and preserves the verified snapshot on empty, partial, invalid or older input',()=>{
  const matches=Array.from({length:8},(_,i)=>({id:'M'+i,round:20,home:'Club '+(i*2),away:'Club '+(i*2+1)})),base={latestRound:20,checkedAt:'2026-07-14T06:00:00Z',availability:[],teamLists:matches,changes:[{id:'A'}],lateMail:[]};
  const first=publishTeamNews(null,base);assert.equal(first.validation.ok,true);assert.equal(first.changed,true);
  const unchanged=publishTeamNews(first.published,{...base,checkedAt:'2026-07-14T06:05:00Z',generatedAt:'2026-07-14T06:05:00Z',teamLists:base.teamLists.map(item=>({...item,checkedAt:'2026-07-14T06:05:00Z'})),availability:base.availability.map(item=>({...item,checkedAt:'2026-07-14T06:05:00Z'}))});assert.equal(unchanged.changed,false);assert.equal(unchanged.published.sourceHash,first.published.sourceHash);
  for(const candidate of [null,{...base,teamLists:[]},{...base,teamLists:matches.slice(0,2)},{...base,latestRound:19,teamLists:matches.map(x=>({...x,round:19}))}]){const result=publishTeamNews(first.published,candidate);assert.equal(result.changed,false);assert.equal(result.published.sourceHash,first.published.sourceHash)}
  const changed=publishTeamNews(first.published,{...base,changes:[{id:'A'},{id:'A'},{id:'B'}]});assert.equal(changed.changed,true);assert.deepEqual(changed.published.changes.map(x=>x.id),['A','B']);
});
