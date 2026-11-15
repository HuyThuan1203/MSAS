'use strict';
/* Structural role regression: reference levels are anchored to confirmed
 * extreme pivots and MUST NOT silently jump to a later weaker swing.
 * Values are derived from supplied 48-bar samples under documented V5
 * provisional selection policy, not claimed as user-certified ground truth.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=require('../static/engine.js');
const advanced=require('../static/advanced_engine.js');
const root=path.resolve(__dirname,'..');
function load(s){return JSON.parse(fs.readFileSync(path.join(root,'samples/normalized',`${s}_M15_12h_2025-06-18_UTC.json`),'utf8')).candles;}
const xau=load('XAUUSD');
function snap(c,t){return advanced.analyzeAdvancedPrefix(c,t,base.analyzePrefix(c,t));}
const before=snap(xau,42),breach=snap(xau,43),complete=snap(xau,47);
assert.equal(before.external.majorHigh.id,'SH-30');
assert.equal(before.external.majorLow.id,'SL-27');
// Slide 11/13: after a close-break the strongest accepted pivot in the
// pending wave wins; a weaker, later SH44 must NOT demote SH34.
for(const x of [breach,complete]){
 assert.equal(x.external.trend,'up');
 assert.equal(x.external.majorHigh.id,'SH-34');
 assert.equal(x.external.majorHigh.price,3396.648);
 assert.equal(x.external.majorLow.id,'SL-37');
 assert.equal(x.external.majorLow.price,3373.545);
}
assert.equal(breach.internal.trend,'unknown');
assert.equal(complete.internal.trend,'up');
assert(complete.events.some(e=>e.kind==='internal_established'&&e.at===46));
assert(breach.events.some(e=>e.kind==='major_continuation'&&e.at===43));
assert(breach.events.some(e=>e.kind==='major_updated'&&e.at===43&&e.refs.includes('SH-34')));
assert(!complete.events.some(e=>e.kind==='major_updated'&&e.at>=44));
for(let t=0;t<xau.length;t++){
 const s=snap(xau,t);
 for(const p of [s.external.majorHigh,s.external.majorLow,s.internal.internalHigh,s.internal.internalLow]){
  if(!p)continue;
  assert(p.confirmedAt<=t,`future pivot promoted at ${t}: ${p.id}`);
  assert(p.index<t,`right-hand close not yet known at ${t}: ${p.id}`);
 }
 const truncated=snap(xau.slice(0,t+1),t);
 assert.deepEqual(s.external,truncated.external,`no-lookahead external @ ${t}`);
 assert.deepEqual(s.internal,truncated.internal,`no-lookahead internal @ ${t}`);
}
const fixture=JSON.parse(fs.readFileSync(path.join(root,'fixtures/advanced_slide13_synthetic.json'),'utf8'));
const candles=Array.from({length:fixture.bars},(_,i)=>({time:new Date(Date.UTC(2025,5,18,6,i*15)).toISOString(),close:fixture.close_overrides[i]??fixture.default_close}));
const at=i=>advanced.analysisFromAccepted(candles,fixture.pivots,i).external;
assert.equal(at(9).majorHigh.id,'SH-7');assert.equal(at(9).majorLow.id,'SL-5');
assert.equal(at(19).majorHigh.id,'SH-7');assert.equal(at(19).majorLow.id,'SL-5');
assert.equal(at(29).majorHigh.id,'SH-27');assert.equal(at(29).majorLow.id,'SL-25');
assert.equal(at(34).trend,'down');assert.equal(at(34).majorHigh.id,'SH-27');assert.equal(at(34).majorLow,null);
const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
for(const id of ['majorDirection','internalDirection','feedMajorTrend','feedInternalTrend','feedMajorHigh','feedMajorLow','feedInternalHigh','feedInternalLow']){
 assert(html.includes(`id="${id}"`),`Missing visible structure state ${id}`);
}
const i18n=require('../static/i18n.js');
for(const l of ['en','vi']){
 for(const key of ['majorLabel','internalLabel','currentStatus','notConfirmed','majorHighLabel','majorLowLabel']){
  assert(i18n.text(key,l)!==key,`Missing ${l} translation for ${key}`);
 }
}
console.log('PASS Major/Internal state readout; XAU strongest accepted SH34/SL37, 48 prefixes and PPT slide 13 reference');
