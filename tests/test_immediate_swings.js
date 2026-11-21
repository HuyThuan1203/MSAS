'use strict';
/* Closed-bar swing confirmation (user rule 2026-11-21):
 * - a swing is confirmed at the right candle, without waiting for an opposite swing;
 * - if the right candle is an Inside Bar of the center (center = mother), the
 *   swing is only known when a later candle BREAKS the mother range, and only
 *   valid if that breakout does not exceed the swing extreme;
 * - SH/SL alternate causally: a weaker same-type swing is ignored, a stronger
 *   one supersedes the previous AT its own confirmation candle (no repaint).
 */
const assert=require('node:assert/strict');
const E=require('../static/engine.js');
const A=require('../static/advanced_engine.js');
function bars(rows){return rows.map(([high,low],i)=>({time:'2026-11-19T'+String(i).padStart(2,'0')+':00:00Z',open:(high+low)/2,high,low,close:(high+low)/2}));}
const ids=out=>out.confirmed.map(p=>p.id);
// Right candle is NOT inside: confirmed at the right candle.
{
 const data=bars([[10,5],[12,6],[11,4]]);
 assert.equal(E.analyzePrefix(data,1).confirmed.length,0,'no lookahead');
 const out=E.analyzePrefix(data,2);
 assert.deepEqual(ids(out),['SH-1'],'swing must not wait for opposite pivot');
 assert.equal(out.confirmed[0].structConfirmedAt,2);
}
{
 const out=E.analyzePrefix(bars([[10,5],[9,3],[11,4]]));
 assert.deepEqual(ids(out),['SL-1']);
 assert.equal(out.confirmed[0].structConfirmedAt,2);
}
// Right candle is an Inside Bar: nothing is known until the ISB is broken.
{
 const data=bars([[10,5],[12,6],[11,7],[11.5,6.5],[9,4]]);
 for(const t of [2,3]){
  const out=E.analyzePrefix(data,t);
  assert.equal(out.confirmed.length,0,'SH shown before ISB breakout @'+t);
  assert(!out.swings.some(s=>s.index===1),'no premature candidate @'+t);
  assert(!out.events.some(e=>e.kind==='swing'),'no premature swing event @'+t);
 }
 const out=E.analyzePrefix(data,4);
 assert.deepEqual(ids(out),['SH-1'],'ISB broken downward validates SH');
 assert.equal(out.confirmed[0].structConfirmedAt,4);
 assert.equal(out.confirmed[0].isbBreakAt,4);
}
// ISB broken upward: the center was never a top.
{
 const out=E.analyzePrefix(bars([[10,5],[12,6],[11,7],[13,8]]));
 const sh=out.swings.find(s=>s.id==='SH-1');
 assert.equal(sh.status,'isb_rejected');
 assert(!ids(out).includes('SH-1'));
}
// Symmetric SL: ISB broken upward validates, downward rejects.
{
 const ok=E.analyzePrefix(bars([[10,5],[9,3],[8,4],[12,6]]));
 assert.deepEqual(ids(ok),['SL-1']);assert.equal(ok.confirmed[0].structConfirmedAt,3);
 const bad=E.analyzePrefix(bars([[10,5],[9,3],[8,4],[8.5,2]]));
 assert.equal(bad.swings.find(s=>s.id==='SL-1').status,'isb_rejected');
}
// Left neighbour inside a mother: compare with the mother's range.
{
 // candle 2 is inside mother 1 (high 12); candle 3 breaks below with high 11.5 < 12 -> not an SH.
 const out=E.analyzePrefix(bars([[10,5],[12,6],[11,7],[11.5,4],[10,3]]));
 assert(!out.swings.some(s=>s.id==='SH-3'),'lower high than the mother is not a swing high');
}
// Falling leg with no SL between: a lower SH is ignored (never shown as structure).
{
 const out=E.analyzePrefix(bars([[10,5],[14,6],[13,5.5],[13.5,5.2],[12,5.0]]));
 assert.deepEqual(ids(out),['SH-1']);
 assert.equal(out.swings.find(s=>s.id==='SH-3').structStatus,'ignored');
}
// Higher SH with no SL between supersedes the previous one at ITS confirmation time.
{
 const data=bars([[10,5],[12,6],[11,5.5],[14,5],[13,4]]);
 const early=E.analyzePrefix(data,3);
 assert.deepEqual(ids(early),['SH-1'],'earlier prefix keeps SH-1');
 const out=E.analyzePrefix(data,4);
 assert.deepEqual(ids(out),['SH-3']);
 const old=out.swings.find(s=>s.id==='SH-1');
 assert.equal(old.structStatus,'superseded');assert.equal(old.supersededAt,4);
 assert.deepEqual(out.accepted.map(p=>p.id),['SH-1','SH-3'],'causal acceptance log keeps history');
}
// Major rolls on the candle that confirms a swing outside the active range:
// MH -> new SH, ML -> the SL immediately preceding that SH.
{
 const s=A.makeState();
 s.external={trend:'up',phase:'confirmed',majorHigh:{id:'SH-0',index:0,type:'SH',price:110,confirmedAt:0},
   majorLow:{id:'SL-0',index:0,type:'SL',price:100,confirmedAt:0},breakAt:null,breakLevel:null};
 A.advance(s,0,{open:105,high:106,low:104,close:105});
 A.advance(s,1,{open:105,high:106,low:102,close:103});
 A.advance(s,2,{open:103,high:107,low:103,close:106},[{id:'SL-1',index:1,type:'SL',price:102,structConfirmedAt:2}]);
 assert.equal(s.external.majorLow.id,'SL-0','SL inside the range is internal only');
 A.advance(s,3,{open:106,high:112,low:105,close:109});
 A.advance(s,4,{open:109,high:110,low:107,close:108},[{id:'SH-3',index:3,type:'SH',price:112,structConfirmedAt:4}]);
 assert.deepEqual([s.external.majorHigh.id,s.external.majorLow.id],['SH-3','SL-1'],'immediate roll without Close beyond MH');
 assert(s.events.some(e=>e.at===4&&e.kind==='major_updated'));
}
console.log('immediate swing + ISB breakout + causal alternation + immediate Major roll: PASS');
