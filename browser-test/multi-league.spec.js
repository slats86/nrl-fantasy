'use strict';
const {test,expect}=require('@playwright/test');

function league(id,format,name,code){
  const line={starters:{1:[null],2:[null,null,null],3:[null,null],4:[null,null],5:[null,null],6:[null,null,null]},bench:[null,null,null,null],res:[null,null,null,null],c:null,vc:null};
  const customState={name,settings:null,corrections:{},cap:13000000,tradesPerRound:2,seasonTrades:30,captainMult:2,benchScores:true,team:{name:`${name} Team`,squad:[],line,history:{},bank:13000000,tradesRound:0,tradesSeason:0,chips:{active:{},used:{},injured:[]}}};
  const draftState={phase:'lobby',league:{name,code,size:8,participants:[{name:'Browser Owner',isMe:true,isAI:false}],isOwner:true,allowAI:true},size:8,me:0,teams:null,pickNo:0,done:false,log:[],history:{}};
  return {id,code,format,name,role:'owner',memberCount:1,maxMembers:8,status:'active',teamId:`T-${id}`,teamName:`${name} Team`,teamVersion:0,draftVersion:0,created:Date.now(),updated:Date.now(),rules:{},draftState:format==='draft'?draftState:null,draftPicks:[],team:{id:`T-${id}`,name:`${name} Team`,version:0,state:format==='custom'?customState:{}},members:[],fixtures:[],scores:[]};
}
async function openDevice(browser,width,backend){
  const context=await browser.newContext({baseURL:'http://127.0.0.1:32188',viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('**/api/soo/me',route=>route.fulfill({json:{userId:'browser-owner',name:'Browser Owner',email:'browser-owner@example.test'}}));
  await page.route('**/api/app-state',route=>route.fulfill({json:route.request().method()==='GET'?{version:0,state:null}:{ok:true,version:1}}));
  await page.route('**/api/fantasy-leagues**',async route=>{
    const request=route.request(),url=new URL(request.url()),parts=url.pathname.split('/').filter(Boolean),method=request.method(),id=parts[2],item=id&&backend[id];
    if(url.pathname==='/api/fantasy-leagues'&&method==='GET')return route.fulfill({json:{leagues:Object.values(backend).map(({team,draftState,draftPicks,members,fixtures,scores,...summary})=>summary),limit:20}});
    if(item&&parts.length===3&&method==='GET')return route.fulfill({json:{league:item}});
    if(item&&parts[3]==='team'&&method==='PUT'){
      const body=request.postDataJSON();if(body.baseVersion!==item.teamVersion)return route.fulfill({status:409,json:{error:'Team changed on another device',version:item.teamVersion,team:item.team}});
      item.team.state=body.state;item.teamVersion++;item.team.version=item.teamVersion;return route.fulfill({json:{ok:true,version:item.teamVersion,updatedAt:Date.now()}});
    }
    if(item&&parts[3]==='draft'&&parts.length===4&&method==='PUT'){const body=request.postDataJSON();if(body.baseVersion!==item.draftVersion)return route.fulfill({status:409,json:{error:'Draft changed on another device',version:item.draftVersion,draftState:item.draftState}});item.draftState=body.state;item.draftVersion++;return route.fulfill({json:{ok:true,version:item.draftVersion}})}
    return route.fulfill({status:404,json:{error:'Not mocked'}});
  });
  await page.goto('/');await page.waitForFunction(()=>Array.isArray(S.customLeagues)&&S.customLeagues.length===2&&Array.isArray(S.draftLeagues)&&S.draftLeagues.length===2);await page.evaluate(()=>{S.settings.onboardingVersion=1;S.settings.themeChosen=true;closeModal();setPage('leagues')});
  return {context,page,errors};
}

test('Custom and Draft league switchers isolate state across desktop, mobile and stale devices',async({browser})=>{
  const backend={CUSTA:league('CUSTA','custom','Custom Alpha','ALPHA234'),CUSTB:league('CUSTB','custom','Custom Beta','BETA2345'),DRAFTA:league('DRAFTA','draft','Draft Alpha','DRAFT234'),DRAFTB:league('DRAFTB','draft','Draft Beta','DRAFT235')};
  const desktop=await openDevice(browser,1440,backend),page=desktop.page;
  await page.locator('.format-tabs div').filter({hasText:'Custom'}).click();await expect(page.locator('.league-directory-card')).toHaveCount(2);await expect(page.getByText('Custom Alpha',{exact:true})).toBeVisible();await expect(page.getByText('Custom Beta',{exact:true})).toBeVisible();
  await page.getByText('Custom Beta',{exact:true}).click();await expect(page.locator('#custom-league-switch')).toHaveValue('CUSTB');
  await page.evaluate(()=>{S.customLeague.team.squad=[17];save()});await page.evaluate(()=>saveActiveFantasyLeague('custom',true));
  await page.locator('#custom-league-switch').selectOption('CUSTA');await expect.poll(()=>page.evaluate(()=>S.activeCustomLeagueId)).toBe('CUSTA');expect(await page.evaluate(()=>S.customLeague.team.squad)).toEqual([]);
  await page.locator('#custom-league-switch').selectOption('CUSTB');await expect.poll(()=>page.evaluate(()=>S.activeCustomLeagueId)).toBe('CUSTB');expect(await page.evaluate(()=>S.customLeague.team.squad)).toEqual([17]);
  await page.reload();await page.waitForFunction(()=>S.customLeagues&&S.customLeagues.length===2);await page.evaluate(()=>{closeModal();setPage('leagues')});await page.locator('.format-tabs div').filter({hasText:'Draft'}).click();await expect(page.locator('.league-directory-card')).toHaveCount(2);

  const mobile=await openDevice(browser,375,backend);await mobile.page.locator('.format-tabs div').filter({hasText:'Custom'}).click();await expect(mobile.page.locator('.league-directory-card')).toHaveCount(2);await mobile.page.getByText('Custom Beta',{exact:true}).click();expect(await mobile.page.evaluate(()=>S.customLeague.team.squad)).toEqual([17]);expect(await mobile.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.evaluate(()=>{bindActiveLeague('custom','CUSTA');S.customLeague.team.squad=[41]});await mobile.page.evaluate(()=>{bindActiveLeague('custom','CUSTB');S.customLeague.team.squad=[42]});
  await Promise.all([page.evaluate(()=>saveActiveFantasyLeague('custom',true)),mobile.page.evaluate(()=>saveActiveFantasyLeague('custom',true))]);expect(backend.CUSTA.team.state.team.squad).toEqual([41]);expect(backend.CUSTB.team.state.team.squad).toEqual([42]);
  await Promise.all([page.waitForTimeout(800),mobile.page.waitForTimeout(800)]);

  const current=await openDevice(browser,1024,backend),stale=await openDevice(browser,1024,backend);await stale.page.evaluate(()=>{bindActiveLeague('custom','CUSTB');S.customLeague.team.squad=[29]});
  await current.page.evaluate(()=>{bindActiveLeague('custom','CUSTB');S.customLeague.team.squad=[31]});await current.page.evaluate(()=>saveActiveFantasyLeague('custom',true));
  await stale.page.evaluate(()=>saveActiveFantasyLeague('custom',true).catch(()=>{}));await expect(stale.page.getByRole('heading',{name:'Newer league changes found'})).toBeVisible();

  expect(desktop.errors).toEqual([]);expect(mobile.errors).toEqual([]);expect(current.errors).toEqual([]);expect(stale.errors.filter(message=>!/409 \(Conflict\)/.test(message))).toEqual([]);expect(stale.errors.filter(message=>/409 \(Conflict\)/.test(message))).toHaveLength(1);
  await desktop.context.close();await mobile.context.close();await current.context.close();await stale.context.close();
});

test('league cards and active switcher remain overflow-free at every supported width',async({browser})=>{
  const backend={CUSTA:league('CUSTA','custom','A Very Long Custom League Name','ALPHA234'),CUSTB:league('CUSTB','custom','Second Independent Competition','BETA2345'),DRAFTA:league('DRAFTA','draft','Draft Alpha','DRAFT234'),DRAFTB:league('DRAFTB','draft','Draft Beta','DRAFT235')};
  for(const width of [320,375,390,768,1024,1440,1920]){const device=await openDevice(browser,width,backend);await device.page.locator('.format-tabs div').filter({hasText:'Custom'}).click();await device.page.getByText('A Very Long Custom League Name',{exact:true}).click();await expect(device.page.locator('#custom-league-switch')).toBeVisible();expect(await device.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${width}px overflow`).toBeLessThanOrEqual(1);expect(device.errors).toEqual([]);await device.context.close()}
});
