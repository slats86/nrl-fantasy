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
  expect((await page.request.post(`/api/soo/league/${code}/picks`, {data:{teamId,teamName:'Owners Updated',picks:{1:{FB:456}}}})).status()).toBe(200);
  await page.reload();
  await page.evaluate(() => window.setPage('origin'));
  await page.locator('.soo-tab').filter({hasText:'League'}).click();
  await expect(page.getByText('Origin League', {exact:true}).first()).toBeVisible();
  await page.evaluate(() => window.setPage('home'));
  await expect(page.locator('#pg-home')).toHaveClass(/on/);

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
  await page.goto('/');
  await page.locator('#soo-login-email').fill('owner@example.com');
  await page.locator('#soo-login-pass').fill('owner-password-123');
  await page.locator('#soo-login-submit').click();
  await expect(page.locator('#pg-home')).toHaveClass(/on/);
  await member.close(); await owner.close();
});

for (const width of widths) test(`responsive app shell at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  const login = await page.request.post('/api/soo/login', {data:{email:'owner@example.com',password:'owner-password-123'}});
  expect(login.status()).toBe(200);
  await page.goto('/'); await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('Choose your look')).toBeVisible();
  await page.getByRole('button', {name:'Modern Lime'}).click();
  await page.getByRole('button', {name:'Skip tour'}).click();
  await expect(page).toHaveTitle('The Squad — NRL Fantasy');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.evaluate(() => window.setPage('home'));
  await expect(page.locator('[data-testid="dashboard-hero"]')).toBeVisible();
  await expect(page.getByRole('button', {name:/Manage team/i})).toBeVisible();
  await page.evaluate(() => window.setPage('classic'));
  await expect(page.locator('.team-builder')).toBeVisible();
  await expect(page.locator('#pool-card')).toBeVisible();
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
    await page.locator('#bottom-tabbar .btab').filter({hasText:'More'}).click();
    await expect(page.getByRole('button', {name:'State of Origin'})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});
