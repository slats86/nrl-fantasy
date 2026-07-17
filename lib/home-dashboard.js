'use strict';

const crypto=require('node:crypto');
const SYDNEY='Australia/Sydney';

function sydneyParts(value){
  const date=value instanceof Date?value:new Date(value);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-AU',{timeZone:SYDNEY,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
  return {weekday:parts.weekday,year:+parts.year,month:+parts.month,day:+parts.day,hour:+parts.hour,minute:+parts.minute,total:+parts.hour*60+(+parts.minute)};
}

function schedulerDecision(now,status={}){
  const local=sydneyParts(now),t=local.total,tuesday=local.weekday==='Tue';
  if(!tuesday||t<15*60+55||t>18*60)return {due:false,cadence:'regular',local,warning:false};
  const complete=Number(status.expectedClubCount)>0&&Number(status.receivedClubCount)>=Number(status.expectedClubCount)&&!status.validationErrors?.length;
  if(complete)return {due:false,cadence:'complete',local,warning:false};
  const cadence=t<=16*60+30?'five-minute':'fifteen-minute',interval=cadence==='five-minute'?5:15;
  const due=local.minute%interval===0||t===15*60+55;
  return {due,cadence,local,warning:t>=18*60&&!complete};
}

function contentHash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function publicationContent(value){
  if(Array.isArray(value))return value.map(publicationContent);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['checkedAt','lastAttempt','lastSuccess','generatedAt','freshness'].includes(key)).map(([key,item])=>[key,publicationContent(item)]));
}
function validateTeamNewsPublication(previous,candidate){const errors=[];if(!candidate||!Array.isArray(candidate.teamLists)||!Array.isArray(candidate.availability))errors.push('Invalid payload shape');if(!candidate?.teamLists?.length)errors.push('Team lists are empty');if(previous&&candidate&&Number(candidate.latestRound)<Number(previous.latestRound))errors.push('Candidate round is older than the verified snapshot');const latest=Number(candidate?.latestRound)||0,clubs=new Set((candidate?.teamLists||[]).filter(item=>Number(item.round)===latest).flatMap(item=>[item.home,item.away]).filter(Boolean)),expectedClubCount=Math.max(1,Number(candidate?.expectedClubCount)||16);if(latest&&clubs.size<expectedClubCount)errors.push(`Partial club coverage (${clubs.size}/${expectedClubCount})`);return {ok:errors.length===0,errors,receivedClubCount:clubs.size,expectedClubCount}}
function publishTeamNews(previous,candidate){const validation=validateTeamNewsPublication(previous,candidate);if(!validation.ok)return {changed:false,published:previous,validation};const dedupe=items=>{const seen=new Set();return (items||[]).filter(item=>{const key=item.id||contentHash(publicationContent(item));return !seen.has(key)&&seen.add(key)})},published={...candidate,changes:dedupe(candidate.changes),lateMail:dedupe(candidate.lateMail),receivedClubCount:validation.receivedClubCount,expectedClubCount:validation.expectedClubCount,validationErrors:[]};published.sourceHash=contentHash(publicationContent({availability:published.availability,teamLists:published.teamLists,changes:published.changes,lateMail:published.lateMail}));const changed=!previous||published.sourceHash!==previous.sourceHash;return {changed,published:changed?published:{...previous,lastAttempt:candidate.checkedAt||new Date().toISOString()},validation}}
function ids(value,out=new Set()){
  if(value==null)return out;
  if(Number.isSafeInteger(value)){out.add(value);return out}
  if(Array.isArray(value)){for(const item of value)ids(item,out);return out}
  if(typeof value!=='object')return out;
  for(const [key,item] of Object.entries(value))if(/^(pid|playerId)$/i.test(key)&&Number.isSafeInteger(Number(item)))out.add(Number(item));else if(['squad','roster','starters','interchange','reserves','line','picks','team'].includes(key))ids(item,out);
  return out;
}
function scoreFor(league,teamId,round){const row=(league.scores||[]).find(item=>item.teamId===teamId&&Number(item.round)===Number(round));return row?Number(row.points):null}
function matchupFor(league,team,round){const fixture=(league.fixtures||[]).find(item=>Number(item.round)===Number(round)&&(item.homeTeamId===team.id||item.awayTeamId===team.id));if(!fixture)return null;const opponentId=fixture.homeTeamId===team.id?fixture.awayTeamId:fixture.homeTeamId,opponent=(league.teams||[]).find(item=>item.id===opponentId);return {opponentId,opponentName:opponent?.name||'Opponent',opponentScore:scoreFor(league,opponentId,round)} }
function statusGroup(status,urgent){return urgent?0:status==='live'?1:status==='scheduled'?2:3}

function competitionSummaries({user,classicLeague,classicTeam,fantasyLeagues,round,liveStatus='scheduled',updatedAt=Date.now()}){
  const result=[];
  if(classicTeam)result.push({id:'classic:'+user.userId,teamId:classicTeam.id||user.teamId||'classic',format:'classic',leagueName:classicLeague?.name||'Classic',teamName:classicTeam.name||user.name,score:classicTeam.score??null,status:liveStatus,rank:classicTeam.rank??null,rankMovement:classicTeam.rankMovement??null,players:classicTeam.players||null,matchup:classicTeam.matchup||null,updatedAt,action:{label:'View team',page:'classic'}});
  for(const league of Object.values(fantasyLeagues||{})){
    const membership=(league.members||[]).find(item=>item.userId===user.userId&&item.active!==false);if(!membership)continue;
    const team=(league.teams||[]).find(item=>item.userId===user.userId);if(!team)continue;
    const state=team.state||{},score=scoreFor(league,team.id,round),matchup=matchupFor(league,team,round),draft=league.format==='draft'?league.draftState||{}:null;
    const myTurn=Boolean(draft&&draft.phase==='draft'&&Number(draft.me)===Number(draft.turn)),urgent=myTurn||Boolean(state.invalid||state.saveConflict);
    result.push({id:league.id,teamId:team.id,format:league.format,leagueName:league.name,teamName:team.name,role:membership.role,score,status:league.status==='inactive'?'final':liveStatus,rank:state.rank??null,rankMovement:state.rankMovement??null,players:state.players||null,matchup,draft:league.format==='draft'?{phase:draft.phase||'lobby',myTurn,waiverDeadline:draft.waiverDeadline||null}:null,stale:Boolean(state.stale),urgent,updatedAt:team.updated||league.updated||updatedAt,action:{label:myTurn?'Draft now':'View team',page:league.format,leagueId:league.id}});
  }
  return result.sort((a,b)=>statusGroup(a.status,a.urgent)-statusGroup(b.status,b.urgent)||a.format.localeCompare(b.format)||a.leagueName.localeCompare(b.leagueName)||a.id.localeCompare(b.id));
}

function teamNewsEvents(snapshot={}){
  const availability=(snapshot.availability||[]).map(item=>({id:item.id||contentHash(['availability',item.playerName,item.club,item.sourceUpdatedAt]),type:item.type==='suspension'?'Suspension/judiciary outcome':item.type==='injury'?'Confirmed injury/return':'Omitted',playerId:item.playerId??null,playerName:item.playerName,club:item.club,summary:item.summary||item.injury||item.status,round:item.expectedReturnRound||snapshot.latestRound||null,source:item.publisher||'NRL.com',sourceUrl:item.sourceUrl||null,sourceTime:item.sourceUpdatedAt||item.checkedAt,confirmation:item.accuracy==='confirmed'?'Confirmed':'Estimated'}));
  const changes=[...(snapshot.changes||[]),...(snapshot.lateMail||[])].map(item=>({id:item.id||contentHash(['change',item.club,item.summary,item.capturedAt]),type:(snapshot.lateMail||[]).includes(item)?'Late mail/final-team change':'Official team list named',playerId:item.playerId??null,playerName:item.playerName||null,club:item.club,summary:item.summary,round:item.round,source:item.source?.publisher||item.publisher||'NRL.com',sourceUrl:item.source?.sourceUrl||item.sourceUrl||null,sourceTime:item.capturedAt,confirmation:item.accuracy==='confirmed'?'Confirmed':'Estimated'}));
  const seen=new Set();return [...availability,...changes].filter(item=>item.sourceTime&&!seen.has(item.id)&&seen.add(item.id)).sort((a,b)=>+new Date(b.sourceTime)-+new Date(a.sourceTime));
}
function relevantNews(events,{teamPlayerIds=new Set(),watchlist=new Set(),clubs=new Set(),scope='all'}={}){
  return events.map(item=>({...item,relevance:teamPlayerIds.has(Number(item.playerId))?'My player':watchlist.has(Number(item.playerId))?'Watchlist':clubs.has(item.club)?'My club':'League-wide'})).filter(item=>scope==='my-players'?item.relevance==='My player':scope==='watchlist'?item.relevance==='Watchlist':true).sort((a,b)=>['My player','Watchlist','My club','League-wide'].indexOf(a.relevance)-['My player','Watchlist','My club','League-wide'].indexOf(b.relevance)||+new Date(b.sourceTime)-+new Date(a.sourceTime));
}
function activeAlerts({competitions=[],events=[],teamPlayerIds=new Set(),now=Date.now(),deadline=null}){
  const alerts=[];
  for(const competition of competitions){if(competition.draft?.myTurn)alerts.push({key:`draft-turn:${competition.id}`,severity:'Critical',title:'Your Draft turn is ready',consequence:'Another coach is waiting for your selection.',competitionId:competition.id,context:`${competition.leagueName} · ${competition.teamName}`,eventTime:competition.updatedAt,action:competition.action,expiresAt:competition.draft.waiverDeadline||null});if(competition.stale)alerts.push({key:`stale:${competition.id}`,severity:'Warning',title:'Live data is stale',consequence:'Scores may be delayed while the source recovers.',competitionId:competition.id,context:competition.leagueName,eventTime:competition.updatedAt,action:competition.action,expiresAt:null})}
  for(const event of events)if(event.relevance==='My player'&&/Omitted|injury|reserves|suspension/i.test(`${event.type} ${event.summary}`))alerts.push({key:`team-news:${event.id}`,severity:'Action required',title:`${event.playerName||event.club} needs attention`,consequence:event.summary,competitionId:null,context:event.relevance,eventTime:event.sourceTime,action:{label:'Fix team',page:'teamnews'},expiresAt:deadline});
  const seen=new Set();return alerts.filter(item=>(!item.expiresAt||+new Date(item.expiresAt)>+new Date(now))&&!seen.has(item.key)&&seen.add(item.key));
}

module.exports={SYDNEY,sydneyParts,schedulerDecision,contentHash,validateTeamNewsPublication,publishTeamNews,ids,competitionSummaries,teamNewsEvents,relevantNews,activeAlerts};
