export function createActivityEngine({
  upper,getAirportIndex,zuluDate,tzParts,appSettings,mins,isFlight,dayEntries,scheduleBlockMins,
  timeSpanMins,isSim,isStby,isPositioning,entryTimeOverride,entryFieldIsSource,entryHasTimeValue,
  numericTime,entryBlockMins,controlledDuty,dutyLastId,controlledDutyMinutes,requiresManualDutyControl,
  nightRouteMinutes,endZuluDate,timeGroupSettings,timeGroupKeys,entryManualField,entryFieldSource,
  isManualFlight,knownMulticrewAircraft,entryRoleIsPic,userIsSimTrainer,paySettings,activityRule,
  canonicalDutyType,logtenTimeColumns
}){
  const MOROCCO_IATA=new Set(['CMN','RAK','FEZ','TNG','RBA','OUD','AGA','NDR','ESU','OZZ','ERH','EUN','TTU','UAR','BEM']);
  function isMoroccoCode(code){
    code=upper(code);
    if(MOROCCO_IATA.has(code))return true;
    const a=getAirportIndex()?.[code];
    return !!(a&&(upper(a.country)==='MA'||a.tz==='Africa/Casablanca'||upper(a.icao||'').startsWith('GM')));
  }
  function moroccoLocalScheduledMinute(f){
    if(!f?.date||!f?.schedOut||!isMoroccoCode(f.dep))return null;
    const d=zuluDate(f.date,f.schedOut);
    if(!d)return null;
    return tzParts(d,'Africa/Casablanca');
  }
  function qualifiesMoroccoNightCredit(f){
    if(!isFlight(f)||!f.schedOut||!isMoroccoCode(f.dep))return false;
    const m=moroccoLocalScheduledMinute(f);
    if(m===null)return false;
    const st=appSettings(),start=mins(st.nightStart||'18:00'),end=mins(st.nightEnd||'05:00');
    if(start===null||end===null||start===end)return false;
    return start<end?m>=start&&m<end:m>=start||m<end;
  }
  function moroccoNightTrigger(f){
    return qualifiesMoroccoNightCredit(f);
  }
  function sameFlightIdentity(a,b){
    return (a?.id&&b?.id&&a.id===b.id) ||
      (upper(a?.flightNo||'')===upper(b?.flightNo||'') &&
       upper(a?.dep||'')===upper(b?.dep||'') &&
       upper(a?.arr||'')===upper(b?.arr||'') &&
       String(a?.schedOut||'')===String(b?.schedOut||''));
  }
  function dutyGetsMoroccoNightPremium(f,allEntries=null){
    if(!isFlight(f)||!f.date)return false;
    if(isMoroccoCode(f.dep))return moroccoNightTrigger(f);
    const source=Array.isArray(allEntries)?allEntries:dayEntries(f.date);
    const flights=(source||[]).filter(isFlight).filter(x=>x.date===f.date).map(x=>({...x}));
    if(!flights.some(x=>sameFlightIdentity(x,f)))flights.push({...f});
    flights.sort((a,b)=>{
      const da=zuluDate(a.date,a.schedOut||a.out||'00:00')?.getTime()||0;
      const db=zuluDate(b.date,b.schedOut||b.out||'00:00')?.getTime()||0;
      return da-db;
    });
    const idx=flights.findIndex(x=>sameFlightIdentity(x,f));
    if(idx<=0)return false;
    const previous=flights[idx-1];
    return isMoroccoCode(previous.dep)&&moroccoNightTrigger(previous);
  }
  function flightCreditMins(f,allEntries=null){
    const base=scheduleBlockMins(f);
    if(!(base>0))return 0;
    const rounded=Math.ceil(base/30)*30;
    const premium=Math.max(0,Number(appSettings().nightPremiumPct??50));
    return dutyGetsMoroccoNightPremium(f,allEntries)?Math.round(rounded*(1+premium/100)):rounded;
  }
  function entryScheduleTotalMins(entry){return entry?.schedOut&&entry?.schedIn?timeSpanMins(entry.schedOut,entry.schedIn):0}
  function resolvedSimulatorTimeMins(entry){
    if(!isSim(entry))return 0;
    const preserveSaved=entryTimeOverride(entry,'simulatorTime')||entryFieldIsSource(entry,'simulatorTime')||entry?.simulatorTimeImported===true;
    if(preserveSaved&&entryHasTimeValue(entry,'simulatorTime'))return numericTime(entry.simulatorTime);
    return entryScheduleTotalMins(entry);
  }
  function entryDutyMins(entry){
    const controlled=controlledDuty(entry);
    if(controlled)return entry.id===(controlled.control.totalDutyAtLast?dutyLastId(controlled):controlled.root.id)?controlledDutyMinutes(controlled.control):0;
    if(requiresManualDutyControl(entry))return 0;
    if(entryTimeOverride(entry,'totalDuty')&&entryHasTimeValue(entry,'totalDuty'))return numericTime(entry.totalDuty);
    if(entryFieldIsSource(entry,'totalDuty')&&entryHasTimeValue(entry,'totalDuty'))return numericTime(entry.totalDuty);
    if(entry?.onDuty&&entry?.offDuty)return timeSpanMins(entry.onDuty,entry.offDuty);
    if(isPositioning(entry)&&entry?.schedOut&&entry?.schedIn)return timeSpanMins(entry.schedOut,entry.schedIn);
    return entryHasTimeValue(entry,'totalDuty')?numericTime(entry.totalDuty):0;
  }
  function nightMinsForEntry(entry){
    if(!entry?.date||!entry?.out||!entry?.in)return 0;
    const index=getAirportIndex(),dep=index[upper(entry.dep)],arr=index[upper(entry.arr)];if(!dep||!arr)return 0;
    const start=zuluDate(entry.date,entry.out),end=endZuluDate(entry.date,entry.out,entry.in);return nightRouteMinutes(start,end,dep,arr);
  }
  function resolvedNightMins(entry){
    if((entryManualField(entry,'night')||entryFieldSource(entry,'night')==='manual'||entryFieldSource(entry,'night')==='logten'||entry?.source==='logten')&&Object.prototype.hasOwnProperty.call(entry||{},'night'))return numericTime(entry.night)??0;
    if(entryFieldIsSource(entry,'night')&&entryHasTimeValue(entry,'night'))return numericTime(entry.night);
    if(timeGroupSettings().night.autoSync!==true&&entryHasTimeValue(entry,'night'))return numericTime(entry.night);
    return nightMinsForEntry(entry);
  }
  function calculatedTimeGroupValue(entry,key,allEntries=null){
    const block=entryBlockMins(entry),simulatorTime=resolvedSimulatorTimeMins(entry),night=resolvedNightMins(entry);
    switch(key){
      case'totalFlightTime':return isFlight(entry)?block:0;
      case'multiPilot':return isFlight(entry)&&knownMulticrewAircraft(entry)?block:0;
      case'pic':return isFlight(entry)&&entryRoleIsPic(entry)?block:0;
      case'picUS':return isFlight(entry)&&['PICUS','PIC U/S','PIC U/S'].includes(String(entry?.role||'').toUpperCase())?block:0;
      case'sic':return isFlight(entry)&&entry?.instruction!==true&&String(entry?.role||'').toUpperCase()==='SIC'?block:0;
      case'ifrTime':return isFlight(entry)?block:0;
      case'airTime':return isFlight(entry)&&entry?.off&&entry?.on?timeSpanMins(entry.off,entry.on):0;
      case'night':return isFlight(entry)?night:0;
      case'picNight':return isFlight(entry)&&entryRoleIsPic(entry)?night:0;
      case'simulatorTime':return simulatorTime;
      case'sfiSfe':return isSim(entry)&&userIsSimTrainer(entry)?simulatorTime:0;
      case'dualGiven':return isFlight(entry)&&entry?.instruction===true?block:0;
      case'dualReceived':return isFlight(entry)?block:0;
      case'groundInstruction':return 0;
      case'stbyTime':return isStby(entry)&&entry?.onDuty&&entry?.offDuty?timeSpanMins(entry.onDuty,entry.offDuty):0;
      case'credit':return creditMinsForEntry(entry,allEntries);
      case'totalDuty':return entryDutyMins(entry);
      default:return 0;
    }
  }
  function timeGroupFinalValue(entry,key,allEntries=null){
    if(key==='totalInstrument'){const value=Object.prototype.hasOwnProperty.call(entry||{},key)?entry[key]:entry?.logtenCustom?.totalInstrument;return numericTime(value)??0}
    if(!timeGroupKeys.has(key))return 0;
    if(key==='totalDuty'&&(controlledDuty(entry)||isManualFlight(entry)))return entryDutyMins(entry);
    if((entryManualField(entry,key)||entryFieldSource(entry,key)==='manual')&&Object.prototype.hasOwnProperty.call(entry||{},key))return numericTime(entry[key])??0;
    if((entryFieldSource(entry,key)==='logten'||entry?.source==='logten')&&Object.prototype.hasOwnProperty.call(entry||{},key)&&Object.prototype.hasOwnProperty.call(logtenTimeColumns(),key))return numericTime(entry[key])??0;
    if(entryFieldIsSource(entry,key)&&entryHasTimeValue(entry,key))return numericTime(entry[key]);
    if(key==='sfiSfe'&&entry?.source==='logten'&&entryHasTimeValue(entry,'sfiSfe'))return numericTime(entry.sfiSfe);
    if(key==='dualGiven'&&isFlight(entry)&&entry?.instruction===true)return calculatedTimeGroupValue(entry,key,allEntries);
    if(['sic','picUS'].includes(key)&&(entryFieldSource(entry,key)==='calculated'||timeGroupSettings()[key]?.autoSync===true))return calculatedTimeGroupValue(entry,key,allEntries);
    if(timeGroupSettings()[key]?.autoSync===true)return calculatedTimeGroupValue(entry,key,allEntries);
    if(entryHasTimeValue(entry,key))return numericTime(entry[key]);
    return 0;
  }
  function creditMinsForEntry(f,allEntries=null){
    const rule=activityRule(f);
    if(entryTimeOverride(f,'credit')&&entryHasTimeValue(f,'credit'))return numericTime(f.credit);
    if(entryFieldIsSource(f,'credit')&&entryHasTimeValue(f,'credit'))return numericTime(f.credit);
    if(rule.credit==='flight-schedule')return flightCreditMins({...f,dutyType:'Flight'},allEntries);
    if(rule.credit==='editable-sim'){
      if(f?.creditImported===true&&entryHasTimeValue(f,'credit'))return numericTime(f.credit);
      if(userIsSimTrainer(f))return 300;
      return 0;
    }
    if(rule.credit==='editable-ground'){
      if(entryHasTimeValue(f,'credit'))return numericTime(f.credit);
      const trainer=upper(f?.aerolineTrainerType||f?.trainerType||'');
      if(trainer==='TNE')return 0;
      if(trainer==='GI'||trainer==='SOD'||upper(f.courseType)==='SOD')return Math.round(paySettings().groundCredit*60);
      return 0;
    }
    if(rule.credit==='zero')return 0;
    return entryHasTimeValue(f,'credit')?numericTime(f.credit):0;
  }
  function calculateActivityMetrics(f,allEntries=null){
    const dutyType=canonicalDutyType(f?.dutyType||'Flight'),flight=dutyType==='Flight',sim=dutyType==='Simulator';
    const schedBlock=entryScheduleTotalMins(f),block=entryBlockMins(f);
    const flightMins=flight&&f?.off&&f?.on?timeSpanMins(f.off,f.on):0;
    const simulatorTime=sim?resolvedSimulatorTimeMins(f):0;
    const totalDuty=entryDutyMins(f);
    const credit=creditMinsForEntry({...f,dutyType,schedBlock,simulatorTime},allEntries);
    return{dutyType,schedBlock,block,airTime:flightMins,simulatorTime,totalDuty,credit};
  }
  return {isMoroccoCode,qualifiesMoroccoNightCredit,flightCreditMins,dutyGetsMoroccoNightPremium,entryScheduleTotalMins,entryDutyMins,calculatedTimeGroupValue,timeGroupFinalValue,creditMinsForEntry,calculateActivityMetrics};
}
