'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const port = 32191;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-product-api-'));
const emailCapture = path.join(dataDir, 'email.json');
let server;
const base = `http://127.0.0.1:${port}`;

function cookie(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function jsonRequest(requestPath, {method='GET', body, session}={}) {
  const response = await fetch(base + requestPath, {
    method,
    headers: {...(body === undefined ? {} : {'content-type':'application/json'}), ...(session ? {cookie:session} : {})},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return {response, payload};
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error('product API server exited');
    try { if ((await fetch(base + '/ready')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('product API server did not start');
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {cwd:path.join(__dirname, '..'), stdio:'ignore', env:{
    ...process.env, PORT:String(port), APP_URL:base, DATA_DIR:dataDir, NODE_ENV:'test', EMAIL_CAPTURE_FILE:emailCapture
  }});
  await waitForServer();
});

test.after(() => {
  if (server) server.kill();
  fs.rmSync(dataDir, {recursive:true, force:true});
});

test('complete account, concurrency, league and ownership API lifecycle', async () => {
  const owner = {name:'API Owner', email:'api-owner@example.com', password:'owner-password-123'};
  const registrations = await Promise.all([
    jsonRequest('/api/soo/register', {method:'POST', body:owner}),
    jsonRequest('/api/soo/register', {method:'POST', body:owner})
  ]);
  assert.deepEqual(registrations.map(result => result.response.status).sort(), [201, 409]);
  const created = registrations.find(result => result.response.status === 201);
  const registrationCookie = cookie(created.response);
  assert.ok(registrationCookie.startsWith('session='));
  assert.doesNotMatch(JSON.stringify(created.payload), /hash|salt|token|password/i);

  assert.equal((await jsonRequest('/api/soo/login', {method:'POST', body:{email:owner.email,password:'wrong-password'}})).response.status, 401);
  const loginA = await jsonRequest('/api/soo/login', {method:'POST', body:{email:owner.email,password:owner.password}});
  const loginB = await jsonRequest('/api/soo/login', {method:'POST', body:{email:owner.email,password:owner.password}});
  const sessionA = cookie(loginA.response), sessionB = cookie(loginB.response);
  assert.notEqual(sessionA, sessionB);
  assert.equal((await jsonRequest('/api/soo/me', {session:registrationCookie})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/me', {session:sessionA})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/me', {session:sessionB})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/logout', {method:'POST', session:sessionB})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/me', {session:sessionB})).response.status, 401);
  assert.equal((await jsonRequest('/api/soo/me', {session:sessionA})).response.status, 200);

  assert.equal((await jsonRequest('/api/soo/forgot-password', {method:'POST', body:{email:'missing@example.com'}})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/forgot-password', {method:'POST', body:{email:owner.email}})).response.status, 200);
  let captured;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (fs.existsSync(emailCapture)) {
      try { captured = JSON.parse(fs.readFileSync(emailCapture, 'utf8')); } catch { captured = null; }
      if (captured && /reset/i.test(captured.subject)) break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(captured && captured.subject || '', /reset/i);
  assert.equal(captured.to, owner.email);
  const resetToken = captured.html.match(/resetToken=([a-f0-9]+)/i)[1];
  const newPassword = 'new-owner-password-123';
  const reset = await jsonRequest('/api/soo/reset-password', {method:'POST', body:{token:resetToken,password:newPassword}});
  assert.equal(reset.response.status, 200);
  const resetSession = cookie(reset.response);
  assert.equal((await jsonRequest('/api/soo/reset-password', {method:'POST', body:{token:resetToken,password:newPassword}})).response.status, 400);
  assert.equal((await jsonRequest('/api/soo/me', {session:sessionA})).response.status, 401);
  assert.equal((await jsonRequest('/api/soo/login', {method:'POST', body:{email:owner.email,password:owner.password}})).response.status, 401);
  assert.equal((await jsonRequest('/api/soo/me', {session:resetSession})).response.status, 200);

  const initialState = await jsonRequest('/api/app-state', {session:resetSession});
  assert.equal(initialState.payload.version, 0);
  const firstState = await jsonRequest('/api/app-state', {method:'PUT', session:resetSession,
    body:{baseVersion:0,state:{classic:{squad:[101]},settings:{theme:'lime'}}}});
  assert.equal(firstState.response.status, 200);
  assert.equal(firstState.payload.version, 1);
  const stateUpdates = await Promise.all([
    jsonRequest('/api/app-state', {method:'PUT', session:resetSession,
      body:{baseVersion:1,state:{classic:{squad:[201]},settings:{theme:'blue'}}}}),
    jsonRequest('/api/app-state', {method:'PUT', session:resetSession,
      body:{baseVersion:1,state:{classic:{squad:[301]},settings:{theme:'gold'}}}})
  ]);
  assert.deepEqual(stateUpdates.map(result => result.response.status).sort(), [200, 409]);
  const currentState = await jsonRequest('/api/app-state', {session:resetSession});
  assert.equal(currentState.payload.version, 2);
  const winner = stateUpdates.find(result => result.response.status === 200);
  const winningSquad = winner === stateUpdates[0] ? [201] : [301];
  assert.deepEqual(currentState.payload.state.classic.squad, winningSquad);
  assert.equal((await jsonRequest('/api/app-state', {method:'PUT', session:resetSession,
    body:{state:{classic:{squad:[]}}}})).response.status, 428);
  assert.equal((await jsonRequest('/api/app-state', {method:'PUT', session:resetSession,
    body:{baseVersion:2,state:{classic:'not-an-object'}}})).response.status, 400);

  const leagueCreates = await Promise.all([
    jsonRequest('/api/soo/create', {method:'POST', session:resetSession, body:{name:'Concurrent League',teamName:'Owners',picks:{}}}),
    jsonRequest('/api/soo/create', {method:'POST', session:resetSession, body:{name:'Duplicate League',teamName:'Owners',picks:{}}})
  ]);
  assert.deepEqual(leagueCreates.map(result => result.response.status).sort(), [200, 409]);
  const league = leagueCreates.find(result => result.response.status === 200).payload;

  const member = {name:'API Member',email:'api-member@example.com',password:'member-password-123'};
  const memberRegistration = await jsonRequest('/api/soo/register', {method:'POST',body:member});
  assert.equal(memberRegistration.response.status, 201);
  const memberSession = cookie(memberRegistration.response);
  assert.equal((await jsonRequest('/api/soo/join', {method:'POST',session:memberSession,
    body:{code:'bad!',teamName:'Members',picks:{}}})).response.status, 400);
  assert.equal((await jsonRequest('/api/soo/join', {method:'POST',session:memberSession,
    body:{code:'ABC234',teamName:'Members',picks:{}}})).response.status, 404);
  const joined = await jsonRequest('/api/soo/join', {method:'POST',session:memberSession,
    body:{code:league.code,teamName:'Members',picks:{}}});
  assert.equal(joined.response.status, 200);
  assert.equal((await jsonRequest('/api/soo/join', {method:'POST',session:memberSession,
    body:{code:league.code,teamName:'Members',picks:{}}})).response.status, 409);

  const memberTeamId = joined.payload.teamId;
  const locked = await jsonRequest(`/api/soo/league/${league.code}/picks`, {method:'POST',session:memberSession,
    body:{teamId:memberTeamId,baseVersion:0,picks:{1:{FB:1}}}});
  assert.equal(locked.response.status, 423);
  assert.match(locked.payload.error, /locked/i);
  const pickUpdates = await Promise.all([
    jsonRequest(`/api/soo/league/${league.code}/picks`, {method:'POST',session:memberSession,
      body:{teamId:memberTeamId,baseVersion:0,picks:{},teamName:'Members A'}}),
    jsonRequest(`/api/soo/league/${league.code}/picks`, {method:'POST',session:memberSession,
      body:{teamId:memberTeamId,baseVersion:0,picks:{},teamName:'Members B'}})
  ]);
  assert.deepEqual(pickUpdates.map(result => result.response.status).sort(), [200, 409]);
  assert.equal((await jsonRequest(`/api/soo/league/${league.code}/picks`, {method:'POST',session:resetSession,
    body:{teamId:memberTeamId,baseVersion:1,picks:{}}})).response.status, 403);
  const leagueState = await jsonRequest(`/api/soo/league/${league.code}`, {session:memberSession});
  assert.equal(leagueState.payload.teams.length, 2);
  assert.equal(leagueState.payload.teams.find(team => team.id === memberTeamId).version, 1);

  assert.equal((await jsonRequest(`/api/soo/league/${league.code}/team/${memberTeamId}`,
    {method:'DELETE',session:memberSession})).response.status, 403);
  assert.equal((await jsonRequest(`/api/soo/league/${league.code}/team/${memberTeamId}`,
    {method:'DELETE',session:resetSession})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/my-league', {session:memberSession})).response.status, 404);
  assert.equal((await jsonRequest('/api/soo/account', {method:'DELETE',session:memberSession,
    body:{password:member.password}})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/login', {method:'POST',body:{email:member.email,password:member.password}})).response.status, 401);

  assert.equal((await jsonRequest(`/api/soo/league/${league.code}`, {method:'DELETE',session:resetSession})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/account', {method:'DELETE',session:resetSession,
    body:{password:newPassword}})).response.status, 200);
  assert.equal((await jsonRequest('/api/soo/me', {session:resetSession})).response.status, 401);
});

test('expired sessions are rejected without affecting server health', async () => {
  const expiryPort = port + 1;
  const expiryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-session-expiry-'));
  const child = spawn(process.execPath, ['server.js'], {cwd:path.join(__dirname, '..'), stdio:'ignore', env:{
    ...process.env, PORT:String(expiryPort), APP_URL:`http://127.0.0.1:${expiryPort}`, DATA_DIR:expiryDir,
    NODE_ENV:'test', SESSION_TTL_MS:'1200'
  }});
  try {
    for (let attempt=0;attempt<50;attempt++) {
      try {if((await fetch(`http://127.0.0.1:${expiryPort}/ready`)).ok)break;} catch {}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const registered=await fetch(`http://127.0.0.1:${expiryPort}/api/soo/register`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:'Expiry User',email:'expiry@example.com',password:'expiry-password-123'})
    });
    assert.equal(registered.status,201);
    const session=cookie(registered);
    assert.equal((await fetch(`http://127.0.0.1:${expiryPort}/api/soo/me`,{headers:{cookie:session}})).status,200);
    await new Promise(resolve=>setTimeout(resolve,1300));
    assert.equal((await fetch(`http://127.0.0.1:${expiryPort}/api/soo/me`,{headers:{cookie:session}})).status,401);
    assert.equal((await fetch(`http://127.0.0.1:${expiryPort}/health`)).status,200);
  } finally { child.kill();fs.rmSync(expiryDir,{recursive:true,force:true}); }
});

test('sensitive authentication routes enforce rate limits', async () => {
  const ratePort=port+2,rateDir=fs.mkdtempSync(path.join(os.tmpdir(),'nrl-rate-limit-'));
  const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),stdio:'ignore',env:{
    ...process.env,PORT:String(ratePort),APP_URL:`http://127.0.0.1:${ratePort}`,DATA_DIR:rateDir,NODE_ENV:'test'
  }});
  try{
    for(let attempt=0;attempt<50;attempt++){
      try{if((await fetch(`http://127.0.0.1:${ratePort}/ready`)).ok)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    let response;
    for(let attempt=0;attempt<11;attempt++)response=await fetch(`http://127.0.0.1:${ratePort}/api/soo/login`,{
      method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`spoof-${attempt}, 127.0.0.1`},body:JSON.stringify({email:'nobody@example.com',password:'invalid'})
    });
    assert.equal(response.status,429);assert.match(response.headers.get('retry-after'),/^\d+$/);
    for(let attempt=0;attempt<6;attempt++)response=await fetch(`http://127.0.0.1:${ratePort}/api/soo/forgot-password`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'nobody@example.com'})
    });
    assert.equal(response.status,429);
  }finally{child.kill();fs.rmSync(rateDir,{recursive:true,force:true});}
});
