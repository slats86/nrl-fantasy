'use strict';

const LIVE=new Set(['active','live','in_progress','in-progress','playing']);
const FINAL=new Set(['complete','completed','final','full_time','full-time']);
function status(value){const key=String(value||'').toLowerCase();return LIVE.has(key)?'live':FINAL.has(key)?'complete':'scheduled'}
function time(value){const n=+new Date(value||0);return Number.isFinite(n)?n:0}
function matchStart(match){return match.start_time||match.kickoff||match.scheduled_start||match.match_time||match.date||null}
function roundStart(round){return round.start||matchStart((round.matches||[])[0])||null}
function roundEnd(round){return round.end||matchStart((round.matches||[]).at(-1))||null}

function currentRoundContext(rounds,{now=Date.now(),fetchedAt=Date.now(),stale=false,season=new Date(now).getFullYear()}={}){
  const verified=(Array.isArray(rounds)?rounds:[]).filter(round=>Number.isSafeInteger(Number(round.id))&&Array.isArray(round.matches)).map(round=>{
    const matches=round.matches.map(match=>({...match,normalizedStatus:status(match.status),start:matchStart(match)}));
    const states=matches.map(match=>match.normalizedStatus),explicit=status(round.status),live=explicit==='live'||states.includes('live'),complete=explicit==='complete'||Boolean(states.length&&states.every(value=>value==='complete'));
    return {raw:round,id:Number(round.id),matches,live,complete,start:roundStart(round),end:roundEnd(round)};
  });
  const live=verified.filter(round=>round.live).sort((a,b)=>b.id-a.id)[0]||null;
  const upcoming=verified.filter(round=>!round.complete&&!round.live).sort((a,b)=>{const at=time(a.start)||Infinity,bt=time(b.start)||Infinity;return at-bt||a.id-b.id})[0]||null;
  const completed=verified.filter(round=>round.complete).sort((a,b)=>b.id-a.id)[0]||null;
  const selected=live||upcoming||completed||null;
  if(!selected)return {season,currentRound:0,liveRound:null,lastCompletedRound:null,state:'pre_lockout',firstLockout:null,nextLockout:null,games:{complete:0,live:0,toPlay:0,total:0},updatedAt:new Date(fetchedAt).toISOString(),cacheAgeMs:Math.max(0,now-fetchedAt),stale:Boolean(stale),fixtures:[],appearances:[]};
  const games={complete:selected.matches.filter(match=>match.normalizedStatus==='complete').length,live:selected.matches.filter(match=>match.normalizedStatus==='live').length,toPlay:selected.matches.filter(match=>match.normalizedStatus==='scheduled').length,total:selected.matches.length};
  const starts=selected.matches.map(match=>match.start).filter(Boolean).sort((a,b)=>time(a)-time(b)),next=starts.find(value=>time(value)>now)||null;
  const state=selected.live?'live':selected.complete?(stale?'provisional_final':'final'):'pre_lockout';
  const fixtures=selected.matches.map(match=>({id:match.id??null,status:match.normalizedStatus,start:match.start,homeSquadId:match.home_squad_id??null,awaySquadId:match.away_squad_id??null,homeScore:match.home_score??null,awayScore:match.away_score??null}));
  const appearances=[...new Set(fixtures.flatMap(match=>[match.homeSquadId,match.awaySquadId]).filter(value=>value!=null))];
  return {season,currentRound:selected.id,liveRound:live?.id??null,lastCompletedRound:completed?.id??null,state,firstLockout:starts[0]||selected.start,nextLockout:next, games,updatedAt:new Date(fetchedAt).toISOString(),cacheAgeMs:Math.max(0,now-fetchedAt),stale:Boolean(stale),fixtures,appearances};
}

function reconcileComponents(officialTotal,components,rules){let calculated=0;const rows=[];for(const [key,count] of Object.entries(components||{})){if(count==null||!Number.isFinite(Number(count))||!Number.isFinite(Number(rules?.[key])))continue;const contribution=Math.round(Number(count)*Number(rules[key])*10)/10;calculated+=contribution;rows.push({key,count:Number(count),rule:Number(rules[key]),contribution})}calculated=Math.round(calculated*10)/10;const official=officialTotal==null?null:Number(officialTotal),difference=official==null?null:Math.round((official-calculated)*10)/10;return {officialTotal:official,calculatedTotal:calculated,difference,pending:difference!=null&&Math.abs(difference)>.05,rows}}

module.exports={status,currentRoundContext,reconcileComponents};
