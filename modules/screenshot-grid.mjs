export function createScreenshotGrid({upper,canonicalDutyType,coreActivityRows,normalDate,rosterFlightDigits}){
function normalizeScreenshotDate(v){
  const s=String(v||'').trim();
  let m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if(m){
    let y=m[3]; if(y.length===2)y=`20${y}`;
    return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }
  m=s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  return normalDate(s);
}
function normalizeOcrTime(v){
  const s=String(v||'').trim().replace('.',':');
  const m=s.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i);
  return m?`${String(m[1]).padStart(2,'0')}:${m[2]}`:'';
}
function classifyScreenshotDuty(text){
  const s=upper(text||'');
  if(/\bSTBY\b|STANDBY|\bHSBY\b/.test(s))return'STBY';
  if(/\bDHP\b/.test(s))return'DHP';
  if(/\bDHD\b|DEADHEAD|POSITIONING|TRANSFER|\bTGV\b|PICK\s*UP/.test(s))return'DHD';
  if(/\bSIM\b|SIMULATOR|FSTD|FFS/.test(s))return'Simulator';
  if(/GROUND\s*COURSE|\bGRT\b|\bCRM\b|\bSEP\b|COURSE|TRAINING\s*GROUND/.test(s))return'Ground Course';
  if(/\bDUTY\b/.test(s)&&!/\bFLIGHT\b/.test(s))return'Duty';
  return'Flight';
}
function screenshotFlightNumbers(text){
  const out=[];
  const seen=new Set();
  const re=/\b(?:3O|MAC)\s*[- ]?(\d{2,4})\b/gi;
  let m;
  while((m=re.exec(text))){
    const x=`3O${m[1]}`;
    if(!seen.has(x)){seen.add(x);out.push(x)}
  }
  return out;
}
function screenshotRoutes(text){
  const routes=[];
  const re=/\b([A-Z]{3})\s*(?:→|->|–>|-|TO)\s*([A-Z]{3})\b/g;
  let m;
  while((m=re.exec(upper(text||''))))routes.push([m[1],m[2]]);
  return routes;
}
function screenshotTimes(text){
  const out=[];
  const re=/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  let m;
  while((m=re.exec(text))){
    const t=normalizeOcrTime(m[0]);
    if(t&&!out.includes(t))out.push(t)
  }
  return out;
}
function screenshotAirports(text){
  const stop=new Set(['THE','AND','PIC','SIC','SIM','FSTD','OFF','OUT','DAY','NIGHT','DUTY','TOTAL','FROM','DATE','TIME','FLIGHT','COURSE','CRM','GRT','SEP','MAC']);
  return [...new Set((upper(text||'').match(/\b[A-Z]{3}\b/g)||[]).filter(x=>!stop.has(x)))];
}
function ocrDateMatches(line){
  return [...String(line||'').matchAll(/\b(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})\b/g)].map(m=>m[0]);
}
function screenshotMissingFields(r){
  const missing=[],dutyType=r?.dutyType==='To complete'?'To complete':canonicalDutyType(r?.dutyType||'');
  if(!r?.date)missing.push('date');
  if(!r?.dutyType||dutyType==='To complete')missing.push('dutyType');

  if(dutyType==='Flight'){
    if(!r.flightNo)missing.push('flightNo');
    if(!r.dep)missing.push('dep');
    if(!r.arr)missing.push('arr');
    if(r.target==='roster'){
      if(!r.start)missing.push('start');
      if(!r.end)missing.push('end');
    }
  }else if(dutyType==='DHD'||dutyType==='DHP'){
    if(!r.dep)missing.push('dep');
    if(!r.arr)missing.push('arr');
    if(!r.start)missing.push('start');
    if(!r.end)missing.push('end');
  }else if(dutyType==='STBY'||dutyType==='Simulator'){
    if(!r.start)missing.push('start');
    if(!r.end)missing.push('end');
  }else if(dutyType==='Ground Course'){
    if(!r.start)missing.push('start');
  }

  return [...new Set(missing)];
}
function screenshotRowReady(r){return screenshotMissingFields(r).length===0}
function makeScreenshotRow(o={}){
  const row={
    include:o.include!==false,
    target:o.target||'entries',
    date:o.date||'',
    dutyType:o.dutyType&&o.dutyType!=='To complete'?canonicalDutyType(o.dutyType):'To complete',
    flightNo:o.flightNo||'',
    dep:upper(o.dep||''),
    arr:upper(o.arr||''),
    start:o.start||'',
    end:o.end||'',
    remarks:o.remarks||'',
    rawText:o.rawText||o.remarks||'',
    parserNote:o.parserNote||''
  };
  row.needsReview=!screenshotRowReady(row);
  return row;
}
function screenshotReviewSummaryData(){
  const selected=screenshotReviewRows.filter(r=>r.include);
  const incomplete=selected.filter(r=>!screenshotRowReady(r));
  return{selected:selected.length,incomplete:incomplete.length,ready:selected.length-incomplete.length};
}
function screenshotBlockWords(blocks){
  const out=[];
  (blocks||[]).forEach(block=>(block.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(line=>
    (line.words||[]).forEach(w=>{
      const b=w.bbox||{},text=String(w.text||'').trim();
      if(!text||!Number.isFinite(b.x0)||!Number.isFinite(b.y0)||!Number.isFinite(b.x1)||!Number.isFinite(b.y1))return;
      out.push({text,x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1,cx:(b.x0+b.x1)/2,cy:(b.y0+b.y1)/2});
    })
  )));
  return out;
}
function screenshotWordLines(words){
  if(!words.length)return[];
  const hs=words.map(w=>Math.max(1,w.y1-w.y0)).sort((a,b)=>a-b);
  const medianH=hs[Math.floor(hs.length/2)]||12,tol=Math.max(5,medianH*.8);
  const sorted=[...words].sort((a,b)=>a.cy-b.cy||a.x0-b.x0),lines=[];
  for(const w of sorted){
    let line=lines.find(l=>Math.abs(l.cy-w.cy)<=tol);
    if(!line){line={words:[],cy:w.cy};lines.push(line)}
    line.words.push(w);
    line.cy=(line.cy*(line.words.length-1)+w.cy)/line.words.length;
  }
  return lines.sort((a,b)=>a.cy-b.cy).map(l=>{
    l.words.sort((a,b)=>a.x0-b.x0);
    l.text=l.words.map(w=>w.text).join(' ');
    l.x0=Math.min(...l.words.map(w=>w.x0));l.x1=Math.max(...l.words.map(w=>w.x1));
    l.y0=Math.min(...l.words.map(w=>w.y0));l.y1=Math.max(...l.words.map(w=>w.y1));
    return l;
  });
}
function crewScheduleYear(text){
  const years=[...String(text||'').matchAll(/\b(20\d{2})\b/g)].map(m=>Number(m[1]));
  return years[0]||new Date().getFullYear();
}
function crewScheduleDefaultMonth(text){
  const s=upper(text||'');
  for(const [name,num] of Object.entries(OCR_MONTHS)){
    if(new RegExp(`\\b${name}\\b`).test(s))return num;
  }
  return new Date().getMonth()+1;
}
function cleanOcrToken(v){return upper(v||'').replace(/[^A-Z0-9]/g,'')}
function crewScheduleDateHeaders(words,text){
  const lines=screenshotWordLines(words),year=crewScheduleYear(text),defaultMonth=crewScheduleDefaultMonth(text),headers=[];
  for(const line of lines){
    const ws=line.words;
    for(let i=0;i<ws.length;i++){
      const token=cleanOcrToken(ws[i].text),isDayName=OCR_DAY_NAMES.has(token);
      let day=null,month=null,start=i,end=i;
      if(isDayName){
        for(let j=i+1;j<=Math.min(i+3,ws.length-1);j++){
          const t=cleanOcrToken(ws[j].text);
          if(day===null&&/^\d{1,2}$/.test(t)&&Number(t)>=1&&Number(t)<=31){day=Number(t);end=j;continue}
          if(day!==null&&OCR_MONTHS[t]){month=OCR_MONTHS[t];end=j;break}
        }
        if(day!==null&&!month)month=defaultMonth;
      }else if(/^\d{1,2}$/.test(token)&&Number(token)>=1&&Number(token)<=31){
        const next=cleanOcrToken(ws[i+1]?.text);
        if(OCR_MONTHS[next]){day=Number(token);month=OCR_MONTHS[next];end=i+1}
      }
      if(day!==null&&month){
        const chosen=ws.slice(start,end+1);
        headers.push({
          date:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
          x0:Math.min(...chosen.map(w=>w.x0)),x1:Math.max(...chosen.map(w=>w.x1)),
          y0:Math.min(...chosen.map(w=>w.y0)),y1:Math.max(...chosen.map(w=>w.y1)),
          cx:chosen.reduce((s,w)=>s+w.cx,0)/chosen.length,
          cy:chosen.reduce((s,w)=>s+w.cy,0)/chosen.length
        });
        i=end;
      }
    }
  }
  const dedup=[];
  headers.sort((a,b)=>a.cy-b.cy||a.cx-b.cx).forEach(h=>{
    if(!dedup.some(x=>x.date===h.date&&Math.abs(x.cx-h.cx)<20&&Math.abs(x.cy-h.cy)<20))dedup.push(h);
  });
  return dedup;
}
function clusterCrewHeaderRows(headers){
  if(!headers.length)return[];
  const hs=headers.map(h=>Math.max(1,h.y1-h.y0)).sort((a,b)=>a-b);
  const tol=Math.max(8,(hs[Math.floor(hs.length/2)]||12)*1.6),rows=[];
  [...headers].sort((a,b)=>a.cy-b.cy||a.cx-b.cx).forEach(h=>{
    let row=rows.find(r=>Math.abs(r.cy-h.cy)<=tol);
    if(!row){row={headers:[],cy:h.cy};rows.push(row)}
    row.headers.push(h);
    row.cy=(row.cy*(row.headers.length-1)+h.cy)/row.headers.length;
  });
  rows.forEach(r=>r.headers.sort((a,b)=>a.cx-b.cx));
  return rows.sort((a,b)=>a.cy-b.cy);
}
function crewScheduleFooterY(words,lastHeaderY){
  const footer=words.filter(w=>w.cy>lastHeaderY&&/^(REPORTING|MEMO)$/i.test(cleanOcrToken(w.text))).map(w=>w.y0);
  return footer.length?Math.min(...footer):null;
}
function crewScheduleCellWords(words,row,rowIndex,rows,headerIndex,footerY=null){
  const hs=row.headers,h=hs[headerIndex];
  const gaps=hs.slice(1).map((x,i)=>x.cx-hs[i].cx).filter(x=>x>10).sort((a,b)=>a-b);
  const spacing=gaps[Math.floor(gaps.length/2)]||Math.max(50,h.x1-h.x0+20);
  const left=headerIndex>0?(hs[headerIndex-1].cx+h.cx)/2:h.cx-spacing/2;
  const right=headerIndex<hs.length-1?(h.cx+hs[headerIndex+1].cx)/2:h.cx+spacing/2;
  const nextRowY=rowIndex<rows.length-1?Math.min(...rows[rowIndex+1].headers.map(x=>x.y0)):null;
  const rowEnd=nextRowY||footerY||Math.max(...words.map(w=>w.y1))+10;
  const rowHeight=Math.max(30,rowEnd-h.y1);
  const contentEnd=rowEnd-Math.max(10,rowHeight*.14);
  return words.filter(w=>w.cx>=left&&w.cx<right&&w.cy>h.y1&&w.cy<contentEnd);
}
function gridLineFlightNos(line){
  const text=upper(line||'').replace(/[|]/g,' ');
  const out=[],re=/\b(?:3[O0Q]|MAC)\s*[- ]?(\d{2,4})\b/g;
  let m;while((m=re.exec(text)))out.push(`3O${m[1]}`);
  return out;
}
function inferScreenshotRoute(flightNo){
  const digits=rosterFlightDigits(flightNo||'');
  if(!digits)return{dep:'',arr:''};
  const candidates=coreActivityRows().filter(isFlight).filter(x=>rosterFlightDigits(x.flightNo||'')===digits&&x.dep&&x.arr)
   .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  return candidates.length?{dep:upper(candidates[0].dep),arr:upper(candidates[0].arr)}:{dep:'',arr:''};
}
function gridCellRows(date,cellWords){
  if(!cellWords.length)return[];
  const lines=screenshotWordLines(cellWords),
    raw=lines.map(l=>l.text).join(' ').replace(/\s+/g,' ').trim(),
    blob=upper(raw),
    rows=[];

  const hasFlights=lines.some(l=>gridLineFlightNos(l.text).length);
  if(/\bOFF\b/.test(blob)&&!hasFlights){
    return[makeScreenshotRow({
      target:'duty',date,dutyType:'Day OFF',
      remarks:raw||'OFF',rawText:raw||'OFF'
    })];
  }

  for(const line of lines){
    const txt=upper(line.text),flights=gridLineFlightNos(txt),times=screenshotTimes(txt);

    if(flights.length){
      flights.forEach((flightNo,i)=>{
        const route=inferScreenshotRoute(flightNo);
        rows.push(makeScreenshotRow({
          target:'roster',date,dutyType:'Flight',flightNo,
          dep:route.dep,arr:route.arr,
          start:times[Math.min(i,times.length-1)]||'',end:'',
          remarks:line.text,rawText:line.text,
          parserNote:(!route.dep||!route.arr)?'Complete From/To.':''
        }));
      });
      continue;
    }

    if(/\bDHP\b|\bDHD\b|DEADHEAD/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({
        target:'entries',date,dutyType:/\bDHP\b/.test(txt)?'DHP':'DHD',
        dep:airports[0]||'',arr:airports[1]||'',
        start:times[0]||'',end:times[1]||'',
        remarks:line.text,rawText:line.text
      }));
      continue;
    }

    if(/\bHSBY\b|\bSTBY\b|STANDBY/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({
        target:'entries',date,dutyType:'STBY',
        dep:airports[0]||'',
        start:times[0]||'',end:times[1]||'',
        remarks:line.text,rawText:line.text
      }));
      continue;
    }

    if(/\bSIM\b|SIMULATOR|FSTD|FFS/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({
        target:'entries',date,dutyType:'Simulator',
        dep:airports[0]||'',
        start:times[0]||'',end:times[1]||'',
        remarks:line.text,rawText:line.text
      }));
      continue;
    }

    if(/\bGRT\b|\bCRM\b|\bSMS\b|\bSEP\b|\bDGR\b|\bAVSEC\b|FIRST\s*AID|\bUPRT\b|GROUND\s*COURSE|COURSE/.test(txt)){
      rows.push(makeScreenshotRow({
        target:'entries',date,dutyType:'Ground Course',
        start:times[0]||'',end:times[1]||'',
        remarks:line.text,rawText:line.text
      }));
    }
  }

  // If we understood at least one activity, keep the original OCR in Remarks
  // of those rows. Missing fields will be highlighted in Review.
  if(rows.length)return rows;

  // Never silently discard a non-empty cell.
  // Ignore only obvious bottom-of-cell totals made exclusively of numbers/times.
  const totalsOnly=/^(?:\d{1,2}[:.]\d{2}|\d+(?:[.,]\d+)?|\s|-)+$/.test(raw);
  if(raw&&!totalsOnly){
    return[makeScreenshotRow({
      target:'entries',date,dutyType:'To complete',
      remarks:raw.slice(0,220),rawText:raw,
      parserNote:'PilotLog could not classify this cell.'
    })];
  }
  return[];
}
function parseCrewScheduleGrid(layout,text){
  const words=screenshotBlockWords(layout?.blocks||[]);
  if(words.length<10)return[];
  const headers=crewScheduleDateHeaders(words,text),rows=clusterCrewHeaderRows(headers);
  if(headers.length<4||rows.length<1)return[];
  const footerY=crewScheduleFooterY(words,Math.max(...headers.map(h=>h.cy)));
  const out=[];
  rows.forEach((row,rowIndex)=>row.headers.forEach((h,i)=>{
    out.push(...gridCellRows(h.date,crewScheduleCellWords(words,row,rowIndex,rows,i,footerY)));
  }));
  const seen=new Set();
  return out.filter(r=>{
    const k=[r.target,r.date,r.dutyType,r.flightNo,r.dep,r.arr,r.start,r.end].join('|');
    if(seen.has(k))return false;
    seen.add(k);return true;
  });
}
function crewScheduleUnparsedRows(layout,text){
  const words=screenshotBlockWords(layout?.blocks||[]);
  const lines=screenshotWordLines(words)
    .map(l=>l.text.replace(/\s+/g,' ').trim())
    .filter(Boolean)
    .filter(t=>!/INDIVIDUAL\s+CREW\s+SCHEDULE|CURRENT\s+MONTH|REPORTING\s+TIME|MEMO|CREW\s+NAME|CREW\s+ID/i.test(t));

  const meaningful=lines.filter(t=>
    /\b(?:3[O0Q]|MAC)\s*[- ]?\d{2,4}\b|\bOFF\b|\bDHD\b|\bSTBY\b|\bHSBY\b|\bSIM\b|\bGRT\b|\bCRM\b|\bSMS\b|\bSEP\b|\bDGR\b|\bAVSEC\b|\bA320\b|\d{1,2}[:.]\d{2}/i.test(t)
  );

  const source=meaningful.length?meaningful:String(text||'').replace(/\s+/g,' ').trim()?[String(text||'').replace(/\s+/g,' ').trim()]:[];
  return source.slice(0,40).map(t=>makeScreenshotRow({
    target:'entries',date:'',dutyType:'To complete',
    remarks:t.slice(0,220),rawText:t,
    parserNote:'OCR recovered text but could not safely assign its date/type.'
  }));
}
function crewScheduleCellRects(layout,text,width,height){
  const words=screenshotBlockWords(layout?.blocks||[]);
  if(words.length<10)return[];
  const headers=crewScheduleDateHeaders(words,text),rows=clusterCrewHeaderRows(headers);
  if(headers.length<4||!rows.length)return[];
  const footerY=crewScheduleFooterY(words,Math.max(...headers.map(h=>h.cy)))||height;
  const rects=[];

  rows.forEach((row,rowIndex)=>{
    const hs=row.headers;
    const gaps=hs.slice(1).map((x,i)=>x.cx-hs[i].cx).filter(x=>x>15).sort((a,b)=>a-b);
    const spacing=gaps[Math.floor(gaps.length/2)]||Math.max(60,width/Math.max(1,hs.length));
    const nextTop=rowIndex<rows.length-1?Math.min(...rows[rowIndex+1].headers.map(x=>x.y0)):footerY;
    const rowBottom=Math.min(height,nextTop);
    const contentTop=Math.max(...hs.map(h=>h.y1))+2;
    const rowHeight=Math.max(30,rowBottom-contentTop);
    const bodyBottom=rowBottom-Math.max(8,rowHeight*.12);

    hs.forEach((h,i)=>{
      const left=i>0?(hs[i-1].cx+h.cx)/2:h.cx-spacing/2;
      const right=i<hs.length-1?(h.cx+hs[i+1].cx)/2:h.cx+spacing/2;
      const x=Math.max(0,Math.floor(left+2)),y=Math.max(0,Math.floor(contentTop));
      const r=Math.min(width,Math.ceil(right-2)),b=Math.min(height,Math.floor(bodyBottom));
      if(r-x>20&&b-y>18)rects.push({date:h.date,x,y,width:r-x,height:b-y});
    });
  });

  const seen=new Set();
  return rects.filter(r=>{if(seen.has(r.date))return false;seen.add(r.date);return true})
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function smartCellUsefulText(text){
  const s=String(text||'').replace(/\s+/g,' ').trim();
  if(!s)return false;
  if(/^(?:\d{1,2}[:.]\d{2}|\d+(?:[.,]\d+)?|\s|-)+$/.test(s))return false;
  return /[A-Z]{2,}|\d{2,}/i.test(s);
}
function gridCellTextRows(date,text){
  const raw=String(text||'').replace(/\r/g,'').trim();
  if(!raw)return[];
  const lines=raw.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const blob=upper(lines.join(' ')),rows=[];
  const hasFlight=lines.some(x=>gridLineFlightNos(x).length);

  if(/\bOFF\b/.test(blob)&&!hasFlight){
    return[makeScreenshotRow({target:'duty',date,dutyType:'Day OFF',remarks:raw.slice(0,220),rawText:raw,parserNote:'Smart Cell Scan'})];
  }

  for(const line of lines){
    const txt=upper(line),flightNos=gridLineFlightNos(txt),times=screenshotTimes(txt);
    if(flightNos.length){
      flightNos.forEach((flightNo,i)=>{
        const route=inferScreenshotRoute(flightNo);
        rows.push(makeScreenshotRow({
          target:'roster',date,dutyType:'Flight',flightNo,dep:route.dep,arr:route.arr,
          start:times[Math.min(i,times.length-1)]||'',end:'',remarks:line,rawText:line,
          parserNote:(!route.dep||!route.arr)?'Smart Cell Scan • complete From/To and clipped times.':'Smart Cell Scan • complete clipped times.'
        }));
      });
      continue;
    }
    if(/\bDHD\b|DEADHEAD/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({target:'entries',date,dutyType:'DHD',dep:airports[0]||'',arr:airports[1]||'',start:times[0]||'',end:times[1]||'',remarks:line,rawText:line,parserNote:'Smart Cell Scan'}));
      continue;
    }
    if(/\bHSBY\b|\bSTBY\b|STANDBY/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({target:'entries',date,dutyType:'STBY',dep:airports[0]||'',start:times[0]||'',end:times[1]||'',remarks:line,rawText:line,parserNote:'Smart Cell Scan'}));
      continue;
    }
    if(/\bSIM\b|SIMULATOR|\bFSTD\b|\bFFS\b/.test(txt)){
      const airports=screenshotAirports(txt);
      rows.push(makeScreenshotRow({target:'entries',date,dutyType:'Simulator',dep:airports[0]||'',start:times[0]||'',end:times[1]||'',remarks:line,rawText:line,parserNote:'Smart Cell Scan'}));
      continue;
    }
    if(/\bGRT\b|\bCRM\b|\bSMS\b|\bSEP\b|\bDGR\b|\bAVSEC\b|FIRST\s*AID|\bUPRT\b|GROUND\s*COURSE|COURSE/.test(txt)){
      rows.push(makeScreenshotRow({target:'entries',date,dutyType:'Ground Course',start:times[0]||'',end:times[1]||'',remarks:line,rawText:line,parserNote:'Smart Cell Scan'}));
    }
  }

  if(rows.length)return rows;
  if(smartCellUsefulText(raw)){
    return[makeScreenshotRow({target:'entries',date,dutyType:'To complete',remarks:raw.slice(0,220),rawText:raw,parserNote:'Smart Cell Scan read this day but could not classify it.'})];
  }
  return[];
}
function parseSmartCrewScheduleCells(cells){
  const out=[];
  (cells||[]).forEach(cell=>out.push(...gridCellTextRows(cell.date,cell.text)));
  const seen=new Set();
  return out.filter(r=>{
    const k=[r.target,r.date,r.dutyType,r.flightNo,r.dep,r.arr,r.start,r.end,r.remarks].join('|');
    if(seen.has(k))return false;seen.add(k);return true;
  });
}
return {normalizeScreenshotDate,normalizeOcrTime,classifyScreenshotDuty,screenshotFlightNumbers,screenshotRoutes,screenshotTimes,screenshotAirports,ocrDateMatches,screenshotMissingFields,screenshotRowReady,makeScreenshotRow,screenshotReviewSummaryData,screenshotBlockWords,screenshotWordLines,crewScheduleYear,crewScheduleDefaultMonth,cleanOcrToken,crewScheduleDateHeaders,clusterCrewHeaderRows,crewScheduleFooterY,crewScheduleCellWords,gridLineFlightNos,inferScreenshotRoute,gridCellRows,parseCrewScheduleGrid,crewScheduleUnparsedRows,crewScheduleCellRects,smartCellUsefulText,gridCellTextRows,parseSmartCrewScheduleCells};
}
