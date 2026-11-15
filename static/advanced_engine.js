/* Advanced structure overlay V1: major/external and minor/internal structural roles.
 * Sources: Cau_truc_nang_cao_-_Final.pptx slides 3-14.
 * This module consumes pre-confirmed alternating pivots from engine.js and CLOSED candles.
 * It does not alter raw 3-bar pivot detection, mother zones, or their audit semantics.
 * Assumptions which are not fully specified by slides are documented in docs/advanced/.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AdvancedStructureEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VALID_TRENDS=new Set(['unknown','up','down']);
const level=p=>p?{id:p.id,index:p.index,type:p.type,price:p.price,confirmedAt:p.structConfirmedAt??p.confirmedAt??null}:null;
const latest=(pivots,type)=>{for(let i=pivots.length-1;i>=0;i--)if(pivots[i].type===type)return pivots[i];return null;};
const earlierOpposite=(pivots,p)=>{for(let i=pivots.length-1;i>=0;i--){const q=pivots[i];if(q.type!==p.type&&q.index<p.index)return q;}return null;};
function pairTrend(pivots){
 const hs=pivots.filter(p=>p.type==='SH'),ls=pivots.filter(p=>p.type==='SL');
 if(hs.length<2||ls.length<2)return 'unknown';
 const H=hs.at(-1).price-hs.at(-2).price,L=ls.at(-1).price-ls.at(-2).price;
 if(H>0&&L>0)return 'up';if(H<0&&L<0)return 'down';return 'unknown';
}
function makeState(){return {
 at:-1,previousClose:null,history:[],events:[],roleChanges:[],
 external:{trend:'unknown',phase:'uninitialized',majorHigh:null,majorLow:null,breakAt:null,breakLevel:null},
 internal:{trend:'unknown',phase:'uninitialized',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:false},
 segmentStart:-1
};}
function log(s,at,kind,layer,title,detail,refs=[],source='ADV:S14',severity='info',data=null){
 const ev={id:`${kind}:${at}:${s.events.length}`,at,kind,layer,title,detail,severity,source,refs,data};
 s.events.push(ev);return ev;
}
function changeRole(s,at,p,from,to,reason){if(!p)return; s.roleChanges.push({at,pivot_id:p.id,pivot_index:p.index,from,to,reason});}
function clearInternal(s){s.internal={trend:'unknown',phase:'collecting',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:false};}
function validInternalPivots(s){
 const ext=s.external;
 if(!ext.majorHigh||!ext.majorLow)return [];
 const lo=ext.majorLow.price,hi=ext.majorHigh.price;
 return s.history.filter(p=>p.index>s.segmentStart && p.price>=lo && p.price<=hi);
}
function protectedLevel(pivots,direction){
 // A local downtrend reverses against the HIGH preceding the latest genuine LL.
 // It is not necessarily the latest SH (slide 13: point 12 must break 8, not 10).
 // Symmetric for an uptrend: use the low preceding its latest HH.
 const kind=direction==='down'?'SL':'SH',reverse=direction==='down'?'SH':'SL';
 const same=pivots.filter(p=>p.type===kind);
 if(same.length<2)return null;
 for(let i=same.length-1;i>0;i--){
  const progressed=direction==='down'?same[i].price<same[i-1].price:same[i].price>same[i-1].price;
  if(!progressed)continue;
  const before=pivots.filter(p=>p.type===reverse && p.index<same[i].index).at(-1);
  if(before)return level(before);
 }
 return null;
}
function refreshInternal(s,at){
 const set=validInternalPivots(s),prevHigh=s.internal.internalHigh,prevLow=s.internal.internalLow;
 s.internal.internalHigh=level(latest(set,'SH'));
 s.internal.internalLow=level(latest(set,'SL'));
 if(prevHigh?.id!==s.internal.internalHigh?.id){
  if(prevHigh)changeRole(s,at,prevHigh,'internal_sh','historical_swing','newer_internal_high');
  if(s.internal.internalHigh)changeRole(s,at,s.internal.internalHigh,'confirmed_swing','internal_sh','latest_internal_high');
 }
 if(prevLow?.id!==s.internal.internalLow?.id){
  if(prevLow)changeRole(s,at,prevLow,'internal_sl','historical_swing','newer_internal_low');
  if(s.internal.internalLow)changeRole(s,at,s.internal.internalLow,'confirmed_swing','internal_sl','latest_internal_low');
 }
 const direction=pairTrend(set);
 // Protected levels are retained through a pullback. A weaker intermediate high
 // does not supersede the high protecting the last lower low (ADV slide 13).
 if(s.internal.trend==='down')s.internal.protectedHigh=protectedLevel(set,'down');
 if(s.internal.trend==='up')s.internal.protectedLow=protectedLevel(set,'up');
 if(s.internal.pendingDirection){
  const newHigh=latest(set,'SH'),newLow=latest(set,'SL');
  const confirmedSequence=s.internal.pendingDirection==='up' ?
    (newHigh && newLow && newHigh.index>=s.internal.pendingBreakAt && newLow.index>newHigh.index) :
    (newLow && newHigh && newLow.index>=s.internal.pendingBreakAt && newHigh.index>newLow.index);
  if(direction===s.internal.pendingDirection && confirmedSequence){
   s.internal.trend=direction;s.internal.confirmed=true;s.internal.phase='confirmed';
   s.internal.protectedHigh=protectedLevel(set,'down');s.internal.protectedLow=protectedLevel(set,'up');
   s.internal.pendingDirection=null;s.internal.pendingBreakAt=null;
   log(s,at,'internal_confirmed','internal','Internal '+(direction==='up'?'TĂNG':'GIẢM')+' đã xác nhận',
      'Cặp HH+HL hoặc LH+LL của các Swing Internal đã xác nhận hướng mới.',
      [s.internal.internalHigh?.id,s.internal.internalLow?.id].filter(Boolean),'ADV:S13-14','success',{direction});
  }
 }else if(s.internal.trend==='unknown'&&direction!=='unknown'){
  s.internal.trend=direction;s.internal.confirmed=true;s.internal.phase='confirmed';
  s.internal.protectedHigh=protectedLevel(set,'down');s.internal.protectedLow=protectedLevel(set,'up');
  log(s,at,'internal_established','internal','Nhận diện Internal '+(direction==='up'?'TĂNG':'GIẢM'),
      'Các Swing nằm trong biên Major đáp ứng '+(direction==='up'?'HH+HL':'LH+LL')+'; không thay đổi xu hướng Major.',
      [s.internal.internalHigh?.id,s.internal.internalLow?.id].filter(Boolean),'ADV:S6-7','info',{direction});
 }
}
function setMajor(s,at,trend,high,low,reason){
 const e=s.external;
 if(e.majorHigh&&e.majorHigh.id!==high?.id)changeRole(s,at,e.majorHigh,'major_high','historical_major','major_rolled');
 if(e.majorLow&&e.majorLow.id!==low?.id)changeRole(s,at,e.majorLow,'major_low','historical_major','major_rolled');
 e.trend=trend;e.phase='confirmed';e.majorHigh=level(high);e.majorLow=level(low);e.breakAt=null;e.breakLevel=null;
 if(high)changeRole(s,at,high,'confirmed_swing','major_high',reason);
 if(low)changeRole(s,at,low,'confirmed_swing','major_low',reason);
 s.segmentStart=trend==='up'?high.index:low.index;
 clearInternal(s);
}
function initialize(s,at){
 if(s.external.phase!=='uninitialized')return;
 const trend=pairTrend(s.history);
 if(trend==='unknown')return;
 const edge=latest(s.history,trend==='up'?'SH':'SL');
 const opposite=earlierOpposite(s.history,edge);
 if(!opposite)return;
 const H=trend==='up'?edge:opposite,L=trend==='up'?opposite:edge;
 setMajor(s,at,trend,H,L,'initial_major_pair');
 log(s,at,'major_established','external','Khởi tạo cấu trúc chính '+(trend==='up'?'TĂNG':'GIẢM'),
     `Major High ${H.price}; Major Low ${L.price}. Xác định từ Swing đã được chấp nhận theo HH+HL / LH+LL.`,
     [H.id,L.id],'ADV:S5,S14','success',{direction:trend,majorHigh:H.price,majorLow:L.price});
}
function cross(prev,now,threshold,direction){
 if(threshold===null||threshold===undefined)return false;
 return direction==='up'?(now>threshold&&(prev===null||prev<=threshold)):(now<threshold&&(prev===null||prev>=threshold));
}
function advance(s,at,close,newlyConfirmed=[]){
 if(!Number.isFinite(close))throw Error('Giá đóng cửa phải hữu hạn.');
 if(at!==s.at+1)throw Error('Phải xử lý từng nến đã đóng theo thứ tự, không bỏ qua hoặc quay ngược.');
 const prev=s.previousClose,external=s.external,internal=s.internal;
 // Price breaches are evaluated against levels known BEFORE the current candle closed.
 if(external.trend!=='unknown'){
  const h=external.majorHigh,l=external.majorLow;
  if(external.trend==='up'&&l&&cross(prev,close,l.price,'down')){
   const oldLow=l;
   changeRole(s,at,l,'major_low','broken_major_low','external_reversal');
   external.trend='down';external.phase='awaiting_major_low';external.majorLow=null;
   external.breakAt=at;external.breakLevel=oldLow.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều TĂNG → GIẢM',
       `Giá đóng ${close} thấp hơn Major Low ${oldLow.price}; giữ Major High ${h?.price??'chưa có'}, Major Low mới chờ xác nhận.`,
       [h?.id,oldLow.id].filter(Boolean),'ADV:S3,S7,S13-14','error',{direction:'down',close,brokenLevel:oldLow.price,retainedLevel:h?.price??null});
  }else if(external.trend==='down'&&h&&cross(prev,close,h.price,'up')){
   const oldHigh=h;
   changeRole(s,at,h,'major_high','broken_major_high','external_reversal');
   external.trend='up';external.phase='awaiting_major_high';external.majorHigh=null;
   external.breakAt=at;external.breakLevel=oldHigh.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều GIẢM → TĂNG',
       `Giá đóng ${close} cao hơn Major High ${oldHigh.price}; giữ Major Low ${l?.price??'chưa có'}, Major High mới chờ xác nhận.`,
       [oldHigh.id,l?.id].filter(Boolean),'ADV:S3,S7,S14','success',{direction:'up',close,brokenLevel:oldHigh.price,retainedLevel:l?.price??null});
  }else if(external.phase==='confirmed'&&h&&l){
   if(external.trend==='up'&&cross(prev,close,h.price,'up')){
    external.phase='awaiting_major_high';external.breakAt=at;external.breakLevel=h.price;
    clearInternal(s);
    log(s,at,'major_continuation','external','Cấu trúc chính tiếp diễn TĂNG',
        `Close ${close} > Major High ${h.price}. Chờ Swing High mới hợp lệ để cập nhật cặp Major.`,[h.id],'ADV:S7,S11,S14','success',{direction:'up',close,brokenLevel:h.price});
   }else if(external.trend==='down'&&cross(prev,close,l.price,'down')){
    external.phase='awaiting_major_low';external.breakAt=at;external.breakLevel=l.price;
    clearInternal(s);
    log(s,at,'major_continuation','external','Cấu trúc chính tiếp diễn GIẢM',
        `Close ${close} < Major Low ${l.price}. Chờ Swing Low mới hợp lệ để cập nhật cặp Major.`,[l.id],'ADV:S7,S14','success',{direction:'down',close,brokenLevel:l.price});
   }else if(internal.confirmed && internal.internalHigh && internal.internalLow){
    if(internal.trend==='down'&&cross(prev,close,(internal.protectedHigh||internal.internalHigh).price,'up')){
     const threshold=internal.protectedHigh||internal.internalHigh;
     internal.trend='up';internal.pendingDirection='up';internal.pendingBreakAt=at;internal.confirmed=false;internal.phase='pending_confirmation';
     log(s,at,'internal_reversal','internal','Internal GIẢM → TĂNG (chờ xác nhận)',
         `Giá đóng ${close} phá Internal SH ${threshold.price}. Major ${external.trend==='up'?'TĂNG':'GIẢM'} chưa thay đổi; chờ HH+HL xác nhận.`,
         [threshold.id],'ADV:S7,S13-14','warning',{direction:'up',majorDirection:external.trend,close,brokenLevel:threshold.price});
    }else if(internal.trend==='up'&&cross(prev,close,(internal.protectedLow||internal.internalLow).price,'down')){
     const threshold=internal.protectedLow||internal.internalLow;
     internal.trend='down';internal.pendingDirection='down';internal.pendingBreakAt=at;internal.confirmed=false;internal.phase='pending_confirmation';
     log(s,at,'internal_reversal','internal','Internal TĂNG → GIẢM (chờ xác nhận)',
         `Giá đóng ${close} phá Internal SL ${threshold.price}. Major ${external.trend==='up'?'TĂNG':'GIẢM'} chưa thay đổi; chờ LH+LL xác nhận.`,
         [threshold.id],'ADV:S7,S14','warning',{direction:'down',majorDirection:external.trend,close,brokenLevel:threshold.price});
    }
   }
  }
 }
 // Only pivots which are structurally confirmed by THIS closed candle may enter the ledger.
 for(const p of newlyConfirmed){
  if(p.structConfirmedAt!==at)throw Error(`Swing ${p.id} được cung cấp sai thời điểm xác nhận.`);
  if(p.index>=at)throw Error('Swing chỉ hợp lệ khi nến phía sau đã đóng.');
  if(!['SH','SL'].includes(p.type)||!Number.isFinite(p.price))throw Error('Swing không hợp lệ.');
  if(s.history.some(x=>x.id===p.id))throw Error('Pivot ID đã tồn tại.');
  s.history.push({id:p.id,index:p.index,type:p.type,price:p.price,structConfirmedAt:at});
 }
 // Init when the local accepted swing history is sufficient.
 initialize(s,at);
 if(external.phase==='awaiting_major_high'&&external.breakAt!==null){
  const newHigh=newlyConfirmed.filter(p=>p.type==='SH' && p.price>external.breakLevel && p.index> (external.majorHigh?.index??-1)).at(-1);
  const opp=newHigh?earlierOpposite(s.history,newHigh):null;
  if(newHigh&&opp&&opp.type==='SL'){
   setMajor(s,at,'up',newHigh,opp,'accepted_after_major_break');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${newHigh.price}; Major Low ${opp.price}. Hai mốc chỉ cập nhật khi Swing mới đã được xác nhận.`,
       [newHigh.id,opp.id],'ADV:S11,S13-14','success',{direction:'up',majorHigh:newHigh.price,majorLow:opp.price});
  }
 }else if(external.phase==='awaiting_major_low'&&external.breakAt!==null){
  const newLow=newlyConfirmed.filter(p=>p.type==='SL' && p.price<external.breakLevel && p.index> (external.majorLow?.index??-1)).at(-1);
  const opp=newLow?earlierOpposite(s.history,newLow):null;
  if(newLow&&opp&&opp.type==='SH'){
   setMajor(s,at,'down',opp,newLow,'accepted_after_major_break');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${opp.price}; Major Low ${newLow.price}. Hai mốc chỉ cập nhật khi Swing mới đã được xác nhận.`,
       [opp.id,newLow.id],'ADV:S14','success',{direction:'down',majorHigh:opp.price,majorLow:newLow.price});
  }
 }
 if(external.phase==='confirmed')refreshInternal(s,at);
 s.at=at;s.previousClose=close;
 if(!VALID_TRENDS.has(external.trend)||!VALID_TRENDS.has(s.internal.trend))throw Error('Xu hướng không hợp lệ.');
 return s;
}
function analysisFromAccepted(candles,accepted,upto){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 const grouped=new Map();
 for(const p of accepted){
  const at=p.structConfirmedAt;
  if(at===null||at===undefined||at>end)continue;
  if(!Number.isInteger(at)||at<=p.index||at<0)throw Error('Thời điểm xác nhận Swing không hợp lệ.');
  if(!grouped.has(at))grouped.set(at,[]);
  grouped.get(at).push(p);
 }
 const state=makeState();
 for(let t=0;t<=end;t++)advance(state,t,candles[t].close,grouped.get(t)||[]);
 return {end,external:state.external,internal:state.internal,events:state.events,roleChanges:state.roleChanges,
         acceptedCount:state.history.length,policy:{source:'ADV PPT S3-S14',majorSelection:'provisional',
            initialMajor:'latest confirmed trend pair',closeBreak:'strict',noLookahead:true},
         _state:state};
}
function analyzeAdvancedPrefix(candles,upto,base){
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 if(!base){
  const L=(typeof require==='function' ? require('./engine.js') :
    (typeof globalThis!=='undefined'?globalThis.MarketStructureEngine:null));
  if(!L)throw Error('Yêu cầu MarketStructureEngine để tính Swing nguồn.');
  base=L.analyzePrefix(candles,end);
 }
 return analysisFromAccepted(candles,base.confirmed,end);
}
return {makeState,advance,analysisFromAccepted,analyzeAdvancedPrefix,pairTrend};
});
