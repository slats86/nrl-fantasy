'use strict';
const {chromium} = require('@playwright/test');

const baseURL=String(process.argv.find(arg=>arg.startsWith('--base-url='))||'--base-url=http://127.0.0.1:32290').split('=').slice(1).join('=').replace(/\/$/,'');
const targets=[
  {name:'Valentine Holmes',officialId:500845,slug:'valentine-holmes',requiredRound:18},
  {name:'Liam Henry',officialId:100007929,slug:'liam-henry',requiredRound:18},
  {name:'Jayden Campbell',officialId:100001622,slug:'jayden-campbell',requiredRound:15}
];
const password='disposable-player-ui-password';
const email=`player-ui-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
const componentKeys=['tackles','metres_gained','tries','goals'];

function assert(condition,message){if(!condition)throw new Error(message);}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{
    const registration=await page.request.post('/api/soo/register',{data:{name:'Disposable Player UI Audit',email,password}});
    assert(registration.status()===201,'disposable account registration failed: '+registration.status());
    await page.goto('/');
    await page.evaluate(()=>{S.settings.themeChosen=true;S.settings.onboardingVersion=1;save();closeModal();});

    const verified=[];
    for(const viewport of [{width:1440,height:1000,label:'desktop'},{width:390,height:844,label:'mobile'}]){
      await page.setViewportSize(viewport);
      for(const target of targets){
        const response=await page.request.get(`/api/player-stats/${target.officialId}?slug=${target.slug}`,{headers:{'cache-control':'no-cache'}});
        assert(response.ok(),`${target.name} endpoint returned ${response.status()}`);
        const payload=await response.json();
        const resolvedId=response.headers()['x-footystatistics-player-id'];
        const stat=(payload.stats||[]).find(row=>Number(row.year)===2026&&Number(row.round_id)===target.requiredRound);
        assert(stat,`${target.name} is missing Round ${target.requiredRound}`);
        assert(componentKeys.some(key=>stat[key]!==null&&stat[key]!==undefined),`${target.name} Round ${target.requiredRound} has no detailed components`);
        assert(resolvedId&&resolvedId!==String(target.officialId),`${target.name} did not resolve to an internal FootyStatistics ID`);

        const player=await page.evaluate(({name,round})=>{
          const p=PLAYERS.find(item=>item.name===name);if(!p)return null;
          const fixture=RFIX[round];if(!fixture)return null;
          S.ui.mcRound=round;S.ui.mcMatch=Math.max(0,fixture.games.findIndex(game=>game[0]===p.sq||game[1]===p.sq));setPage('match');
          return {id:p.id};
        },{name:target.name,round:target.requiredRound});
        assert(player,`${target.name} is unavailable in the application dataset`);
        const matchRow=page.locator('#pg-match tr').filter({hasText:target.name}).first();
        await matchRow.waitFor({state:'visible'});await matchRow.click();
        await page.locator('#modal tbody tr').filter({hasText:/Tackle|Run Metres|Try|Goal/}).first().waitFor({state:'visible'});
        const matchText=await page.locator('#modal').innerText();
        assert(!/Detailed stats are not available/i.test(matchText),`${target.name} Match Centre omitted components`);
        await page.keyboard.press('Escape');

        await page.evaluate(()=>setPage('players'));
        await page.locator('#player-stats-search').fill(target.name);
        const profile=page.locator('#pg-players .pl-main-table tbody tr').filter({hasText:target.name}).first();
        await profile.waitFor({state:'visible'});await profile.click();
        await page.getByText('2026 game log').waitFor({state:'visible'});
        const gameRow=page.locator('#modal .gamelog tbody tr').filter({has:page.locator('td:first-child b',{hasText:String(target.requiredRound)})}).first();
        await gameRow.waitFor({state:'visible'});
        const gameText=await gameRow.innerText();
        assert(/\d/.test(gameText),`${target.name} profile Round ${target.requiredRound} is empty`);
        await page.keyboard.press('Escape');
        verified.push(`${target.name} ${viewport.label}`);
      }
    }
    assert(errors.length===0,'unexpected browser errors: '+errors.join(' | '));
    process.stdout.write(`Player UI smoke passed: ${verified.join(', ')}.\n`);
  } finally {
    try{await page.request.delete('/api/soo/account',{data:{password}});}catch{}
    await context.close();await browser.close();
  }
})().catch(error=>{process.stderr.write('Player UI smoke failed: '+error.message+'\n');process.exit(1);});
