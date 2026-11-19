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
// PPT 'Mau_hinh_xac_nhan_ao_chieu_-_Final' slide 8: zero tolerance.
// A wick only is a weak MSS attempt (C); only a CLOSE strictly beyond the
// active Major confirms MSS S+ and reverses the main trend.
const MSS_TOLERANCE=0;
const PRIMARY_KINDS=new Set(['major_established','major_continuation','major_reversal']);
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
 at:-1,previousClose:null,history:[],events:[],roleChanges:[],closed:[],
 mss:{tolerance:MSS_TOLERANCE,last:null,lastWeak:null,weakAttempt:null},
 cisd:{reference:null,last:null,emitted:[]},
 external:{trend:'unknown',phase:'uninitialized',majorHigh:null,majorLow:null,breakAt:null,breakLevel:null},
 internal:{trend:'unknown',phase:'uninitialized',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:false},
 segmentStart:-1,majorRoleAt:-1
};}
function log(s,at,kind,layer,title,detail,refs=[],source='ADV:S14',severity='info',data=null){
 const ev={id:`${kind}:${at}:${s.events.length}`,at,kind,layer,title,detail,severity,source,refs,data,primary:PRIMARY_KINDS.has(kind)};
 s.events.push(ev);if(ev.primary)s.lastPrimary=ev;return ev;
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
 const e=s.external,oldHighId=e.majorHigh?.id,oldLowId=e.majorLow?.id;
 if(e.majorHigh&&e.majorHigh.id!==high?.id)changeRole(s,at,e.majorHigh,'major_high','historical_major','major_rolled');
 if(e.majorLow&&e.majorLow.id!==low?.id)changeRole(s,at,e.majorLow,'major_low','historical_major','major_rolled');
 e.trend=trend;e.phase='confirmed';e.majorHigh=level(high);e.majorLow=level(low);e.breakAt=null;e.breakLevel=null;
 if(high&&high.id!==oldHighId)changeRole(s,at,high,'confirmed_swing','major_high',reason);
 if(low&&low.id!==oldLowId)changeRole(s,at,low,'confirmed_swing','major_low',reason);
 s.segmentStart=trend==='up'?high.index:low.index;
 s.majorRoleAt=at;
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
/** Choose the strongest ALREADY CONFIRMED structural extreme of the pending
 * break wave, not the last swing to happen to confirm after a Close breakout.
 * A major role is assigned only at `at`, never at the historical pivot time.
 * Slide 11/13: major expansion 10/9 or 14/13; source does not fully specify
 * competing pivot tie-breaks, so this remains an explicit provisional policy.
 */
function pendingMajorPair(s,direction){
 const e=s.external,kind=direction==='up'?'SH':'SL';
 if(e.breakAt===null||e.breakLevel===null)return null;
 const anchor=direction==='up'?(e.majorHigh?.index??s.segmentStart-1):(e.majorLow?.index??s.segmentStart-1);
 const eligible=s.history.filter(p=>p.type===kind&&p.index>anchor&&
  (direction==='up'?p.price>e.breakLevel:p.price<e.breakLevel));
 // An accepted extreme may be known BEFORE the Close crosses the old Major
 // boundary. Prefer the strongest price across the wave, not the latest pivot.
 eligible.sort((a,b)=>direction==='up'?b.price-a.price||a.index-b.index:a.price-b.price||a.index-b.index);
 for(const extreme of eligible){
  // If the new extreme was already confirmed BEFORE the closing breakout,
  // the protected counter-extreme can form AFTER it but BEFORE the breakout.
  // XAU source user annotation: MH SH-34 followed by corrective ML SL-37.
  // Otherwise use the latest preceding opposite pivot (PPT 14/13 case).
  const opposites=s.history.filter(p=>p.type!==kind && p.index>anchor);
  const follow=opposites.filter(p=>p.index>extreme.index && p.index<=e.breakAt);
  follow.sort((a,b)=>direction==='up'?a.price-b.price||a.index-b.index:b.price-a.price||a.index-b.index);
  const opposite=follow[0]||earlierOpposite(s.history,extreme);
  if(opposite){
   if(direction==='down'&&e.majorHigh&&opposite.price>=e.majorHigh.price){
    // Higher opposing wick is NOT a new bearish Lower High. The protected
    // prior Major High stays active until a real lower high is confirmed.
    return {high:e.majorHigh,low:extreme};
   }
   return direction==='up'?{high:extreme,low:opposite}:{high:opposite,low:extreme};
  }
 }
 return null;
}
/** Most recent candle cluster moving in the OLD main trend, within the latest
 * eligible swing wave. The Open of its FIRST candle is the CISD reference.
 * The wave boundary uses confirmed opposite swing evidence only, never future
 * pivots. See REV slides 5-8; the exact wave-boundary tie-break is provisional.
 */
function lastOldDirectionCluster(s,at,trend){
 const oldBearish=trend==='down';
 const oppositeType=oldBearish?'SH':'SL';
 const opposite=s.history.filter(p=>p.type===oppositeType).at(-1);
 const waveStart=Math.max(0,s.segmentStart,opposite?.index??0);
 const oldDirection=c=>c && Number.isFinite(c.open)&&
    (oldBearish?c.close<c.open:c.close>c.open);
 let end=-1;
 for(let i=at-1;i>=waveStart;i--){if(oldDirection(s.closed[i])){end=i;break;}}
 if(end<0)return null;
 let start=end;
 while(start-1>=waveStart&&oldDirection(s.closed[start-1]))start--;
 return {direction:trend,startIndex:start,endIndex:end,open:s.closed[start].open,
         waveStartIndex:waveStart,opposingSwingId:opposite?.id??null};
}
function scanReversalSignals(s,at,bar,previousMajor){
 const {trend,majorHigh,majorLow}=previousMajor;
 if(!['up','down'].includes(trend)||!Number.isFinite(bar.open))return;
 const isDown=trend==='down';
 const threshold=isDown?majorHigh:majorLow;
 if(threshold&&Number.isFinite(isDown?bar.high:bar.low)){
  // C: only wick crosses the Major boundary; the body stays inside it.
  const wickBreak=isDown?bar.high>threshold.price+MSS_TOLERANCE:bar.low<threshold.price-MSS_TOLERANCE;
  const bodyInside=isDown?bar.open<=threshold.price && bar.close<threshold.price:
                           bar.open>=threshold.price && bar.close>threshold.price;
  const weak=wickBreak&&bodyInside;
  const key=trend+':'+threshold.id;
  if(weak&&s.mss.weakAttempt!==key){
   const direction=isDown?'up':'down';
   const ev=log(s,at,'mss_weak','external','MSS C · nỗ lực đảo chiều yếu',
      `Râu nến vượt ${isDown?'Major High':'Major Low'} ${threshold.price}, nhưng Close ${bar.close} trở lại biên. Main ${trend==='up'?'TĂNG':'GIẢM'} giữ nguyên.`,
      [threshold.id],'REV:S4,S8','warning',
      {label:'C',direction,mainTrend:trend,close:bar.close,wick:isDown?bar.high:bar.low,
       brokenLevel:threshold.price,majorPivotId:threshold.id,confirmed:false,tolerance:MSS_TOLERANCE});
   s.mss.lastWeak={at,label:'C',eventId:ev.id,majorPivotId:threshold.id};
  }
  s.mss.weakAttempt=weak?key:null;
 }else s.mss.weakAttempt=null;
 // B: this candle must oppose the old direction; a close through the FIRST
 // old-direction candle's Open of the LAST contiguous group is required.
 const ref=lastOldDirectionCluster(s,at,trend);
 s.cisd.reference=ref;
 if(!ref)return;
 const reversesDelivery=isDown?bar.close>bar.open:bar.close<bar.open;
 const crossed=isDown?bar.close>ref.open+MSS_TOLERANCE:bar.close<ref.open-MSS_TOLERANCE;
 const key=trend+':'+ref.startIndex;
 if(reversesDelivery&&crossed&&!s.cisd.emitted.includes(key)){
  const direction=isDown?'up':'down';
  const ev=log(s,at,'cisd','delivery','CISD B · thay đổi hành vi giá',
    `Close ${bar.close} vượt Open ${ref.open} của nến đầu cụm ${trend==='down'?'GIẢM':'TĂNG'} cuối cùng. Đây chỉ là tín hiệu sớm; Major vẫn ${trend==='up'?'TĂNG':'GIẢM'}.`,
    [],'REV:S5-S8','warning',
    {label:'B',direction,mainTrend:trend,close:bar.close,referenceOpen:ref.open,
     referenceStartIndex:ref.startIndex,referenceEndIndex:ref.endIndex,
     waveStartIndex:ref.waveStartIndex,confirmed:false,tolerance:MSS_TOLERANCE});
  s.cisd.emitted.push(key);
  s.cisd.last={at,label:'B',eventId:ev.id,referenceOpen:ref.open,
                referenceStartIndex:ref.startIndex,majorDirectionUnchanged:true};
 }
}
/** Refresh a CONFIRMED Major pair from a fully accepted continuation wave.
 *
 * A breakout already observed after an old Major became active counts as
 * price confirmation (even if the boundary was assigned with price already
 * outside it). Promotion still REQUIRES accepted Swing evidence; this is
 * independent from S+ reversal and never invents a pivot at the breakout.
 *
 * REV:S8 + ADV:S7,S11,S14 establish Close and rolling role semantics. Which
 * eligible corrective pivot to pair is not completely defined by the PPT;
 * these deterministic tie-breaks are provisional and regression-tested.
 */
function rollMajorFromConfirmed(s,at){
 const e=s.external;
 if(e.phase!=='confirmed'||!e.majorHigh||!e.majorLow)return false;
 const up=e.trend==='up',oldEdge=up?e.majorHigh:e.majorLow;
 const from=Math.max(0,s.majorRoleAt+1);
 const priceProved=s.closed.slice(from,at+1).some(b=>
    up?b.close>oldEdge.price+MSS_TOLERANCE:b.close<oldEdge.price-MSS_TOLERANCE);
 if(!priceProved)return false;
 let high=null,low=null;
 if(up){
  const highs=s.history.filter(p=>p.type==='SH'&&p.index>e.majorHigh.index&&p.price>e.majorHigh.price&&p.structConfirmedAt>s.majorRoleAt)
        .sort((a,b)=>b.price-a.price||a.index-b.index);
  for(const newHigh of highs){
   // The user-labeled XAU48 main swing includes an accepted corrective SL
   // AFTER the major high. Never choose the old preceding low while that
   // corrective pivot is not yet known (it would lock a premature ML).
   const corrective=s.history.filter(p=>p.type==='SL'&&p.index>newHigh.index&&p.structConfirmedAt>s.majorRoleAt)
         .sort((a,b)=>a.price-b.price||a.index-b.index)[0];
   if(corrective){high=newHigh;low=corrective;break;}
  }
 }else{
  const lows=s.history.filter(p=>p.type==='SL'&&p.index>e.majorLow.index&&p.price<e.majorLow.price&&p.structConfirmedAt>s.majorRoleAt)
       .sort((a,b)=>a.price-b.price||a.index-b.index);
  for(const newLow of lows){
   // A lower HIGH must precede the fresh LL, otherwise retain the old
   // protected MH. A wick-only higher SH cannot become a new bearish MH.
   const highs=s.history.filter(p=>p.type==='SH'&&p.index>e.majorLow.index&&
       p.index<newLow.index&&p.price<e.majorHigh.price)
       .sort((a,b)=>b.index-a.index);
   const newHigh=highs[0];
   if(newHigh){high=newHigh;low=newLow;break;}
  }
 }
 if(!high||!low)return false;
 setMajor(s,at,e.trend,high,low,'close_confirmed_rolling_major_provisional');
 log(s,at,'major_updated','external','Cập nhật Major theo sóng đã xác nhận',
     `Đã xác nhận ${e.trend==='up'?'tiếp diễn tăng':'tiếp diễn giảm'} bằng Close; Major High ${high.price}, Major Low ${low.price}.`,
     [high.id,low.id],'ADV:S7,S11,S14','success',
     {direction:e.trend,majorHigh:high.price,majorLow:low.price,
      majorHighIndex:high.index,majorLowIndex:low.index,
      selection:'close_confirmed_roll_provisional'});
 return true;
}
function cross(prev,now,threshold,direction){
 if(threshold===null||threshold===undefined)return false;
 return direction==='up'?(now>threshold&&(prev===null||prev<=threshold)):(now<threshold&&(prev===null||prev>=threshold));
}
function advance(s,at,candleOrClose,newlyConfirmed=[]){
 // Numeric close-only synthetic fixtures are supported for structural tests.
 // They cannot generate candle-shape (C) or Open/Close (B) labels.
 const raw=typeof candleOrClose==='number'?{close:candleOrClose}:candleOrClose;
 const close=raw?.close;
 if(!Number.isFinite(close))throw Error('Giá đóng cửa phải hữu hạn.');
 const bar={open:Number.isFinite(raw.open)?raw.open:null,
            high:Number.isFinite(raw.high)?raw.high:null,
            low:Number.isFinite(raw.low)?raw.low:null,close};
 s.closed.push(bar);
 if(at!==s.at+1)throw Error('Phải xử lý từng nến đã đóng theo thứ tự, không bỏ qua hoặc quay ngược.');
 const prev=s.previousClose,external=s.external,internal=s.internal;
 const majorBefore={trend:external.trend,majorHigh:external.majorHigh,majorLow:external.majorLow};
 // Price breaches are evaluated against levels known BEFORE the current candle closed.
 if(external.trend!=='unknown'){
  const h=external.majorHigh,l=external.majorLow;
  if(external.trend==='up'&&l&&close<l.price-MSS_TOLERANCE){
   const oldLow=l;
   changeRole(s,at,l,'major_low','broken_major_low','external_reversal');
   external.trend='down';external.phase='awaiting_major_low';external.majorLow=null;
   external.breakAt=at;external.breakLevel=oldLow.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều TĂNG → GIẢM',
       `Giá đóng ${close} thấp hơn Major Low ${oldLow.price}; giữ Major High ${h?.price??'chưa có'}, Major Low mới chờ xác nhận.`,
       [h?.id,oldLow.id].filter(Boolean),'ADV:S3,S7,S13-14;REV:S3,S8','error',
       {label:'S+',direction:'down',close,brokenLevel:oldLow.price,retainedLevel:h?.price??null,
        majorPivotId:oldLow.id,confirmed:true,tolerance:MSS_TOLERANCE});
  }else if(external.trend==='down'&&h&&close>h.price+MSS_TOLERANCE){
   const oldHigh=h;
   changeRole(s,at,h,'major_high','broken_major_high','external_reversal');
   external.trend='up';external.phase='awaiting_major_high';external.majorHigh=null;
   external.breakAt=at;external.breakLevel=oldHigh.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều GIẢM → TĂNG',
       `Giá đóng ${close} cao hơn Major High ${oldHigh.price}; giữ Major Low ${l?.price??'chưa có'}, Major High mới chờ xác nhận.`,
       [oldHigh.id,l?.id].filter(Boolean),'ADV:S3,S7,S14;REV:S3,S8','success',
       {label:'S+',direction:'up',close,brokenLevel:oldHigh.price,retainedLevel:l?.price??null,
        majorPivotId:oldHigh.id,confirmed:true,tolerance:MSS_TOLERANCE});
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
 // A confirmed S+ takes priority over weak C / early B on this same candle.
 // C and B never switch external.trend and never create Major pivots.
 if(majorBefore.trend!=='unknown'&&external.trend!==majorBefore.trend){
  const ev=s.events.find(e=>e.at===at&&e.kind==='major_reversal');
  s.mss.last={at,label:'S+',direction:external.trend,eventId:ev?.id??null,
              brokenLevel:ev?.data?.brokenLevel??null};
  s.mss.weakAttempt=null;s.cisd.reference=null;
 }else{
  scanReversalSignals(s,at,bar,majorBefore);
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
  const pair=pendingMajorPair(s,'up');
  if(pair){
   setMajor(s,at,'up',pair.high,pair.low,'strongest_confirmed_major_break_wave');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${pair.high.price}; Major Low ${pair.low.price}. Cặp đỉnh/đáy mạnh nhất đã xác nhận cho nhịp phá Major; không chọn cực trị chỉ vì xuất hiện gần nhất.`,
       [pair.high.id,pair.low.id],'ADV:S11,S13-14','success',{direction:'up',majorHigh:pair.high.price,majorLow:pair.low.price,
        majorHighIndex:pair.high.index,majorLowIndex:pair.low.index,selection:'strongest_confirmed_wave_provisional'});
  }
 }else if(external.phase==='awaiting_major_low'&&external.breakAt!==null){
  const pair=pendingMajorPair(s,'down');
  if(pair){
   setMajor(s,at,'down',pair.high,pair.low,'strongest_confirmed_major_break_wave');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${pair.high.price}; Major Low ${pair.low.price}. Cặp đỉnh/đáy mạnh nhất đã xác nhận cho nhịp phá Major; không chọn cực trị chỉ vì xuất hiện gần nhất.`,
       [pair.high.id,pair.low.id],'ADV:S11,S13-14','success',{direction:'down',majorHigh:pair.high.price,majorLow:pair.low.price,
        majorHighIndex:pair.high.index,majorLowIndex:pair.low.index,selection:'strongest_confirmed_wave_provisional'});
  }
 }
 // Re-evaluate active Major after accepting this candle's newly confirmed
 // Swing(s). This can roll a continuation WITHOUT requiring a second price
 // crossing after a fresh Major assignment (XAU40 at bars 16-25).
 rollMajorFromConfirmed(s,at);
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
 for(let t=0;t<=end;t++)advance(state,t,candles[t],grouped.get(t)||[]);
 return {end,external:state.external,internal:state.internal,
         mss:{tolerance:MSS_TOLERANCE,last:state.mss.last,lastWeak:state.mss.lastWeak},
         cisd:{reference:state.cisd.reference,last:state.cisd.last},
         events:state.events,roleChanges:state.roleChanges,
         acceptedCount:state.history.length,policy:{source:'ADV PPT S3-S14',majorSelection:'close-confirmed-rolling-pair-and-wave-extreme (provisional)',
            initialMajor:'latest confirmed trend pair',closeBreak:'strict',tolerance:0,
            mssSource:'REV S3-S4,S8',cisdSource:'REV S5-S8',
            cisdWaveBoundary:'latest eligible opposite pivot (provisional)',noLookahead:true},
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
// ---------------------------------------------------------------------------
// USER-AMENDED V6 streaming implementation (2026-11-19).
// The V5 functions above remain as historical implementation context; all
// public entry points below route through this forward-only state machine.

const jsonClone=value=>JSON.parse(JSON.stringify(value));
const pivotLevel=p=>p?{id:p.id,index:p.index,type:p.type,price:p.price,
 confirmedAt:p.recognizedAt??p.structConfirmedAt??p.confirmedAt??null}:null;
const pivotRecord=p=>({id:p.id,type:p.type,index:p.index,price:p.price,
 recognizedAt:p.recognizedAt??p.structConfirmedAt??p.confirmedAt,
 status:p.status??'eligible',rule:p.rule??'three_bar'});
const extremeMore=(a,b)=>a.type==='SH'?a.price>b.price:a.price<b.price;

function makeStateV6(){
 const selected=[];
 return {at:-1,previousClose:null,history:selected,selected,pivots:[],events:[],roleChanges:[],closed:[],
  mss:{tolerance:MSS_TOLERANCE,last:null,lastWeak:null,weakAttempt:null},
  cisd:{reference:null,last:null,emitted:[]},
  external:{trend:'unknown',phase:'uninitialized',majorHigh:null,majorLow:null,breakAt:null,breakLevel:null,
            provisionalHigh:null,provisionalLow:null},
  internal:{trend:'unknown',phase:'uninitialized',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,
            pendingDirection:null,pendingBreakAt:null,confirmed:false},
  active:{SH:null,SL:null,MH:null,ML:null,iSH:null,iSL:null},lastPrimary:null,
  segmentStart:-1,majorRoleAt:-1,pendingMajor:null,brokenPrimary:new Set(),internalBreaks:new Set(),
  _majorEstablished:false,_pivotIds:new Set(),_closeMax:[[]],_closeMin:[[]]};
}
function ensureV6(s){
 if(!s.selected){s.selected=s.history||[];s.history=s.selected;}
 if(!s.pivots)s.pivots=[];
 if(!s.external.provisionalHigh)s.external.provisionalHigh=null;
 if(!s.external.provisionalLow)s.external.provisionalLow=null;
 if(!s.active)s.active={SH:null,SL:null,MH:null,ML:null,iSH:null,iSL:null};
 if(!s.brokenPrimary)s.brokenPrimary=new Set();
 if(!s.internalBreaks)s.internalBreaks=new Set();
 if(!('pendingMajor'in s))s.pendingMajor=null;
 if(!('lastPrimary'in s))s.lastPrimary=null;
 if(!s._pivotIds)s._pivotIds=new Set(s.pivots.map(p=>p.id));
 if(!s._closeMax)s._closeMax=[[]];if(!s._closeMin)s._closeMin=[[]];
 if(!('_majorEstablished'in s))s._majorEstablished=false;
 if(!s._majorEstablished&&s.external.phase==='confirmed'&&s.external.majorHigh&&s.external.majorLow)s._majorEstablished=true;
}
function appendCloseRangeV6(s,close){
 const at=s.closed.length-1;s._closeMax[0][at]=close;s._closeMin[0][at]=close;
 for(let k=1;(1<<k)<=at+1;k++){
  if(!s._closeMax[k]){s._closeMax[k]=[];s._closeMin[k]=[];}
  const half=1<<(k-1),start=at-(1<<k)+1;
  s._closeMax[k][start]=Math.max(s._closeMax[k-1][start],s._closeMax[k-1][start+half]);
  s._closeMin[k][start]=Math.min(s._closeMin[k-1][start],s._closeMin[k-1][start+half]);
 }
}
function closeRangeV6(s,left,right,wantMax){
 if(left>right)return wantMax?-Infinity:Infinity;
 const length=right-left+1,k=31-Math.clz32(length),span=1<<k,table=wantMax?s._closeMax:s._closeMin;
 return wantMax?Math.max(table[k][left],table[k][right-span+1]):Math.min(table[k][left],table[k][right-span+1]);
}
function validMajorCandidateV6(s,p,at){
 if(!p)return false;const left=p.index+1;if(left>at)return true;
 return p.type==='SH'?closeRangeV6(s,left,at,true)<=p.price:closeRangeV6(s,left,at,false)>=p.price;
}
function refreshActiveV6(s){
 s.active.SH=latest(s.selected,'SH')?.id??null;s.active.SL=latest(s.selected,'SL')?.id??null;
 s.active.MH=s.external.majorHigh?.id??null;s.active.ML=s.external.majorLow?.id??null;
 s.active.iSH=s.internal.internalHigh?.id??null;s.active.iSL=s.internal.internalLow?.id??null;
}
function frameV6(s){
 refreshActiveV6(s);
 const e=s.external,i=s.internal;
 return jsonClone({at:s.at,external:{trend:e.trend,phase:e.phase,majorHigh:e.majorHigh,majorLow:e.majorLow,
  breakAt:e.breakAt,breakLevel:e.breakLevel,provisionalHigh:e.provisionalHigh,provisionalLow:e.provisionalLow},
  internal:{trend:i.trend,phase:i.phase,internalHigh:i.internalHigh,internalLow:i.internalLow,
   protectedHigh:i.protectedHigh,protectedLow:i.protectedLow,confirmed:i.confirmed},
  active:s.active,lastPrimary:s.lastPrimary});
}
function assignSideV6(s,at,side,pivot,reason){
 const key=side==='high'?'majorHigh':'majorLow',role=side==='high'?'major_high':'major_low';
 if(pivot&&!validMajorCandidateV6(s,pivot,at))return false;
 const old=s.external[key],next=pivotLevel(pivot);
 if(old?.id===next?.id)return false;
 if(old)changeRole(s,at,old,role,'historical_major',reason);
 s.external[key]=next;
 if(pivot)changeRole(s,at,pivot,'confirmed_swing',role,reason);
 return true;
}
function updateProvisionalV6(s,at,bar){
 const pending=s.pendingMajor;if(!pending)return;
 if(pending.kind==='initialization'){
  if(!s.external.majorHigh){const price=Number.isFinite(bar.high)?bar.high:bar.close,old=s.external.provisionalHigh;
   if(!old||price>old.price)s.external.provisionalHigh={id:`PX-H-${at}`,index:at,type:'SH',price,provisional:true,confirmedAt:null};}
  if(!s.external.majorLow){const price=Number.isFinite(bar.low)?bar.low:bar.close,old=s.external.provisionalLow;
   if(!old||price<old.price)s.external.provisionalLow={id:`PX-L-${at}`,index:at,type:'SL',price,provisional:true,confirmedAt:null};}
  return;
 }
 if(pending.direction==='up'){
  const price=Number.isFinite(bar.high)?bar.high:bar.close,old=s.external.provisionalHigh;
  if(!old||price>old.price)s.external.provisionalHigh={id:`PX-H-${at}`,index:at,type:'SH',price,provisional:true,confirmedAt:null};
 }else{
  const price=Number.isFinite(bar.low)?bar.low:bar.close,old=s.external.provisionalLow;
  if(!old||price<old.price)s.external.provisionalLow={id:`PX-L-${at}`,index:at,type:'SL',price,provisional:true,confirmedAt:null};
 }
}
function finishPendingV6(s,at){
 s.external.phase='confirmed';s.external.breakAt=null;s.external.breakLevel=null;
 s.external.provisionalHigh=null;s.external.provisionalLow=null;s.pendingMajor=null;s.majorRoleAt=at;
 s.segmentStart=s.external.trend==='up'?(s.external.majorHigh?.index??at):(s.external.majorLow?.index??at);
}
function majorUpdatedV6(s,at,changed,reason){
 if(!changed.length)return;
 log(s,at,'major_updated','external','Cập nhật Major theo bằng chứng Swing đã đóng',
  `Cập nhật độc lập ${changed.join(' + ')} ngay khi Swing được nhận diện; không chờ đủ cặp đối diện.`,
  [s.external.majorHigh?.id,s.external.majorLow?.id].filter(Boolean),'ADV:S7,S11,S14','success',
  {direction:s.external.trend,majorHigh:s.external.majorHigh?.price??null,majorLow:s.external.majorLow?.price??null,
   changed,selection:'USER-AMENDED V6 independent closed-bar roles'});
}
function initializeV6(s,at){
 if(s._majorEstablished)return false;
 const trend=pairTrend(s.selected);if(trend==='unknown')return false;
 const edge=latest(s.selected,trend==='up'?'SH':'SL'),opposite=earlierOpposite(s.selected,edge);
 if(!edge||!opposite)return false;
 const high=trend==='up'?edge:opposite,low=trend==='up'?opposite:edge;
 if(s.pendingMajor?.kind==='initialization'&&s.pendingMajor.direction!==trend){
  s.external.majorHigh=null;s.external.majorLow=null;s.external.provisionalHigh=null;s.external.provisionalLow=null;
 }
 s.external.trend=trend;s.pendingMajor={kind:'initialization',direction:trend};
 if(validMajorCandidateV6(s,high,at))assignSideV6(s,at,'high',high,'initial_major_pair_v6');
 if(validMajorCandidateV6(s,low,at))assignSideV6(s,at,'low',low,'initial_major_pair_v6');
 updateProvisionalV6(s,at,s.closed[at]);
 if(!s.external.majorHigh||!s.external.majorLow){
  s.external.phase=!s.external.majorHigh&&!s.external.majorLow?'awaiting_major_pair':!s.external.majorHigh?'awaiting_major_high':'awaiting_major_low';
  return false;
 }
 s.external.phase='confirmed';s.external.provisionalHigh=null;s.external.provisionalLow=null;s.pendingMajor=null;s._majorEstablished=true;
 s.segmentStart=trend==='up'?s.external.majorHigh.index:s.external.majorLow.index;s.majorRoleAt=at;clearInternal(s);
 log(s,at,'major_established','external',`Khởi tạo cấu trúc chính ${trend==='up'?'TĂNG':'GIẢM'}`,
  `Major High ${high.price}; Major Low ${low.price}.`,[high.id,low.id],'ADV:S5,S14','success',
  {direction:trend,majorHigh:high.price,majorLow:low.price});
 return true;
}
function startBreakV6(s,at,bar,kind,direction,broken){
 const key=`${kind}:${direction}:${broken.id}`;if(s.brokenPrimary.has(key))return false;
 s.brokenPrimary.add(key);
 const reversal=kind==='major_reversal',before={high:s.external.majorHigh,low:s.external.majorLow};
 if(reversal){
  if(direction==='up'){
   if(before.high)changeRole(s,at,before.high,'major_high','historical_major','external_reversal_v6');
   s.external.majorHigh=null;s.external.trend='up';
  }else{
   if(before.low)changeRole(s,at,before.low,'major_low','historical_major','external_reversal_v6');
   s.external.majorLow=null;s.external.trend='down';
  }
 }
 s.external.phase=direction==='up'?'awaiting_major_high':'awaiting_major_low';
 s.external.breakAt=at;s.external.breakLevel=broken.price;s.external.provisionalHigh=null;s.external.provisionalLow=null;
 s.pendingMajor={direction,kind,reversal,breakAt:at,breakLevel:broken.price,previousHigh:before.high,previousLow:before.low,extremeId:null};
 clearInternal(s);s.segmentStart=at;updateProvisionalV6(s,at,bar);
 const retained=direction==='up'?s.external.majorLow:s.external.majorHigh;
 log(s,at,kind,'external',kind==='major_reversal'?
    `Cấu trúc chính đảo chiều ${direction==='up'?'GIẢM → TĂNG':'TĂNG → GIẢM'}`:
    `Cấu trúc chính tiếp diễn ${direction==='up'?'TĂNG':'GIẢM'}`,
   `Close ${bar.close} ${direction==='up'?'>':'<'} ${broken.price}; chờ Swing ${direction==='up'?'High':'Low'} thực, dùng cực trị tạm thời trong lúc chờ.`,
   [broken.id,retained?.id].filter(Boolean),kind==='major_reversal'?'ADV:S3,S7,S13-14;REV:S3,S8':'ADV:S7,S11,S14',
   kind==='major_reversal'?'error':'success',
   {label:kind==='major_reversal'?'S+':null,direction,close:bar.close,brokenLevel:broken.price,
    retainedLevel:retained?.price??null,majorPivotId:broken.id,confirmed:true,tolerance:MSS_TOLERANCE});
 return true;
}
function updatePendingV6(s,at){
 const p=s.pendingMajor;if(!p)return false;
 if(p.kind==='initialization')return initializeV6(s,at);
 const e=s.external,changed=[];
 if(p.direction==='up'){
  // Mirror of the DOWN reversal retention rule: before the new high exists,
  // retain the lowest selected low after the old ML.
  if(p.reversal&&!p.extremeId&&p.previousLow){
   const lows=s.selected.filter(x=>x.type==='SL'&&x.index>p.previousLow.index&&x.price<p.previousLow.price&&validMajorCandidateV6(s,x,at))
     .sort((a,b)=>a.price-b.price||a.index-b.index);
   if(lows[0]&&assignSideV6(s,at,'low',lows[0],'reversal_retained_low_v6'))changed.push('ML');
  }
  const anchor=p.previousHigh?.index??-1;
  const highs=s.selected.filter(x=>x.type==='SH'&&x.index>anchor&&x.index!==p.breakAt&&x.price>p.breakLevel&&validMajorCandidateV6(s,x,at))
    .sort((a,b)=>b.price-a.price||a.index-b.index);
  let current=e.majorHigh;
  const correctiveExists=p.extremeId&&current&&s.selected.some(x=>x.type==='SL'&&x.index>current.index&&validMajorCandidateV6(s,x,at));
  const candidate=highs[0];
  if(candidate&&(!current||(!correctiveExists&&candidate.price>current.price))){
   if(assignSideV6(s,at,'high',candidate,'break_extreme_v6'))changed.push('MH');
   e.provisionalHigh=null;p.extremeId=candidate.id;current=e.majorHigh;
  }
  if(current&&p.extremeId){
   const corrective=s.selected.filter(x=>x.type==='SL'&&x.index>current.index&&validMajorCandidateV6(s,x,at))
     .sort((a,b)=>a.price-b.price||a.index-b.index)[0];
   if(corrective){if(assignSideV6(s,at,'low',corrective,'corrective_after_major_high_v6'))changed.push('ML');finishPendingV6(s,at);}
   else e.phase='awaiting_corrective_low';
  }
 }else{
  // USER-AMENDED asymmetric DOWN rule: retain the highest valid SH after the
  // old MH on reversal; continuation chooses the latest lower SH preceding LL.
  if(p.reversal&&p.previousHigh){
   const highs=s.selected.filter(x=>x.type==='SH'&&x.index>p.previousHigh.index&&validMajorCandidateV6(s,x,at))
     .sort((a,b)=>b.price-a.price||a.index-b.index);
   if(highs[0]&&highs[0].price>p.previousHigh.price&&assignSideV6(s,at,'high',highs[0],'reversal_retained_high_v6'))changed.push('MH');
  }
  const anchor=p.previousLow?.index??-1;
  const lows=s.selected.filter(x=>x.type==='SL'&&x.index>anchor&&x.index!==p.breakAt&&x.price<p.breakLevel&&validMajorCandidateV6(s,x,at))
    .sort((a,b)=>a.price-b.price||a.index-b.index);
  const candidate=lows[0];
  if(candidate){
   if(assignSideV6(s,at,'low',candidate,'break_extreme_v6'))changed.push('ML');
   e.provisionalLow=null;p.extremeId=candidate.id;
   if(!p.reversal&&p.previousHigh&&p.previousLow){
    const corrective=s.selected.filter(x=>x.type==='SH'&&x.index>p.previousLow.index&&x.index<candidate.index&&x.price<p.previousHigh.price&&validMajorCandidateV6(s,x,at))
      .sort((a,b)=>b.index-a.index)[0];
    if(corrective&&assignSideV6(s,at,'high',corrective,'preceding_lower_high_v6'))changed.push('MH');
   }
   finishPendingV6(s,at);
  }
 }
 majorUpdatedV6(s,at,[...new Set(changed)],p.kind);
 return changed.length>0;
}
function acceptPivotV6(s,at,input){
 const p={id:input.id,type:input.type,index:input.index,price:input.price,
  recognizedAt:input.recognizedAt??input.structConfirmedAt??input.confirmedAt??at,
  structConfirmedAt:input.recognizedAt??input.structConfirmedAt??input.confirmedAt??at,
  confirmedAt:input.recognizedAt??input.structConfirmedAt??input.confirmedAt??at,
  status:input.status??'eligible',rule:input.rule??'three_bar'};
 if(p.recognizedAt!==at||p.index>=at)throw Error(`Swing ${p.id} được cung cấp sai thời điểm xác nhận.`);
 if(s._pivotIds.has(p.id))return false;
 s._pivotIds.add(p.id);s.pivots.push(pivotRecord(p));
 if(p.status!=='eligible')return false;
 const last=s.selected.at(-1);
 if(last&&last.type===p.type){
  if(!extremeMore(p,last))return false;
  s.selected.splice(s.selected.length-1,1,p);
  log(s,at,'replace','local',`Thay ${last.id} bằng ${p.id}`,
   `${p.id} cực trị hơn ${last.id} trong đường Swing nhân quả.`,[last.id,p.id],'ADV:S14','info',
   {oldId:last.id,newId:p.id,type:p.type});
 }else s.selected.push(p);
 return true;
}
function internalBreakV6(s,at,close){
 const i=s.internal,e=s.external;if(e.phase!=='confirmed'||!i.confirmed)return;
 let direction=null,threshold=null;
 if(i.trend==='down'){threshold=i.protectedHigh||i.internalHigh;if(threshold&&close>threshold.price)direction='up';}
 else if(i.trend==='up'){threshold=i.protectedLow||i.internalLow;if(threshold&&close<threshold.price)direction='down';}
 if(!direction||!threshold)return;
 const key=`${direction}:${threshold.id}`;if(s.internalBreaks.has(key))return;s.internalBreaks.add(key);
 i.trend=direction;i.pendingDirection=direction;i.pendingBreakAt=at;i.confirmed=false;i.phase='pending_confirmation';
 log(s,at,'internal_reversal','internal',`Internal đảo chiều → ${direction==='up'?'TĂNG':'GIẢM'} (chờ xác nhận)`,
  `Close ${close} phá ${threshold.id}; Main không đổi.`,[threshold.id],'ADV:S7,S13-14','warning',
  {direction,majorDirection:e.trend,close,brokenLevel:threshold.price});
}
function advanceV6(s,at,candleOrClose,newlyRecognized=[]){
 ensureV6(s);if(at!==s.at+1)throw Error('Phải xử lý từng nến đã đóng theo thứ tự, không bỏ qua hoặc quay ngược.');
 const raw=typeof candleOrClose==='number'?{close:candleOrClose}:candleOrClose,close=raw?.close;
 if(!Number.isFinite(close))throw Error('Giá đóng cửa phải hữu hạn.');
 const bar={open:Number.isFinite(raw.open)?raw.open:null,high:Number.isFinite(raw.high)?raw.high:null,
  low:Number.isFinite(raw.low)?raw.low:null,close};s.closed.push(bar);appendCloseRangeV6(s,close);updateProvisionalV6(s,at,bar);
 const before={trend:s.external.trend,majorHigh:s.external.majorHigh,majorLow:s.external.majorLow};
 let reversal=false,majorBreak=false;
 if(s._majorEstablished&&before.trend==='up'&&before.majorLow&&close<before.majorLow.price){
  reversal=startBreakV6(s,at,bar,'major_reversal','down',before.majorLow);majorBreak=reversal;
 }else if(s._majorEstablished&&before.trend==='down'&&before.majorHigh&&close>before.majorHigh.price){
  reversal=startBreakV6(s,at,bar,'major_reversal','up',before.majorHigh);majorBreak=reversal;
 }else if(s.external.phase==='confirmed'){
  if(before.trend==='up'&&before.majorHigh&&close>before.majorHigh.price)
   majorBreak=startBreakV6(s,at,bar,'major_continuation','up',before.majorHigh);
  else if(before.trend==='down'&&before.majorLow&&close<before.majorLow.price)
   majorBreak=startBreakV6(s,at,bar,'major_continuation','down',before.majorLow);
 }
 if(majorBreak)updatePendingV6(s,at);else internalBreakV6(s,at,close);
 if(reversal){
  const ev=s.events.findLast(e=>e.at===at&&e.kind==='major_reversal');
  s.mss.last={at,label:'S+',direction:s.external.trend,eventId:ev?.id??null,brokenLevel:ev?.data?.brokenLevel??null};
  s.mss.weakAttempt=null;s.cisd.reference=null;
 }else if(s._majorEstablished)scanReversalSignals(s,at,bar,before);
 const ordered=[...newlyRecognized].sort((a,b)=>(a.recognizedAt??a.structConfirmedAt??a.confirmedAt??at)-(b.recognizedAt??b.structConfirmedAt??b.confirmedAt??at)||a.index-b.index||a.type.localeCompare(b.type));
 for(const p of ordered){
  const changed=acceptPivotV6(s,at,p);if(!changed)continue;
  const initialized=initializeV6(s,at);
  if(!initialized&&s._majorEstablished&&s.pendingMajor)updatePendingV6(s,at);
 }
 if(s.external.phase==='confirmed'&&s.external.majorHigh&&s.external.majorLow)refreshInternal(s,at);
 s.at=at;s.previousClose=close;refreshActiveV6(s);
 if(!VALID_TRENDS.has(s.external.trend)||!VALID_TRENDS.has(s.internal.trend))throw Error('Xu hướng không hợp lệ.');
 return s;
}

function makeLocalV6(){return {bars:[],zones:[],inside:[],active:null,pivots:[],ids:new Set()};}
function localPivotV6(l,type,index,at,status,rule,zoneId,out){
 const id=`${type}-${index}`;if(l.ids.has(id))return;l.ids.add(id);
 const b=l.bars[index];const p={id,type,index,price:type==='SH'?b.high:b.low,recognizedAt:at,status,rule,zoneId};
 l.pivots.push(p);out.push(p);
}
function localPushV6(l,input){
 const at=l.bars.length,bar={...input};
 if(!Number.isFinite(bar.high)||!Number.isFinite(bar.low)||bar.high<bar.low)throw Error('Nến OHLC không hợp lệ.');
 l.bars.push(bar);l.inside.push(null);const out=[];if(at===0)return out;
 let broken=null;
 if(l.active!==null){const z=l.zones[l.active],m=l.bars[z.mother];
  if(bar.high<=m.high&&bar.low>=m.low){l.inside[at]=l.active;z.last=at;}
  else{z.brokenAt=at;z.breakDirection=bar.high>m.high&&bar.low<m.low?'both':bar.high>m.high?'up':'down';broken=z;l.active=null;}}
 if(l.inside[at]===null&&l.active===null){const prev=l.bars[at-1];if(bar.high<=prev.high&&bar.low>=prev.low){
  l.zones.push({mother:at-1,first:at,last:at,brokenAt:null,breakDirection:null});l.active=l.zones.length-1;l.inside[at]=l.active;}}
 if(at>=2){const i=at-1,a=l.bars[i-1],b=l.bars[i],r=l.bars[at],hi=b.high>a.high&&b.high>r.high,lo=b.low<a.low&&b.low<r.low;
  if(hi||lo){const ambiguous=hi&&lo,z=l.inside[i],status=ambiguous?'ambiguous':z!==null?'inside_rejected':'eligible';
   if(hi)localPivotV6(l,'SH',i,at,status,'three_bar',z,out);if(lo)localPivotV6(l,'SL',i,at,status,'three_bar',z,out);}}
 if(broken&&broken.mother>0&&broken.breakDirection!=='both'){
  const m=broken.mother,mother=l.bars[m],children=l.bars.slice(broken.first,broken.last+1);
  let leftIndex=m-1;while(leftIndex>=0&&l.inside[leftIndex]!==null)leftIndex--;
  if(leftIndex>=0){const left=l.bars[leftIndex];
   if(children.some(x=>x.high===mother.high)&&mother.high>left.high&&mother.high>bar.high)localPivotV6(l,'SH',m,at,'eligible','inside_compressed',l.inside[m],out);
   if(children.some(x=>x.low===mother.low)&&mother.low<left.low&&mother.low<bar.low)localPivotV6(l,'SL',m,at,'eligible','inside_compressed',l.inside[m],out);}}
 return out.sort((a,b)=>a.index-b.index||a.type.localeCompare(b.type));
}
function createStreamV6(){
 const state=makeStateV6(),local=makeLocalV6(),frames=[];
 return {push(bar){const recognized=localPushV6(local,bar);for(const p of recognized)if(p.status!=='eligible'&&!state._pivotIds.has(p.id)){
    state._pivotIds.add(p.id);state.pivots.push(pivotRecord(p));}
   advanceV6(state,state.at+1,bar,recognized.filter(p=>p.status==='eligible'));const frame=frameV6(state);frames.push(frame);return frame;},
  _result(){return {frames:jsonClone(frames),events:jsonClone(state.events),pivots:jsonClone(local.pivots.map(pivotRecord)),
    roleChanges:jsonClone(state.roleChanges),zones:jsonClone(local.zones),state};}};
}
function replayAllV6(candles){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const stream=createStreamV6();for(const bar of candles)stream.push(bar);const r=stream._result();
 return {frames:r.frames,events:r.events,pivots:r.pivots,roleChanges:r.roleChanges,zones:r.zones};
}
function analysisResultV6(state,end,zones=[]){
 const frame=frameV6(state);return {end,external:frame.external,internal:frame.internal,active:frame.active,lastPrimary:frame.lastPrimary,
  mss:{tolerance:MSS_TOLERANCE,last:state.mss.last,lastWeak:state.mss.lastWeak},cisd:{reference:state.cisd.reference,last:state.cisd.last},
  events:jsonClone(state.events),roleChanges:jsonClone(state.roleChanges),pivots:jsonClone(state.pivots),zones:jsonClone(zones),
  acceptedCount:state.selected.length,policy:{source:'ADV PPT S3-S14 + USER-AMENDED V6 2026-11-19',
   majorSelection:'independent streaming roles (provisional)',initialMajor:'first causal HH+HL / LH+LL pair',
   closeBreak:'strict',tolerance:0,noLookahead:true},_state:state};
}
function analysisFromAcceptedV6(candles,accepted,upto){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto)),groups=new Map();
 for(const p of accepted){const at=p.recognizedAt??p.structConfirmedAt??p.confirmedAt;if(at==null||at>end)continue;
  if(!groups.has(at))groups.set(at,[]);groups.get(at).push({...p,recognizedAt:at,status:p.status??'eligible'});}
 const state=makeStateV6();for(let t=0;t<=end;t++)advanceV6(state,t,candles[t],groups.get(t)||[]);
 return analysisResultV6(state,end);
}
function analyzeAdvancedPrefixV6(candles,upto,_base){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 const stream=createStreamV6();for(let t=0;t<=end;t++)stream.push(candles[t]);const r=stream._result();
 return analysisResultV6(r.state,end,r.zones);
}

return {makeState:makeStateV6,advance:advanceV6,createStream:createStreamV6,replayAll:replayAllV6,
 analysisFromAccepted:analysisFromAcceptedV6,analyzeAdvancedPrefix:analyzeAdvancedPrefixV6,
 pairTrend,lastOldDirectionCluster,MSS_TOLERANCE};
});

