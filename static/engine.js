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

    // Swing confirmation (closed candles only, user rule 2026-11-21):
    // a candidate center is valid only after the market has BROKEN OUT of the
    // Inside-Bar range. Inside children are collapsed into their mother:
    //  - left reference  = previous candle, or its mother if it is an inside child
    //  - right reference = next candle, or, if the next candle is inside the
    //    center (the center is a mother), the first candle that breaks out.
    // SH needs center.high > both references; SL needs center.low < both.
    // The event time is the right reference candle; while every candle after the
    // center is still inside it, nothing is known and nothing is emitted.
    const swings=[];
    const motherOf=j=>insideByIndex[j]!==null?c[zones[insideByIndex[j]].mother]:c[j];
    for(let i=1;i<n-1;i++){
      const b=c[i],raw=c[i-1],rawRight=c[i+1];
      const zIndex=insideByIndex[i];
      if(zIndex!==null){
        // Inside child: rejected (A6). Keep the audit record for raw 3-bar turns.
        const rawHigh=b.high>raw.high&&b.high>rawRight.high,rawLow=b.low<raw.low&&b.low<rawRight.low;
        for(const type of ['SH','SL']){
          if((type==='SH'&&!rawHigh)||(type==='SL'&&!rawLow))continue;
          const value=type==='SH'?b.high:b.low,mother=c[zones[zIndex].mother];
          swings.push({id:type+'-'+i,index:i,confirmedAt:i+1,type,price:value,status:'inside_rejected',
            structStatus:'rejected',structConfirmedAt:null,supersededAt:null,comp:'',zoneId:zIndex});
          emit(i+1,'swing',(type==='SH'?'Swing High':'Swing Low')+' cục bộ · '+hhmm(b.time),
            'Giá '+value.toFixed(2)+'. VÔ HIỆU: điểm nằm trong biên nến mẹ '+hhmm(mother.time)+'.','error',i,
            {type,pivotTime:hhmm(b.time),confirmationTime:hhmm(rawRight.time),price:value,status:'inside_rejected',motherTime:hhmm(mother.time)});
        }
        continue;
      }
      const left=motherOf(i-1);
      const leftHigh=b.high>left.high,leftLow=b.low<left.low;
      if(!leftHigh&&!leftLow)continue;
      let r=i+1;
      const childZone=insideByIndex[i+1];
      if(childZone!==null&&zones[childZone].mother===i)r=zones[childZone].brokenAt;
      if(r===null||r===undefined)continue; // ISB not broken yet: unknown, never shown early
      const right=c[r],viaIsb=r!==i+1;
      for(const type of ['SH','SL']){
        if((type==='SH'&&!leftHigh)||(type==='SL'&&!leftLow))continue;
        const value=type==='SH'?b.high:b.low;
        // Ordinary 3-bar test is strict. After an ISB, the breakout only has to
        // NOT exceed the extreme (equal high/low means it broke the other side).
        const ok=viaIsb?(type==='SH'?right.high<=b.high:right.low>=b.low):
                        (type==='SH'?b.high>right.high:b.low<right.low);
        if(!ok&&!viaIsb)continue; // ordinary non-turn, not a candidate
        const status=ok?'eligible':'isb_rejected';
        swings.push({id:type+'-'+i,index:i,confirmedAt:r,type,price:value,status,
          structStatus:ok?'pending':'rejected',structConfirmedAt:null,supersededAt:null,comp:'',zoneId:null,
          isbBreakAt:viaIsb?r:null});
        emit(r,'swing',(type==='SH'?'Swing High':'Swing Low')+' cục bộ · '+hhmm(b.time),
          'Giá '+value.toFixed(2)+'; '+(viaIsb?'nến '+hhmm(right.time)+' phá biên Inside Bar của nến mẹ '+hhmm(b.time)+'. ':'xác nhận khi nến '+hhmm(right.time)+' đóng. ')+
          (ok?'Qua bộ lọc Inside Bar; kiểm tra đỉnh–đáy luân phiên.':'VÔ HIỆU: nến phá biên vượt qua cực trị này.'),
          ok?'info':'error',i,{type,pivotTime:hhmm(b.time),confirmationTime:hhmm(right.time),price:value,status,isbBreakTime:viaIsb?hhmm(right.time):null});
      }
    }

    // Causal alternation (B2/B3): SH and SL must alternate. Processed in
    // confirmation order, exactly as a live feed would deliver them:
    //  - opposite type      -> accepted at its own confirmation candle;
    //  - same type, more extreme -> the previous one is superseded AT THIS
    //    candle (supersededAt), the new one is accepted;
    //  - same type, not more extreme -> ignored, never shown as structure
    //    (e.g. a lower SH in a falling leg with no SL in between).
    // Earlier prefixes are never rewritten: `accepted` keeps superseded pivots
    // with their supersededAt so downstream replay can be reproduced causally.
    const eligible=swings.filter(p=>p.status==='eligible').sort((x,y)=>x.confirmedAt-y.confirmedAt||x.index-y.index);
    const path=[],accepted=[];
    for(const p of eligible){
      const previous=path[path.length-1];
      if(previous&&previous.type===p.type){
        const moreExtreme=p.type==='SH'?p.price>previous.price:p.price<previous.price;
        if(!moreExtreme){
          p.structStatus='ignored';
          emit(p.confirmedAt,'replace','Không dùng '+p.type+' trùng loại',
            'Chưa có '+(p.type==='SH'?'Swing Low':'Swing High')+' hợp lệ kể từ '+p.type+' '+hhmm(c[previous.index].time)+' ('+previous.price.toFixed(2)+'); '+p.type+' '+hhmm(c[p.index].time)+' không phải đỉnh/đáy cấu trúc.',
            'warning',p.index,{type:p.type,action:'ignore',previousTime:hhmm(c[previous.index].time),newTime:hhmm(c[p.index].time)});
          continue;
        }
        previous.structStatus='superseded';previous.supersededAt=p.confirmedAt;
        p.structStatus='confirmed';p.structConfirmedAt=p.confirmedAt;
        path[path.length-1]=p;accepted.push(p);
        emit(p.confirmedAt,'replace','Dời '+p.type+' sang mốc mới',
          'Mốc '+hhmm(c[previous.index].time)+' được thay bằng '+hhmm(c[p.index].time)+' do cực trị '+(p.type==='SH'?'cao hơn':'thấp hơn')+' trước khi có swing đối ứng hợp lệ.',
          'warning',p.index,{type:p.type,action:'replace',previousTime:hhmm(c[previous.index].time),newTime:hhmm(c[p.index].time)});
      }else{
        p.structStatus='confirmed';p.structConfirmedAt=p.confirmedAt;
        path.push(p);accepted.push(p);
        if(previous)emit(p.confirmedAt,'pair','Luân phiên '+previous.type+' → '+p.type,
          p.type+' '+hhmm(c[p.index].time)+' xác nhận sau '+previous.type+' '+hhmm(c[previous.index].time)+'.','success',p.index,
          {previousType:previous.type,previousTime:hhmm(c[previous.index].time),oppositeType:p.type,oppositeTime:hhmm(c[p.index].time)});
      }
    }
    const confirmed=path;
    // Classification and trend are replayed in acceptance order over the
    // running path, so a later replacement never rewrites an earlier message.
    const running=[];let previousTrend='unknown';
    for(const p of accepted){
      const last=running[running.length-1];
      if(last&&last.type===p.type)running[running.length-1]=p;else running.push(p);
      const prior=running.slice(0,-1).reverse().find(x=>x.type===p.type);
      p.comp=!prior?p.type:p.type==='SH'?(p.price>prior.price?'HH':p.price<prior.price?'LH':'EQH'):
        (p.price>prior.price?'HL':p.price<prior.price?'LL':'EQL');
      if(prior){
        const short=p.comp,kind=(short==='HH'||short==='HL')?'success':(short==='LH'||short==='LL')?'warning':'neutral';
        emit(p.structConfirmedAt,'classification','Nhận diện '+short+' · '+hhmm(c[p.index].time),
          p.type+' '+p.price.toFixed(2)+' so với '+prior.price.toFixed(2)+' tại '+hhmm(c[prior.index].time)+'.',kind,p.index,{type:p.type,classification:short,pivotTime:hhmm(c[p.index].time),price:p.price,previousPrice:prior.price,previousTime:hhmm(c[prior.index].time)});
      }
      const vH=running.filter(x=>x.type==='SH'),vL=running.filter(x=>x.type==='SL');
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
    const ORDER=['start','breakout','inside','swing','replace','pair','classification','trend'];
    events.sort((a,b)=>a.at-b.at||ORDER.indexOf(a.kind)-ORDER.indexOf(b.kind));
    const summary={raw:swings.length,insideRejected:swings.filter(s=>s.status==='inside_rejected').length,
      ambiguous:swings.filter(s=>s.status==='ambiguous').length,
      superseded:swings.filter(s=>s.structStatus==='superseded').length,ignored:swings.filter(s=>s.structStatus==='ignored').length,isbRejected:swings.filter(s=>s.status==='isb_rejected').length,
      confirmed:confirmed.length,pending:swings.filter(s=>s.structStatus==='pending').length,
      insideCandles:insideByIndex.filter(x=>x!==null).length};
    return {candles:c,zones,insideByIndex,swings,path,confirmed,accepted,events,trend,reason,summary,lastH,lastL,end};
  }

  return {analyzePrefix};
});
