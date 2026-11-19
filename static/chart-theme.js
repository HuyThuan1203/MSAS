/* MSAS canonical chart palette — independent of the surrounding dark UI.
 * All opacity values use 0..1. Do not introduce canvas gridlines.
 * V6 user amendment 2026-11-19: the same tokens are also exported as
 * TradingView Lightweight Charts options (`lightweight`), derived from the
 * canonical `candles` values so the palette has one source of truth.
 */
(function(root,factory){
 const theme=factory();
 if(typeof module==='object' && module.exports)module.exports=theme;
 root.MSASChartTheme=theme;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const rgba=(hex,alpha)=>{
  const m=/^#([0-9a-f]{6})$/i.exec(hex);
  if(!m)throw Error('Expected #rrggbb colour: '+hex);
  const n=parseInt(m[1],16);
  return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+alpha+')';
 };
 const background='#c6d2df';
 const candles=Object.freeze({
  up:Object.freeze({body:'#ffffff',bodyOpacity:1,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1}),
  down:Object.freeze({body:'#66bb6a',bodyOpacity:.9,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1})
 });
 const lightweight=Object.freeze({
  layout:Object.freeze({background:Object.freeze({type:'solid',color:background}),textColor:'#243746'}),
  // Grid is intentionally hidden (hard requirement).
  grid:Object.freeze({vertLines:Object.freeze({visible:false}),horzLines:Object.freeze({visible:false})}),
  series:Object.freeze({
   upColor:rgba(candles.up.body,candles.up.bodyOpacity),
   downColor:rgba(candles.down.body,candles.down.bodyOpacity),
   borderUpColor:rgba(candles.up.border,candles.up.borderOpacity),
   borderDownColor:rgba(candles.down.border,candles.down.borderOpacity),
   wickUpColor:rgba(candles.up.wick,candles.up.wickOpacity),
   wickDownColor:rgba(candles.down.wick,candles.down.wickOpacity),
   borderVisible:true,wickVisible:true
  }),
  structure:Object.freeze({major:'#1c529a',majorLow:'#00745a',internal:'#926029',sh:'#2859aa',sl:'#0b7866',reject:'#7d8b97',up:'#047760',down:'#b73c52',diag:'#7a5a1f'})
 });
 return Object.freeze({background,grid:false,candles,rgba,lightweight});
});
