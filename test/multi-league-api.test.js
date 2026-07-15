const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const port=32218,base=`http://127.0.0.1:${port}`,dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'nrl-multi-league-'));
let server;
async function request(pathname,{cookie,method='GET',body}={}){
  const response=await fetch(base+pathname,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {response,data:await response.json().catch(()=>({}))};
}
async function register(name,email){
  const {response,data}=await request('/api/soo/register',{method:'POST',body:{name,email,password:'multi-league-password'}});
  assert.equal(response.status,201);return {cookie:response.headers.get('set-cookie').split(';')[0],user:data};
}
async function create(cookie,format,name,key,maxMembers=8){
  const result=await request('/api/fantasy-leagues',{cookie,method:'POST',body:{format,name,teamName:name+' Team',maxMembers,requestId:key,rules:{scoreMode:'official'},teamState:{team:{squad:[],marker:name}},draftState:format==='draft'?{phase:'lobby',marker:name,league:{name,size:maxMembers,participants:[{name:name+' Team',isMe:true,isAI:false},...Array.from({length:maxMembers-1},()=>({name:'Open slot',isEmpty:true,isAI:false}))]}}:undefined}});
  assert.ok([200,201].includes(result.response.status),JSON.stringify(result.data));return result.data;
}

test.before(async()=>{
  server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,APP_URL:base},stdio:'ignore'});
  for(let i=0;i<50;i++){try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('multi-league test server did not start');
});
test.after(()=>{if(server)server.kill();fs.rmSync(dataDir,{recursive:true,force:true})});

test('multiple Custom and Draft leagues remain independent across users and stale devices',async()=>{
  const owner=await register('Owner','multi-owner@example.com');
  const member=await register('Member','multi-member@example.com');
  const outsider=await register('Outsider','multi-outsider@example.com');

  const customOne=await create(owner.cookie,'custom','Custom Alpha','create-custom-alpha');
  const customTwo=await create(owner.cookie,'custom','Custom Beta','create-custom-beta');
  const draftOne=await create(owner.cookie,'draft','Draft Alpha','create-draft-alpha');
  const draftTwo=await create(owner.cookie,'draft','Draft Beta','create-draft-beta');
  assert.equal((await request('/api/fantasy-leagues',{cookie:owner.cookie})).data.leagues.length,4);

  const repeated=await create(owner.cookie,'custom','Ignored duplicate name','create-custom-alpha');
  assert.equal(repeated.league.id,customOne.league.id);assert.equal(repeated.idempotent,true);

  const joinedCustom=await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:customOne.league.code,format:'custom',teamName:'Member Custom',requestId:'join-custom-alpha'}});
  assert.equal(joinedCustom.response.status,201);assert.equal(joinedCustom.data.league.role,'member');
  const joinedDraft=await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:draftOne.league.code,format:'draft',teamName:'Member Draft',requestId:'join-draft-alpha'}});
  assert.equal(joinedDraft.response.status,201);assert.equal(joinedDraft.data.league.draftState.league.participants.filter(item=>item.userId===member.user.userId).length,1);
  const repeatedJoin=await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:customOne.league.code,format:'custom',requestId:'join-custom-alpha'}});
  assert.equal(repeatedJoin.response.status,200);assert.equal(repeatedJoin.data.idempotent,true);

  const forbiddenRead=await request(`/api/fantasy-leagues/${customOne.league.id}`,{cookie:outsider.cookie});
  assert.equal(forbiddenRead.response.status,403);
  const forbiddenManage=await request(`/api/fantasy-leagues/${customOne.league.id}`,{cookie:member.cookie,method:'PATCH',body:{name:'Hijacked'}});
  assert.equal(forbiddenManage.response.status,403);

  const firstSave=await request(`/api/fantasy-leagues/${customOne.league.id}/team`,{cookie:member.cookie,method:'PUT',body:{baseVersion:0,state:{squad:[101],marker:'alpha'}}});
  assert.equal(firstSave.response.status,200);assert.equal(firstSave.data.version,1);
  const staleSave=await request(`/api/fantasy-leagues/${customOne.league.id}/team`,{cookie:member.cookie,method:'PUT',body:{baseVersion:0,state:{squad:[202],marker:'stale'}}});
  assert.equal(staleSave.response.status,409);assert.equal(staleSave.data.team.state.marker,'alpha');
  const ownerOtherSave=await request(`/api/fantasy-leagues/${customTwo.league.id}/team`,{cookie:owner.cookie,method:'PUT',body:{baseVersion:0,state:{squad:[303],marker:'beta'}}});
  assert.equal(ownerOtherSave.response.status,200);
  assert.equal((await request(`/api/fantasy-leagues/${customOne.league.id}`,{cookie:member.cookie})).data.league.team.state.marker,'alpha');
  assert.equal((await request(`/api/fantasy-leagues/${customTwo.league.id}`,{cookie:owner.cookie})).data.league.team.state.marker,'beta');
  assert.equal((await request(`/api/fantasy-leagues/${customOne.league.id}/team`,{cookie:owner.cookie,method:'PUT',body:{baseVersion:0,state:{squad:[777],marker:'same-player-alpha'}}})).response.status,200);
  assert.equal((await request(`/api/fantasy-leagues/${customTwo.league.id}/team`,{cookie:owner.cookie,method:'PUT',body:{baseVersion:1,state:{squad:[777],marker:'same-player-beta'}}})).response.status,200);

  const pickOne=await request(`/api/fantasy-leagues/${draftOne.league.id}/draft/picks`,{cookie:owner.cookie,method:'POST',body:{baseVersion:1,playerId:500845,pickNumber:0}});
  assert.equal(pickOne.response.status,201);assert.equal(pickOne.data.version,2);
  const samePlayerOtherLeague=await request(`/api/fantasy-leagues/${draftTwo.league.id}/draft/picks`,{cookie:owner.cookie,method:'POST',body:{baseVersion:0,playerId:500845,pickNumber:0}});
  assert.equal(samePlayerOtherLeague.response.status,201);
  const duplicateSameLeague=await request(`/api/fantasy-leagues/${draftOne.league.id}/draft/picks`,{cookie:member.cookie,method:'POST',body:{baseVersion:2,playerId:500845,pickNumber:1}});
  assert.equal(duplicateSameLeague.response.status,409);assert.match(duplicateSameLeague.data.error,/already been drafted/i);
  const staleDraft=await request(`/api/fantasy-leagues/${draftOne.league.id}/draft/picks`,{cookie:member.cookie,method:'POST',body:{baseVersion:1,playerId:42,pickNumber:1}});
  assert.equal(staleDraft.response.status,409);assert.match(staleDraft.data.error,/another device/i);

  const liveDraft=await create(owner.cookie,'draft','Live Draft','create-live-draft');
  const liveJoin=await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:liveDraft.league.code,format:'draft',teamName:'Live Member',requestId:'join-live-draft'}});
  assert.equal(liveJoin.response.status,201);
  const liveState={...liveJoin.data.league.draftState,phase:'draft',size:8,pickNo:0,log:[],teams:Array.from({length:8},(_,index)=>({name:'Team '+(index+1),roster:[],ai:index>1}))};
  const started=await request(`/api/fantasy-leagues/${liveDraft.league.id}/draft`,{cookie:owner.cookie,method:'PUT',body:{baseVersion:1,state:liveState}});
  assert.equal(started.response.status,200);assert.equal(started.data.version,2);
  const outOfTurn=await request(`/api/fantasy-leagues/${liveDraft.league.id}/draft/picks`,{cookie:member.cookie,method:'POST',body:{baseVersion:2,playerId:10,pickNumber:0}});
  assert.equal(outOfTurn.response.status,403);assert.match(outOfTurn.data.error,/not your Draft turn/i);
  const liveOwnerPick=await request(`/api/fantasy-leagues/${liveDraft.league.id}/draft/picks`,{cookie:owner.cookie,method:'POST',body:{baseVersion:2,playerId:10,pickNumber:0}});
  assert.equal(liveOwnerPick.response.status,201);assert.equal(liveOwnerPick.data.draftState.pickNo,1);assert.deepEqual(liveOwnerPick.data.draftState.teams[0].roster,[10]);
  const liveMemberPick=await request(`/api/fantasy-leagues/${liveDraft.league.id}/draft/picks`,{cookie:member.cookie,method:'POST',body:{baseVersion:3,playerId:11,pickNumber:1}});
  assert.equal(liveMemberPick.response.status,201);assert.equal(liveMemberPick.data.draftState.pickNo,2);assert.deepEqual(liveMemberPick.data.draftState.teams[1].roster,[11]);
  const liveReload=await request(`/api/fantasy-leagues/${liveDraft.league.id}`,{cookie:owner.cookie});
  assert.equal(liveReload.data.league.draftState.pickNo,2);assert.deepEqual(liveReload.data.league.draftState.teams.slice(0,2).map(team=>team.roster),[[10],[11]]);

  const invalidExpiry=await request(`/api/fantasy-leagues/${customOne.league.id}`,{cookie:owner.cookie,method:'PATCH',body:{inviteExpiresAt:'not-a-date'}});
  assert.equal(invalidExpiry.response.status,400);

  const full=await create(owner.cookie,'custom','Tiny League','create-tiny-league',2);
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:full.league.code,format:'custom',requestId:'join-tiny-league'}})).response.status,201);
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:outsider.cookie,method:'POST',body:{code:full.league.code,format:'custom',requestId:'join-full-league'}})).response.status,409);
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:outsider.cookie,method:'POST',body:{code:'BAD!',format:'custom'}})).response.status,400);
  await request(`/api/fantasy-leagues/${customTwo.league.id}`,{cookie:owner.cookie,method:'PATCH',body:{inviteExpiresAt:Date.now()-1000}});
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:outsider.cookie,method:'POST',body:{code:customTwo.league.code,format:'custom',requestId:'join-expired-league'}})).response.status,410);

  const outsiderCustom=await create(outsider.cookie,'custom','Outsider Custom','create-outsider-custom');
  const outsiderDraft=await create(outsider.cookie,'draft','Outsider Draft','create-outsider-draft');
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:owner.cookie,method:'POST',body:{code:outsiderCustom.league.code,format:'custom',teamName:'Owner Away Custom',requestId:'owner-joins-custom'}})).response.status,201);
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:owner.cookie,method:'POST',body:{code:outsiderDraft.league.code,format:'draft',teamName:'Owner Away Draft',requestId:'owner-joins-draft'}})).response.status,201);
  assert.equal((await request('/api/fantasy-leagues/join',{cookie:member.cookie,method:'POST',body:{code:outsiderCustom.league.code,format:'draft',requestId:'wrong-format-invite'}})).response.status,409);
  assert.equal((await request(`/api/fantasy-leagues/${outsiderCustom.league.id}`,{cookie:outsider.cookie,method:'PATCH',body:{transferOwnerId:owner.user.userId}})).response.status,200);
  assert.equal((await request(`/api/fantasy-leagues/${outsiderCustom.league.id}`,{cookie:outsider.cookie,method:'PATCH',body:{name:'Old owner cannot edit'}})).response.status,403);
  assert.equal((await request(`/api/fantasy-leagues/${outsiderCustom.league.id}`,{cookie:owner.cookie,method:'PATCH',body:{name:'Transferred Custom'}})).response.status,200);

  assert.equal((await request(`/api/fantasy-leagues/${draftOne.league.id}/membership`,{cookie:member.cookie,method:'DELETE',body:{}})).response.status,200);
  const remaining=(await request('/api/fantasy-leagues',{cookie:member.cookie})).data.leagues;
  assert.ok(remaining.some(league=>league.id===customOne.league.id));assert.ok(!remaining.some(league=>league.id===draftOne.league.id));
  assert.equal((await request(`/api/fantasy-leagues/${customOne.league.id}`,{cookie:owner.cookie,method:'DELETE',body:{confirmName:'wrong'}})).response.status,400);
});
