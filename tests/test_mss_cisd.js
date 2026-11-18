'use strict';
/* Source-locked REV PPT slides 3-8 and ADV slides 3,7,13-14.
 * All scenarios are synthetic and explicitly seeded with a confirmed Major pair.
 * They are not asserted as actual exchange or PPT OHLC candles.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const A=require('../static/advanced_engine.js'),E=require('../static/engine.js');
assert.equal(A.MSS_TOLERANCE,0);
const bar=(open,close,high=Math.max(open,close),low=Math.min(open,close))=>({open,high,low,close});
function seed(trend,hi=110,lo=90){
 const s=A.makeState();s.external={trend,phase:'confirmed',majorHigh:{id:'SH-M',index:0,type:'SH',price:hi,confirmedAt:0},majorLow:{id:'SL-M',index:0,type:'SL',price:lo,confirmedAt:0},breakAt:null,breakLevel:null};
 s.segmentStart=0;return s;
}
function consume(s,bars){for(let i=0;i<bars.length;i++)A.advance(s,i,bars[i]);return s;}
function at(s,kind){return s.events.filter(e=>e.kind===kind).map(e=>e.at);}
function snapshot(s){return JSON.stringify({ext:s.external,int:s.internal,mss:s.mss,cisd:s.cisd,events:s.events,roles:s.roleChanges});}

// A falling wave with two bearish clusters. Reference is the first candle of
// the FINAL group (bar 3, open 101), not the earlier group (bar 0, open 105).
const falling=[
 bar(105,103,106,102),bar(103,100,104,99),bar(100,101,102,99),
 bar(101,99,102,98),bar(99,96,100,95),bar(96,101,105,96),
 bar(101,102,104,100),bar(102,100,103,99),bar(100,103,105,99),
 bar(105,109,111,104),bar(108,110,111,107),bar(109,112,113,108)
];
const d=consume(seed('down'),falling);
assert.deepEqual(at(d,'cisd'),[6,8]);
assert.deepEqual(d.events.filter(e=>e.kind==='cisd').map(e=>[e.data.referenceStartIndex,e.data.referenceOpen]),[[3,101],[7,102]]);
assert.equal(d.events.find(e=>e.at===6&&e.kind==='cisd').data.confirmed,false);
assert.equal(d.events.find(e=>e.at===6&&e.kind==='cisd').data.mainTrend,'down');
assert.deepEqual(at(d,'mss_weak'),[9]); // bar 10 only touches Close=High -> no new C
assert.deepEqual(at(d,'major_reversal'),[11]);
assert.equal(d.events.find(e=>e.kind==='major_reversal').data.label,'S+');
assert.equal(d.external.trend,'up');assert.equal(d.external.phase,'awaiting_major_high');
assert.equal(d.external.majorHigh,null);assert.equal(d.external.majorLow.price,90);
assert.equal(d.events.find(e=>e.at===9&&e.kind==='mss_weak').data.confirmed,false);
assert.equal(d.events.find(e=>e.at===11&&e.kind==='major_reversal').data.tolerance,0);
assert.equal(d.mss.last.label,'S+');

// At equal Close, no S+, no C, no B. A wick touching the threshold is not a breach.
const equality=consume(seed('down'),[bar(100,108,109,100),bar(108,110,110,107)]);
assert.equal(equality.external.trend,'down');
assert(!equality.events.some(e=>['mss_weak','major_reversal'].includes(e.kind)));
const wickOnly=consume(seed('down'),[bar(106,107,111,105)]);
assert.equal(wickOnly.external.trend,'down');assert.deepEqual(at(wickOnly,'mss_weak'),[0]);
const bodyBeyond=consume(seed('down'),[bar(109,111,113,108)]);
assert.equal(bodyBeyond.external.trend,'up');assert.deepEqual(at(bodyBeyond,'major_reversal'),[0]);
assert.deepEqual(at(bodyBeyond,'mss_weak'),[]);

// Mirrored UP -> DOWN: falling candle Close below Major Low is S+.
const invert=bs=>bs.map(b=>bar(200-b.open,200-b.close,200-b.low,200-b.high));
const up=consume(seed('up',110,90),invert(falling));
assert.deepEqual(at(up,'cisd'),[6,8]);assert.deepEqual(at(up,'mss_weak'),[9]);
assert.deepEqual(at(up,'major_reversal'),[11]);
assert.equal(up.external.trend,'down');assert.equal(up.external.majorLow,null);
assert.equal(up.external.majorHigh.price,110);

// The two labels C/B are early or weak; neither changes main trend before S+.
for(const cutoff of [5,6,8,9,10]){
 const d0=consume(seed('down'),falling.slice(0,cutoff+1));
 assert.equal(d0.external.trend,'down',`premature reversal at bar ${cutoff}`);
}
// Replaying from scratch at a prefix never sees the future label.
for(let i=0;i<falling.length;i++){
 const s=consume(seed('down'),falling.slice(0,i+1));
 const fullAt=d.events.filter(e=>e.at<=i);
 assert.deepEqual(s.events,fullAt,`MSS/CISD no-lookahead at ${i}`);
}
// Numeric close-only fixtures continue to produce source-driven Major events,
// but must never fabricate C or B without full OHLC.
const n=seed('down');A.advance(n,0,112);
assert.deepEqual(at(n,'major_reversal'),[0]);assert.deepEqual(at(n,'cisd'),[]);assert.deepEqual(at(n,'mss_weak'),[]);

// Real 40- and 48-bar data: prefix history and state are fully causal.
const readCSV=filename=>{
 const rows=fs.readFileSync(filename,'utf8').trim().split(/\r?\n/).map(x=>x.split(','));
 const heads=rows.shift().map(x=>x.toLowerCase());
 return rows.map((vals,index)=>{
  const b={index};heads.forEach((h,j)=>{b[h]=['timestamp','time'].includes(h)?vals[j]:Number(vals[j]);});
  b.time=b.timestamp;return b;
 });
};
const root=path.resolve(__dirname,'..');
const totals=[];
for(const fname of ['BTCUSD_M15_sample.csv','XAUUSD_M15_10Hours.csv']){
 const candles=readCSV(path.join(root,'samples',fname));
 if(candles[0].open===undefined)throw Error('Bad sample parser');
 const full=A.analyzeAdvancedPrefix(candles,candles.length-1,E.analyzePrefix(candles,candles.length-1));
 for(let i=0;i<candles.length;i++){
  const a=A.analyzeAdvancedPrefix(candles,i,E.analyzePrefix(candles,i));
  assert.deepEqual(a.events,full.events.filter(e=>e.at<=i),`${fname} event prefix ${i}`);
  assert(a.events.every(e=>e.at<=i),`${fname} event in future`);
 }
 totals.push([fname,candles.length,full.events.filter(e=>e.kind==='cisd').length,full.events.filter(e=>e.kind==='mss_weak').length,full.events.filter(e=>e.kind==='major_reversal').length]);
}
for(const sym of ['BTCUSD','XAUUSD']){
 const candles=JSON.parse(fs.readFileSync(path.join(root,'samples/normalized',`${sym}_M15_12h_2025-06-18_UTC.json`))).candles;
 const all=A.analyzeAdvancedPrefix(candles,candles.length-1,E.analyzePrefix(candles,candles.length-1));
 for(let i=0;i<candles.length;i++){
  const a=A.analyzeAdvancedPrefix(candles.slice(0,i+1),i,E.analyzePrefix(candles.slice(0,i+1),i));
  assert.deepEqual(a.events,all.events.filter(e=>e.at<=i),`${sym} OHLC event prefix ${i}`);
  assert(a.events.every(e=>e.at<=i));
 }
 totals.push([sym,48,all.events.filter(e=>e.kind==='cisd').length,all.events.filter(e=>e.kind==='mss_weak').length,all.events.filter(e=>e.kind==='major_reversal').length]);
}
console.log('PASS REV S3-S8: S+ vs C vs B, zero tolerance, inverse symmetry, final cluster Open, no-lookahead');
for(const [name,bars,b,c,strong] of totals)console.log(`${name}: ${bars} bars; B=${b}, C=${c}, S+=${strong}`);
