'use strict';
const fs = require('node:fs/promises');
const {test, expect} = require('@playwright/test');

const baseURL='http://127.0.0.1:32188';
const captureFile='/tmp/nrl-browser-email-capture.json';
let sequence=20;

async function isolatedContext(browser, viewport={width:1440,height:900}) {
  sequence++;
  return browser.newContext({baseURL,viewport,extraHTTPHeaders:{'x-forwarded-for':`10.20.0.${sequence}`}});
}

async function finishOnboarding(page) {
  await page.waitForTimeout(250);
  const prompt=page.getByText('Choose your look');
  if(await prompt.isVisible().catch(()=>false)){
    await page.getByRole('button',{name:'Modern Lime'}).click();
    await page.getByRole('button',{name:'Skip tour'}).click();
  }
}

test('registration, invalid login, password reset, persistent session and account deletion', async ({browser}) => {
  await fs.rm(captureFile,{force:true});
  const context=await isolatedContext(browser),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const email=`lifecycle-${Date.now()}@example.com`;
  const oldPassword='lifecycle-old-password';
  const newPassword='lifecycle-new-password';

  await page.goto('/');
  await page.locator('#soo-login-email').fill(email);
  await page.locator('#soo-login-pass').fill('wrong-password');
  await page.locator('#soo-login-submit').click();
  await expect(page.locator('#soo-auth-err')).toContainText(/invalid email or password/i);
  await expect(page.locator('#soo-login-submit')).toBeEnabled();

  await page.locator('#soo-tab-reg').click();
  await page.locator('#soo-reg-name').fill('Lifecycle User');
  await page.locator('#soo-reg-email').fill(email);
  await page.locator('#soo-reg-pass').fill(oldPassword);
  await page.locator('#soo-reg-theme').selectOption('blue');
  await page.locator('#soo-register-submit').click();
  await expect(page.getByText('Finding your way around')).toBeVisible();
  expect(await page.evaluate(()=>S.settings.theme)).toBe('blue');
  await page.getByRole('button',{name:'Next'}).click();
  await page.getByRole('button',{name:'Start playing'}).click();
  await expect(page.locator('#pg-home')).toHaveClass(/on/);

  const stored=await context.storageState();
  const restarted=await browser.newContext({baseURL,storageState:stored,viewport:{width:390,height:844},extraHTTPHeaders:{'x-forwarded-for':'10.20.0.90'}});
  const restartedPage=await restarted.newPage();
  await restartedPage.goto('/');
  await expect(restartedPage.locator('#pg-home')).toHaveClass(/on/);
  expect((await restartedPage.request.get('/api/soo/me')).status()).toBe(200);
  expect((await restartedPage.request.post('/api/soo/login',{data:{email,password:oldPassword}})).status()).toBe(200);

  await page.evaluate(()=>setPage('settings'));
  await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page.locator('#soo-login-page')).toBeVisible();
  expect((await restartedPage.request.get('/api/soo/me')).status()).toBe(200);

  await page.getByRole('button',{name:'Forgot password?'}).click();
  await page.locator('#soo-forgot-email').fill(email);
  await page.getByRole('button',{name:'Send Reset Link'}).click();
  await expect(page.locator('#soo-auth-err')).toContainText(/reset link is on its way/i);
  let capture;
  await expect.poll(async()=>{
    try{capture=JSON.parse(await fs.readFile(captureFile,'utf8'));return capture.to;}catch{return '';}
  }).toBe(email);
  const token=(capture.html.match(/resetToken=([a-f0-9]+)/i)||[])[1];
  expect(token).toBeTruthy();
  await page.goto(`/?resetToken=${token}`);
  await page.locator('#soo-reset-pass').fill(newPassword);
  await page.locator('#soo-reset-pass2').fill('does-not-match');
  await page.getByRole('button',{name:'Set New Password'}).click();
  await expect(page.locator('#soo-auth-err')).toContainText(/do not match/i);
  await page.locator('#soo-reset-pass2').fill(newPassword);
  await page.getByRole('button',{name:'Set New Password'}).click();
  await expect(page.locator('#pg-home')).toHaveClass(/on/);
  expect((await restartedPage.request.get('/api/soo/me')).status()).toBe(401);

  await page.evaluate(()=>setPage('settings'));
  await page.getByRole('button',{name:'Delete account'}).click();
  await expect(page.locator('#modal')).toBeFocused();
  await page.locator('#delete-account-password').fill(newPassword);
  await page.locator('#delete-account-submit').click();
  await expect(page.locator('#soo-login-page')).toBeVisible();
  const deletedLogin=await page.request.post('/api/soo/login',{data:{email,password:newPassword}});
  expect(deletedLogin.status()).toBe(401);
  expect(errors).toEqual([]);
  await restarted.close();await context.close();
});

test('Classic and Custom builders stay isolated through autocomplete, captaincy, clearing and trades', async ({browser}) => {
  const context=await isolatedContext(browser),page=await context.newPage();
  expect((await page.request.post('/api/soo/register',{data:{name:'Builder Audit',email:`builder-${Date.now()}@example.com`,password:'builder-audit-password'}})).status()).toBe(201);
  await page.goto('/');await finishOnboarding(page);

  const classic=await page.evaluate(()=>{
    setPage('classic');autoComplete();
    const T=S.classic;
    const slots=lineSlots(T.line);
    return {count:T.squad.length,unique:new Set(T.squad).size,bank:T.bank,cap:S.settings.cap,c:T.line.c,vc:T.line.vc,
      value:T.squad.reduce((sum,pid)=>sum+price(pid),0),filled:slots.filter(slot=>slot.pid!=null).length,
      eligible:slots.filter(slot=>slot.kind==='st'&&slot.pid!=null).every(slot=>PLAYERS[slot.pid].pos.includes(slot.posId))};
  });
  expect(classic.count).toBe(21);expect(classic.unique).toBe(21);expect(classic.bank).toBeGreaterThanOrEqual(0);
  expect(classic.value+classic.bank).toBe(classic.cap);expect(classic.filled).toBe(21);expect(classic.eligible).toBe(true);
  expect(classic.c).not.toBeNull();expect(classic.vc).not.toBeNull();expect(classic.c).not.toBe(classic.vc);

  await page.evaluate(()=>{S.customLeague=null;setPage('custom');});
  await page.locator('#cl-name').fill('Universal Custom');
  await page.locator('#cl-cap').fill(String(classic.cap+1000000));
  await page.getByRole('button',{name:/Create Custom League/}).click();
  const custom=await page.evaluate(()=>{
    const classicBefore=JSON.stringify(S.classic);
    autoComplete();
    const T=activeTeamState();
    const customBefore=T.squad.slice();
    makeCaptain(customBefore[2]);makeViceCaptain(customBefore[3]);
    const captainOK=T.line.c===customBefore[2]&&T.line.vc===customBefore[3];
    const classicUntouched=JSON.stringify(S.classic)===classicBefore;
    return {count:T.squad.length,unique:new Set(T.squad).size,bank:T.bank,captainOK,classicUntouched};
  });
  expect(custom.count).toBe(21);expect(custom.unique).toBe(21);expect(custom.bank).toBeGreaterThanOrEqual(0);
  expect(custom.captainOK).toBe(true);expect(custom.classicUntouched).toBe(true);

  const trade=await page.evaluate(()=>{
    setPage('custom');
    const T=activeTeamState(),slot=lineSlots(T.line).find(s=>s.pid!=null);
    const out=slot.pid;
    const candidate=PLAYERS.find(p=>!T.squad.includes(p.id)&&(slot.kind!=='st'||p.pos.includes(slot.posId))&&price(p.id)<=T.bank+price(out));
    const before=T.bank,expected=before+price(out)-price(candidate.id);
    S.ui.trPage='custom';execTrade(out,candidate.id);
    return {actual:T.bank,expected,hasIn:T.squad.includes(candidate.id),hasOut:T.squad.includes(out),classicCount:S.classic.squad.length};
  });
  expect(trade).toEqual({actual:trade.expected,expected:trade.expected,hasIn:true,hasOut:false,classicCount:21});

  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>clearTeam());
  const cleared=await page.evaluate(()=>({custom:activeTeamState().squad.length,customBank:activeTeamState().bank,cap:clCap(),classic:S.classic.squad.length}));
  expect(cleared).toEqual({custom:0,customBank:cleared.cap,cap:cleared.cap,classic:21});

  await page.evaluate(()=>setPage('leagues'));
  await page.getByRole('button',{name:/Create Classic League/}).click();
  await page.locator('#lg-name').fill('Audit Classic League');
  await page.locator('#lg-size').selectOption('4');
  await page.getByRole('button',{name:'Create league'}).click();
  expect(await page.evaluate(()=>({name:S.league.name,teams:S.league.teams.length,history:Object.keys(S.league.history).length}))).toEqual({name:'Audit Classic League',teams:4,history:0});

  await page.evaluate(()=>{S.draft=null;setPage('draft');});
  await page.getByRole('button',{name:/Create local draft/}).click();
  await page.locator('#dr-lgname').fill('Audit Draft League');
  await page.getByRole('button',{name:'Create local draft',exact:true}).click();
  const draftCreated=await page.evaluate(()=>({name:S.draft.league.name,owner:S.draft.league.isOwner,localOnly:S.draft.league.localOnly,
    ai:S.draft.league.participants.filter(player=>player.isAI).length,size:S.draft.league.size}));
  expect(draftCreated).toEqual({name:'Audit Draft League',owner:true,localOnly:true,ai:draftCreated.size-1,size:draftCreated.size});
  await page.getByRole('button',{name:/Start Draft/}).click();
  expect(await page.evaluate(()=>({phase:S.draft.phase,teams:S.draft.teams.length,ai:S.draft.teams.filter(team=>team.ai).length}))).toEqual({phase:'draft',teams:draftCreated.size,ai:draftCreated.size-1});
  await context.close();
});

test('navigation, internal links, dialogs and failed requests remain usable', async ({browser}) => {
  const context=await isolatedContext(browser,{width:320,height:720}),page=await context.newPage();
  const consoleErrors=[],pageErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>pageErrors.push(error.message));
  expect((await page.request.post('/api/soo/register',{data:{name:'Quality Audit',email:`quality-${Date.now()}@example.com`,password:'quality-audit-password'}})).status()).toBe(201);
  await page.goto('/');await finishOnboarding(page);
  const liveFixture=await page.evaluate(()=>({feedId:FEEDIDS[0],round:S.round,squadId:SQUAD_FEED_IDS[PLAYERS[0].sq]}));
  const feedPlayers=await (await page.request.get('/api/players')).json();
  const feedRounds=await (await page.request.get('/api/rounds')).json();
  const livePlayer=feedPlayers.find(player=>player.id===liveFixture.feedId);
  livePlayer.stats=livePlayer.stats||{};livePlayer.stats.scores=livePlayer.stats.scores||{};livePlayer.stats.scores[liveFixture.round]=57;
  const liveRound=feedRounds.find(round=>round.id===liveFixture.round);
  feedRounds.forEach(round=>{if(round.status==='active')round.status='complete';});
  liveRound.status='active';
  if(!liveRound.matches||!liveRound.matches.length)liveRound.matches=[{home_squad_id:liveFixture.squadId,away_squad_id:999999,start_time:new Date(Date.now()-60000).toISOString()}];
  await page.route('**/api/players',route=>route.fulfill({json:feedPlayers}));
  await page.route('**/api/rounds',route=>route.fulfill({json:feedRounds}));
  await page.evaluate(()=>autoRefresh());
  expect(await page.evaluate(()=>({status:LIVE.status,score:LIVE.scores[0]}))).toEqual({status:'live',score:57});
  await expect(page.locator('#hdr-status')).toContainText('LIVE');
  const unlabeled=[];
  for(const name of ['home','classic','match','leagues','origin','custom','players','settings']){
    await page.evaluate(value=>setPage(value),name);await page.waitForTimeout(80);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${name} overflow`).toBeLessThanOrEqual(1);
    unlabeled.push(...await page.locator(`#pg-${name} input:visible,#pg-${name} select:visible,#pg-${name} textarea:visible`).evaluateAll(nodes=>nodes.filter(node=>!(node.labels&&node.labels.length)&&!node.getAttribute('aria-label')&&!node.getAttribute('aria-labelledby')).map(node=>node.id||node.outerHTML.slice(0,80))));
  }
  expect(unlabeled).toEqual([]);
  const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute('href'),target:node.target,rel:node.rel})));
  for(const link of links){
    if(!link.href||link.href.startsWith('data:')||link.href.startsWith('mailto:'))continue;
    const url=new URL(link.href,baseURL);
    if(url.origin===baseURL){const response=await page.request.get(url.pathname+url.search);expect(response.status(),link.href).toBeLessThan(400);}
    else {expect(url.protocol).toBe('https:');if(link.target==='_blank')expect(link.rel).toMatch(/noopener/);}
  }
  await page.evaluate(()=>openModal('<h2>Keyboard audit</h2><button id="first-focus">First</button><button id="last-focus">Last</button>'));
  await expect(page.locator('#modal')).toBeFocused();
  const box=await page.locator('#modal').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(320);expect(box.y+box.height).toBeLessThanOrEqual(720);
  await page.locator('#last-focus').focus();await page.keyboard.press('Tab');await expect(page.locator('#modal .x')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#modal-bg')).not.toHaveClass(/on/);
  const contrast=await page.evaluate(()=>{
    const parse=value=>{value=value.trim();let m;if(value.startsWith('#')){const hex=value.slice(1);m=(hex.length===3?[...hex].map(x=>x+x):[hex.slice(0,2),hex.slice(2,4),hex.slice(4,6)]).map(x=>parseInt(x,16));}else m=value.match(/\d+(?:\.\d+)?/g).map(Number);return m.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});};
    const ratio=(a,b)=>{const [x,y]=[a,b].map(value=>{const c=parse(value);return .2126*c[0]+.7152*c[1]+.0722*c[2];});return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const results=[];
    for(const id of Object.keys(APP_THEMES)){
      applyTheme(id,false);const css=getComputedStyle(document.body);
      for(const fg of ['--txt','--dim'])for(const bg of ['--bg','--card'])results.push({id,fg,bg,ratio:ratio(css.getPropertyValue(fg),css.getPropertyValue(bg))});
    }
    applyTheme(S.settings.theme,false);return results;
  });
  for(const item of contrast)expect(item.ratio,`${item.id} ${item.fg}/${item.bg}`).toBeGreaterThanOrEqual(4.5);
  const smallTargets=await page.locator('button:visible,[role="button"]:visible').evaluateAll(nodes=>nodes.filter(node=>{const box=node.getBoundingClientRect();return box.width<40||box.height<40;}).map(node=>node.getAttribute('aria-label')||node.textContent.trim()).slice(0,10));
  expect(smallTargets).toEqual([]);
  expect(consoleErrors).toEqual([]);expect(pageErrors).toEqual([]);
  consoleErrors.length=0;
  await page.route('**/api/app-state',route=>route.request().method()==='PUT'
    ?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporary storage interruption"}'})
    :route.continue());
  await page.evaluate(()=>{S.watchlist=[3];save();});
  await expect(page.locator('#cloud-sync-error')).toBeVisible({timeout:4000});
  await page.unroute('**/api/app-state');
  await page.getByRole('button',{name:'Retry sync'}).click();
  await expect(page.locator('#cloud-sync-error')).toBeHidden({timeout:4000});
  expect(consoleErrors.every(message=>message.includes('503'))).toBe(true);expect(pageErrors).toEqual([]);
  await context.close();

  const failed=await isolatedContext(browser),login=await failed.newPage();
  await login.route('**/api/soo/login',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporarily unavailable"}'}));
  await login.goto('/');await login.locator('#soo-login-email').fill('recover@example.com');await login.locator('#soo-login-pass').fill('recover-password');
  await login.locator('#soo-login-submit').click();
  await expect(login.locator('#soo-auth-err')).toContainText('Temporarily unavailable');
  await expect(login.locator('#soo-login-submit')).toBeEnabled();
  await failed.close();
});

test('Match Centre advances generically, refreshes live scores/components, pauses hidden and recovers', async ({browser}) => {
  const context=await isolatedContext(browser,{width:1440,height:900}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  expect((await context.request.post('/api/soo/register',{data:{name:'Live Pipeline',email:`live-${Date.now()}@example.com`,password:'live-pipeline-password'}})).status()).toBe(201);
  const sourcePlayers=await (await context.request.get('/api/players')).json();
  const sourceRounds=await (await context.request.get('/api/rounds')).json();
  const player=sourcePlayers[0],home=player.squad_id;
  const away=sourceRounds.flatMap(round=>round.matches||[]).flatMap(match=>[match.home_squad_id,match.away_squad_id]).find(id=>id!==home);
  player.stats=player.stats||{};player.stats.scores=player.stats.scores||{};player.stats.scores[19]=61;
  const round18=sourceRounds.find(round=>round.id===18),round19=sourceRounds.find(round=>round.id===19),round20=sourceRounds.find(round=>round.id===20);
  sourceRounds.forEach(round=>round.status='scheduled');round18.status='complete';
  round19.status='active';round19.start=new Date(Date.now()-3600000).toISOString();round19.end=new Date(Date.now()+3600000).toISOString();
  round19.matches=[{id:1901,round:19,status:'active',home_squad_id:home,away_squad_id:away,home_score:12,away_score:8,date:new Date(Date.now()-1800000).toISOString()}];
  let playersBody=sourcePlayers,roundsBody=sourceRounds,fail=false,playerRequests=0,roundRequests=0;
  await page.route('**/api/players',async route=>{playerRequests++;if(fail)return route.abort('timedout');await route.fulfill({json:playersBody});});
  await page.route('**/api/rounds',async route=>{roundRequests++;if(fail)return route.abort('timedout');await route.fulfill({json:roundsBody});});
  await page.route('**/api/player-stats/*',route=>route.fulfill({json:{stats:[{year:2026,match_type:'nrl',round_id:19,
    fantasy_points:61,tackles:17,metres_gained:123,tries:1,goals:2,time_on_ground:80}]}}));
  await page.goto('/');await finishOnboarding(page);await page.evaluate(()=>_refreshInFlight);
  playerRequests=0;roundRequests=0;
  await page.evaluate(()=>Promise.all([autoRefresh(),autoRefresh(),autoRefresh()]));
  expect({playerRequests,roundRequests}).toEqual({playerRequests:1,roundRequests:1});
  expect(await page.evaluate(()=>({round:LIVE.round,status:LIVE.status,score:LIVE.scores[0],fixture:RFIX[19].games[0].slice(2)})))
    .toEqual({round:19,status:'live',score:61,fixture:[12,8]});
  await page.evaluate(()=>{S.ui.mcRound=19;S.ui.mcMatch=0;setPage('match');});
  await expect(page.locator('#pg-match')).toContainText('Round 19');
  await expect(page.locator('#pg-match')).toContainText('12 – 8');
  await expect(page.locator('#pg-match')).toContainText('61');
  await page.locator('#pg-match tbody tr').filter({hasText:player.first_name+' '+player.last_name}).first().click();
  await expect(page.locator('#modal')).toContainText('Tackle');
  await expect(page.locator('#modal')).toContainText('123');

  player.stats.scores[19]=64;round19.matches[0].home_score=14;
  await page.evaluate(()=>autoRefresh());
  expect(await page.evaluate(()=>({score:LIVE.scores[0],fixture:RFIX[19].games[0].slice(2)}))).toEqual({score:64,fixture:[14,8]});

  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  expect(await page.evaluate(()=>_refreshTimer)).toBeNull();
  const beforeResume=playerRequests;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>playerRequests).toBeGreaterThan(beforeResume);

  fail=true;await page.evaluate(()=>autoRefresh());
  await expect(page.locator('#hdr-updated')).toContainText('Data may be stale');
  expect(await page.evaluate(()=>LIVE.scores[0])).toBe(64);
  fail=false;await page.evaluate(()=>autoRefresh());
  await expect(page.locator('#hdr-updated')).toContainText('Updated');

  round19.status='complete';round19.matches[0].status='complete';
  round20.status='active';round20.start=new Date(Date.now()-60000).toISOString();round20.end=new Date(Date.now()+3600000).toISOString();
  round20.matches=[{id:2001,round:20,status:'active',home_squad_id:home,away_squad_id:away,home_score:4,away_score:0,date:new Date().toISOString()}];
  player.stats.scores[20]=22;
  await page.evaluate(()=>autoRefresh());
  expect(await page.evaluate(()=>({round:LIVE.round,status:LIVE.status,score:LIVE.scores[0]}))).toEqual({round:20,status:'live',score:22});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{S.ui.mcRound=20;S.ui.mcMatch=0;setPage('match');});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('#pg-match')).toContainText('Round 20');
  expect(errors).toEqual([]);
  await context.close();
});
