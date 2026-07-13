'use strict';

const fs = require('fs');
const path = require('path');
const {normalizedStatus} = require('../live-data');

function summary(rounds, players, roundId) {
  const round = rounds.find(item => Number(item.id) === Number(roundId));
  if (!round) return {round: Number(roundId), missing: true};
  const scorers = players.filter(player => player.stats && player.stats.scores && player.stats.scores[roundId] != null);
  return {round: Number(roundId), status: round.status, matches: (round.matches || []).map(match => ({id: match.id,
    status: normalizedStatus(match.status), home: match.home_squad_name, away: match.away_squad_name,
    homeScore: match.home_score, awayScore: match.away_score})), playersWithScores: scorers.length,
    playersWithNonZeroScores: scorers.filter(player => Number(player.stats.scores[roundId]) !== 0).length};
}

async function fetchDetails(player, roundId) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();const timeout = setTimeout(()=>controller.abort(), 10000);
    try {
      const response = await fetch(`https://fantasy.nrl.com/data/nrl/stats/players/${player.id}.json`, {signal: controller.signal, cache: 'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json(),detail=data[roundId];
      if (!detail) throw new Error('round detail is missing');
      const components = ['TCK','MG','T','G','TA','LB','TB','KM'].filter(key => Number(detail[key]) !== 0);
      if (!components.length) throw new Error('no detailed components');
      return {officialId: player.id, name: [player.first_name, player.last_name].filter(Boolean).join(' '),
        squadId: player.squad_id, fantasyPoints: player.stats.scores[roundId], components: Object.fromEntries(components.map(key => [key, detail[key]]))};
    } catch (error) { lastError=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*400)); }
    finally { clearTimeout(timeout); }
  }
  return {officialId: player.id, squadId: player.squad_id, error: lastError.message};
}

async function main() {
  const root = path.join(__dirname, '..');
  const args=process.argv.slice(2).filter(value=>!value.startsWith('--'));
  const rounds = JSON.parse(fs.readFileSync(args[0] || path.join(root, 'public/rounds.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(args[1] || path.join(root, 'public/players.json'), 'utf8'));
  const roundId = Number(args[2] || Math.max(...rounds.filter(round => normalizedStatus(round.status) !== 'scheduled').map(round => round.id)));
  const result = summary(rounds, players, roundId);
  if (process.argv.includes('--details') && !result.missing) {
    const round = rounds.find(item=>Number(item.id)===roundId);
    const squads = new Set((round.matches||[]).flatMap(match=>[match.home_squad_id,match.away_squad_id]));
    const selected = [...squads].map(squadId=>players.filter(player=>player.squad_id===squadId&&player.stats&&player.stats.scores&&player.stats.scores[roundId]!=null)
      .sort((a,b)=>b.stats.scores[roundId]-a.stats.scores[roundId])[0]).filter(Boolean);
    result.detailChecks=[];
    for(let index=0;index<selected.length;index+=4)
      result.detailChecks.push(...await Promise.all(selected.slice(index,index+4).map(player=>fetchDetails(player,roundId))));
    result.detailFailures=result.detailChecks.filter(check=>check.error).length;
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.missing || !result.matches.length || !result.playersWithScores || result.detailFailures) process.exitCode = 1;
}

if (require.main === module) main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports = {summary};
