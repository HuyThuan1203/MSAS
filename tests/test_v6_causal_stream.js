'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('../static/engine.js'),A=require('../static/advanced_engine.js');
const ROOT=path.resolve(__dirname,'..');

function csvCandles(file){
 const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);if(!lines.length)return null;
 let headers=lines[0].split(',').map(x=>x.trim().toLowerCase()),start=1;
 if(!headers.some(x=>['high','h'].includes(x))){headers=['timestamp','open','high','low','close'];start=0;}
 const aliases={timestamp:'time',timestamp_utc:'time',date:'time',o:'open',h:'high',l:'low',c:'close'};
 if(!['open','high','low','close'].every(k=>headers.map(x=>aliases[x]||x).includes(k)))return null;
 const out=[];
 for(let i=start;i<lines.length;i++){
  if(!lines[i].trim())continue;const values=lines[i].split(','),b={index:out.length};
  headers.forEach((h,j)=>{const key=aliases[h]||h;b[key]=key==='time'?values[j]:values[j]===''?null:Number(values[j]);});
  if(!['open','high','low','close'].every(k=>Number.isFinite(b[k])))return null;
  if(b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low>b.high)return null;
  out.push(b);
 }
 return out.length?out:null;
}
function discover(){
 const files=[];for(const root of ['samples','fixtures']){
  const walk=d=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);if(x.isDirectory())walk(f);else files.push(f);}};walk(path.join(ROOT,root));
 }
 const sets=[];
 for(const file of files.sort()){
  if(file.endsWith('.json')){const obj=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(obj.candles)&&obj.candles.length)sets.push([path.relative(ROOT,file),obj.candles]);}
  else if(file.endsWith('.csv')){const c=csvCandles(file);if(c)sets.push([path.relative(ROOT,file),c]);}
 }
 return sets;
}
function levels(frame){return [frame.external.majorHigh,frame.external.majorLow,frame.external.provisionalHigh,frame.external.provisionalLow,
 frame.internal.internalHigh,frame.internal.internalLow,frame.internal.protectedHigh,frame.internal.protectedLow].filter(Boolean);}
function assertMajorAssignments(name,candles,replay){
 const pivots=new Map(replay.pivots.map(p=>[p.id,p]));
 for(const role of replay.roleChanges.filter(r=>r.to==='major_high'||r.to==='major_low')){
  const pivot=pivots.get(role.pivot_id);assert(pivot,`${name} missing assigned pivot ${role.pivot_id}`);
  const closes=candles.slice(pivot.index+1,role.at+1).map(b=>b.close);
  if(role.to==='major_high')assert(closes.every(close=>close<=pivot.price),`${name} violated MH ${pivot.id} assigned @${role.at}`);
  else assert(closes.every(close=>close>=pivot.price),`${name} violated ML ${pivot.id} assigned @${role.at}`);
 }
}
let prefixes=0;
for(const [name,candles] of discover()){
 const full=A.replayAll(candles),baseFull=E.analyzePrefix(candles);
 assertMajorAssignments(name,candles,full);
 assert.equal(full.frames.length,candles.length,name);
 for(let t=0;t<candles.length;t++){
  const prefix=A.replayAll(candles.slice(0,t+1));
  assert.deepEqual(prefix.frames[t],full.frames[t],`${name} frame @${t}`);
  assert.deepEqual(prefix.events,full.events.filter(e=>e.at<=t),`${name} events @${t}`);
  assert.deepEqual(prefix.roleChanges,full.roleChanges.filter(e=>e.at<=t),`${name} roles @${t}`);
  assert.deepEqual(prefix.pivots,full.pivots.filter(p=>p.recognizedAt<=t),`${name} pivots @${t}`);
  assert(levels(prefix.frames[t]).every(p=>p.confirmedAt===null||p.confirmedAt<=t),`${name} future Level @${t}`);
  const base=E.analyzePrefix(candles,t);
  for(const pivot of baseFull.swings.filter(p=>p.confirmedAt<=t))
   assert.deepEqual(base.swings.find(p=>p.id===pivot.id),pivot,`${name} immutable ${pivot.id} @${t}`);
  prefixes++;
 }
}
// The accepted-pivot slide fixture is an event fixture rather than raw OHLC;
// exercise its compatibility stream separately.
{
 const f=JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures/advanced_slide13_synthetic.json'),'utf8'));
 const candles=Array.from({length:f.bars},(_,i)=>({index:i,close:f.close_overrides[i]??f.default_close}));
 const full=A.analysisFromAccepted(candles,f.pivots,candles.length-1);
 for(let t=0;t<candles.length;t++){
  const p=A.analysisFromAccepted(candles.slice(0,t+1),f.pivots.filter(x=>(x.structConfirmedAt??x.confirmedAt)<=t),t);
  assert.deepEqual(p.events,full.events.filter(e=>e.at<=t),`accepted fixture events @${t}`);
  assert.deepEqual(p.roleChanges,full.roleChanges.filter(e=>e.at<=t),`accepted fixture roles @${t}`);
  prefixes++;
 }
}
console.log(`PASS V6 causal streaming: ${prefixes} prefixes across every valid samples/ and fixtures/ dataset; immutable pivots/events/roles/frames`);
