/* Market-structure learning engine v1.0 — offline, deterministic, no dependencies.
 * Based on supplied training slides; see docs for strict scope/ambiguities.
 * All logic works on a closed-candle prefix. Never use future candles.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  root.MarketStructureEngine=api;
})(typeof globalThis !== 'undefined' ? globalThis : this,function(){
  'use strict';

  const round2=v=>Math.round((v+Number.EPSILON)*100)/100;
  const hhmm=t=>String(t).slice(11,16);
  // Parsing is handled by the adaptive Python adapter (app/importer.py).
  // This analysis engine receives normalized CLOSED OHLC bars only.

  function analyzePrefix(candles,upto){
    if(!Array.isArray(candles) || !candles.length) throw Error('Không có nến.');
    const end=upto===undefined?candles.length-1:Math.max(0,Math.min(upto,candles.length-1));
    const c=candles.slice(0,end+1),n=c.length;
    const events=[];
    const emit=(at,kind,title,detail,severity='info',pivotIndex=null,data=null)=>events.push({at,kind,title,detail,severity,pivotIndex,data});
    const insideByIndex=Array(n).fill(null);
    const zones=[];
    let active=null;
    emit(0,'start','Khởi động mô hình','Nến đầu tiên đã đóng. Chưa đủ bộ 3 nến để xác định swing.','neutral',null,{});
    for(let j=1;j<n;j++){
      const now=c[j],prev=c[j-1];
      if(active){
        const mother=c[active.mother];
        if(now.high<=mother.high && now.low>=mother.low){
          insideByIndex[j]=zones.length-1;
          active.last=j;
          zones[zones.length-1].last=j;
          emit(j,'inside','Tiếp diễn Inside Bar','Giữ nguyên biên nến mẹ '+hhmm(mother.time)+': '+mother.low.toFixed(2)+' – '+mother.high.toFixed(2)+'.','warning',null,{phase:'continue',motherTime:hhmm(mother.time),low:mother.low,high:mother.high});
          continue;
        }
        const dir=now.high>mother.high && now.low<mother.low?'hai phía':now.high>mother.high?'trên':'dưới';
        zones[zones.length-1].brokenAt=j;
        zones[zones.length-1].breakDirection=dir;
        emit(j,'breakout','Phá biên nến mẹ '+(dir==='trên'?'↑':dir==='dưới'?'↓':'↕'),
          'Nến '+hhmm(now.time)+' xuyên biên '+dir+' của nến mẹ '+hhmm(mother.time)+'. Các swing đã vô hiệu không được phục hồi.','success',null,{direction:dir==='trên'?'up':dir==='dưới'?'down':'both',candleTime:hhmm(now.time),motherTime:hhmm(mother.time)});
        active=null;
      }
      if(now.high<=prev.high && now.low>=prev.low){
        active={mother:j-1,first:j,last:j};
        zones.push({mother:j-1,first:j,last:j,brokenAt:null,breakDirection:null});
        insideByIndex[j]=zones.length-1;
        emit(j,'inside','Khởi tạo Inside Bar','Nến '+hhmm(now.time)+' nằm trong biên nến mẹ '+hhmm(prev.time)+' ['+prev.low.toFixed(2)+'; '+prev.high.toFixed(2)+'].','warning',null,{phase:'start',candleTime:hhmm(now.time),motherTime:hhmm(prev.time),low:prev.low,high:prev.high});
      }
    }

    const swings=[];
    for(let i=1;i<n-1;i++){
      const a=c[i-1],b=c[i],z=c[i+1];
      const isHigh=b.high>a.high && b.high>z.high;
      const isLow=b.low<a.low && b.low<z.low;
      if(!isHigh&&!isLow) continue;
      const ambiguous=isHigh && isLow;
      for(const type of ['SH','SL']){
        if((type==='SH'&&!isHigh)||(type==='SL'&&!isLow)) continue;
        const value=type==='SH'?b.high:b.low;
        const zIndex=insideByIndex[i];
        const status=ambiguous?'ambiguous':zIndex!==null?'inside_rejected':'eligible';
        const swing={id:type+'-'+i,index:i,confirmedAt:i+1,type,price:value,status,
          structStatus:status==='eligible'?'pending':'rejected',structConfirmedAt:null,comp:'',
          zoneId:zIndex};
        swings.push(swing);
        emit(i+1,'swing',(type==='SH'?'Swing High':'Swing Low')+' cục bộ · '+hhmm(b.time),
          'Giá '+value.toFixed(2)+'; xác nhận khi nến '+hhmm(z.time)+' đóng. '+
          (ambiguous?'Cùng nến hình thành SH và SL: OHLC không biết thứ tự biến động, loại khỏi cấu trúc.':
           zIndex!==null?'VÔ HIỆU: điểm nằm trong biên nến mẹ '+hhmm(c[zones[zIndex].mother].time)+'.':
           'Qua bộ lọc Inside Bar; chờ kiểm tra đỉnh–đáy luân phiên.'),
          ambiguous?'neutral':zIndex!==null?'error':'info',i,{type,pivotTime:hhmm(b.time),confirmationTime:hhmm(z.time),price:value,status,motherTime:zIndex!==null?hhmm(c[zones[zIndex].mother].time):null});
      }
    }

    // A strictly eligible three-CLOSED-bar swing is known at its right bar.
    // Opposing pivots are NOT a prerequisite. The alternating path is a
    // separate display/structural pairing view and must not delay detection.
    // Same-kind replacements are recorded when later closed bars arrive;
    // previously emitted pivots retain their historical confirmation time.
    const eligible=swings.filter(p=>p.status==='eligible').sort((x,y)=>x.index-y.index);
    for(const p of eligible){p.structStatus='confirmed';p.structConfirmedAt=p.confirmedAt;}
    const path=[];
    for(const p of eligible){
      const previous=path[path.length-1];
      if(previous&&previous.type===p.type){
        const moreExtreme=p.type==='SH'?p.price>previous.price:p.price<previous.price;
        if(moreExtreme)path[path.length-1]=p;
      }else path.push(p);
    }
    const confirmed=path;
    let priorHigh=null,priorLow=null;
    for(const p of confirmed){
      if(p.type==='SH'){
        p.comp=priorHigh?(p.price>priorHigh.price?'HH':p.price<priorHigh.price?'LH':'EQH'):'SH';
        priorHigh=p;
      }else{
        p.comp=priorLow?(p.price>priorLow.price?'HL':p.price<priorLow.price?'LL':'EQL'):'SL';
        priorLow=p;
      }
    }
    // Explanatory notifications for classification and causal trend changes.
    for(let i=0;i<confirmed.length;i++){
      const p=confirmed[i];
      const prior=confirmed.slice(0,i).reverse().find(x=>x.type===p.type);
      if(prior){
        const short=p.comp,kind=(short==='HH'||short==='HL')?'success':(short==='LH'||short==='LL')?'warning':'neutral';
        emit(p.structConfirmedAt,'classification','Nhận diện '+short+' · '+hhmm(c[p.index].time),
          p.type+' '+p.price.toFixed(2)+' so với '+prior.price.toFixed(2)+' tại '+hhmm(c[prior.index].time)+'.',kind,p.index,{type:p.type,classification:short,pivotTime:hhmm(c[p.index].time),price:p.price,previousPrice:prior.price,previousTime:hhmm(c[prior.index].time)});
      }
    }
    let previousTrend='unknown',checked=[];
    for(const p of confirmed){
      checked.push(p);
      const vH=checked.filter(x=>x.type==='SH'),vL=checked.filter(x=>x.type==='SL');
      const curH=vH.at(-1)?.comp,curL=vL.at(-1)?.comp;
      const next=vH.length>=2&&vL.length>=2 ?
          (curH==='HH'&&curL==='HL'?'up':curH==='LH'&&curL==='LL'?'down':'unknown') : 'unknown';
      if(next!==previousTrend){
        emit(p.structConfirmedAt,'trend',next==='up'?'Cấu trúc TĂNG được xác nhận':next==='down'?'Cấu trúc GIẢM được xác nhận':'Trở lại VÙNG XÁM',
          next==='up'?'Các cặp mới nhất đáp ứng HH + HL.':next==='down'?'Các cặp mới nhất đáp ứng LH + LL.':'Các cặp HH/HL/LH/LL không còn đồng thuận. Không tự gán đi ngang.',
          next==='unknown'?'warning':'success',p.index,{direction:next});
        previousTrend=next;
      }
    }
    const hs=confirmed.filter(p=>p.type==='SH');
    const ls=confirmed.filter(p=>p.type==='SL');
    const lastH=hs.at(-1)?.comp||null,lastL=ls.at(-1)?.comp||null;
    let trend='unknown',reason='Chưa đủ hai Swing High và hai Swing Low đã xác thực luân phiên.';
    if(hs.length>=2 && ls.length>=2){
      if(lastH==='HH' && lastL==='HL'){
        trend='up'; reason='Hai đỉnh hợp lệ nâng cao (HH) và hai đáy hợp lệ nâng cao (HL).';
      }else if(lastH==='LH' && lastL==='LL'){
        trend='down'; reason='Hai đỉnh hợp lệ hạ thấp (LH) và hai đáy hợp lệ hạ thấp (LL).';
      }else{
        trend='unknown'; reason='Các cặp SH/SL không đồng thuận theo HH+HL hoặc LH+LL; không tự gán đi ngang.';
      }
    }
    events.sort((a,b)=>a.at-b.at||['breakout','inside','swing','replace','pair','start'].indexOf(a.kind)-['breakout','inside','swing','replace','pair','start'].indexOf(b.kind));
    const summary={raw:swings.length,insideRejected:swings.filter(s=>s.status==='inside_rejected').length,
      ambiguous:swings.filter(s=>s.status==='ambiguous').length,
      superseded:swings.filter(s=>s.structStatus==='superseded').length,
      confirmed:confirmed.length,pending:swings.filter(s=>s.structStatus==='pending').length,
      insideCandles:insideByIndex.filter(x=>x!==null).length};
    return {candles:c,zones,insideByIndex,swings,path,confirmed,events,trend,reason,summary,lastH,lastL,end};
  }

  return {analyzePrefix};
});
