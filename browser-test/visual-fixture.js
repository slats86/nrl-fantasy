'use strict';

// Approved layout screenshots must survive the data-refresh bot. Prices, scores,
// the current round and who sorts to the top all move every round, so pin a
// deterministic season from each player's feed id before taking a baseline.
const VISUAL_ROUNDS=22;

async function pinVisualSeason(page){
  await page.evaluate(async rounds=>{
    if(_refreshInFlight){try{await _refreshInFlight}catch(error){}}
    if(_refreshTimer){clearTimeout(_refreshTimer);_refreshTimer=null}
    autoRefresh=()=>Promise.resolve();
    if(typeof loadTeamNews==='function')loadTeamNews=()=>Promise.resolve(TEAM_NEWS);
    if(typeof stopTeamNewsPoll==='function')stopTeamNewsPoll();
    MAXR=rounds;
    S.round=rounds;
    PLAYERS.forEach(player=>{
      const feed=Number(FEEDIDS[player.id])||player.id;
      const priceK=380+(feed%420);
      const scores=[],prices=[];
      for(let round=1;round<=rounds;round++){
        const played=(feed+round)%5!==0;
        scores.push(played?25+((feed+round*13)%60):null);
        prices.push(priceK-40+Math.round(round*40/rounds));
      }
      OFFS[player.id]=scores;
      RPRICE[player.id]=prices;
      const playedScores=scores.filter(score=>score!=null);
      player.gp=playedScores.length;
      player.avg=playedScores.length?Math.round(playedScores.reduce((sum,score)=>sum+score,0)/playedScores.length*10)/10:0;
      const recent=playedScores.slice(-3);
      player.l3=recent.length?Math.round(recent.reduce((sum,score)=>sum+score,0)/recent.length*10)/10:0;
      player.own=(feed%55)+1;
      RST[player.id]=RST[player.id]||{};
      for(let round=1;round<=rounds;round++){
        if(scores[round-1]==null){delete RST[player.id][round];continue}
        const line=Array.isArray(RST[player.id][round])?RST[player.id][round]:[];
        line[24]=50+((feed+round)%31);
        RST[player.id][round]=line;
      }
    });
    const status=document.getElementById('hdr-status');
    if(status)status.textContent='';
    const updated=document.getElementById('hdr-updated');
    if(updated)updated.textContent='';
    // Cloud save status includes a clock time and flips through "Saving...",
    // which would make every data refresh and every minute a new screenshot.
    if(_cloudSaveTimer){clearTimeout(_cloudSaveTimer);_cloudSaveTimer=null}
    queueCloudSave=()=>{};
    setTeamSaveStatus=()=>{};
    const saved=document.getElementById('team-save-status');
    if(saved){saved.textContent='Saved';saved.className='team-save-status'}
  },VISUAL_ROUNDS);
}

module.exports={pinVisualSeason,VISUAL_ROUNDS};
