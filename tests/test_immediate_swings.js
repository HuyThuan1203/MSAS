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
// Codex review P1: delayed ISB confirmation accepts an EQUAL extreme on the breakout candle.
{
 const out=E.analyzePrefix([{open:6,high:9,low:4,close:7},{open:7,high:10,low:5,close:8},{open:8,high:9,low:6,close:7},{open:7,high:10,low:4,close:5}]
   .map((c,i)=>({...c,time:'2026-11-21T0'+i+':00:00Z'})));
 assert.deepEqual(ids(out),['SH-1']);assert.equal(out.confirmed[0].structConfirmedAt,3);
}
// Codex review P0: a pair that becomes active on THIS candle is checked against THIS Close.
{
 const rows=[[98.6,99.0,94.9,98.2],[99.2,110.5,94.9,99.4],[98.1,108.4,89.6,106.7],[110.1,118.4,103.2,108.1],
   [106.2,115.0,96.4,102.0],[104.6,110.4,100.7,109.2],[112.1,119.0,101.1,101.3],[98.9,99.4,93.6,93.7]];
 const data=rows.map(([open,high,low,close],i)=>({time:'2026-11-21T0'+i+':00:00Z',open,high,low,close}));
 const base=E.analyzePrefix(data,6),s=A.makeState();
 // Seed Main UP like the trace (MH SH-3 118.4, ML SL-2 89.6) and replay causal swings.
 const grouped=new Map();for(const p of base.accepted){if(!grouped.has(p.structConfirmedAt))grouped.set(p.structConfirmedAt,[]);grouped.get(p.structConfirmedAt).push(p);}
 for(let t=0;t<=6;t++)A.advance(s,t,data[t],grouped.get(t)||[]);
 s.external={trend:'up',phase:'confirmed',majorHigh:{id:'SH-3',index:3,type:'SH',price:118.4,confirmedAt:4},
   majorLow:{id:'SL-2',index:2,type:'SL',price:89.6,confirmedAt:3},breakAt:null,breakLevel:null};
 A.advance(s,7,data[7],[{id:'SH-6',index:6,type:'SH',price:119,structConfirmedAt:7}]);
 assert.equal(s.external.trend,'down','Close 93.7 < newly active ML 96.4 must be S+');
 assert.equal(s.external.majorHigh.price,119);assert.equal(s.external.majorLow,null);
 assert(!s.events.some(e=>e.at===7&&(e.kind==='cisd'||e.kind==='mss_weak')),'S+ withdraws same-candle B/C');
}
// Codex review P1: a base without the causal `accepted` log is recomputed, never replayed from `confirmed`.
{
 const data=bars([[10,5],[12,6],[11,5.5],[14,5],[13,4]]);
 const full=E.analyzePrefix(data);
 assert.equal(A.analyzeAdvancedPrefix(data,2,{confirmed:full.confirmed}).acceptedCount,1);
}
// Codex review P2: invalid input throws BEFORE mutating reusable state.
{
 const s=A.makeState();
 assert.throws(()=>A.advance(s,1,{close:100}));
 assert.equal(s.closed.length,0);A.advance(s,0,{close:100});assert.equal(s.closed.length,1);
}
// Codex review P2: wick through MH with Close exactly ON MH is a C, not S+.
{
 const s=A.makeState();
 s.external={trend:'down',phase:'confirmed',majorHigh:{id:'SH-m',index:0,type:'SH',price:110,confirmedAt:0},
   majorLow:{id:'SL-m',index:0,type:'SL',price:90,confirmedAt:0},breakAt:null,breakLevel:null};
 A.advance(s,0,{open:108,high:112,low:107,close:110});
 assert.equal(s.external.trend,'down');assert(s.events.some(e=>e.kind==='mss_weak'));
}
console.log('immediate swing + ISB breakout + causal alternation + immediate Major roll + Codex review regressions: PASS');
