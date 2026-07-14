'use strict';
const {test,expect}=require('@playwright/test');
const baseURL='http://127.0.0.1:32188';
async function open(browser,width=1440){const context=await browser.newContext({baseURL,viewport:{width,height:900}}),page=await context.newPage(),errors=[];await page.route('**/api/soo/me',route=>route.fulfill({json:{userId:'team-news-ui',name:'Team News Tester',email:'team-news-ui@example.test'}}));await page.route('**/api/app-state',route=>route.fulfill({json:route.request().method()==='GET'?{version:0,state:null}:{version:1}}));page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto('/');if(await page.getByText('Choose your look').isVisible().catch(()=>false)){await page.getByRole('button',{name:'Electric Blue'}).click();await page.getByRole('button',{name:'Skip tour'}).click()}await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;closeModal();setPage('teamnews')});await expect(page.getByRole('heading',{name:'Team News',level:1})).toBeVisible();await expect(page.getByText(/checked/i).first()).toBeVisible();return {context,page,errors}}

test('desktop Team News hub exposes verified directory, filters, lists and player integration',async({browser})=>{
  const {context,page,errors}=await open(browser,1440);await expect(page.locator('#sidebar-nav [data-pg="teamnews"]')).toBeVisible();await expect(page.locator('.team-news-metric')).toHaveCount(4);
  await page.getByRole('tab',{name:'Injuries'}).click();await expect(page.locator('.team-news-table tbody tr').first()).toBeVisible();await expect(page.getByRole('link',{name:/NRL.com/}).first()).toHaveAttribute('rel',/noopener/);
  const search=page.getByLabel('Search injuries');await search.fill("J'maine");await expect(search).toBeFocused();await expect(page.locator('.team-news-table tbody tr')).toHaveCount(1);await search.fill('');
  await page.getByLabel('Filter injuries by club').selectOption({label:'Broncos'});expect(await page.locator('.team-news-table tbody tr').count()).toBeGreaterThan(1);
  await page.getByRole('tab',{name:'Team Lists'}).click();await expect(page.getByLabel('Select team-list round')).toBeVisible();await expect(page.locator('.team-list-club')).toHaveCount(2);await expect(page.getByRole('tab',{name:/Final team/}).first()).toHaveAttribute('aria-selected','true');
  const player=page.locator('.team-list-player-row button').first();const name=await player.textContent();await player.click();await expect(page.getByRole('heading',{name:name.trim(),level:1})).toBeVisible();expect(errors).toEqual([]);await context.close();
});

test('mobile hub uses cards, scrollable controls and has no page overflow',async({browser})=>{
  for(const width of [320,375,390,768]){const {context,page,errors}=await open(browser,width);await expect(page.locator('#bottom-tabbar [data-pg="teamnews"]')).toBeVisible();await page.getByRole('tab',{name:'Injuries'}).click();await expect(page.locator('.team-news-cards .team-news-card').first()).toBeVisible();await expect(page.locator('.team-news-table-wrap')).toBeHidden();const card=page.locator('.team-news-card').first();await card.locator('summary').click();await expect(card).toHaveAttribute('open','');expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${width}px overflow`).toBeLessThanOrEqual(1);expect(errors).toEqual([]);await context.close()}
});

test('personalisation, dashboard count and all colour themes remain functional',async({browser})=>{
  const {context,page,errors}=await open(browser,1024);await page.getByRole('tab',{name:'Injuries'}).click();const first=page.locator('.team-news-table tbody tr').first();await first.locator('.team-news-player').click();const pid=await page.evaluate(()=>S.ui.playerProfilePid);await page.evaluate(()=>closePlayerProfile());await page.evaluate(()=>setPage('teamnews'));await page.getByRole('tab',{name:'Injuries'}).click();await page.evaluate(id=>{S.watchlist=[id];S.teamNewsPrefs.lastVisitedAt='2026-01-01T00:00:00Z';renderTeamNews()},pid);await page.getByRole('tab',{name:'Overview'}).click();await expect(page.getByText('Relevant to me')).toBeVisible();await page.evaluate(()=>setPage('home'));await expect(page.locator('.dashboard-team-news')).toBeVisible();await expect(page.getByRole('button',{name:'View all team news'})).toBeVisible();
  for(const theme of ['lime','blue','gold','coral','light']){await page.evaluate(value=>applyTheme(value,false),theme);await page.evaluate(()=>setPage('teamnews'));await expect(page.locator('.team-news-hero')).toBeVisible()}
  expect(errors).toEqual([]);await context.close();
});

test('source outage retains verified facts and announces stale state',async({browser})=>{
  const {context,page,errors}=await open(browser,1440);await page.evaluate(()=>{TEAM_NEWS={...TEAM_NEWS,sourceAvailable:false,freshness:'source-unavailable',failures:[{error:'timeout'}]};renderTeamNews()});await expect(page.getByRole('status').filter({hasText:'Source temporarily unavailable'})).toBeVisible();await expect(page.getByText('Last verified snapshot')).toBeVisible();await page.getByRole('tab',{name:'Injuries'}).click();expect(await page.locator('.team-news-table tbody tr').count()).toBeGreaterThan(50);expect(errors).toEqual([]);await context.close();
});
