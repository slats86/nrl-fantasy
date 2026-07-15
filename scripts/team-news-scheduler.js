'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {schedulerDecision,contentHash}=require('../lib/home-dashboard');
const snapshotPath=path.join(__dirname,'..','public','team-news.json');
function statusFromSnapshot(snapshot={}){const latest=Math.max(0,...(snapshot.teamLists||[]).map(item=>Number(item.round)||0)),clubs=new Set((snapshot.teamLists||[]).filter(item=>Number(item.round)===latest).flatMap(item=>[item.home,item.away]).filter(Boolean));return {lastAttempt:snapshot.checkedAt||null,lastSuccess:snapshot.generatedAt||null,sourceVersion:snapshot.sourceVersion||snapshot.schemaVersion||null,sourceHash:snapshot.sourceHash||contentHash({availability:snapshot.availability||[],teamLists:snapshot.teamLists||[],changes:snapshot.changes||[]}),expectedClubCount:Number(snapshot.expectedClubCount)||16,receivedClubCount:clubs.size,validationErrors:snapshot.validationErrors||snapshot.failures?.map(item=>item.error)||[]}}
function decisionAt(now,snapshot){return {...schedulerDecision(now,statusFromSnapshot(snapshot)),status:statusFromSnapshot(snapshot)}}
if(require.main===module){let snapshot={};try{snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'))}catch{}const now=process.env.NOW?new Date(process.env.NOW):new Date(),decision=decisionAt(now,snapshot);process.stdout.write(JSON.stringify(decision)+'\n');if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`due=${decision.due}\ncadence=${decision.cadence}\nwarning=${decision.warning}\n`)}
module.exports={statusFromSnapshot,decisionAt};
