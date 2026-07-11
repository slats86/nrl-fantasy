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
  await page.evaluate(() => window.setPage('origin'));
  await page.locator('.soo-tab').filter({hasText:'League'}).click();
  await expect(page.locator('#soo-league-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#soo-create-submit')).toBeEnabled();
  const created = await page.request.post('/api/soo/create', {data:{name:'Origin League',teamName:'Owners',picks:{1:{FB:123}}}});
  expect(created.status()).toBe(200);
  const {code, teamId} = await created.json();
  expect((await page.request.post(`/api/soo/league/${code}/picks`, {data:{teamId,teamName:'Owners Updated',picks:{1:{FB:456}}}})).status()).toBe(200);

  const member = await browser.newContext({baseURL:'http://127.0.0.1:32188'});
  const memberPage = await member.newPage();
  expect((await memberPage.request.post('/api/soo/register', {data:{name:'Member',email:'member@example.com',password:'member-password-123'}})).status()).toBe(201);
  const joined = await memberPage.request.post('/api/soo/join', {data:{code,teamName:'Members',picks:{}}});
  expect(joined.status()).toBe(200);
  const memberTeam = (await joined.json()).teamId;
  expect((await page.request.delete(`/api/soo/league/${code}/team/${memberTeam}`)).status()).toBe(200);
  expect((await page.request.post('/api/soo/scores', {data:{game:1,scores:{456:88}}})).status()).toBe(200);
  expect((await page.request.delete('/api/soo/scores?game=1')).status()).toBe(200);
  expect((await page.request.post('/api/soo/logout')).status()).toBe(200);
  expect((await page.request.get('/api/soo/me')).status()).toBe(401);
  await member.close(); await owner.close();
});

for (const width of widths) test(`responsive app shell at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveTitle('The Squad — NRL Fantasy');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.evaluate(() => window.setPage('leagues'));
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
  expect(errors).toEqual([]);
});
