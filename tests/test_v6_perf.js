'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const A=require('../static/advanced_engine.js');

let seed=0x6d736173;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/0x100000000;};
const candles=[];
let close=1000;
for(let index=0;index<25000;index++){
 const open=close;
 close=open+(random()-0.5)*4;
 const high=Math.max(open,close)+random()*2;
 const low=Math.min(open,close)-random()*2;
 candles.push({index,open,high,low,close,time:new Date(1704067200000+index*900000).toISOString()});
}
const started=performance.now();
const replay=A.replayAll(candles);
const durationMs=performance.now()-started;
assert.equal(replay.frames.length,candles.length);
const hasPivotLedger=(value,key='')=>{
 if(!value||typeof value!=='object')return false;
 if(Array.isArray(value))return ['pivots','swings','path','confirmed','detected','history','selected'].includes(key);
 return Object.entries(value).some(([childKey,child])=>hasPivotLedger(child,childKey));
};
for(const [index,frame] of replay.frames.entries())assert(!hasPivotLedger(frame),`frame ${index} copied a full pivot ledger`);
const heapUsed=process.memoryUsage().heapUsed;
console.log(`V6 PERF durationMs=${durationMs.toFixed(2)} heapUsed=${heapUsed}`);
assert(durationMs<3000,`25,000-bar replay exceeded 3000 ms: ${durationMs.toFixed(2)} ms`);
console.log('PASS V6 25,000-bar streaming performance and compact frame contract');
