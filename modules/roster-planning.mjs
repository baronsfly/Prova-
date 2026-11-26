export function createRosterPlanning({displayActivityRows,inMonth,activityIncludedInResults,isFlight,entryChrono,tripSequenceStart}){
  function planningEntry(r){
    if(activityIncludedInResults(r))return {...r,_payrollRosterSynthetic:false,_trainingAuthoritative:true};
    const flight=isFlight(r);
    return {...r,onDuty:flight?'':r.onDuty,offDuty:flight?'':r.offDuty,_payrollRosterSynthetic:flight,_trainingAuthoritative:false};
  }
  function rosterMonthAvailable(month){
    if(!month)return false;
    return displayActivityRows().some(r=>inMonth(r.date,month)&&!r.rosterHidden);
  }
  function operationalEntriesForMonth(month){
    return displayActivityRows()
      .filter(r=>inMonth(r.date,month)&&!r.rosterHidden)
      .map(planningEntry)
      .sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
  }
  function operationalEntriesForTrips(){
    const activities=displayActivityRows().filter(r=>!r.rosterHidden),byMonth=new Map();
    for(const r of activities){
      const month=String(r?.date||'').slice(0,7);if(!month)continue;
      if(!byMonth.has(month))byMonth.set(month,[]);
      byMonth.get(month).push(r);
    }
    const out=[];
    for(const month of [...byMonth.keys()].sort()){
      const rows=byMonth.get(month)||[];
      out.push(...rows.map(planningEntry).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b))));
    }
    return out.sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
  }
  return {rosterMonthAvailable,operationalEntriesForMonth,operationalEntriesForTrips};
}
