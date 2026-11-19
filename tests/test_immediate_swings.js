'use strict';
const assert=require('node:assert/strict');
const E=require('../static/engine.js');
function bars(rows){return rows.map(([high,low],i)=>({time:'2026-11-19T'+String(i).padStart(2,'0')+':00:00Z',open:(high+low)/2,high,low,close:(high+low)/2}));}
{
 const data=bars([[10,5],[12,6],[11,7]]);
 assert.equal(E.analyzePrefix(data,1).confirmed.length,0,'no lookahead');
 const out=E.analyzePrefix(data,2);
 assert.equal(out.confirmed.length,1,'swing must not wait for opposite pivot');
 assert.equal(out.confirmed[0].type,'SH');
 assert.equal(out.confirmed[0].structConfirmedAt,2);
 assert.equal(typeof out.confirmed[0].id,'string');
}
{
 const out=E.analyzePrefix(bars([[10,5],[9,3],[11,4]]));
 assert.equal(out.confirmed.length,1);
 assert.equal(out.confirmed[0].type,'SL');
 assert.equal(out.confirmed[0].structConfirmedAt,2);
}
console.log('immediate swing closed-bar regression: PASS');
