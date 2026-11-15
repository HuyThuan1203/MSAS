/* MSAS canonical chart palette — independent of the surrounding dark UI.
 * All opacity values use 0..1. Do not introduce canvas gridlines.
 */
(function(root,factory){
 const theme=factory();
 if(typeof module==='object' && module.exports)module.exports=theme;
 root.MSASChartTheme=theme;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 return Object.freeze({
  background:'#c6d2df',
  grid:false,
  candles:Object.freeze({
   up:Object.freeze({body:'#ffffff',bodyOpacity:1,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1}),
   down:Object.freeze({body:'#66bb6a',bodyOpacity:.9,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1})
  })
 });
});
