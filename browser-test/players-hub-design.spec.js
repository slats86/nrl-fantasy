'use strict';
const {test,expect}=require('@playwright/test');

async function openHub(browser,width){
  const context=await browser.newContext({baseURL:'http://127.0.0.1:32188',viewport:{width,height:900}});
  const page=await context.newPage(),errors=[];
  await page.route('**/api/soo/me',route=>route.fulfill({json:{userId:'players-hub-ui',name:'Players Hub',email:'players-hub-ui@example.test'}}));
  await page.route('**/api/app-state',route=>route.fulfill({json:route.request().method()==='GET'?{version:0,state:null}:{version:1}}));
  await page.route('**/api/fantasy-leagues**',route=>route.fulfill({json:{leagues:[],limit:20}}));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto('/');
  const appearance=page.getByText('Choose your look');
  if(await appearance.isVisible().catch(()=>false)){await page.getByRole('button',{name:'Electric Blue'}).click();await page.getByRole('button',{name:'Skip tour'}).click()}
  await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;closeModal();S.ui.playerProfilePid=null;S.ui.plSearch='';S.ui.plFilters={};S.ui.plView='all';S.ui.plCompare=[];applyTheme('blue',false);setPage('players')});
  await page.waitForFunction(()=>TEAM_NEWS!==null);await page.evaluate(()=>renderPlayers());
  await expect(page.getByRole('heading',{name:'Players',level:1})).toBeVisible();
  return {context,page,errors};
}

test('Players Hub is purpose-built and overflow-free at every supported width',async({browser})=>{
  for(const width of [320,375,390,768,1024,1440,1920]){
    const {context,page,errors}=await openHub(browser,width);
    await expect(page.getByText('Search, filter and compare every player')).toBeAttached();
    await expect(page.getByRole('tab',{name:'All Players'})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.players-hub-search input')).toBeVisible();
    if(width<=768){await expect(page.locator('.players-mobile-card').first()).toBeVisible();await expect(page.locator('.players-table')).toBeHidden();await expect(page.getByRole('button',{name:/Filters/})).toBeVisible()}
    else{await expect(page.locator('.players-table')).toBeVisible();await expect(page.locator('.players-hub-summary')).toBeVisible()}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${width}px overflow`).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);await context.close();
  }
});

test('search focus, combined filters, reset, sorting, watch and profile back state work',async({browser})=>{
  const {context,page,errors}=await openHub(browser,1440);
  const search=page.locator('#player-stats-search');await search.fill('jayden');
  await expect(search).toBeFocused();await expect(search).toHaveValue('jayden');
  await expect(page.locator('.players-table tbody tr')).toHaveCount(4);
  await page.getByLabel('Filter by position').selectOption('4');await page.getByLabel('Filter by club').selectOption('15');
  await expect(page.locator('.players-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Sort players').selectOption('name');expect(await page.evaluate(()=>S.ui.plSort)).toBe('name');
  const row=page.locator('.players-table tbody tr').first(),name=(await row.locator('.players-identity-copy b').textContent()).trim();
  await row.getByRole('button',{name:new RegExp(`Add ${name} to watchlist`)}).click();
  await expect(row.getByRole('button',{name:new RegExp(`Remove ${name} from watchlist`)})).toHaveAttribute('aria-pressed','true');
  await row.locator('.players-identity').click();await expect(page.getByRole('heading',{name,level:1})).toBeVisible();
  await page.getByRole('button',{name:'Back to players'}).click();await expect(search).toHaveValue('jayden');
  await page.getByRole('button',{name:/Clear 2 filters/}).click();expect(await page.evaluate(()=>Object.values(S.ui.plFilters).filter(Boolean).length)).toBe(0);
  await search.fill("fa asu");await expect(search).toBeFocused();await expect(page.locator('.players-table .players-identity-copy b').filter({hasText:"Tino Fa'asuamaleaui"})).toBeVisible();
  await search.fill('');await page.getByLabel('Filter by form').selectOption('steady');expect(await page.locator('.players-table tbody tr').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);await context.close();
});

test('mobile filter chips and three-player comparison are accessible and bounded',async({browser})=>{
  const {context,page,errors}=await openHub(browser,375);
  await page.getByRole('button',{name:'Filters'}).click();await expect(page.getByRole('dialog',{name:'Filter players'})).toBeVisible();
  await page.locator('#players-sheet-position').selectOption('4');await page.locator('#players-sheet-ownership').selectOption('15plus');
  await expect(page.locator('.players-filter-sheet .players-filter-chip')).toHaveCount(2);
  await page.getByRole('dialog',{name:'Filter players'}).getByRole('button',{name:/Remove Position: HLF filter/}).click();await expect(page.locator('.players-filter-sheet .players-filter-chip')).toHaveCount(1);
  await page.getByRole('button',{name:/Show .* players/}).click();await expect(page.getByRole('dialog',{name:'Filter players'})).toBeHidden();
  await expect(page.getByRole('button',{name:/Remove Ownership: 15%\+ filter/})).toBeVisible();
  await page.getByRole('button',{name:/Filters \(1\)/}).click();await page.getByRole('button',{name:'Reset'}).click();
  await page.keyboard.press('Escape');
  const compare=page.locator('.players-mobile-card .players-row-action[aria-label*="to comparison"]');
  await compare.first().click();await compare.first().click();await compare.first().click();
  await expect(page.locator('.players-compare-card').filter({has:page.locator('button')})).toHaveCount(3);
  await expect(page.getByText('Maximum of three players selected')).toBeVisible();
  await compare.first().click();await expect(page.locator('.players-compare-card').filter({has:page.locator('button')})).toHaveCount(3);
  await expect(page.locator('.players-compare-run')).toBeEnabled();await page.locator('.players-compare-run').click();
  await expect(page.getByRole('heading',{name:'Player Comparison'})).toBeVisible();await expect(page.locator('#modal table thead th')).toHaveCount(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);await context.close();
});

test('Watchlist, Market Movers and injury states use truthful source distinctions',async({browser})=>{
  const {context,page,errors}=await openHub(browser,390);
  await page.evaluate(()=>{S.watchlist=[];renderPlayers()});await page.getByRole('tab',{name:'Watchlist'}).click();await expect(page.getByText('No watchlist results.')).toBeVisible();
  await page.getByRole('tab',{name:'Market Movers'}).click();await expect(page.locator('.players-mobile-card').first()).toBeVisible();await expect(page.locator('.players-mobile-card .players-price-change').first()).toBeVisible();expect(await page.evaluate(()=>S.ui.plSort||playersHubModel().sort)).toBe('change');
  const separation=await page.evaluate(()=>{S.ui.plView='injuries';const model=playersHubModel(),injuries=playersInjuryMap();return {allInjuries:model.list.every(p=>injuries.has(p.id)),hasOtherTypes:(TEAM_NEWS.availability||[]).some(x=>x.type!=='injury'),injuredCount:model.injuredCount,statusCount:playersAvailabilityMap().size}});
  expect(separation.allInjuries).toBe(true);expect(separation.hasOtherTypes).toBe(true);expect(separation.injuredCount).toBeLessThan(separation.statusCount);
  await page.evaluate(()=>{TEAM_NEWS.freshness='source-unavailable';renderPlayers()});await expect(page.getByText(/last verified player status information/i)).toBeVisible();
  await page.evaluate(()=>{TEAM_NEWS=null;_teamNewsPromise=Promise.resolve(null);S.ui.plView='injuries';renderPlayers()});
  await expect(page.getByText('Injury data is temporarily unavailable.')).toBeVisible();await expect(page.getByText(/will not infer or fabricate injuries/i)).toBeVisible();
  expect(errors).toEqual([]);await context.close();
});

test('hub navigation restores query, filters, sort, view and scroll position',async({browser})=>{
  const {context,page,errors}=await openHub(browser,1440);
  await page.getByLabel('Sort players').selectOption('name');await page.getByLabel('Filter by price').selectOption('600plus');
  const target=page.locator('.players-table tbody tr').nth(12);await target.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>window.scrollY);expect(before).toBeGreaterThan(0);
  const name=(await target.locator('.players-identity-copy b').textContent()).trim();await target.locator('.players-identity').click();await expect(page.getByRole('heading',{name,level:1})).toBeVisible();
  await page.getByRole('button',{name:'Back to players'}).click();await expect(page.getByLabel('Sort players')).toHaveValue('name');await expect(page.getByLabel('Filter by price')).toHaveValue('600plus');
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThanOrEqual(before-2);
  expect(errors).toEqual([]);await context.close();
});

test('hub controls remain usable across every colour theme',async({browser})=>{
  const {context,page,errors}=await openHub(browser,390);
  for(const theme of ['blue','gold','coral','light']){await page.evaluate(value=>{applyTheme(value,false);renderPlayers()},theme);await expect(page.locator('.players-mobile-card').first()).toBeVisible();const target=await page.locator('.players-mobile-card').first().evaluate(el=>getComputedStyle(el).color);expect(target).not.toBe('rgba(0, 0, 0, 0)');expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)}
  expect(errors).toEqual([]);await context.close();
});

test('approved mobile filter sheet and comparison tray visuals',async({browser})=>{
  const {context,page,errors}=await openHub(browser,375),runner=process.env.CI?'ci':'local';
  await page.getByRole('button',{name:'Filters'}).click();await page.locator('#players-sheet-position').selectOption('4');await page.locator('#players-sheet-price').selectOption('400to600');
  await expect(page.getByRole('dialog',{name:'Filter players'})).toBeVisible();await expect(page).toHaveScreenshot(`players-hub-filters-approved-375-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  await page.getByRole('button',{name:/Show .* players/}).click();await page.getByRole('button',{name:/Clear 2 filters/}).click();
  const compare=page.locator('.players-mobile-card .players-row-action[aria-label*="to comparison"]');await compare.first().click();await compare.first().click();
  await expect(page.locator('.players-compare-tray')).toBeVisible();await expect(page).toHaveScreenshot(`players-hub-compare-approved-375-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});

for(const width of [375,1440])test(`approved Players Hub visual at ${width}px`,async({browser})=>{
  const {context,page,errors}=await openHub(browser,width);
  await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;closeModal();renderPlayers()});
  await expect(page.locator('#modal-bg')).not.toHaveClass(/on/);
  await expect(page.locator(width<=768?'.players-mobile-card':'.players-table tbody tr').first()).toBeVisible();
  const runner=process.env.CI?'ci':'local';
  await expect(page).toHaveScreenshot(`players-hub-approved-${width}-${runner}.png`,{animations:'disabled',caret:'hide',maxDiffPixelRatio:.012});
  expect(errors).toEqual([]);await context.close();
});
