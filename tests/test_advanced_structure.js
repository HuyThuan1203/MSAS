'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const A=require('../static/advanced_engine.js');const E=require('../static/engine.js');
const root=path.resolve(__dirname,'..');
const f=JSON.parse(fs.readFileSync(path.join(root,'fixtures/advanced_slide13_synthetic.json'),'utf8'));
const candles=Array.from({length:f.bars},(_,i)=>({index:i,time:new Date(Date.UTC(2025,5,18,6,i*15)).toISOString(),close:f.close_overrides[i]??f.default_close}));
function result(upto){return A.analysisFromAccepted(candles,f.pivots,upto);}
const observed=result(candles.length-1);
for(const original of f.expected){
 // V6 user amendment 2026-11-19: at 29, ML SL-25 -> retained SL-5 until a corrective SL after SH-27; at 34, old reversal -> no reversal without that active corrective ML.
 const x=original.at===29?{...original,major_low:'SL-5'}:original.at===34?{...original,external_trend:'up',major_low:'SL-5',event:null}:original;
 const state=result(x.at),ex=state.external,inn=state.internal,evAt=state.events.filter(e=>e.at===x.at);
 if(x.external_trend)assert.equal(ex.trend,x.external_trend,`major direction at ${x.at}`);
 if(x.internal_trend)assert.equal(inn.trend,x.internal_trend,`minor direction at ${x.at}`);
 if('internal_confirmed'in x)assert.equal(inn.confirmed,x.internal_confirmed,`pending at ${x.at}`);
 if('major_high'in x)assert.equal(ex.majorHigh?.id??null,x.major_high,`MH at ${x.at}`);
 if('major_low'in x)assert.equal(ex.majorLow?.id??null,x.major_low,`ML at ${x.at}`);
 if('protected_internal_high'in x)assert.equal(inn.protectedHigh?.id??null,x.protected_internal_high,`protected high at ${x.at}`);
 if('latest_internal_high'in x)assert.equal(inn.internalHigh?.id??null,x.latest_internal_high,`latest high at ${x.at}`);
 if(x.event)assert(evAt.some(e=>e.kind===x.event),`${x.event} missing at ${x.at}`);
}
assert(observed.events.some(e=>e.kind==='internal_confirmed'&&e.at>=25&&e.at<=27),'internal up confirmation absent');
assert(observed.roleChanges.some(e=>e.to==='historical_major'),'Major historical role ledger missing');
assert(observed.events.every(e=>e.at>=0&&e.at<candles.length));
// Replay prefix determinism, no future confirmed pivot.
for(let t=0;t<candles.length;t++){
 const s=result(t),trim=A.analysisFromAccepted(candles.slice(0,t+1),f.pivots.filter(p=>p.structConfirmedAt<=t));
 assert.deepEqual(s.events,trim.events,`lookahead events at t=${t}`);
 assert.deepEqual(s.external,trim.external,`lookahead Major at t=${t}`);
 assert.deepEqual(s.internal,trim.internal,`lookahead Internal at t=${t}`);
}
// Slide 7: a wick breach is NOT a structure reversal without a CLOSE past the level.
const baseCandles=candles.slice(0,25).map(x=>({...x}));
const at24=A.analysisFromAccepted(baseCandles,f.pivots,24);
assert.equal(at24.external.trend,'up');
// Test new dataset input against original engine, independent of source symbol.
for(const symbol of ['BTCUSD','XAUUSD']){
 const file=path.join(root,'samples','normalized',`${symbol}_M15_12h_2025-06-18_UTC.json`);
 const c=JSON.parse(fs.readFileSync(file,'utf8')).candles;
 assert.equal(c.length,48);
 for(let t=0;t<c.length;t++){
  const b=E.analyzePrefix(c,t),adv=A.analyzeAdvancedPrefix(c,t,b);
  assert.equal(adv.end,t);
  assert(adv.events.every(e=>e.at<=t));
  for(const pivot of b.confirmed)assert(pivot.structConfirmedAt<=t);
  if(t===c.length-1){
   console.log(symbol,JSON.stringify({swing:b.summary,rawTrend:b.trend,external:adv.external,internal:adv.internal,events:adv.events.length}));
  }
 }
}

// Symmetry: project rules must behave consistently for down->up after price inversion.
const mirror=(p)=>({id:p.id.replace(/^SH/,'TEMP').replace(/^SL/,'SH').replace(/^TEMP/,'SL'),
 type:p.type==='SH'?'SL':'SH',index:p.index,price:220-p.price,structConfirmedAt:p.structConfirmedAt});
const mirrored=f.pivots.map(mirror);
const flipped=candles.map(x=>({...x,close:220-x.close}));
const md=(i)=>A.analysisFromAccepted(flipped,mirrored,i);
assert.equal(md(9).external.trend,'down');
assert.equal(md(19).external.trend,'down');
assert.equal(md(19).internal.trend,'up');
assert.equal(md(21).internal.protectedLow?.id,'SL-15');
assert(md(23).events.some(e=>e.at===23&&e.kind==='internal_reversal'));
assert(md(28).events.some(e=>e.at===28&&e.kind==='major_continuation'));
// V6 round-2 invariant 2026-11-19: the former SH-25 assignment at 29 was
// already Close-violated (113 > 108). The latest valid corrective is SH-21
// at 114, so Close 111 at 34 is not an S+; the false reversal is removed.
assert.equal(md(34).external.trend,'down');
assert.equal(md(34).external.majorLow?.id,'SL-27');
assert.equal(md(34).external.majorHigh?.id,'SH-21');
assert(!md(34).events.some(e=>e.at===34&&e.kind==='major_reversal'));
// A wick-only excursion or exact boundary touch is not a Major close break.
const wickOnly=candles.map(x=>({...x}));wickOnly[28].high=145;wickOnly[28].close=124;
assert(!A.analysisFromAccepted(wickOnly,f.pivots,28).events.some(e=>e.at===28&&e.kind==='major_continuation'));
const equality=candles.map(x=>({...x}));equality[28].close=125;
assert(!A.analysisFromAccepted(equality,f.pivots,28).events.some(e=>e.at===28&&e.kind==='major_continuation'));
// Full-run event history must reproduce every known prior prefix on market samples.
for(const symbol of ['BTCUSD','XAUUSD']){
 const data=JSON.parse(fs.readFileSync(path.join(root,'samples/normalized',`${symbol}_M15_12h_2025-06-18_UTC.json`),'utf8')).candles;
 const complete=A.analyzeAdvancedPrefix(data,data.length-1,E.analyzePrefix(data));
 for(let t=0;t<data.length;t++){
  const prefix=A.analyzeAdvancedPrefix(data,t,E.analyzePrefix(data,t));
  assert.deepEqual(prefix.events,complete.events.filter(e=>e.at<=t),`Full vs prefix mismatch ${symbol}@${t}`);
 }
}
console.log('PASS advanced PPT synthetic role fixtures + 36 prefix checks + both 48-bar datasets no-lookahead');
