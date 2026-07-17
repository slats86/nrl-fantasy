'use strict';
const {test,expect}=require('@playwright/test');

const baseURL='http://127.0.0.1:32188';
let authState;
test.beforeAll(async({request})=>{
  const credentials={email:'player-design@example.com',password:'player-design-password'};
  const response=await request.post('/api/soo/register',{data:{name:'Player Design',...credentials}});
  if(response.status()===409)expect((await request.post('/api/soo/login',{data:credentials})).status()).toBe(200);
  else expect(response.status()).toBe(201);
  authState=await request.storageState();
});
async function openAccount(browser,width,label){
  const context=await browser.newContext({baseURL,viewport:{width,height:900},storageState:authState}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto('/');
  const prompt=page.getByText('Choose your look');
  if(await prompt.isVisible().catch(()=>false)){await page.getByRole('button',{name:'Electric Blue'}).click();await page.getByRole('button',{name:'Skip tour'}).click()}
  await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;applyTheme('blue',false);closeModal()});
  return {context,page,errors};
}
async function routeMultiSeasonHistory(page){
  await page.route('**/api/player-stats/*',route=>route.fulfill({json:{current_season:2026,stats:[
    {year:2026,match_type:'nrl',round_id:18,opponent:'Raiders',position_match:'Fullback',number:'1',time_on_ground:80,price:700000,be:61,fantasy_points:70,tackles:12,metres_gained:190,tries:1,goals:2},
    {year:2025,match_type:'nrl',round_id:27,opponent:'Tigers',position_match:'Halfback',number:'7',time_on_ground:80,price:807000,be:55,fantasy_points:74,tackles:15,metres_gained:104,tries:1,goals:6,errors:1,kick_metres:356,home_squad_id:500004,squad_id:500004,match_date:'2025-09-06 17:30:00'},
    {year:2025,match_type:'nrl',round_id:26,opponent:'Dolphins',position_match:'Fullback',number:'14',time_on_ground:60,price:790000,be:49,fantasy_points:58,tackles:9,metres_gained:141,tries:0,goals:2,away_squad_id:500004,squad_id:500004,match_date:'2025-08-31 16:05:00'},
    {year:2025,match_type:'nrl',round_id:20,opponent:'Storm',position_match:'Centre',number:'3',time_on_ground:70,price:760000,be:52,fantasy_points:40,home_squad_id:500004,squad_id:500004,match_date:'2025-07-20 14:00:00'}
  ],round_strips:{2025:[
    {round:27,played:true,opponent_name:'Tigers',is_home:true},{round:26,played:true,opponent_name:'Dolphins',is_home:false},
    {round:25,played:false,opponent_name:'Raiders',status:'injured'},{round:24,played:false,opponent_name:'Knights',status:'suspended'},
    {round:23,played:false,opponent_name:'Broncos',status:'rested'},{round:22,played:false,opponent_name:'Eels',status:'not_selected'},
    {round:21,played:false,opponent_name:'Bye',status:'bye',is_bye:true},{round:20,played:true,opponent_name:'Storm',is_home:true}
  ]}}}));
}

test('Player Stats structure is responsive at every supported viewport',async({browser})=>{
  for(const width of [320,375,390,768,1024,1440,1920]){
    const {context,page,errors}=await openAccount(browser,width,String(width));
    const player=await page.evaluate(()=>{
      const p=PLAYERS.find(item=>item.pos.length>1&&OFFS[item.id]&&OFFS[item.id].some(score=>score!=null));
      setPage('players');showPlayer(p.id);return {id:p.id,name:p.name,positions:p.pos.length};
    });
    await expect(page.getByRole('heading',{name:player.name,level:1})).toBeVisible();
    await expect(page.locator('.player-metric')).toHaveCount(6);
    await expect(page.getByRole('group',{name:'Chart metric'}).getByRole('button')).toHaveCount(4);
    await expect(page.locator('.player-chart')).toHaveAttribute('role','img');
    await expect(page.locator('.player-profile-meta')).toContainText('/');
    for(const metric of ['Price','Minutes','PPM','Score']){
      await page.getByRole('button',{name:metric,exact:true}).click();
      await expect(page.getByRole('button',{name:metric,exact:true})).toHaveAttribute('aria-pressed','true');
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow,`${width}px profile overflow`).toBeLessThanOrEqual(1);
    await expect(page.locator('.player-profile-top')).toBeVisible();const header=await page.locator('.player-profile-top').boundingBox();expect(header).not.toBeNull();expect(header.x).toBeGreaterThanOrEqual(0);expect(header.x+header.width).toBeLessThanOrEqual(width);
    if(width<=768){
      await expect(page.locator('.player-recent')).toBeVisible();await expect(page.locator('.player-game-history-mobile')).toBeVisible();await expect(page.locator('.player-game-history-table-wrap')).toBeHidden();
      await expect(page.locator('#bottom-tabbar')).toBeVisible();await expect(page.getByRole('button',{name:'Back to players'})).toBeVisible();
      expect(await page.locator('.topbar-brand').evaluate(node=>getComputedStyle(node,'::after').content)).toContain('PLAYER STATS');
      await page.locator('.player-chart .point').last().click();await expect(page.locator('.player-round-screen')).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.locator('.player-profile')).toBeVisible();
    }else{
      await expect(page.locator('.player-game-history-table-wrap')).toBeVisible();await expect(page.locator('.player-side-stack')).toBeVisible();
    }
    expect(errors).toEqual([]);await context.close();
  }
});

test('themes, byes, long names and unavailable match details remain honest',async({browser})=>{
  const {context,page,errors}=await openAccount(browser,390,'states');
  const state=await page.evaluate(()=>{
    const p=[...PLAYERS].sort((a,b)=>b.name.length-a.name.length).find(item=>OFFS[item.id]&&OFFS[item.id].some(score=>score!=null));
    const rows=playerRoundRows(p.id),played=rows.find(row=>row.played),bye=rows.find(row=>row.bye);
    setPage('players');showPlayer(p.id);return {id:p.id,name:p.name,round:played.r,bye:bye&&bye.r};
  });
  await expect(page.getByRole('heading',{name:state.name,level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if(state.bye)await expect(page.getByRole('button',{name:new RegExp(`Round ${state.bye}, bye`)})).toBeDisabled();
  for(const theme of ['lime','blue','gold','teal','light']){
    await page.evaluate(id=>applyTheme(id,false),theme);
    await expect(page.locator('.player-profile-top')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${theme} overflow`).toBeLessThanOrEqual(1);
  }
  await page.evaluate(({id,round})=>{if(RST[id])delete RST[id][round];S.ui.playerRound=round;S.ui.playerOpenGroups={};renderPlayers()},{id:state.id,round:state.round});
  await expect(page.getByText(/Detailed components are not available from the official feed/i)).toBeVisible();
  await expect(page.getByText(/No averages have been substituted/i)).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.player-profile')).toBeVisible();
  expect(errors).toEqual([]);await context.close();
});

test('expanded details are readable and multi-season positions remain distinct',async({browser})=>{
  for(const width of [1024,1440]){
    const {context,page,errors}=await openAccount(browser,width,`readability-${width}`);
    await routeMultiSeasonHistory(page);
    const pid=await page.evaluate(()=>{const pid=PLAYERS.find(item=>playerRoundRows(item.id).some(row=>row.played)).id;setPage('players');showPlayer(pid);return pid});
    await expect(page.locator('.player-profile')).toBeVisible();await expect(page.getByText('Loading all available seasons and detailed match statistics…')).toBeHidden();
    await page.locator('#player-history-season').selectOption('2025');await page.getByRole('button',{name:'Expand 2025 Round 27',exact:true}).click();
    const summary=page.locator('.player-history-summary');for(const value of ['3','57.3','172','74','70.0','Halfback / Fullback / Centre'])await expect(summary).toContainText(value);
    const detail=page.locator('.player-game-detail'),label=detail.locator('.player-stat-item span').first(),value=detail.locator('.player-stat-item b').first(),heading=detail.locator('.player-stat-group h3').first();
    await expect(detail).toBeVisible();await expect(label).toBeVisible();expect(parseFloat(await label.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);expect(parseFloat(await value.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);expect(parseFloat(await heading.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    expect(parseFloat(await label.evaluate(node=>getComputedStyle(node).lineHeight))).toBeGreaterThanOrEqual(21.75);
    const positions=await page.locator('.player-game-history-table tr[data-season="2025"][data-position]').evaluateAll(nodes=>nodes.map(node=>node.dataset.position));
    expect(positions).toEqual(expect.arrayContaining(['Halfback','Fullback','Centre']));expect(new Set(positions).size).toBeGreaterThan(1);
    const groupRows=await detail.locator('.player-stat-group').evaluateAll(nodes=>new Set(nodes.map(node=>Math.round(node.getBoundingClientRect().top))).size);
    expect(groupRows).toBeGreaterThanOrEqual(2);
    if(width===1440)for(const theme of ['lime','blue','gold','teal','light']){
      await page.evaluate(id=>applyTheme(id,false),theme);
      const contrast=await label.evaluate(node=>{const parse=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number),fg=parse(getComputedStyle(node).color),bg=parse(getComputedStyle(node.closest('.player-stat-group')).backgroundColor),alpha=+getComputedStyle(node).opacity||1,mix=fg.map((value,index)=>value*alpha+bg[index]*(1-alpha)),lum=rgb=>{const values=rgb.map(value=>{const s=value/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4)});return .2126*values[0]+.7152*values[1]+.0722*values[2]},a=lum(mix),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
      expect(contrast,`${theme} expanded-label contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole('button',{name:'Collapse 2025 Round 27',exact:true}).click();await expect(page.locator('#player-history-season')).toHaveValue('2025');
    if(width===1024){await page.getByRole('button',{name:'Back to players'}).click();await page.evaluate(id=>showPlayer(id),pid);await expect(page.locator('#player-history-season')).toHaveValue('2025')}
    expect(errors).toEqual([]);await context.close();
  }
});

test('mobile history preserves season through round navigation and exposes equivalent fields',async({browser})=>{
  const {context,page,errors}=await openAccount(browser,375,'mobile-history');
  await routeMultiSeasonHistory(page);
  await page.evaluate(()=>{const pid=PLAYERS.find(item=>playerRoundRows(item.id).some(row=>row.played)).id;setPage('players');showPlayer(pid)});
  await expect(page.getByRole('heading',{name:'Game history'})).toBeVisible();await expect(page.locator('#player-history-season option')).toHaveCount(2);
  await page.locator('#player-history-season').selectOption('2025');await expect(page.locator('.player-history-round-card')).toHaveCount(8);
  for(const status of ['Injured','Suspended','Rested','Not selected','Bye'])await expect(page.locator('.player-game-history-mobile').getByText(status,{exact:true})).toBeVisible();
  await page.locator('.player-history-round-card[data-round="27"]>button').click();await expect(page.locator('.player-round-screen')).toBeVisible();await expect(page.getByRole('heading',{name:'2025 · Round 27'})).toBeVisible();
  await page.getByRole('button',{name:'Back to player overview'}).click();await expect(page.locator('#player-history-season')).toHaveValue('2025');
  await page.locator('.player-history-round-card[data-round="20"]>button').click();await expect(page.getByText(/No averages have been substituted/i)).toBeVisible();await page.getByRole('button',{name:'Back to player overview'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);await context.close();
});

for(const width of [375,1440])test(`approved Player Stats visual at ${width}px`,async({browser})=>{
  const {context,page,errors}=await openAccount(browser,width,`visual-${width}`);
  await page.route('**/api/player-stats/*',route=>route.fulfill({json:{stats:[]}}));
  await page.evaluate(async()=>{const p=PLAYERS.find(item=>item.name==='Jayden Campbell')||PLAYERS[0];setPage('players');await showPlayer(p.id)});
  await expect(page.locator('.player-profile')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Game history'})).toBeVisible();
  await expect(page.getByText('Loading all available seasons and detailed match statistics…')).toBeHidden();
  // Playwright's Chromium is fixed, but Linux font rasterization still differs
  // by host image. Keep strict, readable baselines for both supported runners.
  const runner=process.env.CI?'ci':'local';
  await expect(page).toHaveScreenshot(`player-stats-approved-${width}-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});

test('approved mobile multi-season Game history visual at 375px',async({browser})=>{
  const {context,page,errors}=await openAccount(browser,375,'history-visual');await routeMultiSeasonHistory(page);
  await page.evaluate(()=>{const pid=PLAYERS.find(item=>playerRoundRows(item.id).some(row=>row.played)).id;setPage('players');showPlayer(pid)});
  await expect(page.getByText('Loading all available seasons and detailed match statistics…')).toBeHidden();await page.locator('#player-history-season').selectOption('2025');
  await page.addStyleTag({content:'.skip-link,#bottom-tabbar{display:none!important}'});await page.evaluate(()=>document.activeElement&&document.activeElement.blur());
  await page.evaluate(()=>document.querySelector('.player-history-card').scrollIntoView({block:'start',behavior:'instant'}));const runner=process.env.CI?'ci':'local';
  await expect(page).toHaveScreenshot(`player-game-history-approved-375-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});
