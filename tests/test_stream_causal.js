'use strict';
/* Real-data causality gate: the 4 bundled datasets are real market candles.
 * Each is replayed candle by candle like the live feed. The gate must also be
 * able to FAIL: re-introducing the old repaint bug (advanced replay from the
 * final swing path instead of the causal acceptance log) has to be caught.
 */
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const {check,load}=require('../scripts/live_causal_check.js');
const E=require('../static/engine.js');
const samples=['samples/BTCUSD_M15_sample.csv','samples/XAUUSD_M15_10Hours.csv',
 'samples/normalized/BTCUSD_M15_12h_2025-06-18_UTC.json','samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json'];
const log=console.log;console.log=()=>{};
try{
 for(const s of samples)assert.equal(check(s,load(path.join(ROOT,s)),400),true,s);
 // Negative fixture: XAU40 contains a superseded swing; feeding the final path
 // as if it were the history must be detected as lookahead.
 const original=E.analyzePrefix;
 E.analyzePrefix=(c,t)=>{const r=original(c,t);r.accepted=r.confirmed;return r;};
 try{assert.equal(check('xau40-repaint',load(path.join(ROOT,samples[1])),400),false,'gate failed to detect repaint');}
 finally{E.analyzePrefix=original;}
}finally{console.log=log;}
console.log('PASS real-data stream causality on 4 datasets; repaint negative fixture detected');
