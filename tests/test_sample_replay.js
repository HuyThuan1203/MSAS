'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../static/engine.js');
const specs=[
 {name:'BTCUSD_M15_sample',raw:17,confirmed:11,insideRejected:1,events:52,trend:'up'},
 {name:'XAUUSD_M15_10Hours',raw:17,confirmed:14,insideRejected:0,events:56,trend:'unknown'},
];
for(const spec of specs){
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs',spec.name+'.canonical.json'),'utf8'));
 const bars=data.candles;
 assert.equal(bars.length,40);
 const final=E.analyzePrefix(bars);
 for(const key of ['raw','confirmed','insideRejected'])assert.equal(final.summary[key],spec[key],spec.name+' '+key);
 assert.equal(final.events.length,spec.events);
 assert.equal(final.trend,spec.trend);
 for(let t=0;t<bars.length;t++){
  const a=E.analyzePrefix(bars,t),b=E.analyzePrefix(bars.slice(0,t+1));
  assert.deepEqual(a.summary,b.summary,spec.name+' prefix '+t);
  assert.deepEqual(a.events.map(e=>[e.at,e.kind,e.pivotIndex]),b.events.map(e=>[e.at,e.kind,e.pivotIndex]));
  assert(a.events.every(e=>e.at<=t),spec.name+' no future events');
  assert(a.swings.every(p=>p.confirmedAt<=t),spec.name+' no premature pivots');
 }
 console.log('PASS',spec.name,final.summary,'events',final.events.length,'trend',final.trend);
}
