'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {parseCasualtyWard,parseTeamLists,parseJudiciary,mergeTeamListHistory,deriveChanges,freshness,dedupeAvailability,normalizeName,inferVersion}=require('../lib/team-news');
const {publishTeamNews}=require('../lib/home-dashboard');

const ROOT=path.join(__dirname,'..'),OUTPUT=path.join(ROOT,'public','team-news.json');
const BASE='https://www.nrl.com';
const URLS={
  casualty:process.env.NRL_CASUALTY_URL||BASE+'/news/2026/01/01/nrl-casualty-ward-how-your-club-is-shaping-heading-into-2026/',
  judiciary:process.env.NRL_JUDICIARY_URL||BASE+'/news/2026/01/01/nrl-judiciary-report-2026/',
  topic:process.env.NRL_TEAM_LIST_TOPIC_URL||BASE+'/news/topic/team-lists/'
};
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function fetchText(url,attempts=3){let last;for(let attempt=1;attempt<=attempts;attempt++){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{headers:{Accept:'text/html','User-Agent':'NRL-Fantasy-The-Squad-Data-Bot/1.0 (+https://github.com/slats86/nrl-fantasy)'},signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error(`${url} returned HTTP ${response.status}`);const body=await response.text();if(body.length<10000)throw new Error(`${url} returned an incomplete page`);return body}catch(error){last=error;if(attempt<attempts)await sleep(attempt*600)}finally{clearTimeout(timeout)}}throw last}
function absolute(href){return new URL(href,BASE).toString()}
function discoverTeamListLinks(html){
  const found=new Map();for(const match of html.matchAll(/href="([^"]*\/nrl-team-lists-(?:round-|magic-round)[^"]*\/?)"/gi)){const href=match[1],round=Number((href.match(/round-(\d+)/i)||[])[1]);if(round)found.set(round,absolute(href))}
  return [...found].sort((a,b)=>b[0]-a[0]);
}
function discoverLateMailLinks(html){const found=new Map();for(const match of html.matchAll(/href="([^"]*late-mail[^"]*)"/gi)){const href=match[1],round=Number((href.match(/round-(\d+)/i)||[])[1]);if(round)found.set(round,absolute(href))}return [...found].sort((a,b)=>b[0]-a[0])}
function readPrevious(){try{return JSON.parse(fs.readFileSync(OUTPUT,'utf8'))}catch{return null}}
function statusHistory(previous,current){
  const old=new Map((previous?.availability||[]).map(x=>[x.id,x]));return current.map(item=>{const prior=old.get(item.id),history=[...(prior?.history||[])];if(prior&&(prior.injury!==item.injury||prior.returnLabel!==item.returnLabel||prior.status!==item.status))history.push({injury:prior.injury,status:prior.status,returnLabel:prior.returnLabel,sourceUpdatedAt:prior.sourceUpdatedAt,sourceUrl:prior.sourceUrl});return {...item,history}});
}
function lateMailEvents(teamLists,changes){const events=changes.filter(x=>['24-hour','final'].includes(x.version));for(const match of teamLists){for(const snapshot of match.snapshots||[]){if(!['24-hour','final'].includes(snapshot.version))continue;if(events.some(x=>x.matchId===match.id&&x.version===snapshot.version))continue;events.push({id:`publication-${match.id}-${snapshot.version}`,matchId:match.id,round:match.round,club:`${match.home} v ${match.away}`,capturedAt:snapshot.capturedAt,version:snapshot.version,accuracy:'confirmed',relationship:null,sequence:[],summary:`${snapshot.label} published for ${match.home} v ${match.away}.`,source:match.source})}}return events.sort((a,b)=>new Date(b.capturedAt)-new Date(a.capturedAt))}
async function main(){
  if(process.argv.includes('--rebuild-changes')){const data=readPrevious();if(!data)throw new Error('No Team News snapshot exists');for(const match of data.teamLists||[])for(const snapshot of match.snapshots||[]){snapshot.version=inferVersion(match.startsAt,snapshot.capturedAt);snapshot.label=snapshot.version==='final'?'Final team':snapshot.version==='24-hour'?'24-hour squad':'Tuesday squad'}data.changes=deriveChanges(data.teamLists||[]);data.lateMail=lateMailEvents(data.teamLists||[],data.changes);data.summary={...(data.summary||{}),changes:data.changes.length};const tmp=OUTPUT+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');fs.renameSync(tmp,OUTPUT);console.log(JSON.stringify({changes:data.changes.length,lateMail:data.lateMail.length}));return}
  const checkedAt=new Date().toISOString(),players=JSON.parse(fs.readFileSync(path.join(ROOT,'public','players.json'),'utf8')),previous=readPrevious();const failures=[];
  const safe=async(name,url,parse)=>{try{const html=await fetchText(url);return {html,value:parse(html)}}catch(error){failures.push({source:name,url,error:error.message});return {html:null,value:null}}};
  const [casualty,judiciary,topic]=await Promise.all([
    safe('casualty-ward',URLS.casualty,html=>parseCasualtyWard(html,{url:URLS.casualty,checkedAt,players})),
    safe('judiciary',URLS.judiciary,html=>parseJudiciary(html,{url:URLS.judiciary,checkedAt,players})),
    safe('team-list-index',URLS.topic,html=>html)
  ]);
  const links=topic.html?discoverTeamListLinks(topic.html):[],lateLinks=topic.html?discoverLateMailLinks(topic.html):[];
  const targetLinks=links.slice(0,2),listResults=[];
  for(const [round,url] of targetLinks){const result=await safe(`team-lists-round-${round}`,url,html=>parseTeamLists(html,{url,round,checkedAt,players}));if(result.value)listResults.push(...result.value);await sleep(250)}
  for(const [round,url] of lateLinks.slice(0,1)){const result=await safe(`late-mail-round-${round}`,url,html=>parseTeamLists(html,{url,round,checkedAt,players}));if(result.value)listResults.push(...result.value);await sleep(250)}
  const unique=new Map();for(const match of listResults){const old=unique.get(match.id);unique.set(match.id,old?mergeTeamListHistory([old],[match])[0]:match)}
  let teamLists=[...unique.values()];if(previous?.teamLists)teamLists=mergeTeamListHistory(previous.teamLists,teamLists);
  if(!teamLists.length&&previous?.teamLists)teamLists=previous.teamLists;
  let availability=casualty.value||previous?.availability||[];
  const latestRound=Math.max(0,...teamLists.map(x=>x.round)),latestNamed=new Map();
  teamLists.filter(x=>x.round===latestRound).forEach(match=>{const snapshot=match.snapshots?.[match.snapshots.length-1];for(const club of [match.home,match.away])for(const player of snapshot?.teams?.[club]||[])latestNamed.set(normalizeName(player.playerName),{player,snapshot,match})});
  availability=availability.map(item=>{const named=latestNamed.get(normalizeName(item.playerName));if(!named||!item.expectedReturnRound||item.expectedReturnRound>latestRound)return item;const listTime=new Date(named.snapshot.sourceUpdatedAt||named.snapshot.capturedAt),newsTime=new Date(item.sourceUpdatedAt);if(listTime<newsTime)return item;return {...item,status:'named-to-return',returnConfirmed:true,confidence:'high',summary:`${item.playerName} has been named for ${item.club} after ${item.injury}.`}});
  availability=statusHistory(previous,dedupeAvailability(availability));
  let suspensions=(judiciary.value||previous?.suspensions||[]).map(item=>({...item,expectedReturnRound:item.expectedReturnRound||latestRound+item.matches+1,returnLabel:item.expectedReturnRound?item.returnLabel:`Round ${latestRound+item.matches+1}`}));
  const changes=deriveChanges(teamLists);
  const sourceAvailable=failures.length===0,latestClubs=new Set(teamLists.filter(item=>item.round===latestRound).flatMap(item=>[item.home,item.away]).filter(Boolean)),rounds=JSON.parse(fs.readFileSync(path.join(ROOT,'public','rounds.json'),'utf8')),roundRecord=rounds.find(item=>Number(item.id)===latestRound),expectedClubCount=Math.max(1,Number(roundRecord?.matches?.length)*2||latestClubs.size||16),validationErrors=[...failures.map(item=>item.error),...(latestRound&&latestClubs.size<expectedClubCount?[`Only ${latestClubs.size} of ${expectedClubCount} clubs validated for Round ${latestRound}`]:[])],payloadForHash={availability,teamLists,changes,suspensions},data={schemaVersion:2,season:2026,generatedAt:checkedAt,checkedAt,lastAttempt:checkedAt,lastSuccess:validationErrors.length?previous?.lastSuccess||previous?.generatedAt||null:checkedAt,sourceVersion:`nrl-${latestRound}`,sourceHash:crypto.createHash('sha256').update(JSON.stringify(payloadForHash)).digest('hex'),expectedClubCount,receivedClubCount:latestClubs.size,validationErrors,latestRound,freshness:freshness(checkedAt,sourceAvailable),sourceAvailable,failures,sources:{casualtyWard:URLS.casualty,teamLists:links[0]?.[1]||null,lateMail:lateLinks[0]?.[1]||null,judiciary:URLS.judiciary},availability,teamLists,changes,lateMail:lateMailEvents(teamLists,changes),suspensions,summary:{currentUnavailable:availability.length,currentSuspensions:suspensions.length,matches:teamLists.length,changes:changes.length,unresolvedPlayers:availability.filter(x=>!String(x.identity).startsWith('matched')).length}};
  const publication=publishTeamNews(previous,data),published=publication.published||data;if(!publication.validation.ok&&previous)published.lastAttempt=checkedAt;
  const tmp=OUTPUT+'.tmp';fs.writeFileSync(tmp,JSON.stringify(published,null,2)+'\n');fs.renameSync(tmp,OUTPUT);
  console.log(JSON.stringify({availability:published.availability.length,suspensions:published.suspensions.length,matches:published.teamLists.length,changes:published.changes.length,latestRound:published.latestRound,failures:failures.length,changed:publication.changed,validationErrors:publication.validation.errors}));
  if(!casualty.value&&!previous)throw new Error('Casualty Ward unavailable and no verified snapshot exists');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={fetchText,discoverTeamListLinks,discoverLateMailLinks,statusHistory,lateMailEvents,main};
