/* Source-locked Close/MSS; provisional rolling Major policy.
 * Regressions from user screenshots: XAU40 closed bar #25 (21:00 UTC)
 * and user-annotated 48-bar XAU MH/ML. Inputs are original sample CSVs.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../static/engine.js'),A=require('../static/advanced_engine.js');
const ROOT=path.resolve(__dirname,'..');
const raw=fs.readFileSync(path.join(ROOT,'samples/XAUUSD_M15_10Hours.csv'),'utf8').trim().split(/\r?\n/);
const header=raw.shift().split(',').map(s=>s.toLowerCase());
const sample40=raw.map((line,index)=>{const cells=line.split(',');const o={index};header.forEach((h,i)=>{o[h]=h==='timestamp'?cells[i]:Number(cells[i])});o.time=o.timestamp;return o});
const fixture48=JSON.parse(fs.readFileSync(path.join(ROOT,'samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json'),'utf8')).candles;
function state(data,t){return A.analyzeAdvancedPrefix(data,t,E.analyzePrefix(data,t))}
function active(e){return [e.majorHigh?.id??null,e.majorHigh?.price??null,e.majorLow?.id??null,e.majorLow?.price??null]}
assert.equal(sample40.length,40);
// The previous Major low is assigned at bar 16 (index 15), when Close
// already falls below 3995.80: no artificial *second* crossing is required.
assert.equal(sample40[15].close,3995.2);
assert.deepEqual(active(state(sample40,15).external),['SH-9',4013.4,'SL-12',3995.8]);
// User rule 2026-11-21: Major updates on the SAME candle that confirms a swing
// outside it (no delay). SL-17 is confirmed at index 18 -> ML SL-17, MH SH-14.
assert.deepEqual(active(state(sample40,17).external),['SH-9',4013.4,'SL-12',3995.8]);
const rolled=state(sample40,18);
assert.equal(rolled.external.trend,'down');
assert.deepEqual(active(rolled.external),['SH-14',4001.5,'SL-17',3991.1]);
assert(rolled.events.some(e=>e.kind==='major_updated'&&e.at===18&&e.refs.includes('SL-17')));
// SL-21=3991.0 (below ML 3991.1): its right candle
// 22 is an Inside Bar, so it is only known when 23 breaks the mother range.
assert.deepEqual(active(state(sample40,22).external),['SH-14',4001.5,'SL-17',3991.1]);
const at23=state(sample40,23);
assert.deepEqual(active(at23.external),['SH-18',3996.5,'SL-21',3991.0]);
assert(at23.events.some(e=>e.kind==='major_updated'&&e.at===23));
const screenshot=state(sample40,24); // 25 / 40 at 21:00 screenshot
assert.equal(sample40[24].time.slice(11,16),'21:00');
assert.equal(screenshot.external.trend,'down');
assert.deepEqual(active(screenshot.external),['SH-18',3996.5,'SL-21',3991.0]);
// The annotated 48-bar sample keeps MH SH-34 / ML SL-37. With immediate
// updates, SH-34 makes ML = SL-31 (3384.648) at index 35; Close 3382.348 at
// index 37 is strictly below it -> S+ DOWN, MH SH-34 retained; SL-37 becomes
// ML when it is confirmed at index 38, never earlier.
const at35=state(fixture48,35),at37=state(fixture48,37),at38=state(fixture48,38),end48=state(fixture48,47);
assert.deepEqual(active(at35.external),['SH-34',3396.648,'SL-31',3384.648]);
assert.equal(at37.external.trend,'down');assert.equal(at37.external.majorLow,null);
assert.deepEqual(active(at38.external),['SH-34',3396.648,'SL-37',3373.545]);
assert.deepEqual(active(end48.external),['SH-34',3396.648,'SL-37',3373.545]);
assert.equal(end48.external.trend,'down');
// Deterministic no-lookahead of *both* Major values and event timing.
for(const [name,bars] of [['XAU40',sample40],['XAU48',fixture48]]){
 const full=state(bars,bars.length-1);
 for(let i=0;i<bars.length;i++){
  const x=state(bars.slice(0,i+1),i);
  assert.deepEqual(x.events,full.events.filter(e=>e.at<=i),`${name} event history @${i}`);
  assert.deepEqual(x.roleChanges,full.roleChanges.filter(e=>e.at<=i),`${name} role history @${i}`);
  for(const pp of [x.external.majorHigh,x.external.majorLow])if(pp)assert(pp.confirmedAt<=i,`${name}: future Major @${i}`);
 }
}
// MSS S+ is evaluated by the Close vs active Major without an extra prior
// Close-cross requirement. Equality does NOT trigger; C alone doesn't switch.
function seed(trend,hi=110,lo=90){const s=A.makeState();s.external={trend,phase:'confirmed',majorHigh:{id:'SH-m',index:0,type:'SH',price:hi,confirmedAt:0},majorLow:{id:'SL-m',index:0,type:'SL',price:lo,confirmedAt:0},breakAt:null,breakLevel:null};return s}
const s=seed('down');A.advance(s,0,{open:107,high:111,low:106,close:108});assert.equal(s.external.trend,'down');
A.advance(s,1,{open:110,high:112,low:109,close:110});assert.equal(s.external.trend,'down');
A.advance(s,2,{open:111,high:114,low:109,close:111});assert.equal(s.external.trend,'up');
assert(s.events.some(e=>e.kind==='major_reversal'&&e.at===2&&e.data.label==='S+'));
const up=seed('up');A.advance(up,0,{open:92,high:93,low:88,close:91});
A.advance(up,1,{open:90,high:91,low:88,close:90});assert.equal(up.external.trend,'up');
A.advance(up,2,{open:90,high:91,low:86,close:88});assert.equal(up.external.trend,'down');
assert.equal(A.MSS_TOLERANCE,0);
console.log('PASS screenshot XAU40 Major rolls at confirmed LL, XAU48 annotated pivots, Close MSS, 80 prefix histories');
