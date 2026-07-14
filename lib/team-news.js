'use strict';

const CLUB_ALIASES = new Map(Object.entries({
  'brisbane broncos':'Broncos','broncos':'Broncos','canberra raiders':'Raiders','raiders':'Raiders',
  'canterbury-bankstown bulldogs':'Bulldogs','canterbury bulldogs':'Bulldogs','bulldogs':'Bulldogs',
  'north queensland cowboys':'Cowboys','cowboys':'Cowboys','dolphins':'Dolphins',
  'st george illawarra dragons':'Dragons','dragons':'Dragons','parramatta eels':'Eels','eels':'Eels',
  'newcastle knights':'Knights','knights':'Knights','penrith panthers':'Panthers','panthers':'Panthers',
  'south sydney rabbitohs':'Rabbitohs','rabbitohs':'Rabbitohs','sydney roosters':'Roosters','roosters':'Roosters',
  'manly-warringah sea eagles':'Sea Eagles','manly sea eagles':'Sea Eagles','sea eagles':'Sea Eagles',
  'cronulla sharks':'Sharks','sharks':'Sharks','melbourne storm':'Storm','storm':'Storm',
  'gold coast titans':'Titans','titans':'Titans','warriors':'Warriors','wests tigers':'Tigers','tigers':'Tigers'
}));

function decodeHtml(value='') {
  const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',rsquo:"'",lsquo:"'"};
  return String(value).replace(/&#(x?[0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10)))
    .replace(/&([a-z]+);/gi,(all,n)=>named[n.toLowerCase()]??all);
}
function text(value=''){return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalizeName(value=''){return decodeHtml(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeClub(value=''){const n=normalizeName(value);return CLUB_ALIASES.get(n)||String(value).trim()}
function stableId(...parts){let hash=2166136261;for(const char of parts.map(normalizeName).join('|')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(36)}
function iso(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null}
function metadata(html,url,checkedAt){
  const script=(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i)||[])[1];let data={};
  try{data=JSON.parse(script)}catch{}
  return {publisher:'NRL.com',sourceUrl:url,publishedAt:iso(data.datePublished),sourceUpdatedAt:iso(data.dateModified||data.datePublished),checkedAt:iso(checkedAt)||new Date().toISOString(),accuracy:'confirmed'};
}
function playerIndex(players=[]){
  const result=new Map();
  for(const p of players){const name=[p.first_name,p.middle_name,p.last_name].filter(Boolean).join(' ');const key=normalizeName(name);if(!result.has(key))result.set(key,[]);result.get(key).push(p)}
  result.all=players;
  return result;
}
function resolvePlayer(name,club,players=[]){
  const index=players instanceof Map?players:playerIndex(players),candidates=index.get(normalizeName(name))||[];
  const clubIdByName={Broncos:500011,Raiders:500013,Bulldogs:500010,Cowboys:500012,Dolphins:500723,Dragons:500022,Eels:500031,Knights:500003,Panthers:500014,Rabbitohs:500005,Roosters:500001,'Sea Eagles':500002,Sharks:500028,Storm:500021,Titans:500004,Warriors:500032,Tigers:500023};
  const clubId=clubIdByName[normalizeClub(club)],sameClub=candidates.filter(p=>Number(p.squad_id)===clubId);
  const p=sameClub.length===1?sameClub[0]:candidates.length===1?candidates[0]:null;
  if(p)return {playerId:Number(p.id),identity:'matched'};
  if(!candidates.length&&index.all){const parts=normalizeName(name).split(' '),first=parts[0]||'',last=parts.at(-1)||'',aliases=index.all.filter(item=>Number(item.squad_id)===clubId&&normalizeName(item.last_name)===last).filter(item=>{const candidate=normalizeName(item.first_name);return first.length>=3&&(candidate.startsWith(first)||first.startsWith(candidate))});if(aliases.length===1)return {playerId:Number(aliases[0].id),identity:'matched-alias'}}
  return {playerId:null,identity:candidates.length===0?'unresolved':'ambiguous'};
}

function availabilityType(injury){
  const n=normalizeName(injury);
  if(/suspend|ban|judiciar/.test(n))return 'suspension';
  if(/rest|representative|origin duty/.test(n))return 'rest';
  if(/illness|personal|unavailable/.test(n))return 'unavailable';
  if(/not selected|dropped/.test(n))return 'non-selection';
  return 'injury';
}
function parseReturn(value){
  const raw=String(value||'').trim();const range=raw.match(/round\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
  return {returnLabel:raw||'TBC',expectedReturnRound:range?Number(range[1]):null,expectedReturnRoundEnd:range&&range[2]?Number(range[2]):null,returnConfirmed:false};
}
function parseCasualtyWard(html,{url,checkedAt=new Date(),players=[]}={}){
  const meta=metadata(html,url,checkedAt),start=html.search(/<h2[^>]*>\s*Chemist Warehouse Casualty Ward/i);if(start<0)throw new Error('Official Casualty Ward list was not found');
  const body=html.slice(start),heading=/<h3[^>]*>([\s\S]*?)<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi,index=playerIndex(players),items=[];let match;
  while((match=heading.exec(body))){const club=normalizeClub(text(match[1]));if(!CLUB_ALIASES.has(normalizeName(club)))continue;const li=/<li[^>]*>([\s\S]*?)<\/li>/gi;let row;
    while((row=li.exec(match[2]))){const value=text(row[1]);const parsed=value.match(/^(.+?)\s*\((.+?),\s*([^()]*)\)$/);if(!parsed)continue;
      const [,playerName,injury,ret]=parsed,resolved=resolvePlayer(playerName,club,index),returnInfo=parseReturn(ret),type=availabilityType(injury);
      items.push({id:'availability-'+stableId(playerName,club,type),playerId:resolved.playerId,playerName,club,positions:[],type,injury:injury.trim(),status:type==='rest'?'rested':type==='suspension'?'suspended':'out',firstReportedAt:meta.publishedAt,...returnInfo,confidence:'high',replacement:null,identity:resolved.identity,summary:`${playerName} is unavailable for ${club} (${injury.trim()}); return ${returnInfo.returnLabel}.`,...meta});
    }
  }
  if(items.length<10)throw new Error('Official Casualty Ward parser produced too few records');return items;
}

function playerFromProfile(block,club,index){
  const hidden=text((block.match(/<span class="u-visually-hidden">([\s\S]*?)<\/span>/i)||[])[1]);
  const info=hidden.match(/^(.+?) for (.+?) is number (\d+)$/);if(!info)return null;
  const withoutHidden=block.replace(/<span class="u-visually-hidden">[\s\S]*?<\/span>/i,'');const playerName=text(withoutHidden);if(!playerName)return null;
  const resolved=resolvePlayer(playerName,club,index);return {playerId:resolved.playerId,playerName,club,position:info[1],number:Number(info[3]),identity:resolved.identity};
}
function parseTeamLists(html,{url,checkedAt=new Date(),players=[],round}={}){
  const meta=metadata(html,url,checkedAt),detected=Number(round||((html.match(/NRL Team Lists:\s*Round\s*(\d+)/i)||[])[1]));if(!detected)throw new Error('Team-list round was not found');
  const index=playerIndex(players),markers=[...html.matchAll(/<h3 class="u-visually-hidden">Match:\s*([^<]+?)\s+v\s+([^<]+?)<\/h3>/gi)],matches=[];
  for(let i=0;i<markers.length;i++){
    const chunk=html.slice(markers[i].index,markers[i+1]?.index||html.length),home=normalizeClub(markers[i][1]),away=normalizeClub(markers[i][2]),startsAt=iso((chunk.match(/<time[^>]*datetime="([^"]+)"/i)||[])[1]);
    const rosters={[home]:[],[away]:[]};for(const li of chunk.matchAll(/<li class="team-list[^>]*>([\s\S]*?)<\/li>/gi)){
      const profiles=[...li[1].matchAll(/<div class="team-list-profile[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)];
      if(profiles[0]){const p=playerFromProfile(profiles[0][1],home,index);if(p)rosters[home].push(p)}
      if(profiles[1]){const p=playerFromProfile(profiles[1][1],away,index);if(p)rosters[away].push(p)}
    }
    if(rosters[home].length<17||rosters[away].length<17)continue;
    const version=inferVersion(startsAt,meta.checkedAt),label=version==='final'?'Final team':version==='24-hour'?'24-hour squad':'Tuesday squad';
    matches.push({id:'r'+detected+'-'+stableId(home,away),round:detected,home,away,startsAt,source:{...meta},snapshots:[{id:'snapshot-'+stableId(home,away,meta.sourceUpdatedAt||meta.checkedAt),version,label,capturedAt:meta.checkedAt,sourceUpdatedAt:meta.sourceUpdatedAt,teams:rosters}]});
  }
  if(!matches.length)throw new Error('Official Team Lists parser found no complete matches');return matches;
}
function parseJudiciary(html,{url,checkedAt=new Date(),players=[]}={}){
  const meta=metadata(html,url,checkedAt),table=(html.match(/Latest Judiciary Charges[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i)||[])[1];if(!table)throw new Error('Official latest judiciary table was not found');
  const index=playerIndex(players),items=[];for(const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>text(x[1]));if(cells.length<5||/^player$/i.test(cells[0]))continue;
    const who=cells[0].match(/^(.+?)\s*\((.+)\)$/),matches=cells[4].match(/(\d+)\s*match/i);if(!who||!matches)continue;const club=normalizeClub(who[2]),resolved=resolvePlayer(who[1],club,index);
    items.push({id:'judiciary-'+stableId(who[1],cells[1],meta.sourceUpdatedAt),playerId:resolved.playerId,playerName:who[1],club,type:'suspension',status:'suspended',charge:cells[1],record:cells[2],plea:cells[3],matches:Number(matches[1]),expectedReturnRound:null,returnLabel:`After ${matches[1]} match${matches[1]==='1'?'':'es'}`,returnConfirmed:true,confidence:'high',identity:resolved.identity,summary:`${who[1]} is suspended for ${matches[1]} match${matches[1]==='1'?'':'es'} (${cells[1]}).`,...meta});
  }return items;
}
function inferVersion(startsAt,capturedAt){const hours=(new Date(startsAt)-new Date(capturedAt))/36e5;return hours<=2?'final':hours<=30?'24-hour':'tuesday'}
function sameTeams(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function mergeTeamListHistory(previous=[],incoming=[]){
  return incoming.map(next=>{const old=previous.find(x=>x.id===next.id);if(!old)return next;const snapshots=[...(old.snapshots||[])],fresh=next.snapshots[0];fresh.version=inferVersion(next.startsAt,fresh.capturedAt);fresh.label=fresh.version==='final'?'Final team':fresh.version==='24-hour'?'24-hour squad':'Tuesday squad';if(!snapshots.some(x=>sameTeams(x.teams,fresh.teams)&&x.version===fresh.version))snapshots.push(fresh);return {...next,snapshots};});
}
function compareRosters(before=[],after=[]){
  const key=p=>normalizeName(p.playerName),old=new Map(before.map(p=>[key(p),p])),now=new Map(after.map(p=>[key(p),p])),changes=[];
  for(const [id,p] of old)if(!now.has(id))changes.push({kind:'removed',player:p});
  for(const [id,p] of now){if(!old.has(id))changes.push({kind:'added',player:p});else{const was=old.get(id);if(was.number!==p.number||was.position!==p.position)changes.push({kind:p.number<=13&&was.number>13?'promoted':p.number>13&&was.number<=13?'benched':'moved',player:p,from:was})}}
  return changes;
}
function deriveChanges(matches=[]){const updates=[];for(const match of matches){const snaps=match.snapshots||[];for(let i=1;i<snaps.length;i++){for(const club of [match.home,match.away]){const changes=compareRosters(snaps[i-1].teams[club],snaps[i].teams[club]);if(!changes.length)continue;const removed=changes.filter(x=>x.kind==='removed'),added=changes.filter(x=>x.kind==='added');const direct=removed.length===1&&added.length===1&&changes.length===2;
    updates.push({id:'change-'+stableId(match.id,club,snaps[i].id),matchId:match.id,round:match.round,club,capturedAt:snaps[i].capturedAt,version:snaps[i].version,accuracy:direct?'derived':'possible',relationship:direct?{unavailable:removed[0].player,replacement:added[0].player}:null,sequence:changes,summary:direct?`${removed[0].player.playerName} out — ${added[0].player.playerName} added to the squad.`:`${club} made ${changes.length} linked team-list changes.`,source:match.source});
  }}}return updates}
function classifyReplacement(before=[],after=[],explicit){
  const sequence=compareRosters(before,after),removed=sequence.filter(x=>x.kind==='removed'),added=sequence.filter(x=>x.kind==='added');
  if(explicit){const out=removed.find(x=>normalizeName(x.player.playerName)===normalizeName(explicit.unavailable)),incoming=added.find(x=>normalizeName(x.player.playerName)===normalizeName(explicit.replacement));if(out&&incoming)return {accuracy:'confirmed',relationship:{unavailable:out.player,replacement:incoming.player},sequence}}
  if(removed.length===1&&added.length===1&&sequence.length===2)return {accuracy:'derived',relationship:{unavailable:removed[0].player,replacement:added[0].player},sequence};
  return {accuracy:removed.length&&added.length?'possible':'derived',relationship:null,sequence};
}
function reconcileReports(reports=[]){
  const priority={official_nrl:5,official_judiciary:4,official_club:3,publication:1},groups=new Map();for(const report of reports){const id=report.playerId||normalizeName(report.playerName);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(report)}
  return [...groups.values()].map(group=>{const sorted=[...group].sort((a,b)=>(priority[b.sourceTier]||0)-(priority[a.sourceTier]||0)||new Date(b.sourceUpdatedAt)-new Date(a.sourceUpdatedAt)),current=sorted[0];return {...current,history:sorted.slice(1).map(old=>({status:old.status,injury:old.injury,returnLabel:old.returnLabel,sourceUrl:old.sourceUrl,sourceUpdatedAt:old.sourceUpdatedAt}))}});
}
function freshness(checkedAt,available=true,now=Date.now()){if(!available)return 'source-unavailable';const age=now-new Date(checkedAt).getTime();if(age<15*60e3)return 'live';if(age<2*36e5)return 'recent';if(age<24*36e5)return 'today';return 'stale'}
function dedupeAvailability(items=[]){const byId=new Map();for(const item of items){const old=byId.get(item.id);if(!old||new Date(item.sourceUpdatedAt)>new Date(old.sourceUpdatedAt))byId.set(item.id,item)}return [...byId.values()]}

module.exports={decodeHtml,text,normalizeName,normalizeClub,stableId,resolvePlayer,availabilityType,parseReturn,parseCasualtyWard,parseTeamLists,parseJudiciary,mergeTeamListHistory,compareRosters,deriveChanges,classifyReplacement,reconcileReports,freshness,dedupeAvailability,inferVersion};
