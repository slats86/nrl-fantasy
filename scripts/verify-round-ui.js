'use strict';

const {chromium} = require('playwright');

const baseURL = (process.argv.find(value=>value.startsWith('http')) || 'http://127.0.0.1:3000').replace(/\/$/, '');
const roundId = Number((process.argv.find(value=>/^--round=/.test(value)) || '--round=19').split('=')[1]);
const expectedScores = ['6 – 32','0 – 66','16 – 40','28 – 12','26 – 24','18 – 19','22 – 18'];

async function verify(browser, viewport) {
  const context = await browser.newContext({viewport, baseURL});
  const page = await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('**/api/soo/me',route=>route.fulfill({json:{userId:'readonly-smoke',name:'Read-only Smoke',email:'smoke@example.invalid',isAdmin:false}}));
  await page.route('**/api/app-state',route=>route.fulfill({json:{state:null,version:0}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof autoRefresh==='function'&&typeof setPage==='function');
  await page.locator('#app-shell').waitFor({state:'visible'});
  await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;closeModal()});
  await page.waitForTimeout(250);await page.evaluate(()=>closeModal());
  await page.waitForFunction(()=>LIVE&&LIVE.fetched>0,{timeout:15000});
  const snapshot=await page.evaluate(round=>{
    S.ui.mcRound=round;S.ui.mcMatch=1;setPage('match');
    return{round:LIVE.round,status:LIVE.status,maxR:MAXR,text:document.querySelector('#pg-match').innerText,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  },roundId);
  if(snapshot.round!==roundId||snapshot.maxR<roundId||snapshot.status!=='final')throw new Error('Round state mismatch: '+JSON.stringify(snapshot));
  for(const score of expectedScores)if(!snapshot.text.includes(score))throw new Error('Missing final score '+score);
  if(snapshot.overflow>1)throw new Error('Horizontal overflow at '+viewport.width+'px');
  const hynes=page.locator('#pg-match tbody tr').filter({hasText:'Hynes'}).first();
  await hynes.click();
  await page.waitForFunction(()=>document.querySelector('#modal').innerText.includes('Tackle'));
  const modal=await page.locator('#modal').innerText();
  for(const value of ['107','Tackle','17','Run Metres','83','Try','Goal'])if(!modal.includes(value))throw new Error('Missing Hynes detail '+value+': '+modal.replace(/\s+/g,' ').trim());
  if(errors.length)throw new Error('Browser errors: '+errors.join(' | '));
  await context.close();
  return{viewport:viewport.width,round:snapshot.round,status:snapshot.status,maxR:snapshot.maxR,hynesDetails:true};
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{console.log(JSON.stringify([await verify(browser,{width:1440,height:900}),await verify(browser,{width:390,height:844})],null,2));}
  finally{await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
