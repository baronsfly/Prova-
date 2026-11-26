export function createWeeklyRest({canonicalDutyType,entryChrono,isFlight,isPositioning,upper}){
  const WEEKLY_REST_HOUR=3600000;
  const weeklyRestFormatters=new Map();
  function weeklyLocalParts(ms,zone){
    if(!zone)return null;
    try{
      if(!weeklyRestFormatters.has(zone))weeklyRestFormatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
      return Object.fromEntries(weeklyRestFormatters.get(zone).formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    }catch{return null}
  }
  function weeklyLocalInstant(day,hour,zone){
    const d=new Date(day),wanted=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hour);
    let candidate=wanted;
    for(let i=0;i<4;i++){
      const p=weeklyLocalParts(candidate,zone);if(!p)return null;
      const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second),delta=wanted-represented;
      if(!delta)return candidate;candidate+=delta;
    }
    return null;
  }
  function weeklyRestQualification(start,end,zone){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<36*WEEKLY_REST_HOUR)return null;
    const p=weeklyLocalParts(start,zone);if(!p)return null;
    const firstDay=Date.UTC(p.year,p.month-1,p.day),nights=[];
    for(let i=0;i<4&&nights.length<2;i++){
      const nightStart=weeklyLocalInstant(firstDay+i*24*WEEKLY_REST_HOUR,22,zone),nightEnd=weeklyLocalInstant(firstDay+(i+1)*24*WEEKLY_REST_HOUR,8,zone);
      if(nightStart===null||nightEnd===null)return null;
      if(nightStart>=start&&nightEnd<=end)nights.push({start:nightStart,end:nightEnd});
    }
    if(nights.length<2)return null;
    return {start,end,zone,nights,qualifiedAt:Math.max(start+36*WEEKLY_REST_HOUR,nights[1].end)};
  }
  function weeklyRestProjection(windows,asOf,ongoingRestConfirmed=false){
    const sorted=windows.filter(w=>w.start<=asOf).map(w=>({...w,end:Math.min(w.end,asOf)})).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
    for(const w of sorted){
      const last=merged.length?merged[merged.length-1]:null;
      if(last&&w.start<=last.end){
        last.unknown=last.unknown||w.unknown;
        if(w.end>last.end){last.end=w.end;last.zone=w.zone;last.open=w.open}
        else if(w.end===last.end&&w.zone!==last.zone)last.zone=null;
      }else merged.push({...w});
    }
    let reset=null,lastRest=null,uncertain=false;const violations=[];
    const checkGap=(previous,end)=>{
      if(previous.unknown||previous.open)return;
      if(end-previous.end>=36*WEEKLY_REST_HOUR&&!previous.zone){uncertain=true;return}
      const rest=weeklyRestQualification(previous.end,end,previous.zone);
      if(!rest)return;
      if(reset!==null&&rest.qualifiedAt>reset+168*WEEKLY_REST_HOUR)violations.push({deadline:reset+168*WEEKLY_REST_HOUR,restQualifiedAt:rest.qualifiedAt});
      // Every recognized weekly rest restarts the counter, not every End of Duty.
      reset=rest.end;lastRest=rest;uncertain=false;
    };
    for(let i=0;i<merged.length;i++){
      if(i)checkGap(merged[i-1],merged[i].start);
      if(merged[i].unknown){reset=null;lastRest=null;uncertain=true}
    }
    const last=merged.length?merged[merged.length-1]:null;if(last&&ongoingRestConfirmed)checkGap(last,asOf);
    const deadline=reset===null?null:reset+168*WEEKLY_REST_HOUR;
    return {status:uncertain||deadline===null?'unknown':asOf>deadline?'overdue':'ok',reset,deadline,lastRest,violations,remaining:deadline===null?null:deadline-asOf,asOf};
  }
  function weeklyDutyWindows(rows,asOf,zones){
    // One dutyRootId is ONE duty window. Child entries can contain a manual
    // DUTY OFF only; they must not become separate, unknown duty intervals.
    const byId=new Map(rows.map(r=>[r.id,r])),groups=new Map(),windows=[];
    for(const row of rows){
      if(['Day OFF','Annual Leave','Sick Leave'].includes(canonicalDutyType(row.dutyType)))continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))continue;
      const rootId=row.dutyRootId||row.id;
      if(!groups.has(rootId))groups.set(rootId,[]);
      groups.get(rootId).push(row);
    }
    const parseClock=(row,key)=>/^\d{2}:\d{2}$/.test(row[key]||'')?Date.parse(row.date+'T'+row[key]+':00Z'):null;
    for(const [rootId,members] of groups){
      const ordered=[...members].sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
      const root=byId.get(rootId)||ordered[0];
      const control=root?.dutyControl||ordered.find(r=>r.dutyControl)?.dutyControl;
      const day=Date.parse(ordered[0].date+'T00:00:00Z');
      let start=null,end=null,open=false;
      if(control){
        start=Date.parse(control.start);
        open=control.state==='OPEN';
        end=open?asOf:Date.parse(control.end);
      }else{
        const starts=ordered.map(r=>parseClock(r,'onDuty')).filter(Number.isFinite);
        const ends=ordered.map(r=>parseClock(r,'offDuty')).filter(Number.isFinite);
        if(starts.length)start=Math.min(...starts);
        if(ends.length){
          end=Math.max(...ends);
          if(Number.isFinite(start))while(end<start)end+=24*WEEKLY_REST_HOUR;
        }
      }
      let locationRow=ordered.find(r=>r.id===control?.endEntryId)||null;
      if(!locationRow)locationRow=[...ordered].reverse().find(r=>r.arr||r.location||r.dep)||ordered[ordered.length-1];
      const station=isFlight(locationRow)||isPositioning(locationRow)?locationRow.arr||locationRow.dep:locationRow.location||locationRow.arr||locationRow.dep;
      const zone=zones.get(upper(station||''))||null;
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<start){
        windows.push({start:day,end:day+24*WEEKLY_REST_HOUR,unknown:true,zone:null,rootId});
      }else windows.push({start,end,open,zone,unknown:false,rootId});
    }
    return windows;
  }
  return {weeklyRestProjection,weeklyDutyWindows};
}
