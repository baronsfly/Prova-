export function createStatistics({
  activityRule,isA320Entry,buildAircraftTypeBreakdown,sum,totalFlightMins,timeGroupFinalValue,
  picMins,sicMins,flightInstrMins,simInstrMins,startOfDays,dateOnly,normalizedApproaches,
  today,isoDateLocal,dutyActivityRows,rosterGroups,rosterGroupsByDate,rosterMonthAvailable,
  shiftTime,dutyEndTime,upper,appSettings,isPositioning,operationalEntriesForMonth,dayEntries,
  isLogbookEntry,isFlight,isSim,entriesByDate,creditMinsForEntry
}){
  function buildTotalsModel(entries,now=new Date()){
    const all=entries||[],flying=all.filter(f=>activityRule(f).totals==='flight'),simulators=all.filter(f=>activityRule(f).totals==='simulator');
    const a320Flights=flying.filter(isA320Entry),a320Sims=simulators.filter(isA320Entry);
    return{
      flying,simulators,a320Flights,a320Sims,aircraftTypes:buildAircraftTypeBreakdown(flying,simulators),
      totalFlight:sum(flying,totalFlightMins),totalSimulator:sum(simulators,f=>timeGroupFinalValue(f,'simulatorTime')),a320Flight:sum(a320Flights,totalFlightMins),a320Pic:sum(a320Flights,picMins),a320Sic:sum(a320Flights,sicMins),
      a320FlightInstruction:sum(a320Flights,flightInstrMins),a320SimInstruction:sum(a320Sims,simInstrMins),a320SimulatorTime:sum(a320Sims,f=>timeGroupFinalValue(f,'simulatorTime')),
      rightSeat:sum(flying,f=>f.rhs===true?totalFlightMins(f):0)
    };
  }
  function buildTotalsProjection(entries,now=new Date()){
    const all=entries||[],model=buildTotalsModel(all,now),flying=model.flying,y=now.getUTCFullYear(),m=now.getUTCMonth();
    const rolling=n=>{const start=startOfDays(n,now);return sum(flying,f=>{const d=dateOnly(f.date);return d>=start&&d<=now?totalFlightMins(f):0})};
    const sixMonthsAgo=new Date(now);sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth()-6);sixMonthsAgo.setUTCHours(0,0,0,0);
    const periods=[
      ['This Month — Flight',sum(flying,f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d.getUTCMonth()===m?totalFlightMins(f):0})],
      ['This Year — Flight',sum(flying,f=>dateOnly(f.date).getUTCFullYear()===y?totalFlightMins(f):0)],
      ['Last 28 days — Flight',rolling(28)],['Last 90 days — Flight',rolling(90)],
      ['Last 6 months — Flight',sum(flying,f=>dateOnly(f.date)>=sixMonthsAgo?totalFlightMins(f):0)],['Last 365 days — Flight',rolling(365)]
    ];
    const standardApproachTypes=['CAT3','ILS','LOC','RNAV','RNAV AR','VOR','VOR/DME','NDB','CRCL','VIS','GOA'],approaches={};
    // LogTen stores approaches as their own rows and can associate them with
    // flight or simulator activity, so totals must inspect the complete log.
    all.forEach(f=>normalizedApproaches(f).forEach(a=>approaches[a.type]=(Number(approaches[a.type])||0)+a.quantity));
    const recorded=Object.keys(approaches),approachTypes=[...standardApproachTypes.filter(x=>recorded.includes(x)),...recorded.filter(x=>!standardApproachTypes.includes(x)).sort()];
    const approachCount=Object.values(approaches).reduce((n,v)=>n+(Number(v)||0),0),dayTakeoffs=sum(all,f=>Number(f.dayTakeoffs)||0),nightTakeoffs=sum(all,f=>Number(f.nightTakeoffs)||0),dayLandings=sum(all,f=>Number(f.dayLandings)||0),nightLandings=sum(all,f=>Number(f.nightLandings)||0);
    return{...model,periods,approachTypes,approaches,approachCount,dayTakeoffs,nightTakeoffs,dayLandings,nightLandings};
  }
  function calculateDashboardDutyRows(startOffset,count){
    const todayDate=today(),duties=dutyActivityRows(),groups=rosterGroups(),groupsByDate=rosterGroupsByDate(groups);
    const rows=[];
    for(let i=startOffset;i<startOffset+count;i++){
      const d=new Date(todayDate.getFullYear(),todayDate.getMonth(),todayDate.getDate()+i),date=isoDateLocal(d),month=date.slice(0,7);
      const dayLabel=i===0?'Today':new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(d);
      let type='OFF / No duty',report='',end='',sectors=0,route='',detail='';
      if(rosterMonthAvailable(month)){
        // If the month has a roster, the dashboard is a roster view: never infer OFF from an incomplete Logbook.
        const dayGroups=groupsByDate.get(date)||[];
        const flightGroups=dayGroups.filter(g=>g.kind==='flight');
        if(flightGroups.length){
          const firstG=flightGroups[0],lastG=flightGroups.at(-1),first=firstG.items[0]||{},home=upper(appSettings().homeBase||'CMN');
          type='Flight Duty';report=firstG.start||shiftTime(first.std,-60);end=dutyEndTime(lastG.items.at(-1),lastG.end||shiftTime(lastG.items.at(-1)?.sta,30));
          sectors=flightGroups.reduce((n,g)=>n+Number(g.sectors||0),0);
          const allItems=flightGroups.flatMap(g=>g.items||[]),dest=allItems.find(x=>upper(x.dep)===home&&upper(x.arr)!==home)?.arr||first.arr||'';
          route=`${first.dep||home}${dest?' → '+dest:''}`;
        }else if(dayGroups.length){
          const g=dayGroups[0],u=upper(g.activityType||'Duty');
          type=u==='OFF'||u==='DAY OFF'?'Day OFF':(g.activityType||'Duty');report=g.start||'';end=g.end||'';
          if(isPositioning({dutyType:g.activityType}))route=(g.dep||g.arr)?`${g.dep||'?'} → ${g.arr||'?'}`:'';
          else route=g.dep||'';
          detail=[g.flightNo,g.courseType,g.remarks].filter(Boolean).join(' • ');
        }
      }else{
        // Historical month without a roster: LogTen/Logbook is the fallback source.
        const source=operationalEntriesForMonth(month),actual=dayEntries(date,source).filter(isLogbookEntry),actualFlights=actual.filter(isFlight),ext=duties.find(x=>x.date===date&&!x.aerolineRosterPlanned);
        if(actual.length){
          if(actualFlights.length){
            const first=actualFlights[0],last=actualFlights.at(-1),home=upper(appSettings().homeBase||'CMN');
            type='Flight Duty';report=first.onDuty||ext?.report||shiftTime(first.schedOut||first.out,-60);end=dutyEndTime(last,ext?.end||shiftTime(last.schedIn||last.in,30));sectors=actualFlights.length;
            const dest=actualFlights.find(x=>upper(x.dep)===home&&upper(x.arr)!==home)?.arr||first.arr||'';route=`${first.dep||home}${dest?' → '+dest:''}`;
          }else{
            const first=actual[0],last=actual.at(-1);type='Simulator';report=first.onDuty||'';end=last.offDuty||'';route=first.dep||first.type||'';detail=first.remarks||'';
          }
        }else if(ext){type=ext.type||'Duty';report=ext.report||'';end=ext.end||'';detail=ext.notes||''}
      }
      rows.push({today:i===0,dayLabel,date,type,report,end,sectors,route,detail});
    }
    return rows;
  }
  function calculateLogbookStats(rows,total){
    const all=rows||[],flights=all.filter(isFlight),sims=all.filter(isSim),byDate=entriesByDate(all);
    return{entries:all.length,total:Number(total)||0,sectors:flights.length,block:sum(flights,totalFlightMins),credit:sum(all,f=>creditMinsForEntry(f,byDate.get(String(f.date||''))||[])),simulators:sims.length};
  }
  return {buildTotalsProjection,calculateDashboardDutyRows,calculateLogbookStats};
}
