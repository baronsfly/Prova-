export function createTripProjection({dayEntries,activityRule,tripSequenceStart,entryStart,zuluDate,creditMinsForEntry,
  controlledDuty,requiresManualDutyControl,shiftTime,dutyDateEnd,operationalEntriesForTrips,groundTripDutyMins,layoverRate,readTrips}){
  function overlapMins(a,b,s,e){const x=Math.max(a.getTime(),s.getTime()),y=Math.min(b.getTime(),e.getTime());return Math.max(0,Math.round((y-x)/60000))}
  function tripChargeableDutyFromEntries(s,e,sourceEntries){
    const lower=new Date(s.getTime()-86400000).toISOString().slice(0,10),upperLimit=new Date(e.getTime()+86400000).toISOString().slice(0,10);
    let total=0;const seenDuties=new Set(),fs=(sourceEntries||[]).filter(f=>f.date&&f.date>=lower&&f.date<=upperLimit),dates=[...new Set(fs.map(f=>f.date).filter(Boolean))];
    dates.forEach(date=>{
      const entries=dayEntries(date,fs);
      for(const item of entries){
        const rule=activityRule(item),marker=tripSequenceStart(item)||entryStart(item)||zuluDate(date,item.onDuty||'00:00');
        if(!marker||marker<s||marker>e)continue;
        if(rule.trip==='fixed-ground')total+=groundTripDutyMins;
        else if(rule.trip==='credit')total+=creditMinsForEntry(item);
      }
      const dutyEntries=entries.filter(x=>{
        if(activityRule(x).trip!=='duty')return false;
        const duty=controlledDuty(x);
        if(duty){if(duty.control.state==='CLOSED'&&!seenDuties.has(duty.root.id)){seenDuties.add(duty.root.id);total+=overlapMins(new Date(duty.control.start),new Date(duty.control.end),s,e)}return false}
        return !requiresManualDutyControl(x);
      });if(!dutyEntries.length)return;
      const first=dutyEntries[0],last=dutyEntries[dutyEntries.length-1],startTime=first.onDuty||shiftTime(first.schedOut||first.out,-60),endTime=last.offDuty||shiftTime(last.schedIn||last.in,30);if(!startTime||!endTime)return;
      const [a,b]=dutyDateEnd(date,startTime,endTime);total+=overlapMins(a,b,s,e);
    });
    return total;
  }
  function calculateTripMetrics(startValue,endValue,cashAmount=0,sourceEntries=null){
    const s=startValue instanceof Date?startValue:new Date(startValue),e=endValue instanceof Date?endValue:new Date(endValue);
    if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||e<=s)return null;
    const trip=Math.round((e-s)/60000),duty=tripChargeableDutyFromEntries(s,e,sourceEntries||operationalEntriesForTrips()),layover=Math.max(0,trip-duty),allowance=Number(cashAmount||0)>0?0:(layover/60)*Number(layoverRate()||0);
    return{start:s,end:e,trip,duty,layover,allowance};
  }
  function calculateSavedTripProjection(savedTrip,sourceEntries=null){
    if(!savedTrip)return null;
    const metrics=calculateTripMetrics(savedTrip.start,savedTrip.end,Number(savedTrip.cashAmount||0),sourceEntries||operationalEntriesForTrips());
    if(!metrics)return null;
    const layover=savedTrip.tripOverrides?.layover??metrics.layover,allowance=Number(savedTrip.cashAmount||0)>0?0:savedTrip.tripOverrides?.allowance??(savedTrip.tripOverrides?.layover!=null?layover/60*Number(layoverRate()||0):metrics.allowance);
    return{...savedTrip,trip:savedTrip.trip??metrics.trip,duty:savedTrip.duty??metrics.duty,layover:savedTrip.layover??layover,allowance:savedTrip.allowance??allowance,calculated:metrics};
  }
  function calculateSavedTripProjections(savedTrips=null,sourceEntries=null){
    const entries=sourceEntries||operationalEntriesForTrips();
    return(savedTrips||readTrips()).map(t=>calculateSavedTripProjection(t,entries)).filter(Boolean);
  }
  return {calculateTripMetrics,calculateSavedTripProjection,calculateSavedTripProjections};
}
