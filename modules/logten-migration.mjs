export function createLogTenMigration({upper,canonicalDutyType,isFlight,isSim,scheduleBlockMins,importCoreId,numericTime,entryBlockMins,entryManualField,entryFieldSource,initialTrainingCreditSource,LOGTEN_TIME_COLUMNS}){
function logTenLegacyRowKey(e){
  return[e.date,e.logtenType,e.flightNo,e.dep,e.arr,e.schedOut,e.schedIn,e.onDuty,e.offDuty,e.remarks].map(x=>upper(x)).join('|');
}
function logTenMigrationEntry(raw){
  const {logtenPk,logtenType,...data}=raw||{};const uid=String(data.logtenUniqueId||'').trim();
  if(!uid)throw new Error('A LogTen row is missing its stable unique ID.');
  const f={...data,fieldSources:{...(data.fieldSources||{})}};
  for(const key of Object.keys(LOGTEN_TIME_COLUMNS))if(Object.prototype.hasOwnProperty.call(f,key))f.fieldSources[key]='logten';
  if(!Object.prototype.hasOwnProperty.call(f,'totalInstrument')&&Object.prototype.hasOwnProperty.call(f.logtenCustom||{},'totalInstrument')){f.totalInstrument=f.logtenCustom.totalInstrument;f.fieldSources.totalInstrument='logten'}
  f.source='logten';f.logtenUniqueId=uid;f.id=importCoreId('logten:'+uid);
  f.dutyType=canonicalDutyType(f.dutyType||'Flight');f.date=String(f.date||'').slice(0,10);
  if(isFlight(f))f.schedBlock=scheduleBlockMins(f);
  ['flightNo','dep','arr','reg','type','courseType','picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name','approachType'].forEach(k=>{if(f[k]!=null)f[k]=upper(f[k])});
  if(Array.isArray(f.approaches))f.approaches=f.approaches.map(a=>({
    type:upper(a?.type||''),quantity:Math.max(1,Number(a?.quantity)||1),night:!!a?.night,simulated:!!a?.simulated,
    precision:a?.precision==null?null:!!a.precision,termination:Number(a?.termination)||0,place:upper(a?.place||''),comment:String(a?.comment||'')
  })).filter(a=>a.type);
  if(isSim(f)){
    f.sim='yes';
    f.dep=upper(f.dep||f.location||'');f.location='';f.out='';f.off='';f.on='';f.in='';f.block=null;f.simInstructor=false;f.simExaminer=false;
    if(Object.prototype.hasOwnProperty.call(f,'simulatorTime'))f.simulatorTimeImported=true;
    if(f.creditImported!==true)f.credit=null;
  }else delete f.sim;
  if(f.pf==='no')delete f.pf;
  if(!f.locked)delete f.locked;
  f._logtenImportType=Number(logtenType||0);f._logtenLegacyKey=logTenLegacyRowKey({...raw,logtenType:Number(logtenType||0)});
  return f;
}
function logTenMigrationFallbackMatch(existing,incoming){
  if(!existing||existing.date!==incoming.date)return false;
  if(existing.logtenUniqueId)return String(existing.logtenUniqueId)===String(incoming.logtenUniqueId);
  const same=(key)=>!!existing[key]&&!!incoming[key]&&upper(existing[key])===upper(incoming[key]);
  const compatible=(key)=>!existing[key]||!incoming[key]||same(key);
  if(isFlight(existing)&&isFlight(incoming)){
    if(!same('dep')||!same('arr')||!compatible('reg'))return false;
    if(same('out')&&same('in'))return true;
    const block=numericTime(incoming.totalFlightTime),existingBlock=entryBlockMins(existing);
    if((same('out')||same('in'))&&block>0&&block===existingBlock)return true;
    if(same('schedOut')&&same('schedIn'))return true;
    // A source placeholder has no operational time: only a unique route may match.
    if(!incoming.flightNo&&!incoming.out&&!incoming.in&&!incoming.schedOut&&!incoming.schedIn&&!block)return true;
    return false;
  }
  if(isSim(existing)&&isSim(incoming)){
    if(same('schedOut')&&same('schedIn')&&numericTime(existing.simulatorTime)===numericTime(incoming.simulatorTime))return true;
    return same('reg')&&same('onDuty')&&same('offDuty');
  }
  const a=canonicalDutyType(existing.dutyType),b=canonicalDutyType(incoming.dutyType);
  if(a!==b&&!(b==='Duty'&&['DHD','DHP'].includes(a)))return false;
  if(a==='Flight'||a==='Simulator')return false;
  if(!compatible('dep')||!compatible('arr'))return false;
  // Non-flight rows are accepted only when this date/type identifies one candidate.
  return true;
}
function mergeLogTenMigration(existing,incoming){
  // An explicit complete-source import repairs source fields, including locked
  // LogTen records. Per-field manual edits remain authoritative; lock still protects UI edits.
  const merged={...existing,fieldSources:{...(existing.fieldSources||{})}},conflicts=[];
  const keys=[...Object.keys(LOGTEN_TIME_COLUMNS),'type'];
  for(const key of keys){
    if(!Object.prototype.hasOwnProperty.call(incoming,key))continue;
    const value=incoming[key],manual=entryManualField(existing,key)||entryFieldSource(existing,key)==='manual'||(key==='totalInstrument'&&entryManualField(existing,'logtenCustom'));
    if(key==='type'&&!value)continue;
    if(manual){if(existing[key]!==value)conflicts.push({field:key,manual:existing[key],logten:value});continue}
    merged[key]=value;merged.fieldSources[key]='logten';
  }
  merged.logtenCustom={...(existing.logtenCustom||{})};
  if(!entryManualField(existing,'logtenCustom')&&!entryManualField(existing,'totalInstrument')&&entryFieldSource(existing,'totalInstrument')!=='manual'){
    if(Object.prototype.hasOwnProperty.call(incoming,'totalInstrument'))merged.logtenCustom.totalInstrument=incoming.totalInstrument;
    else if(Object.prototype.hasOwnProperty.call(incoming.logtenCustom||{},'totalInstrument')){merged.logtenCustom.totalInstrument=incoming.logtenCustom.totalInstrument;merged.totalInstrument=incoming.logtenCustom.totalInstrument;merged.fieldSources.totalInstrument='logten'}
  }
  merged.id=existing.id||incoming.id;merged.logtenUniqueId=incoming.logtenUniqueId;
  if(existing.source!=='manual')merged.source='logten';
  merged.logtenImportConflicts=conflicts;
  if(Object.prototype.hasOwnProperty.call(incoming,'simulatorTime'))merged.simulatorTimeImported=true;
  merged._updatedAt=new Date().toISOString();
  return merged;
}
function reconcileLogTenEntries(existingRows,rawEntries){
  const fs=(existingRows||[]).map(row=>({...row})),uidIndex=new Map();let imported=0,updated=0,protectedMerged=0,conflicts=0;
  for(let i=0;i<fs.length;i++){
    const uid=String(fs[i].logtenUniqueId||'').trim();
    if(!uid)continue;
    if(uidIndex.has(uid))throw new Error(`Duplicate existing LogTen ID: ${uid}. No entries were changed.`);
    uidIndex.set(uid,i);
  }
  const seen=new Set();
  for(const raw of rawEntries){
    const incoming=logTenMigrationEntry(raw),uid=String(incoming.logtenUniqueId||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(incoming.date))throw new Error('Invalid LogTen flight date. No entries were imported.');
    if(!uid)throw new Error(`LogTen row without Unique ID on ${incoming.date}. No entries were imported.`);
    if(seen.has(uid))throw new Error(`Duplicate LogTen ID in source: ${uid}. No entries were imported.`);seen.add(uid);
    const idx=uidIndex.has(uid)?uidIndex.get(uid):-1;
    if(idx>=0){
      fs[idx]=mergeLogTenMigration(fs[idx],incoming);updated++;
      const n=fs[idx].logtenImportConflicts.length;if(n){protectedMerged++;conflicts+=n}
    }else{
      delete incoming._logtenImportType;delete incoming._logtenLegacyKey;incoming._updatedAt=new Date().toISOString();
      const next=fs.length;fs.push(initialTrainingCreditSource(incoming));uidIndex.set(uid,next);imported++;
    }
  }
  return{rows:fs,imported,updated,protectedMerged,conflicts,removedIds:[]};
}
return {logTenLegacyRowKey,logTenMigrationEntry,logTenMigrationFallbackMatch,mergeLogTenMigration,reconcileLogTenEntries};
}
