const ACTIVITY_STATUS=Object.freeze({DRAFT:'DRAFT',PLANNED:'PLANNED',OPEN:'OPEN',COMPLETED:'COMPLETED'});
const LEGACY_ACTIVITY_FIELDS=Object.freeze({entry:['entry','Visible'].join(''),roster:['roster','Visible'].join(''),duty:['duty','Visible'].join(''),completed:['completed','EntryId'].join(''),rosterItem:['roster','ItemId'].join(''),legacyRoster:['legacy','RosterId'].join(''),rosterAeroline:['roster','AerolineKey'].join('')});
export function createCoreRecords({makeActivityId,recordRevision,entryManualField,canonicalDutyType,upper,isFlight,isDhd,isSim,isGround,isStby}){
  function rawFlightDigits(value){const m=String(value||'').toUpperCase().match(/(\d{2,4})$/);return m?m[1]:''}
  function rawCanonicalType(value,fallback='Flight'){
    const key=String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
    const aliases={'FLIGHT':'Flight','SIM':'Simulator','SIMULATOR':'Simulator','RT':'Simulator','GROUND COURSE':'Ground Course','GROUND TRAINING':'Ground Course','GROUND TRAINING/COURSE':'Ground Course','GRT':'Ground Course','DHD':'DHD','DHP':'DHP','STBY':'STBY','STANDBY':'STBY','HSBY':'STBY','DAY OFF':'Day OFF','OFF':'Day OFF','FLIGHT DUTY':'Flight Duty','DUTY':'Duty','SICK LEAVE':'Sick Leave','ANNUAL LEAVE':'Annual Leave'};
    return aliases[key]||String(value||'').trim()||fallback;
  }
  function legacyActivityField(row,key){return row?.[LEGACY_ACTIVITY_FIELDS[key]]}
  function activityStatusRank(value){return value===ACTIVITY_STATUS.COMPLETED?3:value===ACTIVITY_STATUS.OPEN?2:1}
  function canonicalActivityStatus(source={},origin=''){
    const explicit=String(source.activityStatus||source.status||'').trim().toUpperCase();
    if(explicit==='DRAFT'&&!source.locked)return ACTIVITY_STATUS.DRAFT;
    const sourceName=String(source.source||'').toLowerCase();
    if(sourceName==='logten')return source.locked?ACTIVITY_STATUS.COMPLETED:ACTIVITY_STATUS.OPEN;
    if(source.manualOverride||source.completedAt||source.locked)return ACTIVITY_STATUS.COMPLETED;
    if(origin==='entries'&&legacyActivityField(source,'entry'))return ACTIVITY_STATUS.COMPLETED;
    if(explicit==='COMPLETED'||explicit==='DONE')return ACTIVITY_STATUS.COMPLETED;
    if(explicit==='OPEN')return ACTIVITY_STATUS.OPEN;
    if(explicit==='PLANNED'||explicit==='PLAN')return ACTIVITY_STATUS.PLANNED;
    return ACTIVITY_STATUS.PLANNED;
  }
  function stripLegacyActivityFields(row){
    const rest={...(row||{})};
    for(const key of Object.values(LEGACY_ACTIVITY_FIELDS))delete rest[key];
    for(const key of ['status','std','sta','report','end','minutes','notes','flight','scheduleTotal','instructionType','trainingSector','instructorFlightTime','instructorExaminer','multiCrew'])delete rest[key];
    return rest;
  }
  function normalizeCoreActivity(source={},origin=''){
    const dutyType=rawCanonicalType(source.dutyType||(origin==='duties'?source.type:'')||'Flight',origin==='duties'?'Duty':'Flight');
    const category='OPERATIONAL';
    const clean=stripLegacyActivityFields(source);
    if((clean.schedBlock===undefined||clean.schedBlock===null||clean.schedBlock==='')&&source.scheduleTotal!==undefined&&source.scheduleTotal!==null&&source.scheduleTotal!=='')clean.schedBlock=source.scheduleTotal;
    delete clean.scheduleTotal;
    const hasTotalDuty=source.totalDuty!==undefined&&source.totalDuty!==null&&source.totalDuty!=='';
    const legacyTotalDuty=source.dutyMinutes!==undefined&&source.dutyMinutes!==null?source.dutyMinutes:source.minutes;
    const totalDuty=hasTotalDuty?source.totalDuty:(legacyTotalDuty!==undefined&&legacyTotalDuty!==null?Number(legacyTotalDuty):undefined);
    delete clean.dutyMinutes;
    return{
      ...clean,
      id:source.id||makeActivityId(),recordKind:'activity',activityCategory:category,dutyType,
      schedOut:source.schedOut||source.std||'',schedIn:source.schedIn||source.sta||'',
      onDuty:source.onDuty||source.report||'',offDuty:source.offDuty||source.end||'',
      remarks:source.remarks||source.notes||'',
      ...(totalDuty!==undefined?{totalDuty}:{}),
      activityStatus:canonicalActivityStatus(source,origin)
    };
  }
  function directUnifiedFlightMatch(a,b){
    if(!a||!b||rawCanonicalType(a.dutyType)!=='Flight')return false;
    if(a.id&&b.id&&a.id===b.id)return true;
    if(a.aerolineKey&&b.aerolineKey&&a.aerolineKey===b.aerolineKey)return true;
    if(a.aerolineFlightLegId&&b.aerolineFlightLegId&&String(a.aerolineFlightLegId)===String(b.aerolineFlightLegId))return true;
    const ad=rawFlightDigits(a.flightNo),bd=rawFlightDigits(b.flightNo);
    return !!(a.date&&a.date===b.date&&ad&&ad===bd&&String(a.dep||'').toUpperCase()===String(b.dep||'').toUpperCase()&&String(a.arr||'').toUpperCase()===String(b.arr||'').toUpperCase());
  }
  function scheduledFlightIdentityMatch(a,b){
    if(!a||!b||rawCanonicalType(a.dutyType)!=='Flight'||rawCanonicalType(b.dutyType)!=='Flight')return false;
    const aOut=a.schedOut||a.std||'',aIn=a.schedIn||a.sta||'',bOut=b.schedOut||b.std||'',bIn=b.schedIn||b.sta||'';
    const timeDistance=(left,right)=>{const parse=value=>{const m=String(value||'').match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null},x=parse(left),y=parse(right);if(x==null||y==null)return 9999;const d=Math.abs(x-y);return Math.min(d,1440-d)};
    return !!(a.date&&a.date===b.date&&String(a.dep||'').toUpperCase()===String(b.dep||'').toUpperCase()&&String(a.arr||'').toUpperCase()===String(b.arr||'').toUpperCase()&&aOut&&aIn&&timeDistance(aOut,bOut)<=15&&timeDistance(aIn,bIn)<=15);
  }
  function uniqueUnifiedFlightMatch(records,row){
    const direct=(records||[]).filter(candidate=>directUnifiedFlightMatch(candidate,row));
    if(direct.length===1)return direct[0];
    if(direct.length>1)return null;
    const scheduled=(records||[]).filter(candidate=>scheduledFlightIdentityMatch(candidate,row));
    return scheduled.length===1?scheduled[0]:null;
  }
  function unifiedFlightMatch(a,b){return directUnifiedFlightMatch(a,b)||scheduledFlightIdentityMatch(a,b)}
  function blankOperationalValue(value){return value===undefined||value===null||value===''}
  function activityAuthorityScore(row){
    return (row?.locked?500:0)+activityStatusRank(row?.activityStatus)*100+Object.values(row||{}).filter(v=>!blankOperationalValue(v)).length;
  }
  function mergeCoreActivities(a,b){
    let primary;
    const ta=String(a?._updatedAt||''),tb=String(b?._updatedAt||'');
    if(ta!==tb)primary=ta>tb?a:b;
    else if(recordRevision(a)!==recordRevision(b))primary=recordRevision(a)>recordRevision(b)?a:b;
    else primary=activityAuthorityScore(a)>=activityAuthorityScore(b)?a:b;
    const secondary=primary===a?b:a,merged={...secondary,...primary};
    const primaryAll=!!primary?.locked,secondaryAll=!!secondary?.locked;
    const primaryLogTen=String(primary?.source||'').toLowerCase()==='logten',secondaryLogTen=String(secondary?.source||'').toLowerCase()==='logten';
    const chosenSecondary=new Set(),keys=new Set([...Object.keys(primary||{}),...Object.keys(secondary||{})]);
    for(const key of keys){
      if(['id','manualFields','timeOverrides','fieldSources','_updatedAt','_syncRev'].includes(key))continue;
      const pManual=primaryAll||entryManualField(primary,key),sManual=secondaryAll||entryManualField(secondary,key);
      if(sManual&&!pManual&&Object.prototype.hasOwnProperty.call(secondary,key)){merged[key]=secondary[key];chosenSecondary.add(key)}
      else if(pManual&&!sManual)continue;
      else if(secondaryLogTen&&!primaryLogTen&&Object.prototype.hasOwnProperty.call(secondary,key)){merged[key]=secondary[key];chosenSecondary.add(key)}
      else if(primaryLogTen&&!secondaryLogTen)continue;
      else if(blankOperationalValue(merged[key])&&!blankOperationalValue(secondary?.[key]))merged[key]=secondary[key];
    }
    merged.manualFields={...(secondary?.manualFields||{}),...(primary?.manualFields||{})};
    merged.timeOverrides={...(secondary?.timeOverrides||{}),...(primary?.timeOverrides||{})};
    merged.fieldSources={...(secondary?.fieldSources||{}),...(primary?.fieldSources||{})};
    for(const key of chosenSecondary){
      if(secondary?.fieldSources&&Object.prototype.hasOwnProperty.call(secondary.fieldSources,key))merged.fieldSources[key]=secondary.fieldSources[key];
      else if(secondaryLogTen)merged.fieldSources[key]='logten';
    }
    for(const key of Object.keys(merged.manualFields))if(merged.manualFields[key]===true)merged.fieldSources[key]='manual';
    for(const key of Object.keys(merged.timeOverrides))if(merged.timeOverrides[key]===true)merged.fieldSources[key]='manual';
    merged.id=primary.id||secondary.id||makeActivityId();merged.recordKind='activity';
    if(primaryLogTen||secondaryLogTen)merged.source='logten';
    if(merged.source==='logten')merged.activityStatus=merged.locked?ACTIVITY_STATUS.COMPLETED:ACTIVITY_STATUS.OPEN;
    else merged.activityStatus=activityStatusRank(a.activityStatus)>=activityStatusRank(b.activityStatus)?a.activityStatus:b.activityStatus;
    return normalizeCoreActivity(merged,merged.activityCategory==='DUTY'?'duties':'entries');
  }
  function normalizeCoreActivityRecords(rows,previousById=null){
    // Only repeated representations of the exact same Core ID may be merged.
    const out=[],byId=new Map();
    for(const raw of (rows||[])){
      if(!raw)continue;
      const row=previousById?.get(raw.id)===raw?raw:normalizeCoreActivity(raw,raw.activityCategory==='DUTY'?'duties':'');
      const id=String(row.id||'');
      if(id&&byId.has(id)){
        const index=byId.get(id);
        out[index]=mergeCoreActivities(out[index],row);
      }else{
        const index=out.length;out.push(row);if(id)byId.set(id,index);
      }
    }
    return out;
  }
  function entryCompleteness(f){
    const weighted=[
      ['flightNo',5],['type',3],['reg',3],['dep',3],['arr',3],
      ['schedOut',4],['schedIn',4],['out',3],['off',3],['on',3],['in',3],
      ['onDuty',2],['offDuty',2],['block',4],['airTime',4],['credit',2],
      ['night',2],['role',1],['remarks',1],
      ['dayTakeoffs',1],['nightTakeoffs',1],['dayLandings',1],['nightLandings',1]
    ];
    return weighted.reduce((sum,[k,w])=>{
      const v=f?.[k];
      const present=v!==undefined&&v!==null&&String(v).trim()!=='';
      return sum+(present?w:0);
    },0)+(f?.locked?2:0);
  }
  function mergeDuplicateEntries(a,b){
    const ca=entryCompleteness(a),cb=entryCompleteness(b),primary=ca>=cb?a:b,secondary=primary===a?b:a;
    const merged={...secondary,...primary},primaryAll=!!primary?.locked,secondaryAll=!!secondary?.locked;
    const primaryLogTen=String(primary?.source||'').toLowerCase()==='logten',secondaryLogTen=String(secondary?.source||'').toLowerCase()==='logten';
    const chosenSecondary=new Set();
    for(const k of new Set([...Object.keys(primary||{}),...Object.keys(secondary||{})])){
      if(['id','manualFields','timeOverrides','fieldSources','_updatedAt','_syncRev'].includes(k))continue;
      const pManual=primaryAll||entryManualField(primary,k),sManual=secondaryAll||entryManualField(secondary,k);
      if(sManual&&!pManual&&Object.prototype.hasOwnProperty.call(secondary,k)){merged[k]=secondary[k];chosenSecondary.add(k)}
      else if(pManual&&!sManual)continue;
      else if(secondaryLogTen&&!primaryLogTen&&Object.prototype.hasOwnProperty.call(secondary,k)){merged[k]=secondary[k];chosenSecondary.add(k)}
      else if(primaryLogTen&&!secondaryLogTen)continue;
      else if((merged[k]===undefined||merged[k]===null||merged[k]==='')&&secondary[k]!==undefined&&secondary[k]!==null&&secondary[k]!=='')merged[k]=secondary[k];
    }
    merged.manualFields={...(secondary?.manualFields||{}),...(primary?.manualFields||{})};
    merged.timeOverrides={...(secondary?.timeOverrides||{}),...(primary?.timeOverrides||{})};
    merged.fieldSources={...(secondary?.fieldSources||{}),...(primary?.fieldSources||{})};
    for(const k of chosenSecondary){
      if(secondary?.fieldSources&&Object.prototype.hasOwnProperty.call(secondary.fieldSources,k))merged.fieldSources[k]=secondary.fieldSources[k];
      else if(secondaryLogTen)merged.fieldSources[k]='logten';
    }
    for(const k of Object.keys(merged.manualFields))if(merged.manualFields[k]===true)merged.fieldSources[k]='manual';
    for(const k of Object.keys(merged.timeOverrides))if(merged.timeOverrides[k]===true)merged.fieldSources[k]='manual';
    merged.id=primary.id||secondary.id||makeActivityId();merged.locked=!!(a.locked||b.locked);
    if(primaryLogTen||secondaryLogTen){merged.source='logten';merged.activityStatus=merged.locked?ACTIVITY_STATUS.COMPLETED:ACTIVITY_STATUS.OPEN}
    merged._syncRev=Math.max(recordRevision(a),recordRevision(b));merged._updatedAt=[a._updatedAt,b._updatedAt].filter(Boolean).sort().pop()||new Date().toISOString();return merged;
  }
  function normalizedFlightDigits(v){
    const s=upper(v||'').replace(/\s+/g,'');
    const m=s.match(/(\d{2,4})$/);
    return m?m[1]:'';
  }
  function exactOperationalMatch(a,b){
    if(!a||!b||a===b)return false;
    if(a.logtenUniqueId&&b.logtenUniqueId&&String(a.logtenUniqueId)!==String(b.logtenUniqueId))return false;
    if(a.date!==b.date||canonicalDutyType(a.dutyType||'Flight')!==canonicalDutyType(b.dutyType||'Flight'))return false;
    if(upper(a.dep||'')!==upper(b.dep||'')||upper(a.arr||'')!==upper(b.arr||''))return false;
    if(isFlight(a)&&isFlight(b)){
      const fa=normalizedFlightDigits(a.flightNo),fb=normalizedFlightDigits(b.flightNo);
      if(fa&&fb&&fa!==fb)return false;
      const timesA=[a.schedOut,a.schedIn,a.out,a.off,a.on,a.in].filter(Boolean);
      const timesB=[b.schedOut,b.schedIn,b.out,b.off,b.on,b.in].filter(Boolean);
      const commonTime=timesA.some(t=>timesB.includes(t));
      if(fa&&fb&&fa===fb)return true;
      if(commonTime)return true;
      const noIdentityA=!fa&&timesA.length===0,noIdentityB=!fb&&timesB.length===0;
      if(noIdentityA&&noIdentityB&&entryCompleteness(a)<=14&&entryCompleteness(b)<=14)return true;
      return false;
    }
    if(isDhd(a)&&isDhd(b)){
      const sa=a.schedOut||a.onDuty||'',sb=b.schedOut||b.onDuty||'';
      const ea=a.schedIn||a.offDuty||'',eb=b.schedIn||b.offDuty||'';
      return (!!sa&&sa===sb)||((!sa||!sb)&&!!ea&&ea===eb);
    }
    if(isSim(a)&&isSim(b)){
      return upper(a.type||'')===upper(b.type||'')&&((a.onDuty&&a.onDuty===b.onDuty)||(a.offDuty&&a.offDuty===b.offDuty));
    }
    if(isGround(a)&&isGround(b)){
      return upper(a.dep||'')===upper(b.dep||'')&&upper(a.courseType||a.remarks||'')===upper(b.courseType||b.remarks||'')&&((a.onDuty&&a.onDuty===b.onDuty)||(!a.onDuty&&!b.onDuty));
    }
    if(isStby(a)&&isStby(b))return (a.onDuty&&a.onDuty===b.onDuty)||(a.offDuty&&a.offDuty===b.offDuty)||(!a.onDuty&&!b.onDuty&&!a.offDuty&&!b.offDuty);
    return false;
  }
  return {ACTIVITY_STATUS,LEGACY_ACTIVITY_FIELDS,rawFlightDigits,rawCanonicalType,legacyActivityField,activityStatusRank,canonicalActivityStatus,stripLegacyActivityFields,normalizeCoreActivity,directUnifiedFlightMatch,scheduledFlightIdentityMatch,uniqueUnifiedFlightMatch,unifiedFlightMatch,blankOperationalValue,activityAuthorityScore,mergeCoreActivities,normalizeCoreActivityRecords,entryCompleteness,mergeDuplicateEntries,normalizedFlightDigits,exactOperationalMatch};
}
