'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const E=require('../static/engine.js'),A=require('../static/advanced_engine.js');
const dir=path.resolve(__dirname,'..');
const c=JSON.parse(fs.readFileSync(path.join(dir,'samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json'),'utf8')).candles;
const run=t=>A.analyzeAdvancedPrefix(c,t,E.analyzePrefix(c,t));
const final=run(47),hi=final.external.majorHigh,low=final.external.majorLow;
assert.equal(final.external.trend,'up');assert.equal(final.internal.trend,'up');
assert.deepEqual([hi?.id,hi?.index,hi?.price],['SH-34',34,3396.648]);
assert.deepEqual([low?.id,low?.index,low?.price],['SL-37',37,3373.545]);
assert.equal(c[hi.index].time,'2025-06-18T14:30:00Z');
assert.equal(c[low.index].time,'2025-06-18T15:15:00Z');
assert(hi.confirmedAt<=47&&low.confirmedAt<=47);
for(let t=0;t<c.length;t++){
 const a=run(t);
 for(const pp of [a.external.majorHigh,a.external.majorLow].filter(Boolean))assert(pp.confirmedAt<=t,'Future Major on chart');
 assert.deepEqual(a.events,final.events.filter(e=>e.at<=t),`Event lookahead ${t}`);
 if(t<hi.confirmedAt)assert.notEqual(a.external.majorHigh?.id,hi.id,'SH-34 promoted too early');
 if(t<low.confirmedAt)assert.notEqual(a.external.majorLow?.id,low.id,'SL-37 promoted too early');
}
assert.equal(final.policy.tolerance,0);
console.log('PASS user-confirmed XAU MH SH-34 3396.648 / ML SL-37 3373.545; causal pivot labels');
