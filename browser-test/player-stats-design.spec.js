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
    const header=await page.locator('.player-profile-top').boundingBox();expect(header.x).toBeGreaterThanOrEqual(0);expect(header.x+header.width).toBeLessThanOrEqual(width);
    if(width<=768){
      await expect(page.locator('.player-recent')).toBeVisible();await expect(page.locator('.player-log-card')).toBeHidden();
      await expect(page.locator('#bottom-tabbar')).toBeVisible();await expect(page.getByRole('button',{name:'Back to players'})).toBeVisible();
      expect(await page.locator('.topbar-brand').evaluate(node=>getComputedStyle(node,'::after').content)).toContain('PLAYER STATS');
      await page.locator('.player-chart .point').last().click();await expect(page.locator('.player-round-screen')).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.locator('.player-profile')).toBeVisible();
    }else{
      await expect(page.locator('.player-log-card')).toBeVisible();await expect(page.locator('.player-side-stack')).toBeVisible();
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

test('expanded details are readable and historical positions remain distinct',async({browser})=>{
  for(const width of [1024,1440]){
    const {context,page,errors}=await openAccount(browser,width,`readability-${width}`);
    const state=await page.evaluate(()=>{const entry=Object.entries(HIST).find(([id,rows])=>rows.some((row,index)=>rows.some((other,otherIndex)=>otherIndex!==index&&other[0]===row[0]&&other[1]!==row[1]))&&playerRoundRows(+id).some(row=>row.played));const pid=entry?+entry[0]:6;setPage('players');showPlayer(pid);return {pid,history:HIST[pid]}});
    await expect(page.locator('.player-profile')).toBeVisible();await expect(page.getByText('Loading current detailed match statistics…')).toBeHidden();
    await page.evaluate(pid=>{const round=playerRoundRows(pid).find(row=>row.played).r,st=Array(STAT_KEYS.length+1).fill(1);st[STAT_KEYS.indexOf('MG')]=176;st[STAT_KEYS.indexOf('TCK')]=31;st[STAT_KEYS.length]=80;RST[pid]=RST[pid]||{};RST[pid][round]=st;S.ui.playerExpandedRound=round;renderPlayers()},state.pid);
    const detail=page.locator('.player-game-detail'),label=detail.locator('.player-stat-item span').first(),value=detail.locator('.player-stat-item b').first(),heading=detail.locator('.player-stat-group h3').first();
    await expect(detail).toBeVisible();await expect(label).toBeVisible();expect(parseFloat(await label.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);expect(parseFloat(await value.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);expect(parseFloat(await heading.evaluate(node=>getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
    expect(parseFloat(await label.evaluate(node=>getComputedStyle(node).lineHeight))).toBeGreaterThanOrEqual(21.75);
    const rows=await page.locator('.player-history-table tbody tr').evaluateAll(nodes=>nodes.map(node=>[node.dataset.season,node.dataset.position]));
    expect(rows.length).toBe(state.history.length);expect(new Set(rows.map(row=>row.join('|'))).size).toBe(rows.length);
    const groupRows=await detail.locator('.player-stat-group').evaluateAll(nodes=>new Set(nodes.map(node=>Math.round(node.getBoundingClientRect().top))).size);
    expect(groupRows).toBeGreaterThanOrEqual(2);
    if(width===1440)for(const theme of ['lime','blue','gold','teal','light']){
      await page.evaluate(id=>applyTheme(id,false),theme);
      const contrast=await label.evaluate(node=>{const parse=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number),fg=parse(getComputedStyle(node).color),bg=parse(getComputedStyle(node.closest('.player-stat-group')).backgroundColor),alpha=+getComputedStyle(node).opacity||1,mix=fg.map((value,index)=>value*alpha+bg[index]*(1-alpha)),lum=rgb=>{const values=rgb.map(value=>{const s=value/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4)});return .2126*values[0]+.7152*values[1]+.0722*values[2]},a=lum(mix),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
      expect(contrast,`${theme} expanded-label contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await page.reload();await page.evaluate(pid=>{setPage('players');showPlayer(pid)},state.pid);await expect(page.getByRole('heading',{name:'Previous seasons — performance by position'})).toBeVisible();await expect(page.locator('.player-history-table tbody tr')).toHaveCount(state.history.length);
    expect(errors).toEqual([]);await context.close();
  }
});

test('mobile history exposes equivalent fields without overflow',async({browser})=>{
  const {context,page,errors}=await openAccount(browser,375,'mobile-history');
  const state=await page.evaluate(()=>{const pid=+Object.keys(HIST).find(id=>HIST[id].length>2);setPage('players');showPlayer(pid);return {pid,count:HIST[pid].length}});
  await expect(page.getByRole('heading',{name:'Previous seasons — performance by position'})).toBeVisible();
  await expect(page.locator('.player-history-mobile .player-history-position')).toHaveCount(state.count);await expect(page.locator('.player-history-mobile').getByText('Starts',{exact:true}).first()).toBeVisible();await expect(page.locator('.player-history-mobile').getByText('Not available',{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);await context.close();
});

for(const width of [375,1440])test(`approved Player Stats visual at ${width}px`,async({browser})=>{
  const {context,page,errors}=await openAccount(browser,width,`visual-${width}`);
  await page.route('**/api/player-stats/*',route=>route.fulfill({json:{stats:[]}}));
  await page.evaluate(async()=>{const p=PLAYERS.find(item=>item.name==='Jayden Campbell')||PLAYERS[0];setPage('players');await showPlayer(p.id)});
  await expect(page.locator('.player-profile')).toBeVisible();
  await expect(page.getByText('Loading current detailed match statistics…')).toBeHidden();
  // Playwright's Chromium is fixed, but Linux font rasterization still differs
  // by host image. Keep strict, readable baselines for both supported runners.
  const runner=process.env.CI?'ci':'local';
  await expect(page).toHaveScreenshot(`player-stats-approved-${width}-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});
