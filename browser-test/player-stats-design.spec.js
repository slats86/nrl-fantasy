'use strict';
const {test,expect}=require('@playwright/test');

const baseURL='http://127.0.0.1:32188';
let authState;
test.beforeAll(async({request})=>{
  const response=await request.post('/api/soo/register',{data:{name:'Player Design',email:'player-design@example.com',password:'player-design-password'}});
  expect(response.status()).toBe(201);authState=await request.storageState();
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

for(const width of [375,1440])test(`approved Player Stats visual at ${width}px`,async({browser})=>{
  const {context,page,errors}=await openAccount(browser,width,`visual-${width}`);
  await page.evaluate(()=>{const p=PLAYERS.find(item=>item.name==='Jayden Campbell')||PLAYERS[0];setPage('players');showPlayer(p.id)});
  await expect(page.locator('.player-profile')).toBeVisible();
  // Host system-ui fallbacks rasterize differently between developer and CI
  // images. Keep the visual assertion strict by pinning only this capture.
  await page.addStyleTag({content:'*,*::before,*::after{font-family:Arial,sans-serif!important}'});
  await expect(page).toHaveScreenshot(`player-stats-approved-${width}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});
