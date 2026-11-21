'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {analyzePrefix}=require('../static/engine.js');
function candle(t,h,l){return {index:t,time:`2026-11-11 00:${String(t*10).padStart(2,'0')}:00`,open:l+1,high:h,low:l,close:h-1,volume:5};}
// PPT 1, slide 3: exact M1-to-M5 table, no assumed intermediary path.
const m1=[
 {open:100,high:104,low:99,close:103},
 {open:103,high:105,low:102,close:104},
 {open:104,high:104,low:100,close:101},
 {open:101,high:102,low:98,close:99},
 {open:99,high:100,low:97,close:98}
];
const m5={open:m1[0].open,high:Math.max(...m1.map(x=>x.high)),low:Math.min(...m1.map(x=>x.low)),close:m1.at(-1).close};
assert.deepEqual(m5,{open:100,high:105,low:97,close:98});
assert(m1[0].close>m1[0].open&&m5.close<m5.open);
// PPT 1, slide 4: exact high/low example and right-side candle close.
const highs=[103,108,105,112,109,111],lows=[99,102,100,106,104,107];
const series=highs.map((h,i)=>candle(i,h,lows[i]));
const expected=[['SH',1,2],['SL',2,3],['SH',3,4],['SL',4,5]];
for(let upto=0;upto<series.length;upto++){
 const result=analyzePrefix(series,upto),raw=result.swings.map(x=>[x.type,x.index,x.confirmedAt]);
 assert.deepEqual(raw,expected.filter(x=>x[2]<=upto),`slide 4 at t${upto+1}`);
}
// PPT 1, slides 6-7: source rule on mother, inclusive inside, breakout by wick.
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/BTCUSD_M15_sample.canonical.json'),'utf8')).candles;
const pre=analyzePrefix(data,20);
assert(pre.zones.some(z=>z.mother===18&&z.first===19&&z.last===20));
assert(!pre.swings.some(x=>x.index===20));
const after=analyzePrefix(data,21);
const invalid=after.swings.find(x=>x.index===20&&x.type==='SL');
assert(invalid&&invalid.confirmedAt===21&&invalid.status==='inside_rejected');
assert(after.zones.some(z=>z.mother===18&&z.brokenAt===21&&z.breakDirection==='tr\u00ean'));
const end=analyzePrefix(data);
assert(end.swings.find(x=>x.index===20&&x.type==='SL').status==='inside_rejected');
// Swings are confirmed at their right candle; no pending state awaiting an opposite swing.
assert(end.swings.find(x=>x.index===38&&x.type==='SL').structStatus==='confirmed');
// PPT 1, slides 5/9: do not force up/down without two same-type pairs.
assert.equal(analyzePrefix(data,0).trend,'unknown');
assert.equal(analyzePrefix(data,5).trend,'unknown');
// PPT 2, slides 2/3: lack of opposing eligible pivots cannot confirm a turn.
const consecutive=[candle(0,10,2),candle(1,12,3),candle(2,11,4),candle(3,14,5),candle(4,13,6)];
const noPair=analyzePrefix(consecutive);
assert.equal(noPair.summary.confirmed,0);
// Candle 2 is inside SH-1 and the breakout (candle 3) goes higher -> SH-1 never a top.
assert.equal(noPair.swings.find(x=>x.index===1&&x.type==='SH').status,'isb_rejected');
// Chronological causality: prefix recomputation is identical to truncated input.
for(let t=0;t<data.length;t++){
 const a=analyzePrefix(data,t),b=analyzePrefix(data.slice(0,t+1));
 assert.deepEqual(a.swings.map(s=>[s.index,s.type,s.status,s.structStatus]),b.swings.map(s=>[s.index,s.type,s.status,s.structStatus]));
 assert.deepEqual(a.events.map(e=>[e.at,e.kind]),b.events.map(e=>[e.at,e.kind]));
 assert(a.events.every(e=>e.at<=t));
}
console.log('PASS PPT slide 3 M5 aggregation, slide 4 pivots, slide 6/7 mother and invalid SL, PPT 2 paired reversals, 40 causal prefixes');
