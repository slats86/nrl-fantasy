'use strict';
const {test, expect} = require('@playwright/test');
const widths = [320, 375, 390, 768, 1024, 1440, 1920];

test('authenticated account, league, picks, owner and score flows', async ({browser}) => {
  const owner = await browser.newContext({baseURL:'http://127.0.0.1:32188'});
  const page = await owner.newPage();
  const register = await page.request.post('/api/soo/register', {data:{name:'Owner',email:'owner@example.com',password:'owner-password-123'}});
  expect(register.status()).toBe(201);
  expect((await page.request.get('/api/soo/me')).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByText('Choose your look')).toBeVisible();
  await page.getByRole('button', {name:'Electric Blue'}).click();
  await expect(page.getByText('Finding your way around')).toBeVisible();
  await page.getByRole('button', {name:'Next'}).click();
  await page.getByRole('button', {name:'Start playing'}).click();
  await page.evaluate(() => window.setPage('settings'));
  await page.locator('.theme-option').filter({hasText:'Light Editorial'}).click();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 245, 247)');
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 245, 247)');
  await page.evaluate(() => window.setPage('settings'));
  await page.locator('.theme-option').filter({hasText:'Modern Lime'}).click();
  await page.evaluate(() => window.setPage('origin'));
  await page.locator('.soo-tab').filter({hasText:'League'}).click();
  await expect(page.locator('#soo-league-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#soo-create-submit')).toBeEnabled();
  const created = await page.request.post('/api/soo/create', {data:{name:'Origin League',teamName:'Owners',picks:{1:{FB:123}}}});
  expect(created.status()).toBe(200);
  const {code, teamId} = await created.json();
  expect((await page.request.post(`/api/soo/league/${code}/picks`, {data:{teamId,teamName:'Owners Updated',baseVersion:0,picks:{1:{FB:456}}}})).status()).toBe(423);
  expect((await page.request.post(`/api/soo/league/${code}/picks`, {data:{teamId,teamName:'Owners Updated',baseVersion:0,picks:{}}})).status()).toBe(200);
  await page.reload();
  await page.evaluate(() => window.setPage('origin'));
  await page.locator('.soo-tab').filter({hasText:'League'}).click();
  await expect(page.getByText('Origin League', {exact:true}).first()).toBeVisible();
  await page.evaluate(() => window.setPage('home'));
  await expect(page.locator('#pg-home')).toHaveClass(/on/);
  const livePlayerRow=await page.evaluate(()=>{
    const previous=LIVE;const player=PLAYERS[0];
    LIVE={round:S.round,status:'live',scores:{[player.id]:42},fetched:Date.now(),kickoffs:{}};
    const html=mcPlayerRows(player.sq,S.round,true);LIVE=previous;return html;
  });
  expect(livePlayerRow).toContain('showStatLine');
  await page.evaluate(()=>showStatLine(0,1));
  await expect(page.locator('#modal-bg')).toHaveClass(/on/);
  await page.keyboard.press('Escape');
  await page.route('**/api/player-stats/*', route => route.fulfill({json:{stats:[{
    year:new Date().getFullYear(),round_id:998,match_type:'nrl',fantasy_points:80,
    tackles:12,metres_gained:219,tries:2,time_on_ground:80
  }]}}));
  await page.evaluate(()=>showStatLine(0,998));
  await expect(page.locator('tr').filter({hasText:'Tackle'})).toContainText('12');
  await expect(page.locator('tr').filter({hasText:'Run Metres'})).toContainText('219');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.setPage('players'));
  await page.locator('#player-stats-search').fill('Holmes');
  await page.waitForTimeout(250);
  await expect(page.locator('#player-stats-search')).toHaveValue('Holmes');
  await page.evaluate(()=>showStatLine(0,999,true));
  await expect(page.getByText(/not available from the official feed for this game/i)).toBeVisible();
  await expect(page.getByText(/never substitutes season averages/i)).toBeVisible();
  await page.keyboard.press('Escape');

  const isolation = await page.evaluate(() => {
    const original = JSON.stringify(S.classic);
    S.classic = {squad:[0],line:emptyLine(),bank:S.settings.cap-price(0),history:{},startRound:1,tradesRound:0,tradesSeason:0,chips:{active:{},used:{},injured:[]}};
    S.classic.line.starters[PLAYERS[0].pos[0]][0]=0;
    S.customLeague={name:'Isolation Test',cap:S.settings.cap,tradesPerRound:2,seasonTrades:30};
    setPage('custom');
    const startsEmpty=activeTeamState().squad.length===0;
    const customPid=PLAYERS.find(p=>p.id!==0&&p.pos.includes(1)&&price(p.id)<S.settings.cap)?.id;
    S.classic.bank=9000;S.ui.slotPick={kind:'st',posId:1,i:0};
    if(customPid!=null)poolClick(customPid);
    const customCount=activeTeamState().squad.length;
    save();setPage('classic');
    const classicIntact=S.classic.squad.length===1&&S.classic.squad[0]===0;
    S.classic=JSON.parse(original);S.customLeague=null;save();
    return {startsEmpty,customCount,classicIntact};
  });
  expect(isolation).toEqual({startsEmpty:true,customCount:1,classicIntact:true});
  await page.reload();
  await expect(page.locator('#pg-classic')).toHaveClass(/on/);

  const member = await browser.newContext({baseURL:'http://127.0.0.1:32188'});
  const memberPage = await member.newPage();
  expect((await memberPage.request.post('/api/soo/register', {data:{name:'Member',email:'member@example.com',password:'member-password-123'}})).status()).toBe(201);
  await memberPage.goto('/');await memberPage.waitForTimeout(250);
  if(await memberPage.getByText('Choose your look').isVisible().catch(()=>false)){
    await memberPage.getByRole('button',{name:'Modern Lime'}).click();await memberPage.getByRole('button',{name:'Skip tour'}).click();
  }
  await memberPage.evaluate(()=>setPage('origin'));
  await memberPage.locator('.soo-tab').filter({hasText:'League'}).click();
  await memberPage.locator('#soo-join-code').waitFor({state:'visible'});
  await memberPage.locator('#soo-join-code').fill('BAD!');await memberPage.locator('#soo-join-submit').click();
  await expect(memberPage.locator('#soo-league-status')).toContainText(/invalid league code/i);
  await memberPage.locator('#soo-join-code').fill(code);await memberPage.locator('#soo-join-tname').fill('Members');
  await memberPage.locator('#soo-join-submit').click();
  await expect.poll(()=>memberPage.evaluate(()=>S.origin.league&&S.origin.league.teamId)).toBeTruthy();
  const memberTeam = await memberPage.evaluate(()=>S.origin.league.teamId);
  const simultaneous=await Promise.all([
    page.request.post(`/api/soo/league/${code}/picks`,{data:{teamId,teamName:'Owners Concurrent',baseVersion:1,picks:{}}}),
    memberPage.request.post(`/api/soo/league/${code}/picks`,{data:{teamId:memberTeam,teamName:'Members Concurrent',baseVersion:0,picks:{}}})
  ]);
  expect(simultaneous.map(response=>response.status())).toEqual([200,200]);
  const concurrentLeague=await (await page.request.get(`/api/soo/league/${code}`)).json();
  expect(concurrentLeague.teams.filter(team=>team.id===teamId)).toHaveLength(1);
  expect(concurrentLeague.teams.filter(team=>team.id===memberTeam)).toHaveLength(1);
  expect(concurrentLeague.teams.find(team=>team.id===teamId).name).toBe('Owners Concurrent');
  expect(concurrentLeague.teams.find(team=>team.id===memberTeam).name).toBe('Members Concurrent');
  expect((await page.request.delete(`/api/soo/league/${code}/team/${memberTeam}`)).status()).toBe(200);
  expect((await page.request.post('/api/soo/scores', {data:{game:1,scores:{456:88}}})).status()).toBe(200);
  expect((await page.request.delete('/api/soo/scores?game=1')).status()).toBe(200);
  expect((await page.request.post('/api/soo/logout')).status()).toBe(200);
  expect((await page.request.get('/api/soo/me')).status()).toBe(401);
  await page.goto('/');
  await page.locator('#soo-login-email').fill('owner@example.com');
  await page.locator('#soo-login-pass').fill('owner-password-123');
  await page.locator('#soo-login-submit').click();
  await expect(page.locator('#pg-home')).toHaveClass(/on/);
  await member.close(); await owner.close();
});

test('classic and custom state sync across devices', async ({browser}) => {
  const first=await browser.newContext({baseURL:'http://127.0.0.1:32188'}),page=await first.newPage();
  expect((await page.request.post('/api/soo/register',{data:{name:'Sync User',email:'sync@example.com',password:'sync-password-123'}})).status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button',{name:'Modern Lime'}).click();await page.getByRole('button',{name:'Skip tour'}).click();
  await page.evaluate(()=>{
    S.classic.squad=[0];S.classic.line=emptyLine();S.classic.line.starters[PLAYERS[0].pos[0]][0]=0;
    S.customLeague={name:'Synced Custom',cap:S.settings.cap,tradesPerRound:2,seasonTrades:30,team:{squad:[],line:emptyLine(),bank:S.settings.cap,history:{},startRound:S.round,tradesRound:0,tradesSeason:0}};
    save();
  });
  await page.waitForTimeout(1300);
  const second=await browser.newContext({baseURL:'http://127.0.0.1:32188'}),phone=await second.newPage();
  expect((await phone.request.post('/api/soo/login',{data:{email:'sync@example.com',password:'sync-password-123'}})).status()).toBe(200);
  await phone.goto('/');await phone.waitForLoadState('domcontentloaded');await phone.waitForTimeout(300);
  const synced=await phone.evaluate(()=>({classic:S.classic.squad.slice(),custom:S.customLeague&&S.customLeague.name}));
  expect(synced).toEqual({classic:[0],custom:'Synced Custom'});
  await phone.evaluate(()=>{
    const classicPid=PLAYERS.find(p=>p.id!==0&&p.pos.includes(2))?.id;
    S.classic.squad=[classicPid];S.classic.line=emptyLine();S.classic.line.starters[2][0]=classicPid;
    const customPid=PLAYERS.find(p=>p.id!==classicPid&&p.pos.includes(1))?.id;
    S.customLeague.team.squad=[customPid];S.customLeague.team.line=emptyLine();S.customLeague.team.line.starters[1][0]=customPid;
    save();
  });
  await phone.waitForTimeout(1300);
  await page.reload();await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(450);
  const reverseSynced=await page.evaluate(()=>({classic:S.classic.squad.slice(),custom:S.customLeague.team.squad.slice()}));
  expect(reverseSynced.classic).toHaveLength(1);expect(reverseSynced.custom).toHaveLength(1);
  expect(reverseSynced.classic[0]).not.toBe(reverseSynced.custom[0]);

  await phone.reload();await page.reload();await Promise.all([phone.waitForTimeout(500),page.waitForTimeout(500)]);
  await Promise.all([
    phone.evaluate(()=>{S.watchlist=[1];save()}),
    page.evaluate(()=>{S.watchlist=[2];save()})
  ]);
  await Promise.all([phone.waitForTimeout(1500),page.waitForTimeout(1500)]);
  const conflicts=(await Promise.all([phone.getByText('Newer changes found').isVisible().catch(()=>false),page.getByText('Newer changes found').isVisible().catch(()=>false)])).filter(Boolean).length;
  expect(conflicts).toBe(1);
  await phone.request.post('/api/soo/logout');
  expect((await phone.request.get('/api/soo/me')).status()).toBe(401);
  expect((await page.request.get('/api/soo/me')).status()).toBe(200);
  await second.close();await first.close();
});

for (const width of [375, 1440]) test(`detailed statistics UI, search and filters at ${width}px`, async ({browser}) => {
  const context=await browser.newContext({baseURL:'http://127.0.0.1:32188',viewport:{width,height:900}});
  const page=await context.newPage();
  await page.route('**/api/player-stats/*',route=>route.fulfill({json:{
    current_season:new Date().getFullYear(),stats:[15,16,17,18].map(round=>({
      year:new Date().getFullYear(),round_id:round,match_type:'nrl',fantasy_points:64,
      tackles:31,metres_gained:176,tries:1,goals:2,time_on_ground:80
    }))
  }}));
  const statsRegistration=await page.request.post('/api/soo/register',{data:{
    name:'Statistics UI',email:`stats-${width}@example.com`,password:'statistics-password-123'
  }});
  if(statsRegistration.status()===429&&width===1440){
    expect((await page.request.post('/api/soo/login',{data:{email:'stats-375@example.com',password:'statistics-password-123'}})).status()).toBe(200);
  }else expect(statsRegistration.status()).toBe(201);
  await page.goto('/');
  const appearancePrompt=page.getByText('Choose your look');
  if(await appearancePrompt.isVisible().catch(()=>false)){
    await page.getByRole('button',{name:'Modern Lime'}).click();
    await page.getByRole('button',{name:'Skip tour'}).click();
  }
  await page.waitForTimeout(300);
  await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;save();closeModal()});
  const player=await page.evaluate(()=>{
    const p=PLAYERS.find(item=>OFFS[item.id]&&OFFS[item.id].some((score,index)=>index>=14&&score));
    const round=OFFS[p.id].findIndex((score,index)=>index>=14&&score)+1;
    return {id:p.id,name:p.name,last:p.name.split(' ').pop(),club:p.sq,position:p.pos[0],round};
  });

  await page.evaluate(({id,round})=>{
    const p=PLAYERS[id],fixture=RFIX[round];
    S.ui.mcRound=round;
    S.ui.mcMatch=Math.max(0,fixture.games.findIndex(game=>game[0]===p.sq||game[1]===p.sq));
    setPage('match');
  },player);
  const matchRow=page.locator('#pg-match tr').filter({hasText:player.name}).first();
  await expect(matchRow).toBeVisible();
  await matchRow.click();
  await expect(page.locator('#modal tr').filter({hasText:'Tackle'})).toContainText('31');
  await expect(page.locator('#modal tr').filter({hasText:'Run Metres'})).toContainText('176');
  await page.keyboard.press('Escape');

  await page.evaluate(()=>setPage('players'));
  await page.locator('#player-stats-search').fill(player.last);
  await page.waitForTimeout(180);
  await page.locator('#player-stats-search + select').selectOption(String(player.club));
  await page.locator('#pg-players .pos-filter button').filter({hasText:new RegExp('^'+await page.evaluate(pos=>POSN[pos],player.position)+'$')}).click();
  const profileRow=page.locator('#pg-players .pl-main-table tbody tr').filter({hasText:player.name}).first();
  await expect(profileRow).toBeVisible();
  await profileRow.click();
  await expect(page.locator('.player-profile')).toBeVisible();
  await expect(page.getByRole('heading',{name:player.name,level:1})).toBeVisible();
  await expect(page.getByRole('heading',{name:'2026 Form'})).toBeVisible();
  await page.evaluate(()=>applyTheme('blue',false));
  await page.screenshot({path:`reports/player-stats-${width}.png`,fullPage:false});
  await expect(page.getByRole('button',{name:'Score'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Minutes'}).click();
  await expect(page.getByRole('button',{name:'Minutes'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Score'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if(width===375){
    const recent=page.getByRole('button',{name:new RegExp(`Open Round ${player.round},`)});
    await expect(recent).toBeVisible();await recent.click();
    await expect(page.getByRole('heading',{name:`Round ${player.round}`})).toBeVisible();
    await expect(page.getByText('Fantasy points')).toBeVisible();
    const scoring=page.getByRole('button',{name:/Scoring/});
    await expect(scoring).toHaveAttribute('aria-expanded','true');
    await expect(page.getByText('Tries',{exact:true})).toBeVisible();
    const running=page.getByRole('button',{name:/Running/});
    await expect(running).toHaveAttribute('aria-expanded','true');
    await expect(page.getByText('Run metres',{exact:true})).toBeVisible();
    await page.screenshot({path:'reports/player-stats-mobile-round-375.png',fullPage:false});
    await page.keyboard.press('Escape');
    await expect(page.locator('.player-profile')).toBeVisible();
  }else{
    const roundRow=page.locator('.player-game-row').filter({hasText:`Round ${player.round}`}).first();
    await expect(roundRow).toBeVisible();await roundRow.click();
    const detail=page.locator('.player-game-detail');
    await expect(detail).toContainText('Tackles');await expect(detail).toContainText('31');
    await expect(detail).toContainText('Run metres');await expect(detail).toContainText('176');
  }
  const watch=page.getByRole('button',{name:/Watch/});await watch.focus();await page.keyboard.press('Space');
  await expect(page.getByRole('button',{name:/Watching/})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(id=>S.watchlist.includes(id),player.id)).toBe(true);
  if(width===1440){
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{S.ui.plSearch='';S.ui.plClub=-1;S.ui.plPos=0;setPage('players');});
    await page.locator('#pg-players th').filter({hasText:'Avg'}).first().click();
    expect(await page.evaluate(()=>S.ui.plSort)).toBe('avg');
    const compareButtons=page.locator('#pg-players .pl-main-table tbody tr td:last-child button');
    await compareButtons.nth(0).click();await page.locator('#modal button').filter({hasText:/^OK$/}).click();
    await compareButtons.nth(1).click();
    await expect(page.locator('#modal')).toContainText(/Player Comparison/i);
    await page.keyboard.press('Escape');
  }
  await context.close();
});

for (const width of widths) test(`responsive app shell at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  const login = await page.request.post('/api/soo/login', {data:{email:'owner@example.com',password:'owner-password-123'}});
  expect(login.status()).toBe(200);
  await page.goto('/'); await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
  const appearancePrompt=page.getByText('Choose your look');
  if(await appearancePrompt.isVisible().catch(()=>false)){
    await page.getByRole('button', {name:'Modern Lime'}).click();
    await page.getByRole('button', {name:'Skip tour'}).click();
  }
  await expect(page).toHaveTitle('The Squad — NRL Fantasy');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('#app-main')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#sidebar-nav')).toHaveAttribute('aria-label', 'Primary navigation');
  await expect(page.locator('#bottom-tabbar')).toHaveAttribute('aria-label', 'Mobile navigation');
  await page.evaluate(() => window.setPage('home'));
  await expect(page.locator('[data-testid="dashboard-hero"]')).toBeVisible();
  await expect(page.getByRole('button', {name:/Manage team/i})).toBeVisible();
  await page.evaluate(() => window.setPage('classic'));
  await expect(page.locator('.team-builder')).toBeVisible();
  if(width<=600){
    await expect(page.locator('.team-builder>#pool-card')).toBeHidden();
    await expect(page.getByRole('button',{name:'Find and add players'})).toBeVisible();
  }else await expect(page.locator('#pool-card')).toBeVisible();
  await page.evaluate(() => window.setPage('leagues'));
  await expect(page.locator('.league-hub')).toBeVisible();
  const cardTab = page.locator('.format-tabs > div').first();
  await expect(cardTab).toHaveAttribute('role', 'button');
  await expect(cardTab).toHaveAttribute('tabindex', '0');
  await cardTab.focus();
  await cardTab.press('Enter');
  for (const name of ['home','classic','match','leagues','custom','players','settings']) {
    await page.evaluate(pg => { if (typeof window.setPage === 'function') window.setPage(pg); }, name);
    await page.waitForTimeout(50);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} horizontally overflows`).toBeLessThanOrEqual(1);
  }
  const mobileNav = await page.locator('#bottom-tabbar').evaluate(el => getComputedStyle(el).display !== 'none');
  expect(mobileNav).toBe(width <= 768);
  if (width <= 768) {
    await expect(page.locator('#bottom-tabbar .btab')).toHaveCount(5);
    await expect(page.getByRole('button',{name:'Open navigation menu'})).toBeVisible();
    await expect(page.locator('.topbar-brand')).toBeVisible();
    await page.locator('#bottom-tabbar .btab').filter({hasText:'More'}).click();
    await expect(page.getByRole('button', {name:'State of Origin'})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  if(width<=600){
    await page.evaluate(()=>window.setPage('classic'));
    await expect(page.locator('.team-summary')).toHaveCSS('position','sticky');
    await expect(page.getByRole('button',{name:'Find and add players'})).toBeVisible();
    await page.getByRole('button',{name:'Find and add players'}).click();
    await expect(page.locator('#modal #pool-card')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});
