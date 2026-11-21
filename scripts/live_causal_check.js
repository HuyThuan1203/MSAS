#!/usr/bin/env node
/* Causality check on REAL candles ("no god view").
 *
 * Replays closed candles one at a time exactly like the live UI receives them
 * and asserts, for every bar t:
 *   1. what the engines report at t uses only candles 0..t
 *      (analysis of the truncated feed == full-history analysis restricted to at<=t);
 *   2. no swing, event, role change or Major pivot points at a candle after t;
 *   3. the Major/Internal state shown at t never changes when later candles arrive.
 *
 * Usage:
 *   node scripts/live_causal_check.js market_data/live/binance/BTCUSDT/M1   # downloaded live data
 *   node scripts/live_causal_check.js samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json
 *   node scripts/live_causal_check.js --samples                              # the 4 bundled real datasets
 * Options: --last N (default 400) checks the newest N closed candles.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const E=require(path.join(ROOT,'static/engine.js')),A=require(path.join(ROOT,'static/advanced_engine.js'));

function readCsvDir(dir){
 const rows=new Map();
 for(const f of fs.readdirSync(dir).filter(n=>/^\d{4}-\d{2}-\d{2}\.csv$/.test(n)).sort()){
  const lines=fs.readFileSync(path.join(dir,f),'utf8').trim().split(/\r?\n/);const head=lines.shift().split(',');
  for(const line of lines){const c=line.split(',');const r=Object.fromEntries(head.map((h,i)=>[h,c[i]]));
   const ms=Number(r.open_ms),rev=Number(r.revision);
   if(!rows.has(ms)||rows.get(ms).rev<=rev)rows.set(ms,{rev,time:r.open_time_utc,open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:r.volume===''?null:+r.volume});}
 }
 return [...rows.keys()].sort((a,b)=>a-b).map(k=>rows.get(k));
}
function readCsvFile(file){
 const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);const head=lines.shift().split(',').map(s=>s.trim().toLowerCase());
 return lines.map(l=>{const c=l.split(',');const o={};head.forEach((h,i)=>o[h]=c[i]);
  return {time:o.timestamp||o.time||o.open_time_utc,open:+o.open,high:+o.high,low:+o.low,close:+o.close,volume:o.volume?+o.volume:null};});
}
function load(src){
 const st=fs.statSync(src);
 if(st.isDirectory())return readCsvDir(src);
 if(src.endsWith('.json')){const j=JSON.parse(fs.readFileSync(src,'utf8'));return j.candles||j;}
 return readCsvFile(src);
}
function analyze(c,t){const base=E.analyzePrefix(c,t);return {base,adv:A.analyzeAdvancedPrefix(c,t,base)};}
const strip=x=>JSON.stringify(x);
function check(name,candlesIn,last){
 const candles=candlesIn.slice(-last).map((c,i)=>({...c,index:i}));
 const n=candles.length;
 if(n<10){console.log(`SKIP ${name}: only ${n} closed candles`);return true;}
 const full=analyze(candles,n-1);
 let failures=0;const fail=(t,msg)=>{if(failures++<10)console.log(`  FAIL @${t} ${candles[t].time}: ${msg}`);};
 const majors=[];
 for(let t=0;t<n;t++){
  const feed=candles.slice(0,t+1);           // exactly what a live feed has delivered
  const now=analyze(feed,t);
  if(strip(now.adv.events)!==strip(full.adv.events.filter(e=>e.at<=t)))fail(t,'advanced events depend on future candles');
  if(strip(now.adv.roleChanges)!==strip(full.adv.roleChanges.filter(e=>e.at<=t)))fail(t,'role changes depend on future candles');
  if(strip(now.base.events.map(e=>[e.at,e.kind,e.pivotIndex]))!==strip(full.base.events.filter(e=>e.at<=t).map(e=>[e.at,e.kind,e.pivotIndex])))fail(t,'swing events depend on future candles');
  for(const s of now.base.swings)if(s.confirmedAt>t||s.index>=t)fail(t,`swing ${s.id} known before its confirming candle`);
  for(const e of now.adv.events)if(e.at>t)fail(t,'event from the future');
  const ex=now.adv.external;
  for(const p of [ex.majorHigh,ex.majorLow])if(p&&(p.confirmedAt>t||p.index>=t))fail(t,`Major pivot ${p.id} not yet confirmed`);
  majors.push(strip([ex.trend,ex.majorHigh?.id,ex.majorLow?.id]));
 }
 // 3. state at t, recomputed with the WHOLE series, must be identical
 for(let t=0;t<n;t+=Math.max(1,Math.floor(n/60))){
  const later=analyze(candles,t).adv.external;
  if(strip([later.trend,later.majorHigh?.id,later.majorLow?.id])!==majors[t])fail(t,'state at t changed after later candles arrived');
 }
 const ev=full.adv.events,count=k=>ev.filter(e=>e.kind===k).length;
 const st=failures?'FAIL':'PASS';
 console.log(`${st} ${name}: ${n} closed candles ${candles[0].time} -> ${candles[n-1].time}; swings ${full.base.confirmed.length}, `+
  `Major updates ${count('major_updated')}, S+ ${count('major_reversal')}, C ${count('mss_weak')}, B ${count('cisd')}; final Main ${full.adv.external.trend}`+
  (failures?`; ${failures} violation(s)`:''));
 return !failures;
}
module.exports={check,load};
if(require.main===module){
const args=process.argv.slice(2);
let last=400;const li=args.indexOf('--last');if(li>=0){last=Number(args[li+1]);args.splice(li,2);}
let targets=args;
if(args.includes('--samples'))targets=['samples/BTCUSD_M15_sample.csv','samples/XAUUSD_M15_10Hours.csv',
 'samples/normalized/BTCUSD_M15_12h_2025-06-18_UTC.json','samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json'].map(p=>path.join(ROOT,p));
if(!targets.length){console.log('usage: node scripts/live_causal_check.js <series dir | csv | json> [--last N] | --samples');process.exit(2);}
let ok=true;
for(const t of targets){
 if(!fs.existsSync(t)){console.log(`MISSING ${t}`);ok=false;continue;}
 ok=check(path.relative(ROOT,path.resolve(t))||t,load(t),last)&&ok;
}
process.exit(ok?0:1);
}
