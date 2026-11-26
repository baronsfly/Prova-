export function createDutySessions({controlledDuty,isPositioning,requiresManualDutyControl,isFlight,isSim,shiftTime,zuluDate,dateAtOrAfter,hhmm,maxReasonableDutyMin=18*60}){
  function flightDutyWindow(f){
    if(!f||!f.date)return null;
    const explicit=controlledDuty(f);if(explicit){if(explicit.control.state!=='CLOSED')return null;const report=new Date(explicit.control.start),release=new Date(explicit.control.end);if(!Number.isFinite(+report)||!Number.isFinite(+release)||release<report)return null;return {entry:f,report,release,activityStart:report,activityEnd:release}}
    if(isPositioning(f))return null;
    const controlled=controlledDuty(f);if(controlled?.control.state==='OPEN'||requiresManualDutyControl(f)&&!controlled)return null;
    const scheduledDuty=isFlight(f)||isSim(f),reportTime=f.onDuty||(scheduledDuty&&f.schedOut?shiftTime(f.schedOut,-60):''),releaseTime=f.offDuty||(scheduledDuty&&f.schedIn?shiftTime(f.schedIn,30):'');
    if(!reportTime||!releaseTime)return null;
    const report=controlled?new Date(controlled.control.start):zuluDate(f.date,reportTime),release=controlled?new Date(controlled.control.end):dateAtOrAfter(f.date,releaseTime,report);if(!report||!release)return null;
    let activityStart=report,activityEnd=release;
    if(isFlight(f)){if(!f.out||!f.in)return null;activityStart=zuluDate(f.date,f.out);activityEnd=dateAtOrAfter(f.date,f.in,activityStart)}
    else if(isSim(f)){if(!f.schedOut||!f.schedIn)return null;activityStart=zuluDate(f.date,f.schedOut);activityEnd=dateAtOrAfter(f.date,f.schedIn,activityStart)}
    if(!activityStart||!activityEnd)return null;
    const own=Math.round((release-report)/60000);
    if(own<=0||!controlled&&own>maxReasonableDutyMin){console.warn('Ignoring unreasonable non-flight duty window',f.id,f.date,own);return null}
    return{entry:f,activityStart,activityEnd,report,release};
  }
  function buildDutySessions(fs){
    const windows=(fs||[]).map(flightDutyWindow).filter(Boolean).sort((a,b)=>a.activityStart-b.activityStart);
    const groups=[];let cur=null;
    const push=()=>{if(cur)groups.push(cur);cur=null};
    for(const w of windows){
      if(!cur){cur={windows:[w],report:w.report,release:w.release,activityEnd:w.activityEnd};continue}
      const gap=Math.round((w.activityStart-cur.activityEnd)/60000);
      const proposedRelease=new Date(Math.max(cur.release.getTime(),w.release.getTime()));
      const proposedMinutes=Math.round((proposedRelease-cur.report)/60000);
      const control=controlledDuty(w.entry),previousControl=controlledDuty(cur.windows[0].entry);
      const sameControl=control&&previousControl&&control.root.id===previousControl.root.id;
      const sameDuty=control||previousControl?sameControl:gap>=-120&&gap<=300&&proposedMinutes>0&&proposedMinutes<=maxReasonableDutyMin;
      if(sameDuty){cur.windows.push(w);cur.release=proposedRelease;if(w.activityEnd>cur.activityEnd)cur.activityEnd=w.activityEnd}
      else{push();cur={windows:[w],report:w.report,release:w.release,activityEnd:w.activityEnd}}
    }
    push();
    return groups.map((g,i)=>{
      const entries=g.windows.map(x=>x.entry),flights=entries.filter(isFlight),minutes=Math.round((g.release-g.report)/60000);
      return{id:`duty-${g.report.toISOString()}-${i}`,reportDate:g.report.toISOString().slice(0,10),report:hhmm(g.report),endDate:g.release.toISOString().slice(0,10),end:hhmm(g.release),startDateTime:g.report,endDateTime:g.release,minutes,sectors:flights.length,entries,firstFlight:flights[0]||null,dep:flights[0]?.dep||entries[0]?.dep||'',arr:flights.at(-1)?.arr||entries.at(-1)?.arr||''};
    });
  }
  return {flightDutyWindow,buildDutySessions};
}
