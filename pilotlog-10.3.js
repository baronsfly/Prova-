/*
 PilotLog source map
  01 Core/storage/settings
  02 Airports/night/flight-entry rules
  03 Duty + EASA FTL
  04 Roster + trips
  05 Imports
  06 Exports
  07 Payroll
  08 Expiry / validity tracking
  09 Cloud sync
  10 UI/render/events
*/
(() => {
'use strict';
const VERSION='10.3';
const TRIPS_KEY='pilotlog7_trips_v1', PAY_SETTINGS_KEY='pilotlog7_pay_settings_v1', PAY_MONTH_KEY='pilotlog7_pay_month_v1', FX_KEY='pilotlog7_fx_v1', APP_SETTINGS_KEY='pilotlog7_app_settings_v1', LAST_EMAIL_KEY='pilotlog7_last_email_v1', ENTRY_DRAFT_KEY='pilotlog7_entry_draft_v1', ENTRY_DRAFTS_KEY='pilotlog8_entry_drafts_v1', CLOUD_TOMBSTONES_KEY='pilotlog7_local_delete_queue_v1', SYNC_LEDGER_KEY='pilotlog8_sync_ledger_v1', EXPIRY_KEY='pilotlog7_expiry_v1', RECONCILIATION_REVIEW_KEY='pilotlog9_reconciliation_review_v1', LOGTEN_ARCHIVE_META_KEY='pilotlog7_logten_archive_meta_v1', AEROLINE_CONFIG_KEY='pilotlog7_aeroline_config_v1', SYNC_DEVICE_KEY='pilotlog7_device_v1';
const SYNC_PROTOCOL='db8', SYNC_READY_KEY='pilotlog7_database_initialized', CLOUD_DIRTY_KEY='pilotlog7_cloud_dirty_v1', CLOUD_BASE_REV_KEY='pilotlog7_cloud_base_revision_v1', CLOUD_PENDING_IMPORT_KEY='pilotlog7_cloud_pending_import_v1';
const $=id=>document.getElementById(id);
const LEGACY_FLIGHT_BACKUP_KEY='pilotlog7_flights_backup_v1';
// Read-only migration inputs. Runtime code never reads or writes separate Roster/Logbook stores.
const LEGACY_FLIGHTS_STORAGE_KEY='pilotlog7_flights_v1',LEGACY_ROSTER_STORAGE_KEY='pilotlog7_roster_v1',LEGACY_DUTIES_STORAGE_KEY='pilotlog7_duties_v1';
const LEGACY_FLIGHT_DB_NAME='pilotlog7-core-data',LEGACY_FLIGHT_DB_STORE='records',LEGACY_FLIGHT_DB_RECORD='flights-v1';
const FLIGHT_DB_NAME='pilotlog9-authoritative-data',FLIGHT_DB_STORE='records',FLIGHT_DB_RECORD='pilotlog-database-v1',FLIGHT_DB_META_KEY='pilotlog9_database_meta_v1',FALLBACK_DB_KEY='pilotlog9_database_fallback_v1';
const BUSINESS_ARRAY_KEYS=new Set([TRIPS_KEY,EXPIRY_KEY,SYNC_LEDGER_KEY,ENTRY_DRAFTS_KEY,CLOUD_TOMBSTONES_KEY,RECONCILIATION_REVIEW_KEY]);
const BUSINESS_OBJECT_KEYS=new Set([PAY_SETTINGS_KEY,PAY_MONTH_KEY,FX_KEY,APP_SETTINGS_KEY,ENTRY_DRAFT_KEY,LOGTEN_ARCHIVE_META_KEY,AEROLINE_CONFIG_KEY]);
const BUSINESS_KEYS=new Set([...BUSINESS_ARRAY_KEYS,...BUSINESS_OBJECT_KEYS]);
let operationalDatabase=null,flightStoreReady=false,flightPersistActive=false,flightPersistDirty=false,flightPersistTimer=null,flightPersistPromise=Promise.resolve();

function emptyOperationalDatabase(){
  return{schema:'PilotLog Operational Database',schemaVersion:1,records:[],values:{},updatedAt:new Date().toISOString()};
}
function isOperationalDatabase(value){return !!(value&&value.schema==='PilotLog Operational Database'&&Number(value.schemaVersion)===1&&Array.isArray(value.records)&&value.values&&typeof value.values==='object')}
function normalizeOperationalDatabase(value){
  const db=isOperationalDatabase(value)?value:emptyOperationalDatabase(),values=db.values&&typeof db.values==='object'?{...db.values}:{};
  const rawRecords=Array.isArray(db.records)?db.records:[],activities=rawRecords.filter(r=>r?.recordKind==='activity'||!r?.recordKind),other=rawRecords.filter(r=>r?.recordKind&&r.recordKind!=='activity');
  let records=[...normalizeCoreActivityRecords(activities),...other];
  // v10.3 migration: Trips live in the same authoritative database record collection.
  const legacyTrips=Array.isArray(values[TRIPS_KEY])?values[TRIPS_KEY]:[];
  if(legacyTrips.length){
    const existing=new Set(records.filter(r=>r?.recordKind==='trip').map(r=>String(r.id||'')));
    for(const trip of legacyTrips){const id=trip?.id||makeActivityId();if(!existing.has(String(id))){records.push({...trip,id,recordKind:'trip'});existing.add(String(id));}}
    delete values[TRIPS_KEY];
  }
  return{...db,records,values,updatedAt:db.updatedAt||new Date().toISOString()};
}
function legacyLocalJson(key,def){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?def:v}catch{return def}}
function legacyLocalFlights(){const v=legacyLocalJson(LEGACY_FLIGHTS_STORAGE_KEY,[]);return Array.isArray(v)?v:[]}
function openFlightStoreDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(FLIGHT_DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(FLIGHT_DB_STORE))db.createObjectStore(FLIGHT_DB_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('PilotLog data database unavailable'));
  });
}
async function readFlightStore(){
  const db=await openFlightStoreDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FLIGHT_DB_STORE,'readonly'),req=tx.objectStore(FLIGHT_DB_STORE).get(FLIGHT_DB_RECORD);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error)})}
  finally{db.close()}
}
async function writeFlightStore(database){
  const data=normalizeOperationalDatabase(database);data.updatedAt=new Date().toISOString();
  const db=await openFlightStoreDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(FLIGHT_DB_STORE,'readwrite');tx.objectStore(FLIGHT_DB_STORE).put(data,FLIGHT_DB_RECORD);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('PilotLog data write aborted'))})}
  finally{db.close()}
  try{localStorage.setItem(FLIGHT_DB_META_KEY,JSON.stringify({records:data.records.length,updatedAt:data.updatedAt,schemaVersion:data.schemaVersion}))}catch{}
  return true;
}
function readLegacyFlightStore(){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open(LEGACY_FLIGHT_DB_NAME,1);
      req.onupgradeneeded=()=>{};
      req.onerror=()=>resolve([]);
      req.onsuccess=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(LEGACY_FLIGHT_DB_STORE)){db.close();resolve([]);return}
        const tx=db.transaction(LEGACY_FLIGHT_DB_STORE,'readonly'),q=tx.objectStore(LEGACY_FLIGHT_DB_STORE).get(LEGACY_FLIGHT_DB_RECORD);
        q.onsuccess=()=>{const rows=Array.isArray(q.result)?q.result:[];db.close();resolve(rows)};
        q.onerror=()=>{db.close();resolve([])};
      };
    }catch{resolve([])}
  });
}
function rawFlightDigits(value){const m=String(value||'').toUpperCase().match(/(\d{2,4})$/);return m?m[1]:''}
function rawCanonicalType(value,fallback='Flight'){
  const key=String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
  const aliases={'FLIGHT':'Flight','SIM':'Simulator','SIMULATOR':'Simulator','RT':'Simulator','GROUND COURSE':'Ground Course','GROUND TRAINING':'Ground Course','GROUND TRAINING/COURSE':'Ground Course','GRT':'Ground Course','DHD':'DHD','DHP':'DHP','STBY':'STBY','STANDBY':'STBY','HSBY':'STBY','DAY OFF':'Day OFF','OFF':'Day OFF','FLIGHT DUTY':'Flight Duty','DUTY':'Duty'};
  return aliases[key]||String(value||'').trim()||fallback;
}
const ACTIVITY_STATUS=Object.freeze({PLANNED:'PLANNED',OPEN:'OPEN',COMPLETED:'COMPLETED'});
const LEGACY_ACTIVITY_FIELDS=Object.freeze({entry:['entry','Visible'].join(''),roster:['roster','Visible'].join(''),duty:['duty','Visible'].join(''),completed:['completed','EntryId'].join(''),rosterItem:['roster','ItemId'].join(''),legacyRoster:['legacy','RosterId'].join(''),rosterAeroline:['roster','AerolineKey'].join('')});
function legacyActivityField(row,key){return row?.[LEGACY_ACTIVITY_FIELDS[key]]}
function activityStatusRank(value){return value===ACTIVITY_STATUS.COMPLETED?3:value===ACTIVITY_STATUS.OPEN?2:1}
function canonicalActivityStatus(source={},origin=''){
  const explicit=String(source.activityStatus||source.status||'').trim().toUpperCase();
  const planningSource=['aeroline','calendar','roster','screenshot'].includes(String(source.source||'').toLowerCase());
  const untouchedPlan=planningSource&&!source.manualOverride&&!source.locked&&!source.completedAt;
  // Migration rule: an entry that was already authoritative/completed in v10.0 must never
  // be downgraded to PLANNED merely because it also originated from the AeroLINE roster.
  if(legacyActivityField(source,'entry')&&(explicit==='DONE'||explicit==='COMPLETED'||source.locked||source.manualOverride||source.completedAt))return ACTIVITY_STATUS.COMPLETED;
  if(untouchedPlan&&(explicit==='DONE'||explicit==='COMPLETED')&&legacyActivityField(source,'roster')&&!legacyActivityField(source,'entry'))return ACTIVITY_STATUS.PLANNED;
  if(explicit==='COMPLETED'||explicit==='DONE')return ACTIVITY_STATUS.COMPLETED;
  if(explicit==='OPEN')return ACTIVITY_STATUS.OPEN;
  if(explicit==='PLANNED'||explicit==='PLAN')return ACTIVITY_STATUS.PLANNED;
  if(source.locked||source.manualOverride||source.completedAt||String(source.source||'').toLowerCase()==='logten')return ACTIVITY_STATUS.COMPLETED;
  if(origin==='entries'&&legacyActivityField(source,'entry')&&!untouchedPlan)return ACTIVITY_STATUS.COMPLETED;
  return ACTIVITY_STATUS.PLANNED;
}
function stripLegacyActivityFields(row){
  const rest={...(row||{})};
  for(const key of Object.values(LEGACY_ACTIVITY_FIELDS))delete rest[key];
  for(const key of ['status','std','sta','report','end','minutes','notes'])delete rest[key];
  return rest;
}
function normalizeCoreActivity(source={},origin=''){
  const dutyType=rawCanonicalType(source.dutyType||(origin==='duties'?source.type:'')||'Flight',origin==='duties'?'Duty':'Flight');
  const category=String(source.activityCategory||((origin==='duties'||(legacyActivityField(source,'duty')&&!legacyActivityField(source,'entry')))?'DUTY':'OPERATIONAL')).toUpperCase()==='DUTY'?'DUTY':'OPERATIONAL';
  const clean=stripLegacyActivityFields(source);
  return{
    ...clean,
    id:source.id||makeActivityId(),recordKind:'activity',activityCategory:category,dutyType,
    schedOut:source.schedOut||source.std||'',schedIn:source.schedIn||source.sta||'',
    onDuty:source.onDuty||source.report||'',offDuty:source.offDuty||source.end||'',
    remarks:source.remarks||source.notes||'',
    dutyMinutes:Number(source.dutyMinutes)||Number(source.minutes)||0,
    trainingSector:source.trainingSector!==undefined?!!source.trainingSector:(dutyType==='Flight'&&source.instructionType==='Flight Instruction'),
    instructorFlightTime:Number(source.instructorFlightTime)||(dutyType==='Flight'&&source.instructionType==='Flight Instruction'?(Number(source.block)||Number(source.flight)||0):0),
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
function blankOperationalValue(value){return value===undefined||value===null||value===''||value==='0:00'||value==='00:00'||value===0}
function activityAuthorityScore(row){
  return (row?.manualOverride?1000:0)+(row?.locked?500:0)+activityStatusRank(row?.activityStatus)*100+Object.values(row||{}).filter(v=>!blankOperationalValue(v)).length;
}
function mergeCoreActivities(a,b){
  let primary;
  if(!!a?.manualOverride!==!!b?.manualOverride)primary=a?.manualOverride?a:b;
  else{
    const ta=String(a?._updatedAt||''),tb=String(b?._updatedAt||'');
    if(ta!==tb)primary=ta>tb?a:b;
    else if(recordRevision(a)!==recordRevision(b))primary=recordRevision(a)>recordRevision(b)?a:b;
    else primary=activityAuthorityScore(a)>=activityAuthorityScore(b)?a:b;
  }
  const secondary=primary===a?b:a,merged={...secondary,...primary};
  for(const [key,value] of Object.entries(secondary||{}))if(blankOperationalValue(merged[key])&&!blankOperationalValue(value))merged[key]=value;
  merged.id=primary.id||secondary.id||makeActivityId();merged.recordKind='activity';
  merged.activityStatus=activityStatusRank(a.activityStatus)>=activityStatusRank(b.activityStatus)?a.activityStatus:b.activityStatus;
  return normalizeCoreActivity(merged,merged.activityCategory==='DUTY'?'duties':'entries');
}
function normalizeCoreActivityRecords(rows){
  const out=[],byId=new Map(),bySource=new Map(),byLeg=new Map(),bySemantic=new Map(),bySchedule=new Map();
  const addIndex=(map,key,index)=>{if(!key)return;let indexes=map.get(key);if(!indexes)map.set(key,indexes=new Set());indexes.add(index)};
  const semanticKey=row=>{const digits=rawFlightDigits(row.flightNo),dep=String(row.dep||'').toUpperCase(),arr=String(row.arr||'').toUpperCase();return row.date&&digits&&dep&&arr?`${row.date}|${digits}|${dep}|${arr}`:''};
  const scheduleKey=row=>{const dep=String(row.dep||'').toUpperCase(),arr=String(row.arr||'').toUpperCase();return row.date&&dep&&arr?`${row.date}|${dep}|${arr}`:''};
  const indexRow=(row,index,aliases=[])=>{
    if(row.id)byId.set(row.id,index);
    aliases.filter(Boolean).forEach(id=>byId.set(id,index));
    addIndex(bySource,syncSourceKey(row),index);
    addIndex(byLeg,row.aerolineFlightLegId?String(row.aerolineFlightLegId):'',index);
    if(rawCanonicalType(row.dutyType)==='Flight'){
      addIndex(bySemantic,semanticKey(row),index);
      addIndex(bySchedule,scheduleKey(row),index);
    }
  };
  const uniqueIndex=(map,key,predicate=null)=>{
    const indexes=key?map.get(key):null;if(!indexes)return undefined;
    const matches=[...indexes].filter(index=>!predicate||predicate(out[index]));
    return matches.length===1?matches[0]:undefined;
  };
  for(const raw of (rows||[])){
    if(!raw)continue;
    const row=normalizeCoreActivity(raw,raw.activityCategory==='DUTY'?'duties':'');
    const aliases=[legacyActivityField(raw,'completed'),legacyActivityField(raw,'rosterItem')];
    let index=byId.get(row.id);
    if(index===undefined)for(const alias of aliases){if(alias&&byId.has(alias)){index=byId.get(alias);break}}
    if(index===undefined)index=uniqueIndex(bySource,syncSourceKey(row));
    if(index===undefined&&row.aerolineFlightLegId)index=uniqueIndex(byLeg,String(row.aerolineFlightLegId));
    if(index===undefined&&rawCanonicalType(row.dutyType)==='Flight')index=uniqueIndex(bySemantic,semanticKey(row));
    if(index===undefined&&rawCanonicalType(row.dutyType)==='Flight')index=uniqueIndex(bySchedule,scheduleKey(row),candidate=>scheduledFlightIdentityMatch(candidate,row));
    if(index!==undefined){out[index]=mergeCoreActivities(out[index],row);indexRow(out[index],index,[row.id,...aliases])}
    else{index=out.length;out.push(row);indexRow(row,index,aliases)}
  }
  return out;
}
function migrateSnapshotToOperationalDatabase(snapshot={}){
  if(isOperationalDatabase(snapshot?.database))return normalizeOperationalDatabase(snapshot.database);
  if(isOperationalDatabase(snapshot))return normalizeOperationalDatabase(snapshot);
  if(Array.isArray(snapshot?.databaseRecords)){
    const values=Array.isArray(snapshot.databaseValues)?Object.fromEntries(snapshot.databaseValues.filter(x=>x&&typeof x.key==='string').map(x=>[x.key,x.value])):(snapshot.databaseValues||{});
    return normalizeOperationalDatabase({schema:snapshot.databaseMeta?.schema||'PilotLog Operational Database',schemaVersion:Number(snapshot.databaseMeta?.schemaVersion)||1,records:snapshot.databaseRecords,values,updatedAt:snapshot.databaseMeta?.updatedAt||new Date().toISOString()});
  }
  const db=emptyOperationalDatabase(),records=[];
  for(const source of (Array.isArray(snapshot.flights)?snapshot.flights:[])){
    records.push(normalizeCoreActivity(source,'entries'));
  }
  for(const source of (Array.isArray(snapshot.roster)?snapshot.roster:[])){
    const roster=normalizeCoreActivity({...source,dutyType:'Flight',activityStatus:source.status||ACTIVITY_STATUS.PLANNED},'roster');
    records.push(roster);
  }
  for(const source of (Array.isArray(snapshot.duties)?snapshot.duties:[])){
    const duty=normalizeCoreActivity({...source,activityCategory:'DUTY'},'duties');
    const i=records.findIndex(x=>x.id===duty.id||(x.date===duty.date&&rawCanonicalType(x.dutyType,'Duty')===duty.dutyType&&(x.onDuty||'')===(duty.onDuty||'')&&(x.offDuty||'')===(duty.offDuty||'')));
    if(i>=0)records[i]=mergeCoreActivities(records[i],duty);else records.push(duty);
  }
  db.records=normalizeCoreActivityRecords(records);
  db.values={
    [TRIPS_KEY]:Array.isArray(snapshot.trips)?snapshot.trips:[],
    [EXPIRY_KEY]:Array.isArray(snapshot.expiry)?snapshot.expiry:[],
    [SYNC_LEDGER_KEY]:Array.isArray(snapshot.syncLedger)?snapshot.syncLedger:[],
    [APP_SETTINGS_KEY]:snapshot.appSettings||{},
    [PAY_SETTINGS_KEY]:snapshot.paySettings||{},
    [PAY_MONTH_KEY]:snapshot.payrollExtras||snapshot.payMonth||{},
    [FX_KEY]:snapshot.fx||{},
    [LOGTEN_ARCHIVE_META_KEY]:snapshot.logTenArchiveMeta||{},
    [AEROLINE_CONFIG_KEY]:snapshot.aerolineConfig||{},
    [ENTRY_DRAFTS_KEY]:Array.isArray(snapshot.drafts)?snapshot.drafts:[],
    [ENTRY_DRAFT_KEY]:snapshot.activeDraft||null
  };
  return normalizeOperationalDatabase(db);
}
function legacySnapshot(flights){
  return{flights:Array.isArray(flights)&&flights.length?flights:legacyLocalFlights(),roster:legacyLocalJson(LEGACY_ROSTER_STORAGE_KEY,[]),duties:legacyLocalJson(LEGACY_DUTIES_STORAGE_KEY,[]),trips:legacyLocalJson(TRIPS_KEY,[]),expiry:legacyLocalJson(EXPIRY_KEY,[]),syncLedger:legacyLocalJson(SYNC_LEDGER_KEY,[]),appSettings:legacyLocalJson(APP_SETTINGS_KEY,{}),paySettings:legacyLocalJson(PAY_SETTINGS_KEY,{}),payMonth:legacyLocalJson(PAY_MONTH_KEY,{}),fx:legacyLocalJson(FX_KEY,{}),logTenArchiveMeta:legacyLocalJson(LOGTEN_ARCHIVE_META_KEY,{}),aerolineConfig:legacyLocalJson(AEROLINE_CONFIG_KEY,{}),drafts:legacyLocalJson(ENTRY_DRAFTS_KEY,[]),activeDraft:legacyLocalJson(ENTRY_DRAFT_KEY,null)};
}
async function initFlightStore(){
  try{
    const stored=await readFlightStore(),fallback=legacyLocalJson(FALLBACK_DB_KEY,null);
    if(isOperationalDatabase(stored))operationalDatabase=normalizeOperationalDatabase(stored);
    else if(isOperationalDatabase(fallback))operationalDatabase=normalizeOperationalDatabase(fallback);
    else operationalDatabase=migrateSnapshotToOperationalDatabase(legacySnapshot(await readLegacyFlightStore()));
    reconcileOperationalFlightIdentities();
    await writeFlightStore(operationalDatabase);
    flightStoreReady=true;
    try{localStorage.removeItem(FALLBACK_DB_KEY)}catch{}
    try{if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{})}catch{}
  }catch(e){
    console.warn('IndexedDB operational database unavailable; using one local fallback database',e);
    operationalDatabase=migrateSnapshotToOperationalDatabase(legacySnapshot(legacyLocalFlights()));flightStoreReady=false;
    try{localStorage.setItem(FALLBACK_DB_KEY,JSON.stringify(operationalDatabase))}catch{}
  }
  return operationalDatabase;
}
function queueFlightPersist(){
  flightPersistDirty=true;
  if(!flightStoreReady)return Promise.resolve(false);
  if(flightPersistTimer){clearTimeout(flightPersistTimer);flightPersistTimer=null}
  if(flightPersistActive)return flightPersistPromise;
  flightPersistActive=true;
  flightPersistPromise=(async()=>{
    try{while(flightPersistDirty){flightPersistDirty=false;await writeFlightStore(operationalDatabase)}}
    finally{flightPersistActive=false}
    return true;
  })();
  return flightPersistPromise;
}
function scheduleFlightPersist(delay=450){
  flightPersistDirty=true;
  if(!flightStoreReady)return false;
  if(flightPersistTimer)clearTimeout(flightPersistTimer);
  flightPersistTimer=setTimeout(()=>{flightPersistTimer=null;queueFlightPersist().catch(e=>console.error('PilotLog IndexedDB write failed',e))},delay);
  return true;
}
async function flushFlightStore(){if(!flightStoreReady)return true;if(flightPersistTimer){clearTimeout(flightPersistTimer);flightPersistTimer=null}await queueFlightPersist();return true}
function coreActivityRows(){return(operationalDatabase?.records||[]).filter(x=>x?.recordKind==='activity').map(x=>({...x}))}
function coreTripRows(){return(operationalDatabase?.records||[]).filter(x=>x?.recordKind==='trip').map(x=>({...x}))}
function replaceCoreTrips(rows){
  if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();
  const kept=(operationalDatabase.records||[]).filter(x=>x?.recordKind!=='trip');
  const trips=(Array.isArray(rows)?rows:[]).map(x=>({...x,id:x?.id||makeActivityId(),recordKind:'trip'}));
  operationalDatabase.records=[...kept,...trips];return touchOperationalDatabase();
}
function isEntryActivityRecord(x){return x?.recordKind==='activity'&&String(x.activityCategory||'OPERATIONAL').toUpperCase()!=='DUTY'}
function isDutyActivityRecord(x){return x?.recordKind==='activity'&&String(x.activityCategory||'').toUpperCase()==='DUTY'}
function entryActivityRows(){return coreActivityRows().filter(isEntryActivityRecord)}
function rosterFlightRows(){return coreActivityRows().filter(x=>rawCanonicalType(x.dutyType)==='Flight').map(x=>({...x,std:x.schedOut||'',sta:x.schedIn||'',status:x.activityStatus===ACTIVITY_STATUS.COMPLETED?'done':'planned'}))}
function dutyActivityRows(){return coreActivityRows().filter(isDutyActivityRecord).map(x=>({...x,type:x.dutyType||'Duty',report:x.onDuty||'',end:x.offDuty||'',minutes:Number(x.dutyMinutes)||timeSpanMins(x.onDuty||'',x.offDuty||''),notes:x.remarks||''}))}
function commitCoreActivities(rows){
  if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();
  operationalDatabase.records=normalizeCoreActivityRecords(Array.isArray(rows)?rows:[]);
  return touchOperationalDatabase();
}
function replaceActivitySelection(predicate,rows){
  const kept=coreActivityRows().filter(x=>!predicate(x)),incoming=(rows||[]).map(x=>normalizeCoreActivity(x,isDutyActivityRecord(x)?'duties':''));
  return commitCoreActivities([...kept,...incoming]);
}
function upsertCoreActivity(source){
  const row=normalizeCoreActivity(source,isDutyActivityRecord(source)?'duties':''),records=coreActivityRows(),i=records.findIndex(x=>x.id===row.id);
  if(i>=0)records[i]=normalizeCoreActivity({...records[i],...row,id:records[i].id},isDutyActivityRecord(row)?'duties':'');else records.push(row);
  commitCoreActivities(records);return coreActivityRows().find(x=>x.id===row.id)||row;
}
function removeCoreActivities(predicate){return commitCoreActivities(coreActivityRows().filter(x=>!predicate(x)))}
async function persistCoreActivities(){await flushFlightStore();return true}
async function replaceEntryActivitiesDurable(rows){replaceActivitySelection(isEntryActivityRecord,(rows||[]).map(x=>({...x,activityCategory:'OPERATIONAL'})));await persistCoreActivities();return true}
function databaseValue(key,def){const v=operationalDatabase?.values?.[key];return v===undefined?def:v}
const load=k=>{if(k===TRIPS_KEY)return coreTripRows();if(BUSINESS_KEYS.has(k)){const v=databaseValue(k,[]);return Array.isArray(v)?v:[]}try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return[]}};
function touchOperationalDatabase(){if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();operationalDatabase.updatedAt=new Date().toISOString();if(flightStoreReady)scheduleFlightPersist();else try{localStorage.setItem(FALLBACK_DB_KEY,JSON.stringify(operationalDatabase))}catch{};return true}
const AUTHORITATIVE_ENTRY_FIELDS=['date','flightNo','dep','arr','type','reg','location','schedOut','schedIn','out','off','on','in','block','flight','simulatorTime','credit','role','seatPosition','instructionType','trainingSector','instructorFlightTime','trainerType','aerolineTrainerType','night','ifr','pf','approachType','approaches','picName','sicName','soName','instructorName','remarks','courseType','delayMinutes','delayReason','pax','fuel','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','onDuty','offDuty','totalDuty','sectors','locked','manualOverride','callFromDayOff'];
function setLocalJson(k,v){
  if(k===TRIPS_KEY)return replaceCoreTrips(v);
  if(BUSINESS_KEYS.has(k)){if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();operationalDatabase.values[k]=v;return touchOperationalDatabase()}
  const text=JSON.stringify(v);
  try{localStorage.setItem(k,text);return true}
  catch(e){
    const quota=e?.name==='QuotaExceededError'||e?.name==='NS_ERROR_DOM_QUOTA_REACHED'||e?.code===22||e?.code===1014;
    if(quota&&k!==LEGACY_FLIGHT_BACKUP_KEY){try{localStorage.removeItem(LEGACY_FLIGHT_BACKUP_KEY);localStorage.setItem(k,text);return true}catch{}}
    throw e;
  }
}
const save=(k,v)=>{
  return setLocalJson(k,v);
};
const loadObject=(k,def={})=>{if(BUSINESS_KEYS.has(k)){const v=databaseValue(k,def);return v&&typeof v==='object'&&!Array.isArray(v)?v:def}try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?v:def}catch{return def}};
function saveObject(k,v){return setLocalJson(k,v&&typeof v==='object'?v:{})}
function mergeOperationalFlightPair(entry,roster){
  return mergeCoreActivities(normalizeCoreActivity(entry,'entries'),normalizeCoreActivity(roster,'roster'));
}
function reconcileOperationalFlightIdentities(){
  if(!operationalDatabase?.records)return{merged:0,reviews:0};
  let records=[...operationalDatabase.records],merged=0;
  const normalized=normalizeCoreActivityRecords(records);merged=Math.max(0,records.length-normalized.length);records=normalized;
  const prior=Array.isArray(operationalDatabase.values?.[RECONCILIATION_REVIEW_KEY])?operationalDatabase.values[RECONCILIATION_REVIEW_KEY]:[];
  const unique=prior.filter(row=>row?.kind!=='ambiguous-flight-link');
  if(merged||JSON.stringify(prior)!==JSON.stringify(unique)){operationalDatabase.values[RECONCILIATION_REVIEW_KEY]=unique;commitCoreActivities(records)}
  return{merged,reviews:0};
}
function removeBusinessValue(k){if(k===TRIPS_KEY){replaceCoreTrips([]);return}if(!BUSINESS_KEYS.has(k)){localStorage.removeItem(k);return}if(BUSINESS_ARRAY_KEYS.has(k))operationalDatabase.values[k]=[];else operationalDatabase.values[k]=null;touchOperationalDatabase()}
async function replaceOperationalDatabase(database){operationalDatabase=normalizeOperationalDatabase(database);touchOperationalDatabase();await flushFlightStore();return operationalDatabase}
function operationalDatabaseCounts(database=operationalDatabase){
  const records=database?.records||[],values=database?.values||{};
  return{activities:records.filter(x=>x?.recordKind==='activity').length,entries:records.filter(x=>x?.recordKind==='activity'&&x.activityStatus===ACTIVITY_STATUS.COMPLETED&&(rawCanonicalType(x.dutyType)==='Flight'||rawCanonicalType(x.dutyType)==='Simulator')).length,roster:records.filter(x=>x?.recordKind==='activity'&&rawCanonicalType(x.dutyType)==='Flight').length,duties:records.filter(x=>x?.recordKind==='activity'&&String(x.activityCategory||'').toUpperCase()==='DUTY').length,trips:records.filter(x=>x?.recordKind==='trip').length,expiry:Array.isArray(values[EXPIRY_KEY])?values[EXPIRY_KEY].length:0};
}
const recordRevision=o=>Math.max(0,Number(o?._syncRev)||0);
const stamp=o=>({...o,_syncRev:recordRevision(o)+1,_updatedAt:new Date().toISOString()});
const today=()=>new Date().toISOString().slice(0,10);
function makeId(){
  if(globalThis.crypto?.randomUUID)return `pl-${crypto.randomUUID()}`;
  const a=new Uint32Array(4);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(a);else for(let i=0;i<4;i++)a[i]=(Math.random()*0xffffffff)>>>0;
  return `pl-${[...a].map(v=>v.toString(16).padStart(8,'0')).join('-')}`;
}
function makeActivityId(){
  const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  for(let attempt=0;attempt<8;attempt++){
    const bytes=new Uint8Array(10);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=(Math.random()*256)|0;
    const id=[...bytes].map(v=>alphabet[v&31]).join('');
    if(!(operationalDatabase?.records||[]).some(x=>x?.id===id))return id;
  }
  throw new Error('Unable to create a unique Core activity ID.');
}
function stableHash(value){let h=2166136261;const text=String(value||'');for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function stableHash128(value){
  const s=String(value||'');let h1=1779033703,h2=3144134277,h3=1013904242,h4=2773480762;
  for(let i=0,k;i<s.length;i++){k=s.charCodeAt(i);h1=h2^Math.imul(h1^k,597399067);h2=h3^Math.imul(h2^k,2869860233);h3=h4^Math.imul(h3^k,951274213);h4=h1^Math.imul(h4^k,2716044179)}
  h1=Math.imul(h3^(h1>>>18),597399067);h2=Math.imul(h4^(h2>>>22),2869860233);h3=Math.imul(h1^(h3>>>17),951274213);h4=Math.imul(h2^(h4>>>19),2716044179);
  const out=[(h1^h2^h3^h4)>>>0,(h2^h1)>>>0,(h3^h1)>>>0,(h4^h1)>>>0];return out.map(v=>v.toString(16).padStart(8,'0')).join('');
}
function stableSourceId(kind,sourceKey){return `src-${String(kind||'item')}-${stableHash128(`${kind}|${sourceKey}`)}`}
function syncDeviceId(){let id=localStorage.getItem(SYNC_DEVICE_KEY);if(!id){id=`dev-${stableHash(`${Date.now()}-${Math.random()}-${navigator.userAgent||''}`)}-${Date.now().toString(36)}`;try{localStorage.setItem(SYNC_DEVICE_KEY,id)}catch{}}return id||'device'}
function syncSourceKey(o){
  if(!o||typeof o!=='object')return'';
  if(o.source==='aeroline'&&o.aerolineKey)return `aeroline:${String(o.aerolineKey)}`;
  if(o.source==='logten'&&o.logtenUniqueId)return `logten:${String(o.logtenUniqueId)}`;
  if(o.source==='logten'&&o.sourceRowKey)return `logten-row:${String(o.sourceRowKey)}`;
  if(o.source==='calendar'&&o.calendarUid)return `calendar:${String(o.calendarUid)}`;
  if(o.source==='roster'&&o.sourceRowKey)return `roster:${String(o.sourceRowKey)}`;
  return'';
}
const mins=t=>{if(!t)return null;const [h,m]=String(t).split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null};
const diff=(a,b)=>{if(a==null||b==null)return 0;let d=b-a;if(d<0)d+=1440;return d};
const timeSpanMins=(start,end)=>diff(mins(start),mins(end));
const fmt=m=>`${Math.floor(Math.max(0,Number(m)||0)/60)}:${String(Math.round(Math.max(0,Number(m)||0))%60).padStart(2,'0')}`;
const PILOTLOG_RULES=Object.freeze({
  aliases:Object.freeze({
    'FLIGHT':'Flight','SIM':'Simulator','SIMULATOR':'Simulator','RT':'Simulator',
    'GROUND COURSE':'Ground Course','GROUND TRAINING':'Ground Course','GROUND TRAINING/COURSE':'Ground Course','GRT':'Ground Course',
    'DHD':'DHD','DHP':'DHP','STBY':'STBY','STANDBY':'STBY','HSBY':'STBY',
    'DAY OFF':'Day OFF','OFF':'Day OFF','FLIGHT DUTY':'Flight Duty','DUTY':'Duty'
  }),
  activities:Object.freeze({
    'Flight':Object.freeze({editor:'flight',credit:'flight-schedule',trip:'duty',totals:'flight',rosterEditLocked:false}),
    'Simulator':Object.freeze({editor:'entry',credit:'editable-sim',trip:'duty',totals:'simulator',rosterEditLocked:true}),
    'Ground Course':Object.freeze({editor:'entry',credit:'editable-ground',trip:'fixed-ground',totals:'other',rosterEditLocked:true}),
    'DHD':Object.freeze({editor:'entry',credit:'zero',trip:'zero',totals:'other',rosterEditLocked:true}),
    'DHP':Object.freeze({editor:'entry',credit:'editable',trip:'credit',totals:'other',rosterEditLocked:true}),
    'STBY':Object.freeze({editor:'entry',credit:'stored',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Day OFF':Object.freeze({editor:'duty',credit:'zero',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Flight Duty':Object.freeze({editor:'duty',credit:'zero',trip:'duty',totals:'other',rosterEditLocked:true}),
    'Duty':Object.freeze({editor:'duty',credit:'zero',trip:'duty',totals:'other',rosterEditLocked:true})
  }),
  fixed:Object.freeze({groundTripDutyMins:300})
});
function canonicalDutyType(value,fallback='Flight'){
  const raw=String(value??'').trim();if(!raw)return fallback;
  const key=upper(raw).replace(/\s+/g,' ');
  return PILOTLOG_RULES.aliases[key]||raw;
}
function activityRule(value){
  const raw=value&&typeof value==='object'?(value.dutyType||value.type||''):value;
  const type=canonicalDutyType(raw,'Flight');
  return {type,...(PILOTLOG_RULES.activities[type]||{editor:'duty',credit:'stored',trip:'duty',totals:'other',rosterEditLocked:true})};
}
function rosterCanEditLockedActivity(value){const r=activityRule(value);return r.editor==='entry'&&r.rosterEditLocked===true}
const MOROCCO_IATA=new Set(['CMN','RAK','FEZ','TNG','RBA','OUD','AGA','NDR','ESU','OZZ','ERH','EUN','TTU','UAR','BEM']);
function isMoroccoCode(code){
  code=upper(code);
  if(MOROCCO_IATA.has(code))return true;
  const a=airportIndex?.[code];
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
  return m!==null&&(m>=18*60||m<5*60);
}
function moroccoNightTrigger(f){
  // Reuse the existing, tested Morocco scheduled-departure helper.
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
  return dutyGetsMoroccoNightPremium(f,allEntries)?Math.round(rounded*1.5):rounded;
}
const shiftTime=(t,delta)=>{const m=mins(t);if(m==null)return'';let x=(m+delta)%1440;if(x<0)x+=1440;return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`};
function signedMinuteDelta(from,to){const a=mins(from),b=mins(to);if(a==null||b==null)return 0;let d=b-a;if(d>720)d-=1440;if(d<-720)d+=1440;return d}
function formDelayMinutes(){if($('dutyTypeFlight')?.value!=='Flight')return 0;return Math.max(0,signedMinuteDelta($('schedOut')?.value,$('out')?.value))}
function updateDelayUI(){const wrap=$('delayReason')?.closest('[data-entry-field]'),d=formDelayMinutes();if(wrap)wrap.classList.toggle('hidden',d<=0);if($('delayReasonLabel'))$('delayReasonLabel').textContent=d>0?`Delay reason • ${fmt(d)}`:'Delay reason';return d}
function promptDelayReasonIfNeeded(){const d=updateDelayUI();if(d<=0){if($('delayReason'))$('delayReason').value='';return true}if(String($('delayReason')?.value||'').trim())return true;const reason=prompt(`Reason of delay (${fmt(d)})`,'');if(reason===null)return false;const clean=upper(reason.trim());if(!clean){alert('Please enter the reason for the delay.');return false}$('delayReason').value=clean;saveEntryDraft();return true}
function syncOnDutyFromScheduleOut(){if($('dutyTypeFlight')?.value!=='Flight')return;const t=$('schedOut')?.value||'';$('onDuty').value=t?shiftTime(t,-60):''}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const csv=s=>`"${String(s??'').replace(/"/g,'""')}"`;
const dateOnly=d=>new Date(`${d}T00:00:00Z`);


const entrySuggestionDb={crew:[],types:[]};
function refreshEntrySuggestions(){
  const fs=entryActivityRows(),names=new Set(),types=new Set();
  fs.forEach(f=>{
    [f.picName,f.sicName,f.soName,f.instructorName].forEach(n=>{const v=upper(n||'').trim();if(v)names.add(v)});
    const t=upper(f.type||'').trim();if(t&&t!=='UNSPECIFIED')types.add(t);
  });
  const selfName=upper(appSettings().profileName||'');
  if(selfName)names.add(selfName);
  entrySuggestionDb.crew=[...names].sort();
  entrySuggestionDb.types=[...types].sort();
  if($('crewNameSuggestions'))$('crewNameSuggestions').innerHTML=entrySuggestionDb.crew.map(v=>`<option value="${esc(v)}"></option>`).join('');
  if($('aircraftTypeSuggestions'))$('aircraftTypeSuggestions').innerHTML=entrySuggestionDb.types.map(v=>`<option value="${esc(v)}"></option>`).join('');
}
function setupSmartAutocomplete(inputId,getValues){
  const input=$(inputId);if(!input)return;
  const host=input.parentElement;host.classList.add('autocomplete-host');
  let menu=host.querySelector('.smart-autocomplete');
  if(!menu){menu=document.createElement('div');menu.className='smart-autocomplete hidden';host.appendChild(menu)}
  const hide=()=>menu.classList.add('hidden');
  const render=()=>{
    const q=upper(input.value||'');
    const vals=(getValues()||[]).filter(v=>!q||v.startsWith(q)||v.includes(q)).slice(0,8);
    if(!vals.length){hide();return}
    menu.innerHTML=vals.map(v=>`<button type="button" data-autocomplete-value="${esc(v)}">${esc(v)}</button>`).join('');
    menu.classList.remove('hidden');
  };
  input.addEventListener('focus',render);input.addEventListener('input',render);
  menu.addEventListener('mousedown',e=>e.preventDefault());
  menu.addEventListener('click',e=>{const b=e.target.closest('[data-autocomplete-value]');if(!b)return;input.value=b.dataset.autocompleteValue;hide();input.dispatchEvent(new Event('input',{bubbles:true}))});
  input.addEventListener('blur',()=>setTimeout(hide,120));
}

function displayDate(v){
  const s=String(v||'').slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:s;
}
function displayDateTime(v){
  const s=String(v||'');
  if(!s)return'';
  const parts=s.replace('T',' ').split(' ');
  return `${displayDate(parts[0])}${parts[1]?' '+parts[1].slice(0,5):''}`;
}

const sum=(a,f)=>a.reduce((x,y)=>x+(Number(f(y))||0),0);
const upper=s=>String(s||'').trim().toUpperCase();
const durMins=v=>{v=String(v||'').trim();const m=v.match(/^(\d+):(\d{1,2})$/);return m?Number(m[1])*60+Number(m[2]):0};
const scheduleBlockMins=f=>{
  if(f?.schedOut&&f?.schedIn)return timeSpanMins(f.schedOut,f.schedIn);
  if(canonicalDutyType(f?.dutyType||'Flight')==='Flight')return 0;
  return Math.max(0,Number(f?.schedBlock)||0);
};
function isFlight(f){return f?.sim!=='yes'&&canonicalDutyType(f?.dutyType||'Flight')==='Flight'}
function sourceLabel(source){
  const s=String(source||'manual').toLowerCase();
  return ({aeroline:'AeroLINE',logten:'LogTen',calendar:'Calendar',roster:'Roster',manual:'Manual','other_company':'Other Company',simulator:'Simulator'})[s]||String(source||'Manual');
}
function setEntrySourceDisplay(source){const el=$('entrySourceDisplay');if(el)el.value=sourceLabel(source)}

function showImportProgress(title='Importing data…'){
  const modal=$('importProgressModal');if(!modal)return;
  $('importProgressTitle').textContent=title;$('importProgressBar').style.width='0%';$('importProgressPercent').textContent='0%';$('importProgressDetail').textContent='Preparing…';modal.classList.remove('hidden');
}
function setImportProgress(percent,detail=''){
  const p=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));if($('importProgressBar'))$('importProgressBar').style.width=`${p}%`;if($('importProgressPercent'))$('importProgressPercent').textContent=`${p}%`;if($('importProgressDetail')&&detail)$('importProgressDetail').textContent=detail;
}
function hideImportProgress(){const modal=$('importProgressModal');if(modal)modal.classList.add('hidden')}
function yieldToUi(){return new Promise(resolve=>setTimeout(resolve,0))}
function normalizedFlightKey(v){return cleanPrefix(composeFlightNo(v||''))}
function normalizedFlightDigits(v){
  const s=upper(v||'').replace(/\s+/g,'');
  const m=s.match(/(\d{2,4})$/);
  return m?m[1]:'';
}
function entryCompleteness(f){
  const weighted=[
    ['flightNo',5],['type',3],['reg',3],['dep',3],['arr',3],
    ['schedOut',4],['schedIn',4],['out',3],['off',3],['on',3],['in',3],
    ['onDuty',2],['offDuty',2],['block',4],['flight',4],['credit',2],
    ['night',2],['role',1],['instructionType',3],['remarks',1],
    ['dayTakeoffs',1],['nightTakeoffs',1],['dayLandings',1],['nightLandings',1]
  ];
  return weighted.reduce((sum,[k,w])=>{
    const v=f?.[k];
    const present=typeof v==='number'?v>0:String(v||'').trim()!==''&&String(v)!=='0:00'&&String(v)!=='00:00';
    return sum+(present?w:0);
  },0)+(f?.locked?2:0);
}
function mergeDuplicateEntries(a,b){
  const ca=entryCompleteness(a),cb=entryCompleteness(b);
  const primary=ca>=cb?a:b,secondary=ca>=cb?b:a;
  const merged={...secondary,...primary};
  Object.keys(secondary||{}).forEach(k=>{
    const pv=merged[k],sv=secondary[k];
    const blank=pv===undefined||pv===null||pv===''||pv==='0:00'||pv==='00:00'||pv===0;
    const useful=sv!==undefined&&sv!==null&&sv!==''&&sv!=='0:00'&&sv!=='00:00'&&sv!==0;
    if(blank&&useful)merged[k]=sv;
  });
  merged.id=primary.id||secondary.id||makeActivityId();
  merged.locked=!!(a.locked||b.locked);
  merged._syncRev=Math.max(recordRevision(a),recordRevision(b));
  merged._updatedAt=[a._updatedAt,b._updatedAt].filter(Boolean).sort().pop()||new Date().toISOString();
  return merged;
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
function dedupeFlightEntriesSemantic(entries){
  let list=[...(entries||[])],removed=0,removedIds=[],changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      if(list[i]?.logtenUniqueId&&list[j]?.logtenUniqueId&&String(list[i].logtenUniqueId)!==String(list[j].logtenUniqueId))continue;
      if(exactOperationalMatch(list[i],list[j])){
        const a=list[i],b=list[j],merged=mergeDuplicateEntries(a,b),removedId=merged.id===a.id?b.id:a.id;
        if(removedId)removedIds.push(removedId);list[i]=merged;list.splice(j,1);removed++;changed=true;break outer;
      }
    }
  }
  const skeletal=list.filter(f=>isFlight(f)&&!normalizedFlightDigits(f.flightNo)&&entryCompleteness(f)<=14);
  for(const sk of [...skeletal]){
    const candidates=list.filter(c=>c!==sk&&isFlight(c)&&c.date===sk.date&&upper(c.dep||'')===upper(sk.dep||'')&&upper(c.arr||'')===upper(sk.arr||'')&&normalizedFlightDigits(c.flightNo)&&entryCompleteness(c)>entryCompleteness(sk));
    if(candidates.length===1){
      const c=candidates[0],ci=list.indexOf(c),si=list.indexOf(sk);
      if(ci>=0&&si>=0){const merged=mergeDuplicateEntries(c,sk),removedId=merged.id===c.id?sk.id:c.id;if(removedId)removedIds.push(removedId);list[ci]=merged;if(si!==ci)list.splice(si,1);removed++}
    }
  }
  return{entries:list,removed,removedIds:[...new Set(removedIds.filter(Boolean))]};
}
function isSim(f){return canonicalDutyType(f?.dutyType||'')==='Simulator'||f?.sim==='yes'}
function isLogbookEntry(f){return isFlight(f)||isSim(f)}
function simulatorCompleted(f,now=new Date()){
  if(!isSim(f)||!f?.date)return false;
  const startTime=f.onDuty||'00:00',endTime=f.offDuty||f.onDuty||'23:59';
  const pair=dutyDateEnd(f.date,startTime,endTime),end=pair?.[1];
  if(!end||!Number.isFinite(end.getTime()))return String(f.date)<isoDateLocal(now);
  return end<=now;
}
function isCompletedLogbookEntry(f,now=new Date()){
  return (isFlight(f)||isSim(f))&&f?.activityStatus===ACTIVITY_STATUS.COMPLETED;
}
function isGround(f){return canonicalDutyType(f?.dutyType||'')==='Ground Course'}
function isDhd(f){return canonicalDutyType(f?.dutyType||'')==='DHD'}
function isDhp(f){return canonicalDutyType(f?.dutyType||'')==='DHP'}
function isPositioning(f){return isDhd(f)||isDhp(f)}
function isStby(f){return canonicalDutyType(f?.dutyType||'')==='STBY'}
function picMins(f){return isFlight(f)&&f.role==='PIC'?Number(f.block)||0:0}
function sicMins(f){return isFlight(f)&&f.role==='SIC'?Number(f.block)||0:0}
function flightInstrMins(f){return isFlight(f)&&f.trainingSector===true?(Number(f.instructorFlightTime)||Number(f.block)||0):0}
function simInstrMins(f){return isSim(f)&&f.instructionType==='SFI/SFE Instruction Sim'?(Number(f.simulatorTime)||Number(f.block)||0):0}

function isA320Entry(f){
  const raw=upper([f.type,f.aircraftType,f.category,f.remarks].filter(Boolean).join(' '));
  const norm=raw.replace(/A32O/g,'A320').replace(/[^A-Z0-9]/g,'');
  return norm.includes('A320');
}
function totalFlightMins(f){return isFlight(f)?Number(f.block)||Number(f.flight)||0:0}

const APP_DEFAULTS={homeBase:'CMN',flightPrefix:'MAC',aircraftPrefix:'CN-NM',profileName:'',profileRole:'Captain',profilePhotoData:'',currency:'MAD'};
function appSettings(){return {...APP_DEFAULTS,...loadObject(APP_SETTINGS_KEY,{})}}
function saveAppSettings(v){saveObject(APP_SETTINGS_KEY,{...appSettings(),...v,_updatedAt:new Date().toISOString()})}
const ISO_CURRENCIES=['AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BOV','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF','CHW','CLF','CLP','CNY','COP','COU','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','USN','UYI','UYU','UYW','UZS','VED','VES','VND','VUV','WST','XAF','XAG','XAU','XBA','XBB','XBC','XBD','XCD','XDR','XOF','XPD','XPF','XPT','XSU','XTS','XUA','XXX','YER','ZAR','ZMW','ZWL'];
const QUICK_CASH_CURRENCIES=['USD','TRY','EUR'];
function appCurrency(){const c=upper(appSettings().currency||'MAD');return ISO_CURRENCIES.includes(c)?c:'MAD'}
function currencyOutputCode(code){return upper(code)==='MAD'?'DHM':upper(code)}
function moneyCurrency(value,code=appCurrency()){return `${money(value)} ${currencyOutputCode(code)}`}
function populateCurrencySelect(el,quick=[]){
  if(!el)return;const current=upper(el.value||'');el.innerHTML='';
  if(quick.length){const g=document.createElement('optgroup');g.label='Quick';quick.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c==='MAD'?'MAD / DHM':c;g.appendChild(o)});el.appendChild(g)}
  const all=document.createElement('optgroup');all.label='All currencies';ISO_CURRENCIES.filter(c=>!quick.includes(c)).forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c==='MAD'?'MAD / DHM':c;all.appendChild(o)});el.appendChild(all);
  if(current&&ISO_CURRENCIES.includes(current))el.value=current;
}
const FX_ENDPOINT_CURRENCY='eur';
function fxRateFromTable(table,from,to){from=upper(from);to=upper(to);if(from===to)return 1;const rates=table?.eur||{},fromPerEur=from==='EUR'?1:Number(rates[from.toLowerCase()]),toPerEur=to==='EUR'?1:Number(rates[to.toLowerCase()]);if(!(fromPerEur>0)||!(toPerEur>0))throw new Error(`FX pair unavailable: ${from}/${to}`);return toPerEur/fromPerEur}
async function fetchFxJson(url,timeoutMs=8000){
  const controller=typeof AbortController!=='undefined'?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{const r=await fetch(url,{cache:'no-store',signal:controller?.signal});if(!r.ok)throw new Error(`FX HTTP ${r.status}`);const j=await r.json();if(!j?.eur||typeof j.eur!=='object')throw new Error('FX data unavailable');return j}finally{if(timer)clearTimeout(timer)}
}
async function fetchFxCandidates(urls){let last=null;for(const url of urls){try{return await fetchFxJson(url)}catch(e){last=e}}throw last||new Error('FX unavailable')}
function fxUrlsForDate(key){return[
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${key}/v1/currencies/${FX_ENDPOINT_CURRENCY}.min.json`,
  `https://${key}.currency-api.pages.dev/v1/currencies/${FX_ENDPOINT_CURRENCY}.min.json`,
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${key}/v1/currencies/${FX_ENDPOINT_CURRENCY}.json`,
  `https://${key}.currency-api.pages.dev/v1/currencies/${FX_ENDPOINT_CURRENCY}.json`
]}
async function fetchFxTableForDate(dateStr){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr||'')))throw new Error('Invalid FX date');
  const requested=new Date(`${dateStr}T12:00:00Z`);if(!Number.isFinite(requested.getTime()))throw new Error('Invalid FX date');
  for(let back=0;back<8;back++){
    const d=new Date(requested);d.setUTCDate(d.getUTCDate()-back);const key=d.toISOString().slice(0,10);
    try{const j=await fetchFxCandidates(fxUrlsForDate(key));return{table:j,date:String(j.date||key)}}catch{}
  }
  throw new Error('FX unavailable for the requested date');
}
async function fetchLatestFxTable(){const j=await fetchFxCandidates(fxUrlsForDate('latest'));return{table:j,date:String(j.date||today())}}
async function fxForDate(from,to,dateStr){from=upper(from);to=upper(to);if(from===to)return{rate:1,date:dateStr};const x=await fetchFxTableForDate(dateStr);return{rate:fxRateFromTable(x.table,from,to),date:x.date}}
async function latestFx(from,to){from=upper(from);to=upper(to);if(from===to)return{rate:1,date:today()};const x=await fetchLatestFxTable();return{rate:fxRateFromTable(x.table,from,to),date:x.date}}
function cleanPrefix(v){return upper(v).replace(/\s+/g,'')}
function composeFlightNo(raw){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^3O\d/i.test(s))return prefix+s.slice(2);if(/^\d+$/.test(s))return prefix+s;return s}
function flightNoInput(full){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(full);if(prefix&&s.startsWith(prefix))return s.slice(prefix.length);if(/^3O\d/i.test(s))return s.slice(2);return s}
function composeAircraftId(raw){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^[A-Z]{1,3}-[A-Z0-9-]+$/.test(s))return s;return prefix+s}
function aircraftIdInput(full){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(full);return prefix&&s.startsWith(prefix)?s.slice(prefix.length):s}
function updatePrefixUI(){const st=appSettings();$('flightPrefixLabel').textContent=cleanPrefix(st.flightPrefix||'MAC');$('aircraftPrefixLabel').textContent=cleanPrefix(st.aircraftPrefix||'CN-NM')}

function updateAppHeader(){
  const st=appSettings(),name=String(st.profileName||'').trim(),role=String(st.profileRole||'').trim();
  const descriptor=[role,name].filter(Boolean).join(' ');
  if($('appTitle'))$('appTitle').textContent=descriptor?`PilotLog of ${descriptor}`:'PilotLog';
  if($('appTagline'))$('appTagline').textContent='PilotLog — your personal LogBook';
  const photo=$('profileHeaderPhoto'),mark=document.querySelector('.brand-mark svg'),hasPhoto=!!st.profilePhotoData;
  if(photo){photo.classList.toggle('hidden',!hasPhoto);if(hasPhoto)photo.src=st.profilePhotoData;else photo.removeAttribute('src')}
  if(mark)mark.classList.toggle('hidden',hasPhoto);
  document.title=descriptor?`PilotLog of ${descriptor}`:'PilotLog';
}


/* Airport DB: fallback + IndexedDB cache of the public mwgg Airports dataset. */
const AIRPORT_SOURCE='https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const AIRPORT_FALLBACK={
CMN:{iata:'CMN',icao:'GMMN',name:'Mohammed V International Airport',city:'Casablanca',country:'MA',lat:33.3675,lon:-7.58997,tz:'Africa/Casablanca'},
TNG:{iata:'TNG',icao:'GMTT',name:'Tangier Ibn Battouta Airport',city:'Tangier',country:'MA',lat:35.7269,lon:-5.91689,tz:'Africa/Casablanca'},
RAK:{iata:'RAK',icao:'GMMX',name:'Marrakesh Menara Airport',city:'Marrakesh',country:'MA',lat:31.6069,lon:-8.0363,tz:'Africa/Casablanca'},
FEZ:{iata:'FEZ',icao:'GMFF',name:'Fès–Saïs Airport',city:'Fès',country:'MA',lat:33.9273,lon:-4.97796,tz:'Africa/Casablanca'},
BGY:{iata:'BGY',icao:'LIME',name:'Milan Bergamo Airport',city:'Bergamo',country:'IT',lat:45.6739,lon:9.70417,tz:'Europe/Rome'},
MXP:{iata:'MXP',icao:'LIMC',name:'Milan Malpensa Airport',city:'Milan',country:'IT',lat:45.6306,lon:8.72811,tz:'Europe/Rome'},
NAP:{iata:'NAP',icao:'LIRN',name:'Naples International Airport',city:'Naples',country:'IT',lat:40.886,lon:14.2908,tz:'Europe/Rome'},
CTA:{iata:'CTA',icao:'LICC',name:'Catania Fontanarossa Airport',city:'Catania',country:'IT',lat:37.4668,lon:15.0664,tz:'Europe/Rome'},
FCO:{iata:'FCO',icao:'LIRF',name:'Rome Fiumicino Airport',city:'Rome',country:'IT',lat:41.8003,lon:12.2389,tz:'Europe/Rome'},
BSL:{iata:'BSL',icao:'LFSB',name:'EuroAirport Basel Mulhouse Freiburg',city:'Basel',country:'CH',lat:47.59,lon:7.52991,tz:'Europe/Zurich'},
SAW:{iata:'SAW',icao:'LTFJ',name:'Istanbul Sabiha Gökçen Airport',city:'Istanbul',country:'TR',lat:40.8986,lon:29.3092,tz:'Europe/Istanbul'},
IST:{iata:'IST',icao:'LTFM',name:'Istanbul Airport',city:'Istanbul',country:'TR',lat:41.2753,lon:28.7519,tz:'Europe/Istanbul'},
SHJ:{iata:'SHJ',icao:'OMSJ',name:'Sharjah International Airport',city:'Sharjah',country:'AE',lat:25.3286,lon:55.5172,tz:'Asia/Dubai'},
DXB:{iata:'DXB',icao:'OMDB',name:'Dubai International Airport',city:'Dubai',country:'AE',lat:25.2528,lon:55.3644,tz:'Asia/Dubai'},
LYS:{iata:'LYS',icao:'LFLL',name:'Lyon Saint-Exupéry Airport',city:'Lyon',country:'FR',lat:45.7256,lon:5.08111,tz:'Europe/Paris'}
};
let airportIndex={...AIRPORT_FALLBACK}, airportDbLoaded=false;
function openAirportDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pilotlog7-airports',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('cache'))db.createObjectStore('cache')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idbGet(key){const db=await openAirportDb();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly'),q=tx.objectStore('cache').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function idbSet(key,val){const db=await openAirportDb();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(val,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
function buildAirportIndex(raw){const idx={...AIRPORT_FALLBACK};Object.values(raw||{}).forEach(a=>{if(!a)return;const rec={iata:upper(a.iata),icao:upper(a.icao),name:a.name||'',city:a.city||'',country:a.country||'',lat:Number(a.lat),lon:Number(a.lon),tz:a.tz||'UTC'};if(rec.iata)idx[rec.iata]=rec;if(rec.icao)idx[rec.icao]=rec});return idx}
async function ensureAirportDb(force=false){if(airportDbLoaded&&!force)return airportIndex;const status=$('airportDbStatus');try{if(!force){const cached=await idbGet('iata-index-v1');if(cached&&Object.keys(cached).length>1000){airportIndex={...AIRPORT_FALLBACK,...cached};airportDbLoaded=true;if(status)status.textContent=`Airport database: ${Object.keys(cached).length} codes cached offline.`;return airportIndex}}if(status)status.textContent='Airport database: downloading and building offline cache…';const r=await fetch(AIRPORT_SOURCE,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const raw=await r.json();const idx=buildAirportIndex(raw);airportIndex=idx;airportDbLoaded=true;await idbSet('iata-index-v1',idx);if(status)status.textContent=`Airport database: ${Object.keys(idx).length} IATA/ICAO codes cached offline.`;return airportIndex}catch(e){airportDbLoaded=true;if(status)status.textContent='Airport database: using built-in fallback; full database will retry when online.';return airportIndex}}
async function airport(code){await ensureAirportDb(false);return airportIndex[upper(code)]||null}
async function updateAirportInfo(){for(const [field,info] of [['dep','depInfo'],['arr','arrInfo'],['simLocation','simLocationInfo']]){if(!$(field)||!$(info))continue;const code=upper($(field).value);$(field).value=code;if(!code){$(info).textContent='';continue}const a=await airport(code);$(info).textContent=a?`${a.iata||a.icao} • ${a.name} • ${a.city} • ${a.tz}`:'Airport not found in current cache.'}}

/* Solar calculations. Night = civil twilight or darker (sun altitude below -6°). */
const rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
function julianDate(d){return d.getTime()/86400000+2440587.5}
function sunAltitude(date,lat,lon){
  const jd=julianDate(date), n=jd-2451545.0;
  const L=(280.46+0.9856474*n)%360, g=rad((357.528+0.9856003*n)%360);
  const lambda=rad((L+1.915*Math.sin(g)+0.020*Math.sin(2*g))%360);
  const eps=rad(23.439-0.0000004*n);
  const ra=Math.atan2(Math.cos(eps)*Math.sin(lambda),Math.cos(lambda));
  const dec=Math.asin(Math.sin(eps)*Math.sin(lambda));
  const T=(jd-2451545)/36525, gmst=(280.46061837+360.98564736629*(jd-2451545)+0.000387933*T*T-T*T*T/38710000)%360;
  const lst=rad((gmst+lon+360)%360), H=lst-ra;
  return deg(Math.asin(Math.sin(rad(lat))*Math.sin(dec)+Math.cos(rad(lat))*Math.cos(dec)*Math.cos(H)));
}
function zuluDate(date,time){if(!date||!time)return null;return new Date(`${date}T${time}:00Z`)}
function endZuluDate(date,start,end){const s=zuluDate(date,start),e=zuluDate(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return e}
function gcPoint(a,b,f){const φ1=rad(a.lat),λ1=rad(a.lon),φ2=rad(b.lat),λ2=rad(b.lon);const δ=2*Math.asin(Math.sqrt(Math.sin((φ2-φ1)/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2));if(!δ)return{lat:a.lat,lon:a.lon};const A=Math.sin((1-f)*δ)/Math.sin(δ),B=Math.sin(f*δ)/Math.sin(δ);const x=A*Math.cos(φ1)*Math.cos(λ1)+B*Math.cos(φ2)*Math.cos(λ2),y=A*Math.cos(φ1)*Math.sin(λ1)+B*Math.cos(φ2)*Math.sin(λ2),z=A*Math.sin(φ1)+B*Math.sin(φ2);return{lat:deg(Math.atan2(z,Math.sqrt(x*x+y*y))),lon:deg(Math.atan2(y,x))}}
function dateAtOrAfter(baseDate,time,reference=null){
  let d=zuluDate(baseDate,time);if(!d)return null;
  if(reference&&d<reference)d.setUTCDate(d.getUTCDate()+1);
  return d;
}
function nightFixedMinutes(start,end,loc,step=2){
  if(!start||!end||!loc||end<=start)return 0;
  const total=Math.round((end-start)/60000);let night=0;
  for(let m=0;m<total;m+=step){const chunk=Math.min(step,total-m),t=new Date(start.getTime()+(m+chunk/2)*60000);if(sunAltitude(t,loc.lat,loc.lon)<-6)night+=chunk}
  return night;
}
function nightRouteMinutes(start,end,dep,arr,step=2){
  if(!start||!end||!dep||!arr||end<=start)return 0;
  const total=Math.round((end-start)/60000);let night=0;
  for(let m=0;m<total;m+=step){const chunk=Math.min(step,total-m),f=(m+chunk/2)/total,p=gcPoint(dep,arr,f),t=new Date(start.getTime()+(m+chunk/2)*60000);if(sunAltitude(t,p.lat,p.lon)<-6)night+=chunk}
  return night;
}
function applyPfCounts(depNight,arrNight){
  const pf=$('pf')?.value==='yes';
  $('dayTakeoffs').value=pf&&!depNight?1:0;$('nightTakeoffs').value=pf&&depNight?1:0;
  $('dayLandings').value=pf&&!arrNight?1:0;$('nightLandings').value=pf&&arrNight?1:0;
}
async function calcNightForForm(){
  const date=$('date').value,dep=await airport($('dep').value),arr=await airport($('arr').value);
  const out=$('out').value,off=$('off').value,on=$('on').value,inn=$('in').value;
  if(!date||!dep||!arr||(!(out&&inn)&&!(off&&on))){
    $('night').value='00:00';applyPfCounts(false,false);
    $('nightStatus').textContent='Night auto: enter valid From/To and OUT/IN (or at least OFF/ON).';return 0;
  }
  let night=0,depNight=false,arrNight=false;
  if(out&&inn){
    const outD=zuluDate(date,out),offD=off?dateAtOrAfter(date,off,outD):outD,onD=on?dateAtOrAfter(date,on,offD):null,inD=dateAtOrAfter(date,inn,onD||offD||outD);
    if(offD&&offD>outD)night+=nightFixedMinutes(outD,offD,dep);
    if(offD&&onD&&onD>offD)night+=nightRouteMinutes(offD,onD,dep,arr);else if(outD&&inD&&inD>outD)night+=nightRouteMinutes(outD,inD,dep,arr);
    if(onD&&inD&&inD>onD)night+=nightFixedMinutes(onD,inD,arr);
    const takeoffD=offD||outD,landingD=onD||inD;
    depNight=!!takeoffD&&sunAltitude(takeoffD,dep.lat,dep.lon)<-6;arrNight=!!landingD&&sunAltitude(landingD,arr.lat,arr.lon)<-6;
  }else{
    const s=zuluDate(date,off),e=endZuluDate(date,off,on);night=nightRouteMinutes(s,e,dep,arr);
    depNight=!!s&&sunAltitude(s,dep.lat,dep.lon)<-6;arrNight=!!e&&sunAltitude(e,arr.lat,arr.lon)<-6;
  }
  $('night').value=fmt(night);applyPfCounts(depNight,arrNight);
  $('nightStatus').textContent=`Night auto: ${fmt(night)} including taxi when it occurs at night • take-off ${depNight?'night':'day'} • landing ${arrNight?'night':'day'}${$('pf').value==='yes'?' • PF counts applied':' • PF No: no take-off/landing credited'}.`;
  return night;
}

/* Credit rules */
const PAY_DEFAULTS={joinDate:'2014-04-01',base:46500,allowance:8000,transport:2500,pos:4000,telephone:500,uniform:300,meal:520,deduction:-3000,seniority2:10,seniority12:15,t1Max:25,t1Rate:170,t2Max:50,t2Rate:370,t3Max:75,t3Rate:665,t4Rate:1400,trainingRate:500,layoverRate:25,simAllowance:1000,simCredit:5,groundCredit:5,dayOffRate:1000};
function paySettings(){return {...PAY_DEFAULTS,...loadObject(PAY_SETTINGS_KEY,{})}}
function creditMinsForEntry(f,allEntries=null){
  const rule=activityRule(f);
  if(rule.credit==='flight-schedule')return flightCreditMins({...f,dutyType:'Flight'},allEntries);
  if(rule.credit==='editable-sim')return f?.simCreditExplicit===true?Math.max(0,Math.round(Number(f?.credit)||0)):Math.round(Number(paySettings().simCredit||0)*60);
  if(rule.credit==='editable-ground'){
    if(f?.groundCreditExplicit===true)return Math.max(0,Math.round(Number(f?.credit)||0));
    const trainer=upper(f?.aerolineTrainerType||f?.trainerType||'');
    if(trainer==='TNE')return 0;
    if(trainer==='GI')return Math.round(Number(paySettings().groundCredit||0)*60);
    const stored=Number(f?.credit);
    if(Number.isFinite(stored)&&stored>0)return Math.max(0,Math.round(stored));
    return Math.round(Number(paySettings().groundCredit||0)*60);
  }
  if(rule.credit==='zero')return 0;
  return Math.max(0,Number(f?.credit)||0);
}
function calculateActivityMetrics(f,allEntries=null){
  const dutyType=canonicalDutyType(f?.dutyType||'Flight'),flight=dutyType==='Flight',sim=dutyType==='Simulator',positioning=dutyType==='DHD'||dutyType==='DHP';
  const schedBlock=(flight||positioning)?timeSpanMins(f?.schedOut||'',f?.schedIn||''):0;
  const block=flight?timeSpanMins(f?.out||'',f?.in||''):0;
  const flightMins=flight?timeSpanMins(f?.off||'',f?.on||''):0;
  const simulatorTime=sim?timeSpanMins(f?.out||'',f?.in||''):0;
  const credit=creditMinsForEntry({...f,dutyType,schedBlock,simulatorTime},allEntries);
  return{dutyType,schedBlock,block,flight:flightMins,simulatorTime,credit};
}
function formActivityInput(){
  const dutyType=canonicalDutyType($('dutyTypeFlight')?.value||'Flight');
  const existing=entryActivityRows().find(x=>x.id===$('editId')?.value);
  const editableCredit=dutyType==='Simulator'||dutyType==='DHP'||dutyType==='Ground Course';
  return{id:$('editId')?.value||'',dutyType,date:$('date')?.value||'',flightNo:composeFlightNo($('flightNo')?.value||''),dep:upper($('dep')?.value||''),arr:upper($('arr')?.value||''),schedOut:$('schedOut')?.value||'',schedIn:$('schedIn')?.value||'',onDuty:$('onDuty')?.value||'',offDuty:$('offDuty')?.value||'',out:$('out')?.value||'',off:$('off')?.value||'',on:$('on')?.value||'',in:$('in')?.value||'',credit:editableCredit?durMins($('creditDisplay')?.value||'0:00'):Number(existing?.credit)||0,simCreditExplicit:dutyType==='Simulator',groundCreditExplicit:dutyType==='Ground Course',aerolineTrainerType:existing?.aerolineTrainerType||''};
}
function formCredit(dutyType){return PilotLogEngine.activity({...formActivityInput(),dutyType:canonicalDutyType(dutyType)}).credit}


function incrementFlightNumber(v){
  const raw=upper(v||'').trim();
  if(!raw)return'';
  const m=raw.match(/^(.*?)(\d+)$/);
  if(!m)return raw;
  return `${m[1]}${String(Number(m[2])+1).padStart(m[2].length,'0')}`;
}
function plusOneIsoDate(date){
  const d=dateOnly(date);
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}
function returnFlightDateFromLeg(f){
  const date=f.date||today();
  const dep=f.schedOut||f.out||f.off||'';
  const arr=f.schedIn||f.in||f.on||'';
  if(dep&&arr&&mins(arr)<mins(dep))return plusOneIsoDate(date);
  return date;
}
function formLegSnapshot(){
  return {
    dutyType:$('dutyTypeFlight')?.value||'Flight',
    date:$('date')?.value||today(),
    flightNo:composeFlightNo($('flightNo')?.value||''),
    type:upper($('type')?.value||''),
    reg:composeAircraftId($('reg')?.value||''),
    location:upper($('simLocation')?.value||''),
    dep:upper($('dep')?.value||''),
    arr:upper($('arr')?.value||''),
    schedOut:$('schedOut')?.value||'',
    schedIn:$('schedIn')?.value||'',
    out:$('out')?.value||'',
    off:$('off')?.value||'',
    on:$('on')?.value||'',
    in:$('in')?.value||'',
    role:$('role')?.value||'PIC',
    picName:upper($('picName')?.value||''),
    sicName:upper($('sicName')?.value||''),
    soName:upper($('soName')?.value||''),
    instructorName:upper($('instructorName')?.value||''),
    instructionType:$('instructionType')?.value||'',
    seatPosition:$('seatPosition')?.value||'',
    ifr:$('ifr')?.value||'yes',
    delayReason:upper($('delayReason')?.value||'')
  };
}
function latestFlightForReturn(){
  return coreActivityRows().filter(f=>isFlight(f)&&f.activityStatus===ACTIVITY_STATUS.COMPLETED).sort((a,b)=>
    `${b.date||''}${b.schedOut||b.out||b.off||''}`.localeCompare(`${a.date||''}${a.schedOut||a.out||a.off||''}`)
  )[0]||null;
}
function createReturnFlight(){
  let src=formLegSnapshot();
  if(!src.dep||!src.arr){
    const latest=latestFlightForReturn();
    if(!latest)return alert('Enter or save the outbound flight first.');
    src=latest;
  }
  if(String(src.dutyType||'Flight')!=='Flight')return alert('Return Flight is available for Flight entries only.');

  saveEntryDraft();
  resetEntry(false);
  $('entryDraftId').value=makeId();
  $('dutyTypeFlight').value='Flight';
  $('date').value=returnFlightDateFromLeg(src);

  const prefix=(appSettings().flightPrefix||'MAC').toUpperCase();
  let no=String(src.flightNo||'');
  if(no.toUpperCase().startsWith(prefix))no=no.slice(prefix.length);
  $('flightNo').value=incrementFlightNumber(no);

  $('type').value=upper(src.type||'A320');

  const regPrefix=(appSettings().aircraftPrefix||'CN-NM').toUpperCase();
  let reg=String(src.reg||'');
  if(reg.toUpperCase().startsWith(regPrefix))reg=reg.slice(regPrefix.length);
  $('reg').value=upper(reg);

  $('dep').value=upper(src.arr||'');
  $('arr').value=upper(src.dep||'');

  $('role').value=src.role||'PIC';
  $('picName').value=upper(src.picName||'');
  $('sicName').value=upper(src.sicName||'');
  $('soName').value=upper(src.soName||'');
  $('instructorName').value=upper(src.instructorName||'');
  $('instructionType').value=src.instructionType||'';
  $('seatPosition').value=src.seatPosition||'';
  $('ifr').value=src.ifr||'yes';

  setEntryTypeUI();
  updateExaminerRemarkReminder();
  calcEntry();
  updateAirportInfo();
  syncProfileNameWithRole();
  saveEntryDraft();
  renderEntryDraftShelf();
  $('schedOut')?.focus();
}

function updateExaminerRemarkReminder(){
  const box=$('examinerRemarkReminder');if(!box)return;
  const active=$('dutyTypeFlight')?.value==='Flight' && $('role')?.value==='Examiner';
  box.classList.toggle('hidden',!active);
}

function setEntryTypeUI(){
  const dt=canonicalDutyType($('dutyTypeFlight').value||'Flight'),rule=activityRule(dt),sim=dt==='Simulator',flight=dt==='Flight',positioning=dt==='DHD'||dt==='DHP',ground=dt==='Ground Course',standby=dt==='STBY';
  $('dutyTypeFlight').value=dt;
  document.querySelectorAll('[data-entry-field]').forEach(el=>{el.classList.remove('hidden');el.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false)});
  $('courseType')?.closest('[data-entry-field]')?.classList.add('hidden');
  $('simLocation')?.closest('[data-entry-field]')?.classList.add('hidden');
  $('simulatorTimeDisplay')?.closest('[data-entry-field]')?.classList.add('hidden');
  $('delayReason')?.closest('[data-entry-field]')?.classList.add('hidden');
  if($('regLabel'))$('regLabel').textContent='Aircraft ID';
  if($('aircraftPrefixLabel'))$('aircraftPrefixLabel').style.display='';
  if($('reg'))$('reg').placeholder='Q';
  if($('onDutyLabel'))$('onDutyLabel').textContent='On Duty (Z)';
  if($('offDutyLabel'))$('offDutyLabel').textContent='Off Duty (Z) — last entry only';
  if($('schedOutLabel'))$('schedOutLabel').textContent='Schedule OUT (Z)';
  if($('schedInLabel'))$('schedInLabel').textContent='Schedule IN (Z)';
  $('schedOut').readOnly=false;$('schedIn').readOnly=false;
  ['breakdownTitle','breakdownGrid','remarksWrap','calcPreview','nightStatus'].forEach(id=>$(id)?.classList.remove('hidden'));

  const flightCrewNameFields=['picName','sicName','soName','instructorName'];
  flightCrewNameFields.forEach(id=>$(id)?.closest('[data-entry-field]')?.classList.toggle('hidden',!['Flight','Simulator'].includes(dt)));
  ['pf','approachType'].forEach(id=>$(id)?.closest('[data-entry-field]')?.classList.toggle('hidden',dt!=='Flight'));

  if(positioning){
    const keep=new Set(['dep','arr','schedOut','schedIn','credit','callFromDayOff']);
    document.querySelectorAll('[data-entry-field]').forEach(el=>{if(!keep.has(el.dataset.entryField))el.classList.add('hidden')});
    ['breakdownTitle','breakdownGrid','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    if($('schedOutLabel'))$('schedOutLabel').textContent='Start time (Z)';
    if($('schedInLabel'))$('schedInLabel').textContent='End time (Z)';
    ['out','off','on','in','onDuty','offDuty'].forEach(id=>$(id).value='');
    $('creditDisplay').readOnly=rule.credit!=='editable';
    if(rule.credit==='zero')$('creditDisplay').value='0:00';
    $('calcPreview').classList.remove('hidden');
    renderEntryDraftShelf();return;
  }

  if(ground){
    const keep=new Set(['dep','courseType','onDuty','credit','callFromDayOff']);
    document.querySelectorAll('[data-entry-field]').forEach(el=>{if(!keep.has(el.dataset.entryField))el.classList.add('hidden')});
    $('courseType')?.closest('[data-entry-field]')?.classList.remove('hidden');
    ['breakdownTitle','breakdownGrid','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    $('depInfo').textContent=$('depInfo').textContent||'Enter the course location IATA code.';
    if($('onDutyLabel'))$('onDutyLabel').textContent='Start time (Z)';
    $('arr').value='';['schedOut','schedIn','out','off','on','in','offDuty'].forEach(id=>$(id).value='');
    $('creditDisplay').readOnly=false;if(!$('creditDisplay').value)$('creditDisplay').value=fmt(PilotLogEngine.credit({dutyType:'Ground Course',credit:0,groundCreditExplicit:false,source:'manual'}));
    $('calcPreview').classList.remove('hidden');renderEntryDraftShelf();return;
  }

  if(sim){
    const hide=['flightNo','dep','arr','schedOut','schedIn','schedBlock','off','on','block','role','seatPosition','night','ifr','pf','approachType','delayReason'];
    hide.forEach(id=>$(id)?.closest('[data-entry-field]')?.classList.add('hidden'));
    $('simLocation')?.closest('[data-entry-field]')?.classList.remove('hidden');
    $('simulatorTimeDisplay')?.closest('[data-entry-field]')?.classList.remove('hidden');
    if($('regLabel'))$('regLabel').textContent='Sim registration';
    if($('aircraftPrefixLabel'))$('aircraftPrefixLabel').style.display='none';
    $('reg').placeholder='SIM-01';
    $('night').value='00:00';$('ifr').value='no';$('seatPosition').value='';
    ['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);
    ['breakdownTitle','breakdownGrid','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    $('creditDisplay').readOnly=false;if(!$('editId').value)$('creditDisplay').value=fmt(Math.round(Number(paySettings().simCredit||0)*60));
    renderEntryDraftShelf();return;
  }

  if(standby){
    const keep=new Set(['dep','onDuty','offDuty','credit','callFromDayOff']);
    document.querySelectorAll('[data-entry-field]').forEach(el=>{if(!keep.has(el.dataset.entryField))el.classList.add('hidden')});
    ['breakdownTitle','breakdownGrid','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    if($('onDutyLabel'))$('onDutyLabel').textContent='Standby start (Z)';
    if($('offDutyLabel'))$('offDutyLabel').textContent='Standby end (Z)';
    ['schedOut','schedIn','out','off','on','in'].forEach(id=>$(id).value='');
    $('creditDisplay').readOnly=true;$('creditDisplay').value=fmt(formCredit(dt));
    $('calcPreview').classList.remove('hidden');renderEntryDraftShelf();return;
  }

  $('creditDisplay').readOnly=rule.credit!=='editable';
  if(rule.credit!=='editable')$('creditDisplay').value=fmt(formCredit(dt));
  if(!flight){$('dayTakeoffs').value=0;$('nightTakeoffs').value=0;$('dayLandings').value=0;$('nightLandings').value=0;$('night').value='00:00'}
  updateDelayUI();updateExaminerRemarkReminder();renderEntryDraftShelf();
}
function calcEntry(){
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');
  const c=PilotLogEngine.activity({...formActivityInput(),dutyType});
  $('schedBlockDisplay').value=fmt(c.schedBlock);$('blockDisplay').value=fmt(c.block);$('creditDisplay').value=(dutyType==='Simulator'||dutyType==='DHP'||dutyType==='Ground Course')?$('creditDisplay').value:fmt(c.credit);
  const role=$('role').value,inst=$('instructionType').value;
  $('totalTimeDisplay').value=fmt(dutyType==='Flight'?c.block:0);if($('simulatorTimeDisplay'))$('simulatorTimeDisplay').value=fmt(c.simulatorTime);
  $('picDisplay').value=fmt(dutyType==='Flight'&&role==='PIC'?c.block:0);$('sicDisplay').value=fmt(dutyType==='Flight'&&role==='SIC'?c.block:0);
  $('flightInstructionDisplay').value=fmt(dutyType==='Flight'&&inst==='Flight Instruction'?c.block:0);$('simInstructionDisplay').value=fmt(dutyType==='Simulator'&&inst==='SFI/SFE Instruction Sim'?c.simulatorTime:0);
  if(dutyType==='DHD'||dutyType==='DHP')$('calcPreview').textContent=`${dutyType} • ${$('dep').value||'—'} → ${$('arr').value||'—'} • ${$('schedOut').value||'--:--'}–${$('schedIn').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Ground Course')$('calcPreview').textContent=`Ground Course • ${$('dep').value||'—'} • ${$('courseType').value||'Course'}${$('onDuty').value?' • Start '+$('onDuty').value+' Z':''} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='STBY')$('calcPreview').textContent=`STBY • ${$('dep').value||'—'} • ${$('onDuty').value||'--:--'}–${$('offDuty').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Simulator')$('calcPreview').textContent=`Simulator ${fmt(c.simulatorTime)} • Credit ${fmt(c.credit)} • OUT ${$('out').value||'--:--'} / IN ${$('in').value||'--:--'}`;
  else{const premium=dutyGetsMoroccoNightPremium({...formActivityInput(),dutyType:'Flight'})?' • Morocco Night +50%':'';$('calcPreview').textContent=`Schedule Block ${fmt(c.schedBlock)} • Actual Block ${fmt(c.block)} • Flight ${fmt(c.flight)} • Credit ${fmt(c.credit)}${premium}`}
  updateDelayUI();return c;
}

/* Duty + EASA FTL — one deterministic operational-duty engine. */
function dtFromZulu(date,time){return zuluDate(date,time)}
function dutyDateEnd(date,start,end){const s=dtFromZulu(date,start),e=dtFromZulu(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return[s,e]}
function entryChrono(f){const t=f.schedOut||f.out||f.onDuty||'00:00';return `${f.date}T${t}`}
function dayEntries(date,fs=entryActivityRows()){return fs.filter(f=>f.date===date).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)))}
function externalDutyForDate(date){return dutyActivityRows().filter(d=>d.date===date).sort((a,b)=>(a.report||'').localeCompare(b.report||''))[0]||null}

const MAX_REASONABLE_DUTY_MIN=18*60;
function hhmm(d){return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`}
function flightDutyWindow(f){
  if(!f||!f.date||isPositioning(f))return null;
  if(isFlight(f)){
    const activityStartTime=f.out||f.schedOut||f.off;
    const activityEndTime=f.in||f.schedIn||f.on;
    const reportBase=f.schedOut||f.out||f.off;
    if(!activityStartTime||!activityEndTime||!reportBase)return null;
    const activityStart=zuluDate(f.date,activityStartTime);
    const activityEnd=dateAtOrAfter(f.date,activityEndTime,activityStart);
    const reportBaseDate=zuluDate(f.date,reportBase);
    if(!activityStart||!activityEnd||!reportBaseDate)return null;
    const report=new Date(reportBaseDate.getTime()-60*60000);
    let release;
    if(f.in){const d=dateAtOrAfter(f.date,f.in,activityStart);release=d?new Date(d.getTime()+30*60000):null}
    if(!release&&f.schedIn){const d=dateAtOrAfter(f.date,f.schedIn,activityStart);release=d?new Date(d.getTime()+30*60000):null}
    if(!release&&f.on){const d=dateAtOrAfter(f.date,f.on,activityStart);release=d?new Date(d.getTime()+30*60000):null}
    if(!release)return null;
    const own=Math.round((release-report)/60000);
    if(own<=0||own>MAX_REASONABLE_DUTY_MIN){console.warn('Ignoring unreasonable flight duty window',f.id,f.date,own);return null}
    return{entry:f,activityStart,activityEnd,report,release};
  }

  const startTime=f.onDuty||f.schedOut||f.out;
  if(!startTime)return null;
  const report=zuluDate(f.date,startTime);
  if(!report)return null;
  let release=null;
  const endTime=f.offDuty||f.schedIn||f.in;
  if(endTime)release=dateAtOrAfter(f.date,endTime,report);
  if(!release&&isGround(f))release=new Date(report.getTime()+5*3600000);
  if(!release)return null;
  const own=Math.round((release-report)/60000);
  if(own<=0||own>MAX_REASONABLE_DUTY_MIN){console.warn('Ignoring unreasonable non-flight duty window',f.id,f.date,own);return null}
  return{entry:f,activityStart:report,activityEnd:release,report,release};
}
function buildDutySessions(fs=entryActivityRows()){
  const windows=(fs||[]).map(flightDutyWindow).filter(Boolean).sort((a,b)=>a.activityStart-b.activityStart);
  const groups=[];let cur=null;
  const push=()=>{if(cur)groups.push(cur);cur=null};
  for(const w of windows){
    if(!cur){cur={windows:[w],report:w.report,release:w.release,activityEnd:w.activityEnd};continue}
    const gap=Math.round((w.activityStart-cur.activityEnd)/60000);
    const proposedRelease=new Date(Math.max(cur.release.getTime(),w.release.getTime()));
    const proposedMinutes=Math.round((proposedRelease-cur.report)/60000);
    const sameDuty=gap>=-120&&gap<=300&&proposedMinutes>0&&proposedMinutes<=MAX_REASONABLE_DUTY_MIN;
    if(sameDuty){cur.windows.push(w);cur.release=proposedRelease;if(w.activityEnd>cur.activityEnd)cur.activityEnd=w.activityEnd}
    else{push();cur={windows:[w],report:w.report,release:w.release,activityEnd:w.activityEnd}}
  }
  push();
  return groups.map((g,i)=>{
    const entries=g.windows.map(x=>x.entry),flights=entries.filter(isFlight),minutes=Math.round((g.release-g.report)/60000);
    return{id:`duty-${g.report.toISOString()}-${i}`,reportDate:g.report.toISOString().slice(0,10),report:hhmm(g.report),endDate:g.release.toISOString().slice(0,10),end:hhmm(g.release),startDateTime:g.report,endDateTime:g.release,minutes,sectors:flights.length,entries,firstFlight:flights[0]||null,dep:flights[0]?.dep||entries[0]?.dep||'',arr:flights.at(-1)?.arr||entries.at(-1)?.arr||''};
  });
}
function reconcileAllDuties(){
  const fs=entryActivityRows(),before=new Map(fs.map(f=>[f.id,`${f.onDuty||''}|${f.offDuty||''}|${Number(f.totalDuty)||0}|${Number(f.sectors)||0}`]));
  fs.forEach(f=>{f.totalDuty=0;f.sectors=0;if(isPositioning(f)){f.onDuty='';f.offDuty=''}else if(isFlight(f)){f.onDuty='';f.offDuty=''}});
  const sessions=buildDutySessions(fs);
  sessions.forEach(s=>{
    const relevant=s.entries.filter(f=>!isPositioning(f)),flights=relevant.filter(isFlight),first=flights[0]||relevant[0],last=flights.at(-1)||relevant.at(-1);
    relevant.forEach(f=>{f.sectors=flights.length;f.totalDuty=0});
    if(first)first.onDuty=s.report;
    if(last){last.offDuty=s.end;last.totalDuty=s.minutes}
  });
  let changed=false;const now=new Date().toISOString();
  fs.forEach(f=>{const after=`${f.onDuty||''}|${f.offDuty||''}|${Number(f.totalDuty)||0}|${Number(f.sectors)||0}`;if(before.get(f.id)!==after){f._updatedAt=now;changed=true}});
  if(changed)replaceActivitySelection(isEntryActivityRecord,fs);
  return sessions;
}

/* EASA FTL — basic maximum daily FDP, acclimatised, no extension. ORO.FTL.205 Table 2. */
const FDP_TABLE=[
{a:360,b:809,v:[780,750,720,690,660,630,600,570,540]},
{a:810,b:839,v:[765,735,705,675,645,615,585,555,540]},
{a:840,b:869,v:[750,720,690,660,630,600,570,540,540]},
{a:870,b:899,v:[735,705,675,645,615,585,555,540,540]},
{a:900,b:929,v:[720,690,660,630,600,570,540,540,540]},
{a:930,b:959,v:[705,675,645,615,585,555,540,540,540]},
{a:960,b:989,v:[690,660,630,600,570,540,540,540,540]},
{a:990,b:1019,v:[675,645,615,585,555,540,540,540,540]},
{a:1020,b:1439,v:[660,630,600,570,540,540,540,540,540]},
{a:0,b:299,v:[660,630,600,570,540,540,540,540,540]},
{a:300,b:314,v:[720,690,660,630,600,570,540,540,540]},
{a:315,b:329,v:[735,705,675,645,615,585,555,540,540]},
{a:330,b:344,v:[750,720,690,660,630,600,570,540,540]},
{a:345,b:359,v:[765,735,705,675,645,615,585,555,540]}
];
function fdpLimit(localStartMins,sectors){const row=FDP_TABLE.find(r=>localStartMins>=r.a&&localStartMins<=r.b);if(!row)return 0;const idx=Math.max(0,Math.min(8,(sectors<=2?0:sectors-2)));return row.v[idx]}
function tzParts(date,tz){try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const h=Number(p.find(x=>x.type==='hour')?.value||0),m=Number(p.find(x=>x.type==='minute')?.value||0);return h*60+m}catch{return date.getUTCHours()*60+date.getUTCMinutes()}}
function startOfDays(n,now=new Date()){const d=new Date(now);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-n+1);return d}
function rollingFlight(n,now=new Date()){
  const c=startOfDays(n,now);
  return sum(entryActivityRows().filter(isFlight),f=>{const d=dateOnly(f.date);return d>=c&&d<=now?(Number(f.block)||0):0});
}
function rollingDuty(n,now=new Date(),sessions=buildDutySessions()){
  const start=startOfDays(n,now);
  return sessions.reduce((total,s)=>{
    const a=new Date(Math.max(s.startDateTime.getTime(),start.getTime())),b=new Date(Math.min(s.endDateTime.getTime(),now.getTime()));
    return total+(b>a?Math.round((b-a)/60000):0);
  },0);
}
function calendarYearFlight(now=new Date()){const y=now.getUTCFullYear();return sum(entryActivityRows().filter(isFlight),f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d<=now?Number(f.block)||0:0})}
function rollingCalendar12Flight(now=new Date()){const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1));return sum(entryActivityRows().filter(isFlight),f=>{const d=dateOnly(f.date);return d>=start&&d<=now?Number(f.block)||0:0})}
function ftlLimitState(value,limit){
  const remaining=Number(limit||0)-Number(value||0);
  if(remaining<0)return{remaining,state:'red',textClass:'danger-text'};
  if(remaining<=300)return{remaining,state:'yellow',textClass:'warning'};
  return{remaining,state:'green',textClass:'success'};
}
function limitRow(name,value,limit){
  const s=ftlLimitState(value,limit);
  return `<div class="stat-row ftl-limit-row ftl-${s.state}"><span>${esc(name)}</span><b class="${s.textClass}">${fmt(value)} / ${fmt(limit)}</b></div>`;
}
async function sessionFdp(s){
  if(!s)return null;const dep=s.firstFlight?.dep||s.dep||'',a=dep?await airport(dep):null,localM=tzParts(s.startDateTime,a?.tz||'UTC'),sectors=Math.max(1,Number(s.sectors)||1),limit=fdpLimit(localM,sectors),margin=limit-s.minutes;
  return{date:s.reportDate,minutes:s.minutes,sectors,limit,margin,status:margin<0?'VIOLATION':margin<=300?'CAUTION':'OK',startDateTime:s.startDateTime};
}
async function rosterFdp(g){
  if(!g?.date||!g.start)return null;const start=zuluDate(g.date,g.start);if(!start)return null;const a=g.dep?await airport(g.dep):null,localM=tzParts(start,a?.tz||'UTC'),sectors=Math.max(1,Number(g.sectors)||1),minutes=g.end?timeSpanMins(g.start,g.end):0,limit=fdpLimit(localM,sectors),margin=limit-minutes;
  return{date:g.date,minutes,sectors,limit,margin,status:margin<0?'VIOLATION':margin<=300?'CAUTION':'OK',startDateTime:start};
}
async function nextFdpCandidate(sessions,now=new Date()){
  const futureSession=sessions.filter(s=>s.sectors>0&&s.startDateTime>now).sort((a,b)=>a.startDateTime-b.startDateTime)[0]||null;
  let futureRoster=null;
  const group=rosterGroups().filter(g=>g.kind==='flight').map(g=>({...g,_start:zuluDate(g.date,g.start)})).filter(g=>g._start&&g._start>now).sort((a,b)=>a._start-b._start)[0]||null;
  if(group)futureRoster=await rosterFdp(group);
  const entryCandidate=futureSession?await sessionFdp(futureSession):null;
  if(entryCandidate&&futureRoster)return entryCandidate.startDateTime<=futureRoster.startDateTime?entryCandidate:futureRoster;
  return entryCandidate||futureRoster;
}
async function renderFtl(containerId,compact=false){
  const now=new Date(),sessions=buildDutySessions(),d7=rollingDuty(7,now,sessions),d14=rollingDuty(14,now,sessions),d28=rollingDuty(28,now,sessions),f28=rollingFlight(28,now),fy=calendarYearFlight(now),f12=rollingCalendar12Flight(now);
  const currentSession=sessions.find(s=>s.sectors>0&&s.startDateTime<=now&&s.endDateTime>=now)||null;
  let current=currentSession?await sessionFdp(currentSession):null,dailyLabel=current?'Current FDP':'Next planned FDP';
  if(!current)current=await nextFdpCandidate(sessions,now);
  if(!current){const last=sessions.filter(s=>s.sectors>0&&s.endDateTime<now).sort((a,b)=>b.endDateTime-a.endDateTime)[0]||null;current=last?await sessionFdp(last):null;dailyLabel='Last recorded FDP'}
  const maxDaily=current?(()=>{const s=ftlLimitState(current.minutes,current.limit);return `<div class="stat-row ftl-limit-row ftl-${s.state}"><span>${esc(dailyLabel)} — ${esc(displayDate(current.date))} • ${current.sectors} sector${current.sectors===1?'':'s'}</span><b class="${s.textClass}">${fmt(current.minutes)} / ${fmt(current.limit)}</b></div>`})():'';
  const rows=maxDaily+limitRow('Duty — 7 consecutive days',d7,3600)+limitRow('Duty — 14 consecutive days',d14,6600)+limitRow('Duty — 28 consecutive days',d28,11400)+limitRow('Flight time — 28 consecutive days',f28,6000)+limitRow('Flight time — calendar year',fy,54000)+limitRow('Flight time — 12 calendar months',f12,60000);
  let dailyHtml='';
  if(!compact){const recent=sessions.filter(s=>s.sectors>0&&s.startDateTime<=now).sort((a,b)=>b.startDateTime-a.startDateTime).slice(0,10),detailed=[];for(const s of recent){const x=await sessionFdp(s);if(x&&x.limit)detailed.push(x)}dailyHtml=detailed.map(x=>{const s=ftlLimitState(x.minutes,x.limit);return `<div class="stat-row ftl-limit-row ftl-${s.state}"><span>${esc(displayDate(x.date))} • ${x.sectors} sector${x.sectors===1?'':'s'}</span><b class="${s.textClass}">${fmt(x.minutes)} / ${fmt(x.limit)} • ${x.status}</b></div>`}).join('')}
  $(containerId).innerHTML=rows+dailyHtml;
  return d7<=3600&&d14<=6600&&d28<=11400&&f28<=6000&&fy<=54000&&f12<=60000;
}

/* Roster local display and grouping */
function parseUtcForRoster(date,time){return zuluDate(date,time)}
async function localTime(date,time,code){if(!time)return'';const a=await airport(code),d=parseUtcForRoster(date,time);if(!d)return time;try{return new Intl.DateTimeFormat('en-GB',{timeZone:a?.tz||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}catch{return time}}
function rosterFlightDigits(v){
  const s=cleanPrefix(v);
  let m=s.match(/^3O(\d+)$/i);if(m)return m[1];
  const prefix=cleanPrefix(appSettings().flightPrefix||'MAC');
  if(prefix&&s.startsWith(prefix)&&/^\d+$/.test(s.slice(prefix.length)))return s.slice(prefix.length);
  m=s.match(/(\d+)$/);return m?m[1]:s;
}
function rosterFlightLabel(v){
  const d=rosterFlightDigits(v);
  return /^\d+$/.test(d)?`3O${d}`:upper(v);
}
function rosterSectorKey(r){
  // Same physical sector can arrive twice (e.g. 3O485 and MAC485).
  return [r.date,rosterFlightDigits(r.flightNo),upper(r.dep),upper(r.arr),r.std||'',r.sta||''].join('|');
}
function dedupeRosterItems(items){
  const map=new Map();
  items.forEach(r=>{
    const k=rosterSectorKey(r),cur=map.get(k);
    if(!cur){map.set(k,r);return}
    // Prefer the 3O-labelled source for the roster display when both exist.
    if(/^3O/i.test(cleanPrefix(r.flightNo))&&!/^3O/i.test(cleanPrefix(cur.flightNo)))map.set(k,r);
  });
  return [...map.values()];
}

function rosterValueCompatible(a,b){return !a||!b||upper(a)===upper(b)}
function rosterTimeCompatible(a,b){return !a||!b||String(a)===String(b)}
function rosterSectorSameIdentity(a,b){
  if(!a||!b||a===b||a.date!==b.date)return false;
  const fa=rosterFlightDigits(a.flightNo||''),fb=rosterFlightDigits(b.flightNo||'');
  if(fa&&fb&&fa!==fb)return false;
  if(!rosterValueCompatible(a.dep,b.dep)||!rosterValueCompatible(a.arr,b.arr))return false;
  if(!rosterTimeCompatible(a.std,b.std)||!rosterTimeCompatible(a.sta,b.sta))return false;
  if(fa&&fb)return true;
  const sameRoute=upper(a.dep||'')===upper(b.dep||'')&&upper(a.arr||'')===upper(b.arr||'')&&!!(a.dep||a.arr);
  const sharedTime=(a.std&&a.std===b.std)||(a.sta&&a.sta===b.sta);
  return sameRoute&&(sharedTime||(!a.std&&!a.sta)||(!b.std&&!b.sta));
}
function rosterSectorScore(r){
  return ['flightNo','dep','arr','std','sta','type','reg','remarks'].reduce((n,k)=>n+(r?.[k]?1:0),0)+(r?.status==='done'?2:0);
}
function mergeRosterSector(a,b){
  const primary=rosterSectorScore(a)>=rosterSectorScore(b)?a:b,secondary=primary===a?b:a;
  const merged={...primary};
  ['flightNo','dep','arr','std','sta','type','reg','remarks','source'].forEach(k=>{if(!merged[k]&&secondary[k])merged[k]=secondary[k]});
  if(a.status==='done'||b.status==='done')merged.status='done';
  merged._syncRev=Math.max(recordRevision(a),recordRevision(b));
  merged._updatedAt=[a._updatedAt,b._updatedAt].filter(Boolean).sort().pop()||new Date().toISOString();
  return merged;
}
function rosterActivityStart(f){return f?.onDuty||f?.schedOut||f?.out||''}
function rosterActivityEnd(f){return f?.offDuty||f?.schedIn||f?.in||f?.on||''}
function rosterActivityType(f){return upper(f?.dutyType||'')}
function rosterActivityScore(f){
  return ['flightNo','dep','arr','onDuty','offDuty','schedOut','schedIn','out','in','type','courseType','remarks'].reduce((n,k)=>n+(f?.[k]?1:0),0)+(f?.locked?2:0);
}
function rosterActivitySameIdentity(a,b){
  if(!a||!b||a===b||a.date!==b.date)return false;
  if(rosterActivityType(a)!==rosterActivityType(b))return false;
  if(!(isPositioning(a)||isSim(a)||isStby(a)||isGround(a)))return false;
  const sa=rosterActivityStart(a),sb=rosterActivityStart(b),ea=rosterActivityEnd(a),eb=rosterActivityEnd(b);
  const oneUntimed=(!sa&&!ea)||(!sb&&!eb);
  const sharedTime=(sa&&sb&&sa===sb)||(ea&&eb&&ea===eb);
  if(!oneUntimed&&!sharedTime)return false;
  if(isPositioning(a)){
    if(!rosterValueCompatible(a.dep,b.dep)||!rosterValueCompatible(a.arr,b.arr))return false;
    const fa=rosterFlightDigits(a.flightNo||''),fb=rosterFlightDigits(b.flightNo||'');
    if(fa&&fb&&fa!==fb)return false;
    return true;
  }
  if(isSim(a))return rosterValueCompatible(a.type,b.type)&&rosterValueCompatible(a.dep,b.dep);
  if(isGround(a))return rosterValueCompatible(a.dep,b.dep)&&rosterValueCompatible(a.courseType||a.remarks,b.courseType||b.remarks);
  if(isStby(a))return rosterValueCompatible(a.dep,b.dep);
  return false;
}
function mergeRosterActivity(a,b){
  const primary=rosterActivityScore(a)>=rosterActivityScore(b)?a:b,secondary=primary===a?b:a;
  const merged={...primary};
  Object.keys(secondary).forEach(k=>{if((merged[k]===undefined||merged[k]===null||merged[k]==='')&&secondary[k]!==undefined&&secondary[k]!==null&&secondary[k]!=='')merged[k]=secondary[k]});
  merged.locked=!!(a.locked||b.locked);
  merged._syncRev=Math.max(recordRevision(a),recordRevision(b));
  merged._updatedAt=[a._updatedAt,b._updatedAt].filter(Boolean).sort().pop()||new Date().toISOString();
  return merged;
}
function cleanupRosterDuplicates(){
  const original=coreActivityRows(),normalized=normalizeCoreActivityRecords(original),activities=[],buckets=new Map();
  let removed=original.length-normalized.length;
  for(const row of normalized){
    const eligible=isPositioning(row)||isSim(row)||isStby(row)||isGround(row),key=eligible?`${row.date||''}|${rosterActivityType(row)}`:'';
    const candidates=key?(buckets.get(key)||[]):[];
    const index=candidates.find(i=>rosterActivitySameIdentity(activities[i],row));
    if(index===undefined){const next=activities.length;activities.push(row);if(key){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(next)};continue}
    const previous=activities[index],merged=mergeCoreActivities(previous,row),keepId=merged.id||previous.id||row.id||makeActivityId();
    const removedId=keepId===previous.id?row.id:previous.id;
    if(removedId)markCloudDeleted('activities',removedId,{includeSource:false});
    merged.id=keepId;activities[index]=merged;removed++;
  }
  if(removed){
    snapshotFlights('before-roster-dedupe');
    commitCoreActivities(activities);
    reconcileAllDuties();
  }
  if(removed)scheduleAutoSync('roster-dedupe',900);
  return removed;
}

function rosterGroups(){
  const home=upper(appSettings().homeBase||'CMN');
  const rs=rosterFlightRows().sort((a,b)=>`${a.date}${a.std||''}`.localeCompare(`${b.date}${b.std||''}`));
  const ds=dutyActivityRows(),by={},groups=[];

  // AeroLINE crewScheduleBlockId is the strongest duty-group signal. Fall back to date when absent.
  rs.forEach(r=>{const key=r.aerolineBlockId?`${r.date}|${r.aerolineBlockId}`:r.date;(by[key]||(by[key]=[])).push(r)});
  Object.entries(by).forEach(([,rawItems])=>{
    const date=rawItems[0]?.date||'';
    const items=dedupeRosterItems(rawItems);
    items.sort((a,b)=>(a.std||'').localeCompare(b.std||''));
    if(!items.length)return;

    const duty=ds.find(d=>d.date===date&&/flight duty/i.test(d.type||''));
    const first=items[0],last=items[items.length-1];
    const outboundDest=(items.find(x=>upper(x.dep)===home&&upper(x.arr)!==home)?.arr)||first.arr||last.arr||'';
    const start=duty?.report||shiftTime(first.std,-60);
    const end=duty?.end||shiftTime(last.sta,30);

    groups.push({
      kind:'flight',date,items,start,end,
      dep:first.dep||home,arr:outboundDest,
      sectors:items.filter(x=>x.flightNo).length,
      status:items.every(x=>x.status==='done')?'done':'planned',
      sortTime:start||first.std||'99:99'
    });
  });

  // SIM, STBY, DHD, DHP and Ground Course are stored as Entries, not roster sectors.
  const activities=entryActivityRows().filter(f=>
    f?.date&&!f.rosterHidden&&(isSim(f)||isStby(f)||isDhd(f)||isDhp(f)||isGround(f))
  );

  activities.forEach(f=>{
    const start=f.onDuty||f.schedOut||f.out||'';
    const end=f.offDuty||f.schedIn||f.in||f.on||'';
    const dep=isPositioning(f)?upper(f.dep||''):(isSim(f)?upper(f.location||f.dep||home):upper(f.dep||home)),arr=isPositioning(f)?upper(f.arr||''):(isSim(f)?dep:upper(f.arr||f.dep||home));

    groups.push({
      kind:'activity',
      activityType:canonicalDutyType(f.dutyType||'Duty','Duty'),
      date:f.date,items:[],entryId:f.id,
      start,end,dep,arr,sectors:0,
      status:f.activityStatus===ACTIVITY_STATUS.COMPLETED?'done':'planned',
      sortTime:start||'99:99',
      courseType:f.courseType||'',
      aircraftType:f.type||'',
      flightNo:f.flightNo||'',
      remarks:f.remarks||''
    });
  });

  // Duty-type activities are records in the same Core collection. Surface them
  // only when an equivalent operational activity is not already present.
  ds.filter(d=>d?.date&&!/flight duty/i.test(d.type||'')).forEach(d=>{
    const duplicate=activities.some(f=>{
      if(f.date!==d.date||canonicalDutyType(f.dutyType||'','Duty')!==canonicalDutyType(d.type||'','Duty'))return false;
      const fs=f.onDuty||f.schedOut||f.out||'',fe=f.offDuty||f.schedIn||f.in||f.on||'';
      return (!d.report||!fs||d.report===fs)&&(!d.end||!fe||d.end===fe);
    });
    if(duplicate)return;

    groups.push({
      kind:'duty',
      activityType:canonicalDutyType(d.type||'Duty','Duty'),
      date:d.date,items:[],dutyId:d.id,
      start:d.report||'',end:d.end||'',
      dep:home,arr:home,sectors:0,status:d.activityStatus===ACTIVITY_STATUS.COMPLETED?'done':'planned',
      sortTime:d.report||'99:99',
      remarks:d.notes||''
    });
  });

  return groups.sort((a,b)=>
    `${a.date}${a.sortTime||'99:99'}${a.kind||''}`.localeCompare(
      `${b.date}${b.sortTime||'99:99'}${b.kind||''}`
    )
  );
}

function savedEntryForRosterSector(r){
  if(!r||r.activityStatus!==ACTIVITY_STATUS.COMPLETED)return null;
  return coreActivityRows().find(x=>x.id===r.id&&isFlight(x))||null;
}
function rosterSectorCompleted(r){return !!r&&r.activityStatus===ACTIVITY_STATUS.COMPLETED}
function rosterCarryDefaultsForItem(r){
  const group=rosterGroups().find(g=>g.items.some(x=>x.id===r?.id));
  if(!group)return null;
  const items=[...group.items].sort((a,b)=>(a.std||'').localeCompare(b.std||''));
  const idx=items.findIndex(x=>x.id===r.id);
  if(idx<=0)return null;
  for(let i=idx-1;i>=0;i--){
    const prev=savedEntryForRosterSector(items[i]);
    if(!prev)continue;
    return{
      reg:prev.reg||'',type:prev.type||'',role:prev.role||'PIC',
      picName:prev.picName||'',sicName:prev.sicName||'',soName:prev.soName||'',
      instructorName:prev.instructorName||'',instructionType:prev.instructionType||'',
      ifr:prev.ifr||'yes',seatPosition:prev.seatPosition||'',
      pf:prev.pf==='yes'?'no':'yes'
    };
  }
  return null;
}

async function rosterGroupHtml(groups,interactive=false){
  if(!groups.length)return'<div class="empty">No roster activities for this day.</div>';
  let html='';

  for(const g of groups){
    const type=canonicalDutyType(g.activityType||'Duty','Duty'),u=upper(type);

    if(u==='DAY OFF'||u==='OFF'){
      const action=interactive&&g.dutyId?` data-edit-roster-duty="${g.dutyId}" role="button" tabindex="0"`:'';
      html+=`<div class="rowitem roster-agenda-row roster-day-off${action?' roster-agenda-clickable':''}"${action}><div><b>${esc(displayDate(g.date))} • Day OFF</b>${g.remarks?`<div class="small">${esc(g.remarks)}</div>`:''}</div><div class="meta"><span class="small">OFF</span></div></div>`;
      continue;
    }

    if(g.kind==='flight'){
      for(const r of g.items){
        const start=r.std?await localTime(r.date,r.std,r.dep):'--:--',end=r.sta?await localTime(r.date,r.sta,r.arr||r.dep):'--:--',done=rosterSectorCompleted(r);
        const info=r.aerolineTrainingLabel||r.aerolineTrainingDesc||'';
        const action=interactive?` data-roster-action="${r.id}" role="button" tabindex="0"`:'';
        html+=`<div class="rowitem roster-agenda-row${interactive?' roster-agenda-clickable':''}${done?' roster-all-completed':''}"${action}><div><b>${done?'✓ ':''}${esc(r.flightNo?rosterFlightLabel(r.flightNo):'Flight')}</b><div class="route">${esc(r.dep||'?')} → ${esc(r.arr||'?')}</div>${info?`<div class="small">${esc(info)}</div>`:''}</div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time${done?' • completed':''}</span></div></div>`;
      }
      continue;
    }

    const start=g.start?await localTime(g.date,g.start,g.dep):'--:--';
    const end=g.end?await localTime(g.date,g.end,g.arr||g.dep):'--:--';

    let detail='';
    if(u==='DHD'||u==='DHP'){
      detail=(g.dep||g.arr)?`${esc(g.dep||'?')} → ${esc(g.arr||'?')}${g.flightNo?` • ${esc(g.flightNo)}`:''}`:'Route to complete';
    }else if(u==='SIMULATOR'){
      detail=[g.dep||'',g.aircraftType||'',g.remarks||g.courseType||''].filter(Boolean).map(esc).join(' • ');
    }else if(u==='GROUND COURSE'){
      detail=[g.dep||'',g.remarks||g.courseType||''].filter(Boolean).map(esc).join(' • ');
    }else{
      detail=esc(g.dep||appSettings().homeBase||'');
    }
    if(!detail&&g.remarks)detail=esc(g.remarks);

    let action='';
    if(interactive&&g.entryId)action=` data-edit-roster-entry="${g.entryId}" role="button" tabindex="0"`;
    else if(interactive&&g.dutyId)action=` data-edit-roster-duty="${g.dutyId}" role="button" tabindex="0"`;

    html+=`<div class="rowitem roster-agenda-row${action?' roster-agenda-clickable':''}"${action}><div><b>${esc(displayDate(g.date))} • ${esc(type)}</b>${detail?`<div class="small">${detail}</div>`:''}</div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time</span></div></div>`;
  }

  return html;
}

/* One activity collection. Roster and Logbook are filtered projections of the same records. */
function rosterMonthAvailable(month){
  if(!month)return false;
  return coreActivityRows().some(r=>inMonth(r.date,month)&&!r.rosterHidden);
}
function rosterPlanningEntriesForMonth(month){
  return coreActivityRows()
    .filter(r=>inMonth(r.date,month)&&!r.rosterHidden)
    .map(r=>r.activityStatus===ACTIVITY_STATUS.COMPLETED?{...r,_payrollRosterSynthetic:false,_trainingAuthoritative:true}:{...r,onDuty:isFlight(r)?'':r.onDuty,offDuty:isFlight(r)?'':r.offDuty,_payrollRosterSynthetic:isFlight(r),_trainingAuthoritative:false})
    .sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
}
function operationalEntriesForMonth(month){
  return rosterPlanningEntriesForMonth(month);
}
function operationalEntriesForTrips(){
  const activities=coreActivityRows().filter(r=>!r.rosterHidden),byMonth=new Map();
  for(const r of activities){
    const month=String(r?.date||'').slice(0,7);if(!month)continue;
    if(!byMonth.has(month))byMonth.set(month,[]);
    byMonth.get(month).push(r);
  }
  const out=[];
  for(const month of [...byMonth.keys()].sort()){
    const rows=byMonth.get(month)||[];
    out.push(...rows.map(r=>r.activityStatus===ACTIVITY_STATUS.COMPLETED?{...r,_payrollRosterSynthetic:false,_trainingAuthoritative:true}:{...r,onDuty:isFlight(r)?'':r.onDuty,offDuty:isFlight(r)?'':r.offDuty,_payrollRosterSynthetic:isFlight(r),_trainingAuthoritative:false}).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b))));
  }
  return out.sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
}

/* Trips */
function overlapMins(a,b,s,e){const x=Math.max(a.getTime(),s.getTime()),y=Math.min(b.getTime(),e.getTime());return Math.max(0,Math.round((y-x)/60000))}
function tripChargeableDutyFromEntries(s,e,sourceEntries){
  const lower=new Date(s.getTime()-86400000).toISOString().slice(0,10),upperLimit=new Date(e.getTime()+86400000).toISOString().slice(0,10);
  let total=0;const fs=(sourceEntries||[]).filter(f=>f.date&&f.date>=lower&&f.date<=upperLimit),dates=[...new Set(fs.map(f=>f.date).filter(Boolean))];
  dates.forEach(date=>{
    const entries=dayEntries(date,fs);
    for(const item of entries){
      const rule=activityRule(item),marker=tripSequenceStart(item)||entryStart(item)||zuluDate(date,item.onDuty||'00:00');
      if(!marker||marker<s||marker>e)continue;
      if(rule.trip==='fixed-ground')total+=PILOTLOG_RULES.fixed.groundTripDutyMins;
      else if(rule.trip==='credit')total+=creditMinsForEntry(item);
    }
    const dutyEntries=entries.filter(x=>activityRule(x).trip==='duty');if(!dutyEntries.length)return;
    const first=dutyEntries[0],last=dutyEntries[dutyEntries.length-1],startTime=first.onDuty||shiftTime(first.schedOut||first.out,-60),endTime=last.offDuty||shiftTime(last.schedIn||last.in,30);if(!startTime||!endTime)return;
    const [a,b]=dutyDateEnd(date,startTime,endTime);total+=overlapMins(a,b,s,e);
  });
  return total;
}
function tripChargeLabel(f){
  const rule=activityRule(f);if(rule.trip==='zero')return isStby(f)?'Not deducted':'Excluded from duty';if(rule.trip==='credit')return`Credit ${fmt(PilotLogEngine.credit(f))} deducted`;if(rule.trip==='fixed-ground')return`${fmt(PILOTLOG_RULES.fixed.groundTripDutyMins)} fixed duty`;return'Included in duty';
}

function tripChargeableDuty(s,e){return tripChargeableDutyFromEntries(s,e,operationalEntriesForTrips())}
function calculateTripMetrics(startValue,endValue,cashAmount=0,sourceEntries=null){
  const s=startValue instanceof Date?startValue:new Date(startValue),e=endValue instanceof Date?endValue:new Date(endValue);
  if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||e<=s)return null;
  const trip=Math.round((e-s)/60000),duty=tripChargeableDutyFromEntries(s,e,sourceEntries||operationalEntriesForTrips()),layover=Math.max(0,trip-duty),allowance=Number(cashAmount||0)>0?0:(layover/60)*Number(paySettings().layoverRate||0);
  return{start:s,end:e,trip,duty,layover,allowance};
}
function calculateSavedTripProjection(savedTrip,sourceEntries=null){
  if(!savedTrip)return null;
  const metrics=calculateTripMetrics(savedTrip.start,savedTrip.end,Number(savedTrip.cashAmount||0),sourceEntries||operationalEntriesForTrips());
  if(!metrics)return null;
  return{...savedTrip,trip:metrics.trip,duty:metrics.duty,layover:metrics.layover,allowance:metrics.allowance,calculated:metrics};
}
function calculateSavedTripProjections(savedTrips=null,sourceEntries=null){
  const entries=sourceEntries||operationalEntriesForTrips();
  return(savedTrips||load(TRIPS_KEY)).map(t=>calculateSavedTripProjection(t,entries)).filter(Boolean);
}
function tripCalc(){
  const result=PilotLogEngine.trip($('tripStart').value,$('tripEnd').value,Number($('tripCashAmount')?.value||0));if(!result){$('tripLayover').value='0:00';$('tripAllowance').value='0.00';return null}
  $('tripLayover').value=fmt(result.layover);$('tripAllowance').value=appCurrency()==='MAD'?moneyCurrency(result.allowance,'MAD'):(result.allowance===0?moneyCurrency(0,appCurrency()):'FX required');return result
}
function tripStartDateFromValue(v){return String(v||'').slice(0,10)}
function tripFxCache(t,target,from,startDate){
  const x=t?.cashFxRates?.[target];if(x&&upper(x.from||'')===from&&String(x.tripStartDate||'')===startDate&&Number(x.rate)>0)return x;
  if(target==='EUR'&&Number(t?.cashAmount)>0&&Number(t?.cashEur)>0&&String(t?.cashFxDate||'')&&upper(t?.cashCurrency||'')===from){return{from,to:'EUR',rate:Number(t.cashEur)/Number(t.cashAmount),date:String(t.cashFxDate),tripStartDate:startDate}}
  return null;
}
async function tripMoneyConversion(){
  const c=tripCalc();if(!c)return null;
  const amount=Number($('tripCashAmount')?.value||0),from=upper($('tripCashCurrency')?.value||''),to=appCurrency(),startDate=tripStartDateFromValue($('tripStart')?.value),existing=load(TRIPS_KEY).find(x=>x.id===$('tripEditId')?.value);
  if(amount>0&&!from){if($('tripCashConverted'))$('tripCashConverted').value='';return{...c,error:'Select the cash currency.'}}
  if(amount>0&&!ISO_CURRENCIES.includes(from)){if($('tripCashConverted'))$('tripCashConverted').value='';return{...c,error:'Unsupported cash currency.'}}
  if(!startDate){if($('tripCashConverted'))$('tripCashConverted').value='';return{...c,error:amount>0?'Trip Start is required before freezing the FX rate.':''}}
  if(startDate>today()&&amount>0&&from!==to){if($('tripCashConverted'))$('tripCashConverted').value='';return{...c,error:'Cash FX cannot be frozen before the Trip Start date.'}}
  let tableInfo=null,rateDate=startDate,cashRate=amount>0&&from===to?1:0,madRate=to==='MAD'?1:0;
  const cached=amount>0?tripFxCache(existing,to,from,startDate):null;
  if(cached){cashRate=Number(cached.rate);rateDate=cached.date||rateDate}
  if(existing&&upper(existing.tripFxTo||'')===to&&String(existing.tripFxTripStartDate||'')===startDate&&Number(existing.tripFxMadRate)>0){madRate=Number(existing.tripFxMadRate);rateDate=existing.tripFxDate||rateDate}
  const needCash=amount>0&&!cashRate,needMad=c.allowance!==0&&!madRate;
  if((needCash||needMad)&&startDate<=today()){
    try{tableInfo=await fetchFxTableForDate(startDate);rateDate=tableInfo.date||rateDate;if(needCash)cashRate=fxRateFromTable(tableInfo.table,from,to);if(needMad)madRate=fxRateFromTable(tableInfo.table,'MAD',to)}catch(e){if(amount>0&&needCash)return{...c,error:'FX unavailable. Connect to the internet and calculate again.'}}
  }
  const cashConverted=amount>0&&cashRate>0?amount*cashRate:0,allowanceConverted=madRate>0?c.allowance*madRate:null;
  if($('tripCashConverted'))$('tripCashConverted').value=amount>0&&cashConverted>=0?moneyCurrency(cashConverted,to):'';
  if($('tripAllowance'))$('tripAllowance').value=c.allowance===0?moneyCurrency(0,to):(allowanceConverted!=null?moneyCurrency(allowanceConverted,to):'FX unavailable');
  return{...c,cashConverted,cashRate,cashFxDate:rateDate,cashFrom:from,cashTo:to,madRate,tripStartDate:startDate,error:''};
}
function resetTrip(){$('tripForm').reset();$('tripEditId').value='';$('tripLayover').value='0:00';$('tripAllowance').value=moneyCurrency(0);if($('tripCashConverted'))$('tripCashConverted').value='';if($('tripCashCurrency'))$('tripCashCurrency').value='USD';updateCurrencyUI()}
async function refreshTripFxForCurrency(target=appCurrency()){
  const ts=load(TRIPS_KEY),tables=new Map();let changed=false,failed=0;
  for(const t of ts){
    const startDate=tripStartDateFromValue(t.start),cashAmount=Number(t.cashAmount||0),from=upper(t.cashCurrency||'');if(!startDate||startDate>today())continue;
    try{
      let tableInfo=tables.get(startDate);if(!tableInfo){tableInfo=await fetchFxTableForDate(startDate);tables.set(startDate,tableInfo)}
      const madRate=target==='MAD'?1:fxRateFromTable(tableInfo.table,'MAD',target);
      t.tripFxTo=target;t.tripFxMadRate=madRate;t.tripFxDate=tableInfo.date;t.tripFxTripStartDate=startDate;
      if(cashAmount>0&&from){const rate=from===target?1:fxRateFromTable(tableInfo.table,from,target),entry={from,to:target,rate,date:tableInfo.date,tripStartDate:startDate};t.cashFxRates={...(t.cashFxRates||{}),[target]:entry};t.cashFxFrom=from;t.cashFxTo=target;t.cashFxRate=rate;t.cashFxDate=tableInfo.date;t.cashFxTripStartDate=startDate;t.cashConverted=cashAmount*rate;if(target==='EUR')t.cashEur=t.cashConverted}
      t._updatedAt=new Date().toISOString();changed=true;
    }catch{failed++}
  }
  if(changed)save(TRIPS_KEY,ts);return{changed,failed};
}
function updateCurrencyUI(){
  const cur=appCurrency(),payCur=payrollConversionCurrency();if($('tripAllowanceLabel'))$('tripAllowanceLabel').textContent=`Total Layover Allowance (${currencyOutputCode(cur)})`;if($('tripCashConvertedLabel'))$('tripCashConvertedLabel').textContent=`Cash value in ${currencyOutputCode(cur)}`;if($('payTotalCurrencyLabel'))$('payTotalCurrencyLabel').textContent=`Converted total (${currencyOutputCode(payCur)})`;
}
function localDateTimeValue(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}
function entryStart(f){return zuluDate(f.date,f.onDuty||f.schedOut||f.out||'00:00')}
function tripSequenceStart(f){
  // For trip boundaries use the actual beginning of the activity, not a derived duty/reporting time.
  const t=f.schedOut||f.out||f.onDuty||'00:00';
  return zuluDate(f.date,t);
}
function tripSequenceEnd(f){
  // For trip boundaries use the actual end of the final activity.
  const start=f.schedOut||f.out||f.onDuty||'00:00';
  const end=f.schedIn||f.in||f.offDuty||f.on||start;
  return endZuluDate(f.date,start,end);
}
function positioningCashEligible(entries){
  return (entries||[]).some(f=>isPositioning(f)&&isMoroccoCode(f.dep)&&f.arr&&!isMoroccoCode(f.arr));
}
function autoDetectTrips(showAlert=true,rerender=true){
  const base=upper(appSettings().homeBase||'CMN');
  const fs=operationalEntriesForTrips().filter(f=>f.date);

  let ts=load(TRIPS_KEY),created=0,updated=0;

  for(let i=0;i<fs.length;i++){
    const f=fs[i];

    // A trip can be opened by DHD or DHP leaving Home Base and ending away from base.
    // Normal operating flights must never create a trip by themselves.
    if(!isPositioning(f) || upper(f.dep)!==base || !f.arr || upper(f.arr)===base) continue;

    const start=tripSequenceStart(f);
    if(!start) continue;

    let end=null,last=i,stations=new Set(),includedIds=[];
    for(let j=i;j<fs.length;j++){
      const x=fs[j];
      includedIds.push(x.id);
      last=j;

      if(x.dep&&upper(x.dep)!==base) stations.add(upper(x.dep));
      if(x.arr&&upper(x.arr)!==base) stations.add(upper(x.arr));

      // Trip closes only when the sequence physically returns to home base.
      if(j>i && upper(x.arr)===base){
        end=tripSequenceEnd(x);
        break;
      }
    }

    if(!end||end<=start) continue;

    const startStr=localDateTimeValue(start),endStr=localDateTimeValue(end);
    const sig=`AUTO|${startStr}|${endStr}|${base}`;
    const k=ts.findIndex(t=>t.autoSig===sig||t.autoSourceId===f.id);
    const existingCash=k>=0?Number(ts[k].cashAmount||0):0;
    const metrics=PilotLogEngine.trip(start,end,existingCash,fs);if(!metrics)continue;
    const{trip,duty,layover}=metrics;
    const allowance=metrics.allowance;

    const obj=stamp({
      id:k>=0?ts[k].id:makeId(),
      base,
      stations:[...stations].filter(Boolean).join(', '),
      start:startStr,
      end:endStr,
      trip,
      duty,
      layover,
      allowance,
      remarks:'Automatically detected from out-of-base sequence',
      auto:true,
      autoSourceId:f.id,
      autoSig:sig,
      includedEntryIds:includedIds,
      cashEligible:positioningCashEligible(fs.filter(x=>includedIds.includes(x.id))),
      cashAmount:k>=0?Number(ts[k].cashAmount||0):0,
      cashCurrency:k>=0?upper(ts[k].cashCurrency||''): '',
      cashConverted:k>=0?Number(ts[k].cashConverted||0):0,
      cashEur:k>=0?Number(ts[k].cashEur||0):0,
      cashFxFrom:k>=0?upper(ts[k].cashFxFrom||ts[k].cashCurrency||''):'',
      cashFxTo:k>=0?upper(ts[k].cashFxTo||''):'',
      cashFxRate:k>=0?Number(ts[k].cashFxRate||0):0,
      cashFxDate:k>=0?String(ts[k].cashFxDate||''):'',
      cashFxTripStartDate:k>=0?String(ts[k].cashFxTripStartDate||''):'',
      cashFxRates:k>=0?{...(ts[k].cashFxRates||{})}:{},
      tripFxTo:k>=0?upper(ts[k].tripFxTo||''):'',tripFxMadRate:k>=0?Number(ts[k].tripFxMadRate||0):0,tripFxDate:k>=0?String(ts[k].tripFxDate||''):'',tripFxTripStartDate:k>=0?String(ts[k].tripFxTripStartDate||''):''
    });

    if(k>=0){ts[k]={...ts[k],...obj};updated++}
    else{ts.push(obj);created++}

    i=last;
  }

  save(TRIPS_KEY,ts);
  if(rerender){renderTrips();renderPayroll()}
  if(showAlert)alert(`Automatic Trips: ${created} created, ${updated} updated.`);
  return{created,updated};
}

/* Imports */
function unfoldIcs(text){return text.replace(/\r?\n[ \t]/g,'')}
function icsVal(line){const i=line.indexOf(':');return i<0?'':line.slice(i+1).replace(/\\n/g,'\n').replace(/\\,/g,',').replace(/\\;/g,';')}
function parseIcsDate(v){v=String(v||'').trim();const m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?/);if(!m)return null;return{date:`${m[1]}-${m[2]}-${m[3]}`,time:m[4]?`${m[4]}:${m[5]}`:''}}
function parseIcs(text){return unfoldIcs(text).split('BEGIN:VEVENT').slice(1).map(x=>x.split('END:VEVENT')[0]).map(b=>{const o={};b.split(/\r?\n/).forEach(line=>{const k=line.split(':')[0].split(';')[0];if(['SUMMARY','DESCRIPTION','DTSTART','DTEND','UID'].includes(k))o[k]=icsVal(line)});o._start=parseIcsDate(o.DTSTART);o._end=parseIcsDate(o.DTEND);return o}).filter(e=>e._start)}
function classify(summary){
  const s=upper(summary),fl=s.match(/\b([A-Z0-9]{2,3}\s?\d{2,4})\b.*?\b([A-Z]{3})\b\s*(?:→|->|–|-)\s*\b([A-Z]{3})\b/);
  if(fl)return{kind:'flight',flightNo:fl[1].replace(/\s+/g,''),dep:fl[2],arr:fl[3]};
  const ac=(s.match(/\bA(319|320|321)\b/)||[])[0]||'';
  if(/\bRT[ -]?A3(19|20|21)\b|RECURRENT TRAINING|\bSIM(?:ULATOR)?\b|\bOPC\b|\bLPC\b/.test(s))return{kind:'entry',dutyType:'Simulator',aircraftType:ac};
  if(/\bSTBY\b|STANDBY|\bHSBY\b/.test(s))return{kind:'entry',dutyType:'STBY',aircraftType:ac};
  if(/\bDHD\b|DEADHEAD|\bDHP\b/.test(s)){const r=s.match(/\b([A-Z]{3})\b\s*(?:→|->|–|-)\s*\b([A-Z]{3})\b/);return{kind:'entry',dutyType:'DHD',aircraftType:ac,dep:r?r[1]:'',arr:r?r[2]:''}};
  if(/\bGRT\b|GROUND|COURSE|TRAINING/.test(s))return{kind:'entry',dutyType:'Ground Course',aircraftType:ac};
  if(/^DUTY\b|\bDUTY\s*[•:-]/.test(s))return{kind:'duty',dutyType:'Flight Duty'};
  if(/^(?:OFF|DAY\s*OFF|DAYOFF)\b/.test(s))return{kind:'duty',dutyType:'Day OFF'};return{kind:'unknown'}
}
function zuluTimes(desc){const d=String(desc||'');return{out:(d.match(/Scheduled (?:take-off\/)?departure\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',inn:(d.match(/Scheduled arrival\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',report:(d.match(/Reporting\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',end:(d.match(/(?:Release|End of duty)\s+(\d{1,2}:\d{2})Z/i)||[])[1]||''}}
function entrySig(f){return [f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.schedIn,f.onDuty,f.offDuty].map(x=>upper(x)).join('|')}
function dutySig(d){return [d.date,d.type,d.report,d.end,d.notes].map(x=>upper(x)).join('|')}
function importCalendar(events){
  const activities=coreActivityRows(),seenActivities=new Set(activities.map(entrySig)),seenDuties=new Set(dutyActivityRows().map(dutySig));let sectors=0,duties=0,other=0,skipped=0;
  events.forEach(ev=>{const c=classify(ev.SUMMARY),z=zuluTimes(ev.DESCRIPTION),date=ev._start.date;if(['ignore','unknown'].includes(c.kind)){skipped++;return}
    if(c.kind==='flight'){
      const schedOut=z.out||ev._start.time||'',schedIn=z.inn||(ev._end?.time||''),sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,f=stamp({id:sourceExisting?.id||makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',date,flightNo:composeFlightNo(c.flightNo),dep:c.dep,arr:c.arr,type:'',reg:'',schedOut,schedIn,schedBlock:timeSpanMins(schedOut,schedIn),onDuty:'',offDuty:'',out:'',off:'',on:'',in:'',block:0,flight:0,credit:creditMinsForEntry({dutyType:'Flight',date,dep:c.dep,schedOut,schedIn,schedBlock:timeSpanMins(schedOut,schedIn)}),role:'PIC',instructionType:'',night:'00:00',sim:'no',ifr:'yes',pf:'yes',approachType:'',dayTakeoffs:1,nightTakeoffs:0,dayLandings:1,nightLandings:0,remarks:'Imported from calendar',source:'calendar',calendarUid:ev.UID||''});
      const existingIndex=activities.findIndex(x=>x.id===f.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],f);skipped++;return}
      const signature=entrySig(f);if(!seenActivities.has(signature)){activities.push(f);seenActivities.add(signature);sectors++}else skipped++;return;
    }
    if(c.kind==='duty'){
      const rep=z.report||ev._start.time||'',end=z.end||(ev._end?.time||''),sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,d=stamp({id:sourceExisting?.id||makeActivityId(),recordKind:'activity',activityCategory:'DUTY',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:c.dutyType,date,onDuty:rep,offDuty:end,dutyMinutes:timeSpanMins(rep,end),remarks:ev.SUMMARY||'',source:'calendar',calendarUid:ev.UID||''}),sd=dutySig({date,type:c.dutyType,report:rep,end,notes:ev.SUMMARY||''});
      const existingIndex=activities.findIndex(x=>x.id===d.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],d);skipped++;return}
      if(!seenDuties.has(sd)){activities.push(d);seenDuties.add(sd);duties++}else skipped++;return;
    }
    if(c.kind==='entry'){
      const start=ev._start.time||'',end=ev._end?.time||'',sim=c.dutyType==='Simulator',ground=c.dutyType==='Ground Course',sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,f=stamp({id:sourceExisting?.id||makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:c.dutyType,date,flightNo:'',dep:c.dep||'',arr:c.arr||'',type:c.aircraftType||'',reg:'',schedOut:'',schedIn:'',schedBlock:0,onDuty:start,offDuty:end,out:'',off:'',on:'',in:'',block:0,flight:0,simulatorTime:sim?timeSpanMins(start,end):0,credit:creditMinsForEntry({dutyType:c.dutyType,credit:0}),role:'PIC',instructionType:sim?'SFI/SFE Instruction Sim':'',night:'00:00',sim:sim?'yes':'no',ifr:'no',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,courseType:ground?upper(ev.SUMMARY||''):'',remarks:`Imported from calendar: ${ev.SUMMARY||''}`,source:'calendar',calendarUid:ev.UID||''});
      const existingIndex=activities.findIndex(x=>x.id===f.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],f);skipped++;return}
      const signature=entrySig(f);if(!seenActivities.has(signature)){activities.push(f);seenActivities.add(signature);other++}else skipped++;
    }
  });commitCoreActivities(activities);reconcileAllDuties();return{sectors,duties,other,skipped}
}

/* AeroLINE native roster JSON import */
/* AeroLINE Connect — browser-session sync */
const AEROLINE_ORIGIN='https://cesarmaroc.airarabia.com';
const AEROLINE_SCHEDULE_PATH='/cesar-web-intranet-portal/webIntranetPortal/TrackingService/getCrewSchedule/';
function aerolineConfig(){
  const x=loadObject(AEROLINE_CONFIG_KEY,{});
  return {...x,crewId:String(x.crewId||''),crewProfileID:Number(x.crewProfileID||0),crewType:upper(x.crewType||'')};
}
function saveAerolineConfig(next){
  const cur=aerolineConfig(),value={...cur,...next,updatedAt:new Date().toISOString()};
  // This device-local record contains only roster identity, never the AeroLINE password or session token.
  saveObject(AEROLINE_CONFIG_KEY,value);
  return value;
}
function aerolineCrewTypeFromProfile(){
  const role=upper(appSettings().profileRole||'');
  if(role.includes('CAPTAIN')||role==='CP')return'CP';
  if(role.includes('FIRST OFFICER')||role==='FO')return'FO';
  if(role.includes('SECOND OFFICER')||role==='SO')return'SO';
  return'';
}
function rememberAerolineIdentity(root){
  if(!root||typeof root!=='object')return aerolineConfig();
  const crewId=String(root.crewId||root.crewID||'').trim();
  const crewProfileID=Number(root.crewProfId||root.crewProfileID||root.crewProfileId||0);
  const current=aerolineConfig();
  const crewType=current.crewType||aerolineCrewTypeFromProfile();
  if(crewId||crewProfileID||crewType)return saveAerolineConfig({crewId:crewId||current.crewId,crewProfileID:crewProfileID||current.crewProfileID,crewType});
  return current;
}
function aerolineMonthRange(month){
  const m=String(month||'').match(/^(\d{4})-(\d{2})$/);if(!m)throw new Error('Select a valid roster month.');
  const year=Number(m[1]),mon=Number(m[2]),last=new Date(Date.UTC(year,mon,0)).getUTCDate();
  const pad=n=>String(n).padStart(2,'0');
  return{fromDate:`01/${pad(mon)}/${year}`,toDate:`${pad(last)}/${pad(mon)}/${year}`};
}
function aerolineDirectSyncAvailable(){
  const c=aerolineConfig();return !!(c.crewId&&c.crewProfileID&&(c.crewType||aerolineCrewTypeFromProfile()));
}
function aerolineOpenLogin(){
  const w=window.open(AEROLINE_ORIGIN+'/','_blank');
  if(!w)throw new Error('The browser blocked the AeroLINE login window. Allow pop-ups and try again.');
  try{w.opener=null}catch{}
  return true;
}
async function fetchAerolineRosterDirect(month){
  const cfg=aerolineConfig();
  if(!cfg.crewId||!cfg.crewProfileID)throw new Error('One-time setup required: import one AeroLINE roster JSON first so PilotLog can learn your crew identifiers.');
  const crewType=cfg.crewType||aerolineCrewTypeFromProfile();
  if(!crewType)throw new Error('Crew type is missing. Open AeroLINE setup and choose CP, FO or SO.');
  const {fromDate,toDate}=aerolineMonthRange(month),url=`${AEROLINE_ORIGIN}${AEROLINE_SCHEDULE_PATH}?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`;
  let response;
  try{
    response=await fetch(url,{
      method:'POST',mode:'cors',credentials:'include',cache:'no-store',
      headers:{'Accept':'application/json, text/plain, */*','Content-Type':'application/json;charset=UTF-8','Auth-Id':cfg.crewId},
      body:JSON.stringify({crewProfileID:cfg.crewProfileID,crewID:cfg.crewId,crewType,newApp:true})
    });
  }catch(e){
    const err=new Error('Direct AeroLINE access was blocked by the browser. Keep AeroLINE logged in, then use Import AeroLINE JSON while we test the session bridge on this device.');
    err.cause=e;throw err;
  }
  if(response.status===401||response.status===403)throw new Error('AeroLINE session not accepted. Open AeroLINE Login, sign in, return to PilotLog and try Sync again.');
  if(!response.ok)throw new Error(`AeroLINE returned HTTP ${response.status}.`);
  let payload;try{payload=await response.json()}catch{throw new Error('AeroLINE returned an unreadable response.');}
  if(!aerolineRoot(payload))throw new Error('AeroLINE responded, but no crew schedule was found.');
  return payload;
}
async function syncAerolineMonth(month){
  const payload=await fetchAerolineRosterDirect(month),result=importAerolineRosterObject(payload);
  return result;
}
function aerolineConnectionStatusText(){
  const cfg=aerolineConfig();
  if(cfg.crewId&&cfg.crewProfileID)return `Roster identity ready • Crew type ${cfg.crewType||aerolineCrewTypeFromProfile()||'not set'} • Password and AeroLINE session token are not stored by PilotLog.`;
  return 'One-time setup: import one AeroLINE roster JSON. PilotLog will retain only the crew identifiers needed for future direct-sync attempts; it never stores your AeroLINE password or session token.';
}

function aerolineRoot(payload){
  const candidates=[payload,payload?.data,payload?.result,payload?.response,payload?.body];
  return candidates.find(x=>x&&typeof x==='object'&&Array.isArray(x.mainCrewScheduleInfoList))||null;
}
function aerolineDateTime(v){
  const s=String(v||'').trim();
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if(m)return{date:`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`,time:`${m[4].padStart(2,'0')}:${m[5]}`};
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  return m?{date:`${m[1]}-${m[2]}-${m[3]}`,time:m[4]?`${m[4].padStart(2,'0')}:${m[5]}`:''}:{date:'',time:''};
}
function aerolineMonthLabel(root){
  const d=String(root?.schStartDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return'';
  try{return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T00:00:00Z`)).toUpperCase()}
  catch{return d.slice(0,7)}
}
function aerolineFlightKey(r){return `FLIGHT|${r.flightLegId||''}|${upper(r.flightNo||'')}|${upper(r.origin||'')}|${upper(r.destination||'')}|${String(r.flightDepTimeString||'')}`}
function aerolineEventKey(r,code){return `EVENT|${upper(code||'')}|${r.crewScheduleBlockId||''}|${String(r.eventStartTimeString||'')}|${String(r.eventEndTimeString||'')}|${upper(r.eventStartLoc||'')}|${upper(r.eventEndLoc||'')}`}
function aerolineTrainingKey(r){return `TRAINING|${r.trainingSlotId||''}|${r.crewScheduleBlockId||''}|${upper(r.trainingProgramCode||'')}|${String(r.trainingStartTimeString||'')}|${String(r.trainingEndTimeString||'')}`}
function aerolineNormalizePersonName(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
function aerolineSamePerson(a,b){const x=aerolineNormalizePersonName(a),y=aerolineNormalizePersonName(b);return !!x&&!!y&&x===y}
function aerolineConfirmCrewIdentity(root){
  const rosterName=String(root?.crewName||'').trim(),profileName=String(appSettings().profileName||'').trim();
  if(!rosterName)return true;
  if(profileName&&aerolineSamePerson(rosterName,profileName))return true;
  return confirm(`Confirm this is ${rosterName}.`);
}
function aerolinePeople(v){return String(v||'').split(',').map(x=>x.trim()).filter(Boolean)}
function aerolineSelfName(root){return String(appSettings().profileName||root?.crewName||'').trim()}
function aerolineOtherCrew(r,root){
  const self=aerolineSelfName(root);
  return (Array.isArray(r?.joininCrew)?r.joininCrew:[]).map(x=>String(x||'').trim()).filter(x=>x&&!aerolineSamePerson(x,self));
}
function aerolineRegistration(r){
  const keys=['aircraftRegistration','aircraftReg','aircraftID','aircraftId','registration','reg','tailNo','tailNumber'];
  for(const k of keys){const v=upper(r?.[k]||'');if(v)return v}
  return'';
}
function aerolineTrainingMeta(root){
  return Array.isArray(root?.trainingCrewScheduleInfoList)?root.trainingCrewScheduleInfoList:[];
}
function aerolineTrainingForFlight(root,date,flightNo){
  const digits=rosterFlightDigits(flightNo||'');
  return aerolineTrainingMeta(root).find(t=>normalDate(t.trainDate||'')===date&&rosterFlightDigits(t.trainLocOrFlight||'')===digits)||null;
}
function aerolineTrainingForActivity(root,r,start){
  const code=upper(r?.trainingProgramCode||''),loc=upper(r?.trainingLocation||'');
  return aerolineTrainingMeta(root).find(t=>{
    const td=aerolineDateTime(t.trainDateString||t.trainDate||'');
    if(td.date!==start.date)return false;
    if(td.time&&start.time&&td.time!==start.time)return false;
    if(code&&upper(t.trainingType||'')&&upper(t.trainingType)!==code)return false;
    if(loc&&upper(t.trainLocOrFlight||'')&&upper(t.trainLocOrFlight)!==loc)return false;
    return true;
  })||null;
}
function aerolineTrainingLabel(tm,r){
  const s=upper([tm?.trainingType,tm?.trainingTypeDesc,r?.trainingProgramCode,r?.trainingProgramDesc,r?.trainingSlotName].filter(Boolean).join(' '));
  if(/\bALC\b|ANNUAL LINE CHECK/.test(s))return'ALC • ANNUAL LINE CHECK';
  if(upper(tm?.trainingType||r?.trainingProgramCode||'')==='LTG'||/\bLINE TRAINING\b/.test(s))return'LTG • LINE TRAINING';
  if(upper(tm?.trainingType||r?.trainingProgramCode||'')==='RT'||/RECURRENT TRAINING/.test(s))return'RT • RECURRENT TRAINING';
  return upper(tm?.trainingTypeDesc||r?.trainingProgramDesc||tm?.trainingType||r?.trainingProgramCode||'');
}
function aerolineIsAlc(tm,r){return /\bALC\b|ANNUAL LINE CHECK/.test(upper([tm?.trainingType,tm?.trainingTypeDesc,r?.trainingProgramCode,r?.trainingProgramDesc,r?.trainingSlotName].filter(Boolean).join(' ')))}
function aerolineIsLineTraining(tm,r){return !aerolineIsAlc(tm,r)&&(upper(tm?.trainingType||r?.trainingProgramCode||'')==='LTG'||/\bLINE TRAINING\b/.test(upper([tm?.trainingTypeDesc,r?.trainingProgramDesc,r?.trainingSlotName].filter(Boolean).join(' '))))}
function aerolineIsSimulatorTraining(r,tm=null){
  const s=upper([tm?.trainingType,tm?.trainingTypeDesc,r.trainingProgramCode,r.trainingProgramDesc,r.trainingSlotName].filter(Boolean).join(' '));
  return /\bSIM\b|SIMULATOR|\bOPC\b|\bLPC\b|RECURRENT TRAINING|\bRT\b/.test(s);
}
function aerolineTrainingCrewFields(root,tm,sim){
  if(!sim||!tm)return{picName:'',sicName:'',instructorName:'',trainerType:''};
  const joining=aerolinePeople(tm.joiningPilot),trainers=aerolinePeople(tm.trainerName),self=aerolineSelfName(root);
  const ownTrainer=trainers.find(x=>aerolineSamePerson(x,self));
  return{
    picName:upper(joining[0]||''),
    sicName:upper(joining[1]||''),
    instructorName:upper(ownTrainer||''),
    trainerType:upper(tm.trainerType||'')
  };
}
const EXPIRY_COURSE_ALIASES=Object.freeze({
  CRM:['CRM','CREW RESOURCE MANAGEMENT'],SMS:['SMS','SAFETY MANAGEMENT SYSTEM'],GRT:['GRT','GROUND RECURRENT TRAINING'],DGR:['DGR','DANGEROUS GOODS'],AVSEC:['AVSEC','AVIATION SECURITY'],SEP:['SEP','SAFETY AND EMERGENCY PROCEDURES','SAFETY EMERGENCY PROCEDURES'],FIRSTAID:['FIRST AID','FIRSTAID'],UPRT:['UPRT','UPSET PREVENTION AND RECOVERY TRAINING'],EBTCBTA:['EBT/CBTA','EBT CBTA','CBTA','EVIDENCE BASED TRAINING'],OPC:['OPC','OPERATOR PROFICIENCY CHECK'],PPC:['PPC','PILOT PROFICIENCY CHECK']
});
function normalizeExpiryText(v){return upper(v||'').replace(/AEROLINE|LOGTEN|TYPE|ENDORSEMENT|COURSE|VALIDATION/g,' ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function expiryCourseCode(x){
  const explicit=upper(x?.aerolineValidationCode||'');if(explicit)return explicit.replace(/[^A-Z0-9/]+/g,'');
  const text=normalizeExpiryText([x?.name,x?.remarks,x?.aerolineValidationDesc].filter(Boolean).join(' '));
  for(const [code,aliases] of Object.entries(EXPIRY_COURSE_ALIASES))if(aliases.some(a=>{const n=normalizeExpiryText(a);return text===n||text.includes(` ${n} `)||text.startsWith(`${n} `)||text.endsWith(` ${n}`)}))return code;
  return normalizeExpiryText(x?.name||'').replace(/\s+/g,'');
}
function expiryIdentity(x){
  const category=String(x?.category||'course').toLowerCase();
  if(category==='course'){const code=expiryCourseCode(x);return code?`course|${code}`:''}
  const authority=normalizeExpiryText(x?.authority||''),name=normalizeExpiryText(x?.name||x?.medicalClass||x?.aircraftType||x?.aerolineValidationCode||'');if(!name)return'';return `${category}|${name}|${authority}`;
}
function findExpirySemanticMatch(rows,candidate){const key=expiryIdentity(candidate);return key&&key!=='course|'?rows.find(x=>expiryIdentity(x)===key):null}
function mergeExpiryDuplicate(a,b){
  const aProtected=!!(a?.locked||a?.manualOverride||a?.source==='manual'),bProtected=!!(b?.locked||b?.manualOverride||b?.source==='manual'),preferred=bProtected&&!aProtected?b:a,other=preferred===a?b:a,out={...other,...preferred};
  out.id=preferred.id||other.id;out.locked=!!(a?.locked||b?.locked);out.manualOverride=!!(a?.manualOverride||b?.manualOverride);
  if(!aProtected&&!bProtected){
    if(!out.expiry||String(other.expiry||'')>String(out.expiry||''))out.expiry=other.expiry||out.expiry||'';
    ['aerolineValidationCode','aerolineValidationDesc','logtenUniqueId','courseDate','lastCheck','number','authority','issuer','photoData'].forEach(k=>{if(!out[k]&&other?.[k])out[k]=other[k]});
  }
  if(preferred.source==='manual')out.source='manual';else if(a?.source==='aeroline'||b?.source==='aeroline')out.source='aeroline';else out.source=preferred.source||other.source||'manual';
  out._updatedAt=new Date().toISOString();return out;
}
function dedupeExpiryRecords(input=load(EXPIRY_KEY)){
  const out=[],index=new Map();let removed=0;
  for(const row of (Array.isArray(input)?input:[])){
    const key=expiryIdentity(row);if(!key||key==='course|'||!index.has(key)){index.set(key,out.length);out.push(row);continue}
    const i=index.get(key);out[i]=mergeExpiryDuplicate(out[i],row);removed++;
  }
  return{rows:out,removed};
}
function migrateExpirySemanticDuplicates(){const d=dedupeExpiryRecords(load(EXPIRY_KEY));if(d.removed)save(EXPIRY_KEY,d.rows);return d.removed}
const AEROLINE_VALIDATION_SKIP=new Set(['CMC','A320/IR','JSIM','TRN','WP']);
function aerolineValidationCategory(code){
  code=upper(code);
  if(code==='MED')return'medical';
  if(code==='ELP')return'english';
  if(code==='LVC')return'license';
  return'course';
}
function parseAerolineValidations(root){
  const seen=new Set(),out=[];
  for(const v of (root?.validationsInfoDTO||[])){
    const code=upper(v?.validationCode||'');if(!code||AEROLINE_VALIDATION_SKIP.has(code)||seen.has(code))continue;
    seen.add(code);
    const expiry=normalDate(String(v?.expDate||'').slice(0,10));
    out.push({code,description:String(v?.validationDesc||code).trim(),expiry:/^\d{4}-\d{2}-\d{2}$/.test(expiry)?expiry:''});
  }
  return out;
}
function importAerolineValidations(root){
  const initial=dedupeExpiryRecords(load(EXPIRY_KEY)),rows=[...initial.rows],validations=parseAerolineValidations(root);let added=0,updated=0,kept=initial.removed,emptySkipped=0;
  for(const v of validations){
    const category=aerolineValidationCategory(v.code),candidate={category,name:category==='english'?'LPC ENGLISH':v.code,aerolineValidationCode:v.code,aerolineValidationDesc:v.description};
    const match=rows.find(x=>upper(x.aerolineValidationCode||'')===v.code)||findExpirySemanticMatch(rows,candidate);
    if(!v.expiry){if(match){match.aerolineValidationCode=v.code;match.aerolineValidationDesc=v.description;kept++}else emptySkipped++;continue}
    if(!match){
      rows.push(stamp({id:stableSourceId('expiry',`aeroline-validation:${v.code}`),category,name:category==='english'?'LPC ENGLISH':v.code,authority:'',number:'',lastCheck:'',courseDate:'',medicalClass:'',englishLevel:'',aircraftType:'',endorsedBy:'',expiry:v.expiry,issuer:'',remarks:`AEROLINE • ${upper(v.description)}`,photoData:'',locked:false,source:'aeroline',aerolineValidationCode:v.code,aerolineValidationDesc:v.description}));
      added++;continue;
    }
    match.aerolineValidationCode=v.code;match.aerolineValidationDesc=v.description;
    if(!match.expiry){if(!(match.locked||match.manualOverride)){match.expiry=v.expiry;updated++}else kept++;match._updatedAt=new Date().toISOString();continue}
    if(match.expiry===v.expiry){match._updatedAt=new Date().toISOString();kept++;continue}
    if(match.locked){kept++;continue}
    const ok=confirm(`AeroLINE shows a different expiry date for ${v.code}.\n\nCurrent PilotLog expiry: ${displayDate(match.expiry)}\nNew AeroLINE expiry: ${displayDate(v.expiry)}\n\nDo you want to update it?`);
    if(ok){match.expiry=v.expiry;match._updatedAt=new Date().toISOString();updated++}else kept++;
  }
  const final=dedupeExpiryRecords(rows);save(EXPIRY_KEY,final.rows);return{added,updated,kept:kept+final.removed,emptySkipped,total:validations.length};
}
function parseAerolineRosterObject(payload){
  const root=aerolineRoot(payload);if(!root)throw new Error('This JSON does not contain an AeroLINE crew schedule.');
  const main=root.mainCrewScheduleInfoList||[];
  const flights=[],activities=[],daysOff=[],unsupported=[];
  const seenFlights=new Set(),seenEvents=new Set(),seenTraining=new Set();

  main.forEach(r=>{
    if(r?.flightNo&&r?.origin&&r?.destination){
      const dep=aerolineDateTime(r.flightDepTimeString),arr=aerolineDateTime(r.flightArrTimeString),key=aerolineFlightKey(r);
      if(dep.date&&!seenFlights.has(key)){
        seenFlights.add(key);
        const tm=aerolineTrainingForFlight(root,dep.date,r.flightNo),crew=aerolineOtherCrew(r,root),self=upper(aerolineSelfName(root));
        const alc=aerolineIsAlc(tm,r),lineTraining=aerolineIsLineTraining(tm,r),trainingLabel=aerolineTrainingLabel(tm,r),twoPilotCrew=crew.length===1;
        flights.push({
          aerolineKey:key,aerolineFlightLegId:String(r.flightLegId||''),aerolineBlockId:String(r.crewScheduleBlockId||''),
          date:dep.date,flightNo:rosterFlightLabel(r.flightNo),dep:upper(r.origin),arr:upper(r.destination),std:dep.time,sta:arr.time,
          type:upper(r.fleetType||''),reg:aerolineRegistration(r),status:'planned',source:'aeroline',aerolineRosterPlanned:true,
          aerolineArrivalDate:arr.date||dep.date,aerolineCrew:crew.map(upper),picName:twoPilotCrew?self:'',sicName:twoPilotCrew?upper(crew[0]||''):'',aerolineCrewAssignmentAmbiguous:crew.length>1,
          aerolineTrainingType:upper(tm?.trainingType||''),aerolineTrainingDesc:upper(tm?.trainingTypeDesc||''),aerolineTrainingLabel:trainingLabel,
          aerolineTrainerType:upper(tm?.trainerType||''),aerolineJoiningPilot:upper(tm?.joiningPilot||''),aerolineTrainerName:upper(tm?.trainerName||''),
          aerolineLineTraining:lineTraining,aerolineAlc:alc,instructorName:'',instructionType:lineTraining?'Flight Instruction':'',remarks:trainingLabel||''
        });
      }
    }

    let eventCode=upper(r?.eventCode||'');
    if(!eventCode&&upper(r?.airportStandby)==='Y')eventCode='STBY';
    if(eventCode){
      const key=aerolineEventKey(r,eventCode);
      if(!seenEvents.has(key)){
        seenEvents.add(key);
        const start=aerolineDateTime(eventCode==='OFF'?(r.leaveStartTimeString||r.eventStartTimeString):r.eventStartTimeString);
        const end=aerolineDateTime(eventCode==='OFF'?(r.leaveEndTimeString||r.eventEndTimeString):r.eventEndTimeString);
        if(eventCode==='OFF'){
          if(start.date)daysOff.push({aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),date:start.date,type:'Day OFF',report:'',end:'',minutes:0,notes:'AeroLINE • OFF',source:'aeroline',aerolineRosterPlanned:true});
        }else if(eventCode==='DHD'||eventCode==='DHP'||eventCode==='HSBY'||eventCode==='STBY'){
          if(start.date){const positioning=eventCode==='DHD'||eventCode==='DHP';activities.push({
            aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType:positioning?eventCode:'STBY',date:start.date,
            flightNo:'',dep:upper(r.eventStartLoc||''),arr:upper(r.eventEndLoc||''),type:upper(r.fleetType||''),reg:aerolineRegistration(r),
            schedOut:positioning?start.time:'',schedIn:positioning?end.time:'',schedBlock:positioning?timeSpanMins(start.time,end.time):0,
            onDuty:positioning?'':start.time,offDuty:positioning?'':end.time,
            out:'',off:'',on:'',in:'',block:0,flight:0,simulatorTime:0,credit:0,role:'PIC',instructionType:'',night:'00:00',sim:'no',ifr:'no',pf:'no',approachType:'',
            dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,courseType:'',remarks:`AeroLINE • ${eventCode}`,source:'aeroline',aerolineRosterPlanned:true,rosterHidden:false,locked:false
          })}
        }else unsupported.push(eventCode);
      }
    }

    if(r?.trainingProgramCode||r?.trainingSlotName){
      const key=aerolineTrainingKey(r);
      if(!seenTraining.has(key)){
        seenTraining.add(key);
        const start=aerolineDateTime(r.trainingStartTimeString),end=aerolineDateTime(r.trainingEndTimeString);
        if(start.date){
          const tm=aerolineTrainingForActivity(root,r,start),sim=aerolineIsSimulatorTraining(r,tm),dutyType=sim?'Simulator':'Ground Course',crew=aerolineTrainingCrewFields(root,tm,sim),trainerType=upper(tm?.trainerType||crew.trainerType||'');
          const fullName=upper(r.trainingSlotName||r.trainingProgramDesc||tm?.trainingTypeDesc||r.trainingProgramCode||'AEROLINE TRAINING');
          const desc=upper(r.trainingProgramDesc||tm?.trainingTypeDesc||'');
          activities.push({
            aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType,date:start.date,flightNo:'',location:upper(r.trainingLocation||tm?.trainLocOrFlight||''),dep:sim?'':upper(r.trainingLocation||tm?.trainLocOrFlight||''),arr:'',type:upper(r.fleetType||''),reg:aerolineRegistration(r),
            schedOut:'',schedIn:'',schedBlock:0,onDuty:sim?shiftTime(start.time,-90):start.time,offDuty:sim?shiftTime(end.time,30):end.time,out:sim?start.time:'',off:'',on:'',in:sim?end.time:'',block:0,flight:0,
            simulatorTime:sim?timeSpanMins(start.time,end.time):0,credit:creditMinsForEntry({dutyType,aerolineTrainerType:trainerType,source:'aeroline'}),
            role:'PIC',instructionType:sim&&crew.instructorName?'SFI/SFE Instruction Sim':'',night:'00:00',sim:sim?'yes':'no',ifr:'no',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,
            courseType:upper(r.trainingProgramCode||tm?.trainingType||r.trainingSlotName||''),remarks:desc&&desc!==fullName?`${fullName} • ${desc}`:fullName,source:'aeroline',aerolineRosterPlanned:true,rosterHidden:false,locked:false,
            picName:crew.picName,sicName:crew.sicName,soName:'',instructorName:crew.instructorName,aerolineTrainerType:trainerType,
            aerolineJoiningPilot:upper(tm?.joiningPilot||''),aerolineTrainerName:upper(tm?.trainerName||''),aerolineTrainingLabel:aerolineTrainingLabel(tm,r),aerolineTrainingSlotName:fullName
          });
        }
      }
    }
  });

  return{root,flights,activities,daysOff,validations:parseAerolineValidations(root),unsupported:[...new Set(unsupported)],start:String(root.schStartDate||'').slice(0,10),end:String(root.schEndDate||'').slice(0,10),monthLabel:aerolineMonthLabel(root)};
}
function aerolineWithinRange(date,start,end){return !!date&&(!start||date>=start)&&(!end||date<=end)}
function aerolineTimeDistance(a,b){const x=mins(a),y=mins(b);if(x==null||y==null)return 9999;const d=Math.abs(x-y);return Math.min(d,1440-d)}
function aerolineRosterMatch(rows,incoming){
  if(incoming.aerolineFlightLegId){const exact=rows.find(x=>String(x.aerolineFlightLegId||'')===incoming.aerolineFlightLegId);if(exact)return exact}
  const candidates=rows.filter(x=>x.date===incoming.date&&rosterFlightDigits(x.flightNo||'')===rosterFlightDigits(incoming.flightNo||'')&&upper(x.dep||'')===incoming.dep&&upper(x.arr||'')===incoming.arr);
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1)return [...candidates].sort((a,b)=>aerolineTimeDistance(a.std,incoming.std)-aerolineTimeDistance(b.std,incoming.std))[0];
  return null;
}
function aerolineActivityMatch(rows,incoming){
  const exact=rows.find(x=>x.aerolineKey&&x.aerolineKey===incoming.aerolineKey);if(exact)return exact;
  return rows.find(x=>rosterActivitySameIdentity(x,incoming))||null;
}
function aerolineThanksDates(root){
  const out=new Set();
  for(const m of (root?.memoListDTO||root?.memoList||[])){
    if(!/\bTHANKS?\b/i.test(String(m?.message||'')))continue;
    const d=normalDate(String(m?.memoDate||m?.memoDateString||'').slice(0,10));
    if(/^\d{4}-\d{2}-\d{2}$/.test(d))out.add(d);
    else{
      const x=aerolineDateTime(m?.memoDateString||'');if(x.date)out.add(x.date);
    }
  }
  return out;
}
function importAerolineRosterObject(payload){
  const parsed=parseAerolineRosterObject(payload),{start,end}=parsed;
  if(!aerolineConfirmCrewIdentity(parsed.root))throw new Error('AeroLINE import cancelled: crew identity not confirmed.');
  rememberAerolineIdentity(parsed.root);
  const expiryImport=importAerolineValidations(parsed.root);
  let activities=coreActivityRows();
  const priorOffDates=new Set(activities.filter(x=>x.aerolineRosterPlanned&&/^(DAY OFF|OFF)$/i.test(x.dutyType||'')).map(x=>x.date));
  const thanksDates=aerolineThanksDates(parsed.root);
  const incomingKeys=new Set();
  let flightsAdded=0,flightsUpdated=0,activitiesAdded=0,activitiesUpdated=0,offAdded=0,offUpdated=0,staleRemoved=0;

  parsed.flights.forEach(r=>{
    incomingKeys.add(r.aerolineKey);
    const hadPriorOff=priorOffDates.has(r.date),hasThanks=thanksDates.has(r.date);
    if(hasThanks){
      r.aerolinePossibleDayOffPaid=true;
      r.aerolineDayOffPaidSignal=hadPriorOff?'OFF replaced by flight + Thanks memo':'Thanks memo on flight day';
    }
    const stableId=makeActivityId(),candidate=normalizeCoreActivity({id:stableId,...r,dutyType:'Flight',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED},'roster');
    if(importSuppressedByDeletion('activities',candidate))return;
    const flightRows=activities.filter(isFlight).map(x=>({...x,std:x.schedOut||'',sta:x.schedIn||''})),match=aerolineRosterMatch(flightRows,r)||activities.find(x=>x.id===stableId);
    if(match){
      const i=activities.findIndex(x=>x.id===match.id),manual=!!match.manualOverride;
      activities[i]=normalizeCoreActivity(stamp(manual?{...candidate,...match,id:match.id,aerolineKey:r.aerolineKey,aerolineFlightLegId:r.aerolineFlightLegId,aerolineBlockId:r.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...candidate,id:match.id,activityStatus:match.activityStatus||ACTIVITY_STATUS.PLANNED}),'roster');
      flightsUpdated++;
    }else{activities.push(stamp(candidate));flightsAdded++}
  });

  parsed.activities.forEach(a=>{
    incomingKeys.add(a.aerolineKey);
    const stableId=makeActivityId(),candidate=normalizeCoreActivity({id:stableId,...a,activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED},'entries');
    if(importSuppressedByDeletion('activities',candidate))return;
    const match=aerolineActivityMatch(activities,a)||activities.find(x=>x.id===stableId);
    if(match){
      const i=activities.indexOf(match),manual=!!match.manualOverride,preserveGroundCredit=canonicalDutyType(match.dutyType||'')==='Ground Course'&&match.groundCreditExplicit===true;
      const incoming=preserveGroundCredit?{...a,credit:match.credit,groundCreditExplicit:true}:a;
      activities[i]=normalizeCoreActivity(stamp(manual?{...incoming,...match,id:match.id,aerolineKey:a.aerolineKey,aerolineBlockId:a.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...incoming,id:match.id,locked:!!match.locked,activityStatus:match.activityStatus||ACTIVITY_STATUS.PLANNED}),'entries');
      activitiesUpdated++;
    }else{activities.push(stamp(candidate));activitiesAdded++}
  });

  parsed.daysOff.forEach(d=>{
    incomingKeys.add(d.aerolineKey);
    const stableId=makeActivityId(),candidate=normalizeCoreActivity({id:stableId,...d,activityCategory:'DUTY',activityStatus:ACTIVITY_STATUS.PLANNED},'duties');
    if(importSuppressedByDeletion('activities',candidate))return;
    let match=activities.find(x=>x.aerolineKey===d.aerolineKey)||activities.find(x=>x.id===stableId)||activities.find(x=>x.date===d.date&&/^(DAY OFF|OFF)$/i.test(x.dutyType||''));
    if(match){
      const i=activities.indexOf(match),manual=!!match.manualOverride;
      activities[i]=normalizeCoreActivity(stamp(manual?{...candidate,...match,id:match.id,aerolineKey:d.aerolineKey,aerolineBlockId:d.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...candidate,id:match.id,activityStatus:match.activityStatus||ACTIVITY_STATUS.PLANNED}),'duties');offUpdated++;
    }else{activities.push(stamp(candidate));offAdded++}
  });

  // The JSON is a full-period roster. Remove only stale records that were themselves imported from AeroLINE.
  activities=activities.filter(x=>{
    if(!x.aerolineRosterPlanned||x.manualOverride||x.locked||!aerolineWithinRange(x.date,start,end))return true;
    const keep=incomingKeys.has(x.aerolineKey);if(!keep){if(x.id)markCloudDeleted('activities',x.id,{includeSource:false});staleRemoved++}return keep;
  });

  snapshotFlights('before-aeroline-import');
  commitCoreActivities(activities);
  cleanupRosterDuplicates();reconcileOperationalFlightIdentities();reconcileAllDuties();refreshEntrySuggestions();
  return{...parsed,flightsAdded,flightsUpdated,activitiesAdded,activitiesUpdated,offAdded,offUpdated,staleRemoved,expiryImport};
}
function aerolineImportStatusText(){
  const months=[];
  coreActivityRows().filter(x=>x.aerolineRosterPlanned&&x.date).forEach(x=>months.push(x.date.slice(0,7)));
  if(!months.length)return'Import the AeroLINE roster JSON. Re-importing the same month updates the existing roster instead of creating duplicates.';
  const latest=months.sort().pop(),d=new Date(`${latest}-01T00:00:00Z`);
  let label=latest;try{label=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}catch{}
  return`AeroLINE roster available through ${label}. Importing the same month performs an update, not a duplicate import.`;
}

function parseCsv(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&q&&n==='"'){cell+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());cell='';if(row.some(x=>x!==''))rows.push(row);row=[]}else cell+=c}row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);return rows}
function parseTab(text){return String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim()!=='').map(line=>line.split('\t'))}
function normalDate(v){v=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`}return v}
function logTenImport(text){
  const rows=parseTab(text);if(rows.length<2)throw new Error('No LogTen rows found.');const headers=rows[0].map(x=>String(x||'').trim()),ix={};headers.forEach((h,i)=>ix[h]=i);if(!('flight_flightDate'in ix))throw new Error('This does not look like a LogTen Export Flights (Tab) file.');const g=(r,k)=>ix[k]===undefined?'':String(r[ix[k]]||'').trim();
  let fs=entryActivityRows(),imported=0,updated=0,sims=0,other=0;rows.slice(1).forEach(r=>{const date=normalDate(g(r,'flight_flightDate'));if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    const category=upper(g(r,'aircraftType_selectedCategory')),
      remarks=g(r,'flight_remarks'),
      flightNoRaw=g(r,'flight_flightNumber'),
      logTenType=String(g(r,'flight_type')||'').trim(),
      simDur=durMins(g(r,'flight_simulator')),
      groundDur=durMins(g(r,'flight_ground')),
      transferText=[remarks,flightNoRaw,g(r,'flight_from'),g(r,'flight_to')].join(' ').toUpperCase(),
      isSimulator=logTenType==='3'||category==='SIMULATOR'||simDur>0,
      isGround=logTenType==='2'||(!isSimulator&&groundDur>0),
      isStandby=logTenType==='7',
      isTransferType=logTenType==='1',
      looksLikeTransfer=/\bDHD\b|\bDHP\b|DEADHEAD|\bTGV\b|\bRAM\b|PICK\s*UP|ROAD|TRANSFER|POSITIONING/.test(transferText),
      isDhpTransfer=isTransferType&&/\bDHP\b/.test(transferText),
      dutyType=isSimulator?'Simulator':isGround?'Ground Course':isStandby?'STBY':(isTransferType&&(looksLikeTransfer||!flightNoRaw))?(isDhpTransfer?'DHP':'DHD'):'Flight';
    const out=g(r,'flight_actualDepartureTime'),inn=g(r,'flight_actualArrivalTime'),off=g(r,'flight_takeoffTime'),on=g(r,'flight_landingTime'),schedOut=isSimulator?'':g(r,'flight_scheduledDepartureTime'),schedIn=isSimulator?'':g(r,'flight_scheduledArrivalTime'),schedBlock=timeSpanMins(schedOut,schedIn),total=durMins(g(r,'flight_totalTime')),block=dutyType==='Flight'?(total||timeSpanMins(out,inn)):0,dual=durMins(g(r,'flight_dualGiven')),dayLd=Number(g(r,'flight_dayLandings')||0),nightLd=Number(g(r,'flight_nightLandings')||0),dayTo=Number(g(r,'flight_dayTakeoffs')||0),nightTo=Number(g(r,'flight_nightTakeoffs')||0),onDuty=g(r,'flight_onDutyTime'),offDuty=g(r,'flight_offDutyTime');
    const f=stamp({dutyType,date,flightNo:dutyType==='Flight'?composeFlightNo(flightNoRaw):'',dep:upper(g(r,'flight_from')),arr:upper(g(r,'flight_to')),reg:upper(g(r,'aircraft_aircraftID')),type:upper(g(r,'aircraftType_type')),schedOut,schedIn,schedBlock,onDuty,offDuty,out:dutyType==='Flight'?out:'',off:dutyType==='Flight'?off:'',on:dutyType==='Flight'?on:'',in:dutyType==='Flight'?inn:'',block,flight:off&&on?timeSpanMins(off,on):0,simulatorTime:isSimulator?simDur:0,credit:creditMinsForEntry({dutyType,date,dep:upper(g(r,'flight_from')),schedOut,schedIn,schedBlock,credit:dutyType==='DHP'?durMins(g(r,'flight_credit')):0}),role:durMins(g(r,'flight_sic'))>0?'SIC':'PIC',instructionType:isSimulator&&dual>0?'SFI/SFE Instruction Sim':dutyType==='Flight'&&dual>0?'Flight Instruction':'',night:g(r,'flight_night')||'00:00',sim:isSimulator?'yes':'no',ifr:g(r,'flight_ifr')?'yes':'no',dayTakeoffs:dayTo,nightTakeoffs:nightTo,dayLandings:dayLd,nightLandings:nightLd,courseType:isGround?upper(remarks):'',remarks,picName:upper(g(r,'flight_selectedCrewPIC')||''),sicName:upper(g(r,'flight_selectedCrewSIC')||''),soName:upper(g(r,'flight_selectedCrewStudent')||''),instructorName:upper(g(r,'flight_selectedCrewInstructor')||''),pf:(dayTo+nightTo+dayLd+nightLd)>0?'yes':'no',approachType:upper(g(r,'flight_selectedApproach1')||''),source:'logten',sourceRowType:logTenType,sourceRowKey:[date,logTenType,flightNoRaw,g(r,'flight_from'),g(r,'flight_to'),g(r,'flight_scheduledDepartureTime'),g(r,'flight_scheduledArrivalTime'),onDuty,offDuty,remarks].map(x=>upper(x)).join('|')});
    if(importSuppressedByDeletion('activities',f))return;
    let match=-1;
    if(dutyType==='Flight'){
      // Prefer stable LogTen source identity when available.
      match=fs.findIndex(x=>x.source==='logten'&&x.sourceRowKey&&x.sourceRowKey===f.sourceRowKey);

      // Then match the same operational flight even if it came from another device/import.
      if(match<0){
        match=fs.findIndex(x=>exactOperationalMatch(x,f));
      }

      // Compatibility with old placeholder entries that have no flight number or times.
      // Merge only if exactly one such same-date/same-route candidate exists.
      if(match<0){
        const skeletalCandidates=fs
          .map((x,i)=>({x,i}))
          .filter(({x})=>
            isFlight(x)&&x.date===date&&
            upper(x.dep||'')===upper(f.dep||'')&&
            upper(x.arr||'')===upper(f.arr||'')&&
            !normalizedFlightDigits(x.flightNo)&&
            !x.schedOut&&!x.schedIn&&!x.out&&!x.off&&!x.on&&!x.in
          );
        if(skeletalCandidates.length===1)match=skeletalCandidates[0].i;
      }
    }else{
      // Re-import must repair a previously misclassified LogTen non-flight row.
      // First prefer the stable source-row key when available.
      match=fs.findIndex(x=>x.source==='logten'&&x.sourceRowKey&&x.sourceRowKey===f.sourceRowKey);

      // Compatibility with entries imported by older PilotLog versions, which did not store sourceRowKey.
      if(match<0){
        match=fs.findIndex(x=>
          x.source==='logten' &&
          x.date===date &&
          !upper(x.flightNo) &&
          upper(x.dep)===upper(f.dep) &&
          upper(x.arr)===upper(f.arr) &&
          String(x.schedOut||'')===String(f.schedOut||'') &&
          String(x.schedIn||'')===String(f.schedIn||'') &&
          String(x.onDuty||'')===String(f.onDuty||'') &&
          String(x.offDuty||'')===String(f.offDuty||'') &&
          upper(x.remarks||'')===upper(f.remarks||'')
        );
      }

      // Last fallback for completely blank LogTen rows such as STBY type 7:
      // same date + no flight/route/time data identifies the original row even if it was wrongly saved as Flight.
      if(match<0 && dutyType==='STBY' && !f.flightNo && !f.dep && !f.arr && !f.schedOut && !f.schedIn && !f.onDuty && !f.offDuty){
        match=fs.findIndex(x=>
          x.source==='logten' &&
          x.date===date &&
          !upper(x.flightNo) &&
          !upper(x.dep) &&
          !upper(x.arr) &&
          !x.schedOut && !x.schedIn && !x.onDuty && !x.offDuty
        );
      }
    }
    if(match>=0){
      f.id=fs[match].id;
      fs[match]=mergeDuplicateEntries(fs[match],f);
      updated++;
    }else{
      f.id=makeActivityId();
      fs.push(f);
      imported++;
    }
    if(isSimulator)sims++;
    if(!['Flight','Simulator'].includes(dutyType))other++;
  });

  const deduped=dedupeFlightEntriesSemantic(fs);
  if(deduped.removed){snapshotFlights('before-logten-dedupe');deduped.removedIds.forEach(id=>markCloudDeleted('activities',id,{includeSource:false}))}
  fs=deduped.entries;
  replaceActivitySelection(isEntryActivityRecord,fs);
  reconcileAllDuties();
  return{imported,updated,sims,other,duplicatesRemoved:deduped.removed}
}


/* Complete LogTen SQLite migration archive */
const LOGTEN_MIGRATION_MAGIC='PLGTN001';
const LOGTEN_ARCHIVE_DB='pilotlog7-logten-archive';
const LOGTEN_ARCHIVE_STORE='archives';

function logTenArchiveMeta(){return loadObject(LOGTEN_ARCHIVE_META_KEY,{})}
function logTenArchiveStatusText(){
  const m=logTenArchiveMeta();
  if(!m?.storedAt)return'No complete LogTen database archived yet.';
  const size=Number(m.sourceBytes||0)/(1024*1024),rows=Number(m.flightRows||0),tables=Number(m.sqliteTables||0);
  const span=m.dateFrom&&m.dateTo?` • ${displayDate(m.dateFrom)}–${displayDate(m.dateTo)}`:'';
  return`Full LogTen archive stored locally • ${rows.toLocaleString('en-US')} logbook rows${span}${tables?` • ${tables} tables`:''}${size?` • ${size.toFixed(1)} MB`:''}. Original SQLite bytes retained; not sent to cloud.`;
}
function openLogTenArchiveDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(LOGTEN_ARCHIVE_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(LOGTEN_ARCHIVE_STORE))db.createObjectStore(LOGTEN_ARCHIVE_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('LogTen archive database unavailable'));
  });
}
async function storeLogTenArchive(databaseBytes,manifest={},sourceFileName='LogTenCoreDataStore.sql'){
  const db=await openLogTenArchiveDb();
  const record={
    storedAt:new Date().toISOString(),
    sourceFileName:sourceFileName||manifest.sourceName||'LogTenCoreDataStore.sql',
    sourceBytes:Number(manifest.sourceBytes)||databaseBytes.byteLength||0,
    sourceSha256:String(manifest.sourceSha256||''),
    flightRows:Number(manifest.flightRows)||0,
    sqliteTables:Number(manifest.sqliteTables)||0,
    dateFrom:String(manifest.dateFrom||''),dateTo:String(manifest.dateTo||''),
    manifest,
    database:new Blob([databaseBytes],{type:'application/x-sqlite3'})
  };
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(LOGTEN_ARCHIVE_STORE,'readwrite');
      tx.objectStore(LOGTEN_ARCHIVE_STORE).put(record,'latest');
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('LogTen archive write aborted'));
    });
  }finally{db.close()}
  saveObject(LOGTEN_ARCHIVE_META_KEY,{
    storedAt:record.storedAt,sourceFileName:record.sourceFileName,sourceBytes:record.sourceBytes,sourceSha256:record.sourceSha256,
    flightRows:record.flightRows,sqliteTables:record.sqliteTables,dateFrom:record.dateFrom,dateTo:record.dateTo
  });
  return record;
}
async function getLogTenArchive(){
  const db=await openLogTenArchiveDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(LOGTEN_ARCHIVE_STORE,'readonly'),req=tx.objectStore(LOGTEN_ARCHIVE_STORE).get('latest');
      req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    });
  }finally{db.close()}
}
async function exportArchivedLogTenDatabase(){
  const r=await getLogTenArchive();
  if(!r?.database)return alert('No complete LogTen database is archived on this device.');
  const name=String(r.sourceFileName||'LogTenCoreDataStore.sql').replace(/[\\/:*?"<>|]+/g,'_')||'LogTenCoreDataStore.sql';
  download(name,r.database,'application/x-sqlite3');
}
function parseLogTenMigrationPackage(buffer){
  const u8=new Uint8Array(buffer);if(u8.byteLength<16)throw new Error('Migration file is too small.');
  const magic=new TextDecoder('ascii').decode(u8.subarray(0,8));
  if(magic!==LOGTEN_MIGRATION_MAGIC)throw new Error('This is not a PilotLog complete LogTen migration file.');
  const jsonLen=new DataView(buffer,8,4).getUint32(0,true),jsonStart=12,jsonEnd=jsonStart+jsonLen;
  if(jsonLen<20||jsonEnd>u8.byteLength)throw new Error('Migration package header is damaged.');
  let payload;try{payload=JSON.parse(new TextDecoder().decode(u8.subarray(jsonStart,jsonEnd)))}catch{throw new Error('Migration package metadata is not valid JSON.')} 
  if(payload?.schema!=='PilotLog LogTen Migration'||Number(payload?.formatVersion)!==1||!Array.isArray(payload?.entries))throw new Error('Unsupported LogTen migration format.');
  const database=u8.slice(jsonEnd);if(database.byteLength<100||new TextDecoder('ascii').decode(database.subarray(0,16))!=='SQLite format 3\u0000')throw new Error('The embedded original LogTen SQLite database is missing or damaged.');
  return{payload,database};
}
function logTenLegacyRowKey(e){
  return[e.date,e.logtenType,e.flightNo,e.dep,e.arr,e.schedOut,e.schedIn,e.onDuty,e.offDuty,e.remarks].map(x=>upper(x)).join('|');
}
function logTenMigrationEntry(raw){
  const {logtenPk,logtenType,...data}=raw||{};const uid=String(data.logtenUniqueId||'').trim();
  if(!uid)throw new Error('A LogTen row is missing its stable unique ID.');
  const f={...data};
  f.source='logten';f.logtenUniqueId=uid;f.id=makeActivityId();
  f.dutyType=canonicalDutyType(f.dutyType||'Flight');f.date=String(f.date||'').slice(0,10);
  if(isFlight(f))f.schedBlock=scheduleBlockMins(f);
  ['flightNo','dep','arr','reg','type','courseType','picName','sicName','soName','instructorName','approachType'].forEach(k=>{if(f[k]!=null)f[k]=upper(f[k])});
  if(Array.isArray(f.approaches))f.approaches=f.approaches.map(a=>({
    type:upper(a?.type||''),quantity:Math.max(1,Number(a?.quantity)||1),night:!!a?.night,simulated:!!a?.simulated,
    precision:a?.precision==null?null:!!a.precision,termination:Number(a?.termination)||0,place:upper(a?.place||''),comment:String(a?.comment||'')
  })).filter(a=>a.type);
  if(isSim(f)){
    f.sim='yes';
    if(!f.out&&f.schedOut)f.out=f.schedOut;
    if(!f.in&&f.schedIn)f.in=f.schedIn;
  }else delete f.sim;
  if(f.pf==='no')delete f.pf;
  if(!f.locked)delete f.locked;
  f._logtenImportType=Number(logtenType||0);f._logtenLegacyKey=logTenLegacyRowKey({...raw,logtenType:Number(logtenType||0)});
  return f;
}
function logTenMigrationFallbackMatch(existing,incoming){
  if(!existing||existing.date!==incoming.date)return false;
  if(existing.source==='logten'&&existing.sourceRowKey&&incoming._logtenLegacyKey&&existing.sourceRowKey===incoming._logtenLegacyKey)return true;
  if(exactOperationalMatch(existing,incoming))return true;
  if(existing.source!=='logten')return false;
  const legacyType=Number(existing.sourceRowType);
  if(Number.isFinite(legacyType)&&legacyType===incoming._logtenImportType){
    const ef=upper(existing.flightNo),inf=upper(incoming.flightNo),er=upper(existing.remarks),ir=upper(incoming.remarks);
    if(ef&&inf&&ef===inf)return true;
    if(er&&ir&&er===ir&&upper(existing.dep)===upper(incoming.dep)&&upper(existing.arr)===upper(incoming.arr))return true;
    if(isStby(incoming)&&!ef&&!inf&&!existing.dep&&!incoming.dep&&!existing.arr&&!incoming.arr&&!existing.schedOut&&!incoming.schedOut)return true;
  }
  return false;
}
function mergeLogTenMigration(existing,incoming){
  const protectedExisting=!!(existing.locked||existing.manualOverride||existing.source==='manual');
  let merged;
  if(protectedExisting){
    // Existing properties win even when the user intentionally saved them
    // empty. Incoming data may only fill fields the protected record never had.
    merged={...incoming,...existing};
  }else if(existing.source==='logten'){
    merged={...existing,...incoming};
  }else{
    merged=mergeDuplicateEntries(existing,incoming);
  }
  merged.id=existing.id||incoming.id;merged.logtenUniqueId=incoming.logtenUniqueId;
  if(existing.source!=='manual')merged.source='logten';
  if(existing.source==='logten'&&!protectedExisting)merged.dutyType=incoming.dutyType;
  if(isSim(merged)&&existing.source==='logten'&&!existing.manualOverride){
    if(!merged.out&&incoming.out)merged.out=incoming.out;
    if(!merged.in&&incoming.in)merged.in=incoming.in;
  }
  merged.locked=!!(existing.locked||incoming.locked);
  merged._updatedAt=new Date().toISOString();
  delete merged._logtenImportType;delete merged._logtenLegacyKey;
  return merged;
}

function mergeLogTenSupplementalRows(key,kind,rawRows){
  let rows=kind==='expiry'?dedupeExpiryRecords(load(key)).rows:load(key), now=new Date().toISOString();
  let imported=0,updated=0;
  for(const raw of (Array.isArray(rawRows)?rawRows:[])){
    const uid=String(raw?.logtenUniqueId||'').trim();if(!uid)continue;
    const stableId=stableSourceId(kind,`logten:${uid}`),incoming={...raw,id:stableId,source:'logten',logtenUniqueId:uid,_updatedAt:now};
    if(importSuppressedByDeletion(kind,incoming))continue;
    let idx=rows.findIndex(x=>String(x?.logtenUniqueId||'')===uid||x?.id===stableId);
    if(idx<0&&kind==='expiry'){const semantic=findExpirySemanticMatch(rows,incoming);if(semantic)idx=rows.indexOf(semantic)}
    if(idx>=0){
      const existing=rows[idx],protectedExisting=!!(existing?.locked||existing?.manualOverride||existing?.source==='manual');
      if(protectedExisting){const preserved={...incoming,...existing};preserved.id=existing.id||stableId;preserved.logtenUniqueId=uid;preserved.source=existing.source||'manual';preserved.manualOverride=!!existing.manualOverride;preserved.locked=!!existing.locked;preserved._updatedAt=now;rows[idx]=preserved}
      else if(kind==='expiry'&&existing.source==='aeroline'){rows[idx]={...incoming,...existing,id:existing.id||stableId,logtenUniqueId:uid,_updatedAt:now}}
      else rows[idx]={...existing,...incoming,id:existing.id||stableId};
      updated++;
    }else{rows.push(incoming);imported++}
  }
  if(kind==='expiry')rows=dedupeExpiryRecords(rows).rows;
  save(key,rows);return{imported,updated,total:Array.isArray(rawRows)?rawRows.length:0};
}

async function importLogTenMigrationPackage(file){
  setImportProgress(2,'Reading complete LogTen migration package…');await yieldToUi();
  const parsed=parseLogTenMigrationPackage(await file.arrayBuffer()),manifest=parsed.payload.manifest||{},rawEntries=parsed.payload.entries;
  setImportProgress(5,`Package read • ${rawEntries.length.toLocaleString('en-US')} logbook rows found`);await yieldToUi();
  if(manifest.creditHoursOnlyPatch===true){
    throw new Error('Credit-Hours-only LogTen patches are not used in v8.6. Flight Credit H is calculated automatically from Scheduled Block Hours.');
  }
  setImportProgress(6,'Migration package read • archiving original LogTen database…');
  await yieldToUi();
  await storeLogTenArchive(parsed.database,manifest,manifest.sourceName||'LogTenCoreDataStore.sql');
  setImportProgress(10,'Original LogTen database archived • preparing logbook rows…');await yieldToUi();
  snapshotFlights('before-logten-complete-import');
  let fs=entryActivityRows(),imported=0,updated=0,protectedMerged=0;
  const uidIndex=new Map(),dateIndex=new Map();
  fs.forEach((x,i)=>{
    if(x?.logtenUniqueId)uidIndex.set(String(x.logtenUniqueId),i);
    const d=String(x?.date||'');if(d){if(!dateIndex.has(d))dateIndex.set(d,[]);dateIndex.get(d).push(i)}
  });
  for(let importIndex=0;importIndex<rawEntries.length;importIndex++){
    const raw=rawEntries[importIndex];
    if(importIndex===0||importIndex%100===0){const pct=10+Math.round((importIndex/Math.max(1,rawEntries.length))*70);setImportProgress(pct,`Processing LogTen rows • ${importIndex.toLocaleString('en-US')} / ${rawEntries.length.toLocaleString('en-US')}`);await yieldToUi()}
    const incoming=logTenMigrationEntry(raw);if(!/^\d{4}-\d{2}-\d{2}$/.test(incoming.date))continue;
    if(importSuppressedByDeletion('activities',incoming))continue;
    let idx=uidIndex.has(incoming.logtenUniqueId)?uidIndex.get(incoming.logtenUniqueId):-1;
    if(idx<0){
      const candidates=dateIndex.get(incoming.date)||[];
      idx=candidates.find(i=>logTenMigrationFallbackMatch(fs[i],incoming));
    }
    if(idx>=0){
      const wasProtected=!!(fs[idx].locked||fs[idx].manualOverride||fs[idx].source==='manual');
      fs[idx]=mergeLogTenMigration(fs[idx],incoming);if(wasProtected)protectedMerged++;updated++;
      uidIndex.set(incoming.logtenUniqueId,idx);
    }else{
      delete incoming._logtenImportType;delete incoming._logtenLegacyKey;
      incoming._updatedAt=new Date().toISOString();
      idx=fs.length;fs.push(incoming);uidIndex.set(incoming.logtenUniqueId,idx);imported++;
    }
  }
  setImportProgress(82,`Writing ${fs.length.toLocaleString('en-US')} normalized entries to PilotLog…`);await yieldToUi();
  try{await replaceEntryActivitiesDurable(fs)}catch(err){
    const mb=(JSON.stringify(fs).length/(1024*1024)).toFixed(1);
    throw new Error(`The original LogTen database was archived safely, but the ${mb} MB normalized logbook could not be written to IndexedDB (${err?.name||'storage error'}).`);
  }
  setImportProgress(88,'Importing licences, validities and trips…');await yieldToUi();
  const expiryImport=mergeLogTenSupplementalRows(EXPIRY_KEY,'expiry',parsed.payload.expiry);
  const tripImport=mergeLogTenSupplementalRows(TRIPS_KEY,'trips',parsed.payload.trips);
  reconcileAllDuties();await flushFlightStore();
  setImportProgress(94,'Verifying imported LogTen identities…');await yieldToUi();
  const persisted=entryActivityRows(),wanted=new Set(rawEntries.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean)),present=new Set(persisted.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean));
  const missing=[...wanted].filter(x=>!present.has(x));if(missing.length)throw new Error(`Local LogTen verification failed: ${missing.length} source rows are missing after import. Nothing has been sent to cloud.`);
  // Complete migration packages already carry stable LogTen identities. Avoid an O(n²)
  // semantic duplicate pass immediately after a 7k+ row import; it can stall mobile browsers.
  localStorage.setItem('pilotlog7_dedupe_semantic_v1','1');
  refreshEntrySuggestions();renderExpiry();renderTrips();setImportProgress(98,'Import verified • rebuilding PilotLog views…');await yieldToUi();
  return{imported,updated,protectedMerged,total:rawEntries.length,manifest,archiveStored:true,expiryImport,tripImport,verified:wanted.size,localTotal:persisted.length};
}
/* Export */



const EASA_ROWS_PER_PAGE=8;

function euDate(v){
  const s=String(v||'').slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:s;
}
function blankIfZero(v){const n=Number(v)||0;return n>0?fmt(n):''}
function blankCount(v){const n=Number(v)||0;return n>0?String(n):''}
function experienceFlights(){
  return coreActivityRows().filter(f=>isFlight(f)&&f.activityStatus===ACTIVITY_STATUS.COMPLETED).sort((a,b)=>`${a.date||''}${a.off||a.out||a.schedOut||''}`.localeCompare(`${b.date||''}${b.off||b.out||b.schedOut||''}`));
}
function experienceSims(){
  return coreActivityRows().filter(f=>isSim(f)&&f.activityStatus===ACTIVITY_STATUS.COMPLETED&&simulatorCompleted(f)).sort((a,b)=>`${a.date||''}${a.onDuty||''}`.localeCompare(`${b.date||''}${b.onDuty||''}`));
}
function experienceRows(){
  const includeSim=($('easaIncludeSim')?.value||'yes')==='yes';
  return [
    ...experienceFlights().map(f=>({...f,_experienceKind:'flight'})),
    ...(includeSim?experienceSims().map(f=>({...f,_experienceKind:'sim'})):[])
  ].sort((a,b)=>{
    const ta=a._experienceKind==='flight'?(a.off||a.out||a.schedOut||'00:00'):(a.onDuty||'00:00');
    const tb=b._experienceKind==='flight'?(b.off||b.out||b.schedOut||'00:00'):(b.onDuty||'00:00');
    return `${a.date||''}${ta}`.localeCompare(`${b.date||''}${tb}`);
  });
}
function expTotals(list){
  const flights=list.filter(x=>x._experienceKind!=='sim'&&isFlight(x));
  const sims=list.filter(x=>x._experienceKind==='sim'||isSim(x));
  return{
    total:sum(flights,totalFlightMins),pic:sum(flights,picMins),sic:sum(flights,sicMins),
    instr:sum(flights,flightInstrMins),night:sum(flights,f=>durMins(f.night)),
    ifr:sum(flights,f=>String(f.ifr||'').toLowerCase()==='yes'?totalFlightMins(f):0),
    ldDay:sum(flights,f=>Number(f.dayLandings)||0),ldNight:sum(flights,f=>Number(f.nightLandings)||0),
    sim:sum(sims,f=>Number(f.simulatorTime)||0),simInstr:sum(sims,simInstrMins)
  };
}
function plusTotals(a,b){const o={};Object.keys(a).forEach(k=>o[k]=(Number(a[k])||0)+(Number(b[k])||0));return o}
function selectedExperiencePageRange(){
  const all=experienceRows(),mode=$('easaExportMode')?.value||'last2';
  if(mode==='period'){
    const from=$('easaFrom')?.value||'',to=$('easaTo')?.value||'';
    return{all,selected:all.filter(f=>(!from||f.date>=from)&&(!to||f.date<=to)),firstPage:null,lastPages:false};
  }
  if(mode==='all')return{all,selected:all,firstPage:0,lastPages:false};
  const n=Number(mode.replace('last',''))||2,totalPages=Math.max(1,Math.ceil(all.length/EASA_ROWS_PER_PAGE)),firstPage=Math.max(0,totalPages-n);
  return{all,selected:all.slice(firstPage*EASA_ROWS_PER_PAGE),firstPage,lastPages:true};
}

/* Minimal PDF writer: produces a real fixed-size A4 PDF, so Safari print scaling
   no longer changes the logbook geometry. */
function pdfEsc(v){
  return String(v??'')
    .replace(/[^\x20-\x7E]/g,c=>({'à':'a','è':'e','é':'e','ì':'i','ò':'o','ù':'u','À':'A','È':'E','É':'E','Ì':'I','Ò':'O','Ù':'U','°':' deg '}[c]||'?'))
    .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function pdfText(x,y,size,text,align='left',width=0,bold=false){
  const s=pdfEsc(text);
  let tx=x;
  if(align!=='left'&&width){
    const approx=s.length*size*0.49;
    if(align==='center')tx=x+(width-approx)/2;
    if(align==='right')tx=x+width-approx-2;
  }
  return `BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${s}) Tj ET\n`;
}
function pdfLine(x1,y1,x2,y2,w=.35){return `${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`}
function pdfRect(x,y,w,h,line=.35){return `${line} w ${x} ${y} ${w} ${h} re S\n`}
function pdfCellText(x,y,w,h,text,size=6,align='center',bold=false){
  const val=String(text||'');
  if(!val)return'';
  const max=Math.max(2,Math.floor(w/(size*.52)));
  const clipped=val.length>max?val.slice(0,Math.max(1,max-1))+'…':val;
  return pdfText(x+1.5,y+h/2-size*.32,size,clipped,align,w-3,bold);
}
function pdfTable(content,x,top,widths,headers,rows,rowH,headerH){
  const totalW=widths.reduce((a,b)=>a+b,0);
  let y=top-headerH;
  content.push(pdfRect(x,y,totalW,headerH));
  let cx=x;
  headers.forEach((h,i)=>{
    if(i)content.push(pdfLine(cx,y,cx,y+headerH));
    content.push(pdfCellText(cx,y,widths[i],headerH,h,5.7,'center',true));
    cx+=widths[i];
  });
  rows.forEach(row=>{
    y-=rowH;
    content.push(pdfRect(x,y,totalW,rowH));
    cx=x;
    row.forEach((v,i)=>{
      if(i)content.push(pdfLine(cx,y,cx,y+rowH));
      const align=i===row.length-1?'left':'center';
      content.push(pdfCellText(cx,y,widths[i],rowH,v,6.2,align,false));
      cx+=widths[i];
    });
  });
  return y;
}
function pdfTotalsRows(t){
  return {
    primary:[blankIfZero(t.total),blankCount(t.ldDay),blankCount(t.ldNight)],
    secondary:[blankIfZero(t.night),blankIfZero(t.ifr),blankIfZero(t.pic),blankIfZero(t.sic),blankIfZero(t.sim),blankIfZero(t.instr+t.simInstr)]
  };
}
function buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo){
  const c=[];
  const W=595.28,H=841.89,margin=24,usable=W-margin*2;
  c.push(pdfText(margin,H-26,12,'PILOT LOGBOOK','left',0,true));
  c.push(pdfText(margin,H-39,7,'EASA-style professional experience record'));
  c.push(pdfText(W-margin-45,H-28,7,`Page ${pageNo}`,'right',45,true));

  const pWidths=[22,48,34,33,34,33,55,45,62,48,47,47];
  const pScale=usable/pWidths.reduce((a,b)=>a+b,0);
  const pw=pWidths.map(v=>v*pScale);
  const pHeaders=['#','DATE','DEP','TIME','ARR','TIME','A/C TYPE','REG.','NAME(S) PIC','TOTAL','LDG D','LDG N'];
  const pRows=rows.map((f,i)=>{
    const sim=f._experienceKind==='sim'||isSim(f);
    if(sim)return [i+1,euDate(f.date),'FSTD','','','',''+(f.type||'A320'),'','','','',''];
    return [i+1,euDate(f.date),f.dep||'',f.off||f.out||'',f.arr||'',f.on||f.in||'',f.type||'',f.reg||'',f.picName||'',blankIfZero(totalFlightMins(f)),blankCount(f.dayLandings),blankCount(f.nightLandings)];
  });
  while(pRows.length<EASA_ROWS_PER_PAGE)pRows.push(Array(12).fill(''));

  let y=pdfTable(c,margin,H-58,pw,pHeaders,pRows,23,21);

  const pt=pdfTotalsRows(pageTotal),pr=pdfTotalsRows(prior),td=pdfTotalsRows(toDate);
  const pTotalRows=[
    ['', '', '', '', '', '', '', '', 'TOTAL FROM THIS PAGE',pt.primary[0],pt.primary[1],pt.primary[2]],
    ['', '', '', '', '', '', '', '', 'TOTAL FROM PREVIOUS PAGES',pr.primary[0],pr.primary[1],pr.primary[2]],
    ['', '', '', '', '', '', '', '', 'TOTAL TO DATE',td.primary[0],td.primary[1],td.primary[2]]
  ];
  y=pdfTable(c,margin,y,pw,Array(12).fill(''),pTotalRows,17,0);

  const sWidths=[22,44,44,42,48,60,65,55,55,112];
  const sScale=usable/sWidths.reduce((a,b)=>a+b,0);
  const sw=sWidths.map(v=>v*sScale);
  const sHeaders=['#','NIGHT','IFR','PIC','CO-PILOT','FSTD DATE','FSTD TYPE','FSTD TIME','FI / SFI','REMARKS / ENDORSEMENTS'];
  const sRows=rows.map((f,i)=>{
    const sim=f._experienceKind==='sim'||isSim(f);
    if(sim)return [i+1,'','','','',euDate(f.date),f.type||'A320 SIM',blankIfZero(Number(f.simulatorTime)||0),blankIfZero(simInstrMins(f)),f.remarks||''];
    const total=totalFlightMins(f);
    const crew=[f.sicName?`SIC: ${f.sicName}`:'',f.soName?`SO: ${f.soName}`:'',f.instructorName?`INSTR/EXAM: ${f.instructorName}`:''].filter(Boolean).join(' • ');
    const remarks=[crew,f.remarks||''].filter(Boolean).join(' | ');
    return [i+1,blankIfZero(durMins(f.night)),String(f.ifr||'').toLowerCase()==='yes'?blankIfZero(total):'',blankIfZero(picMins(f)),blankIfZero(sicMins(f)),'','','',blankIfZero(flightInstrMins(f)),remarks];
  });
  while(sRows.length<EASA_ROWS_PER_PAGE)sRows.push(Array(10).fill(''));

  const secondTop=y-24;
  y=pdfTable(c,margin,secondTop,sw,sHeaders,sRows,23,21);

  const sTotalRows=[
    ['',pt.secondary[0],pt.secondary[1],pt.secondary[2],pt.secondary[3],'','',pt.secondary[4],pt.secondary[5],'TOTAL FROM THIS PAGE'],
    ['',pr.secondary[0],pr.secondary[1],pr.secondary[2],pr.secondary[3],'','',pr.secondary[4],pr.secondary[5],'TOTAL FROM PREVIOUS PAGES'],
    ['',td.secondary[0],td.secondary[1],td.secondary[2],td.secondary[3],'','',td.secondary[4],td.secondary[5],'TOTAL TO DATE']
  ];
  y=pdfTable(c,margin,y,sw,Array(10).fill(''),sTotalRows,17,0);

  c.push(pdfText(margin,18,5.8,'I certify that the entries on this page are true and correct.'));
  c.push(pdfText(W-margin-190,18,5.8,"PILOT'S SIGNATURE __________________________"));
  return c.join('');
}
function makePdfDocument(pageStreams){
  const objects=[];
  const add=o=>{objects.push(o);return objects.length};
  const catalog=add('');
  const pagesObj=add('');
  const font1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageRefs=[];
  for(const stream of pageStreams){
    const content=add(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`);
    const page=add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${content} 0 R >>`);
    pageRefs.push(page);
  }
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj-1]=`<< /Type /Pages /Kids [${pageRefs.map(n=>`${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=new TextEncoder().encode(pdf).length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([new TextEncoder().encode(pdf)],{type:'application/pdf'});
}
function exportEasaStylePdf(){
  const {all,selected,firstPage,lastPages}=selectedExperiencePageRange();
  if(!selected.length)return alert('No professional experience matches this selection.');
  const chunks=[];for(let i=0;i<selected.length;i+=EASA_ROWS_PER_PAGE)chunks.push(selected.slice(i,i+EASA_ROWS_PER_PAGE));
  const streams=chunks.map((rows,pageIndex)=>{
    let prior,pageNo;
    if(lastPages){
      const absolutePage=(firstPage||0)+pageIndex;
      prior=expTotals(all.slice(0,absolutePage*EASA_ROWS_PER_PAGE));
      pageNo=absolutePage+1;
    }else{
      const idx=all.findIndex(x=>x.id===rows[0]?.id&&x._experienceKind===rows[0]?._experienceKind);
      prior=expTotals(idx>0?all.slice(0,idx):[]);
      pageNo=idx>=0?Math.floor(idx/EASA_ROWS_PER_PAGE)+1:pageIndex+1;
    }
    const pageTotal=expTotals(rows),toDate=plusTotals(prior,pageTotal);
    return buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo);
  });
  const blob=makePdfDocument(streams);
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.target='_blank';a.rel='noopener';a.download=`PilotLog_EASA_${today()}.pdf`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function exportExperienceCsv(){
  const d=coreActivityRows().filter(isCompletedLogbookEntry);if(!d.length)return alert('No professional experience to export');
  const cols=['dutyType','date','flightNo','reg','type','location','dep','arr','off','on','block','role','seatPosition','callFromDayOff','picName','sicName','soName','instructorName','instructionType','night','ifr','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','simulatorTime','approachType','remarks'];
  download('pilotlog_professional_experience.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')
}
function exportFullBackupJson(){
  const payload={schema:'PilotLog Backup',version:VERSION,architecture:'single-authoritative-database',exportedAt:new Date().toISOString(),database:normalizeOperationalDatabase(operationalDatabase)};
  download(`pilotlog_backup_${today()}.json`,JSON.stringify(payload,null,2),'application/json')
}
function validateFullBackupPayload(payload){
  if(!payload||typeof payload!=='object'||payload.schema!=='PilotLog Backup')throw new Error('This is not a PilotLog Full Backup JSON.');
  if(payload.database!=null&&!isOperationalDatabase(payload.database))throw new Error('Invalid authoritative database section.');
  if(!payload.database)for(const k of ['flights','roster','duties','trips','expiry','syncLedger'])if(payload[k]!=null&&!Array.isArray(payload[k]))throw new Error(`Invalid backup section: ${k}.`);
  const database=migrateSnapshotToOperationalDatabase(payload),counts=operationalDatabaseCounts(database);
  return{database,...counts};
}
async function restoreFullBackupJsonFile(file){
  const text=await file.text();let payload;try{payload=JSON.parse(String(text||'').replace(/^\uFEFF/,''))}catch{throw new Error('The selected JSON file cannot be read.')}
  const counts=validateFullBackupPayload(payload);
  const ok=confirm(`Restore this PilotLog backup?\n\nVersion: ${payload.version||'unknown'}\nExported: ${payload.exportedAt?displayDateTime(payload.exportedAt):'unknown'}\nUnique operational activities: ${counts.activities}\nLogbook / entry view: ${counts.entries}\nRoster view: ${counts.roster}\nDuty view: ${counts.duties}\nTrips: ${counts.trips}\nExpiry: ${counts.expiry}\n\nCurrent local PilotLog data on this device will be replaced. Nothing will be uploaded automatically.`);
  if(!ok)return false;
  await replaceOperationalDatabase(counts.database);
  reconcileOperationalFlightIdentities();await flushFlightStore();reconcileAllDuties();markLocalOnlyImport(`Full backup restored locally — ${counts.activities} unique activities`);await render();await renderRoster();renderDuty();renderTrips();renderPayroll();renderSettings();resetEntry(false);restoreEntryDraft();
  alert(`Full Backup restored locally.\n\n${counts.activities} unique activities • ${counts.roster} roster • ${counts.trips} trips • ${counts.expiry} expiry records.\n\nAuto Sync is OFF. Review this device before pressing Sync now.`);return true;
}


let screenshotReviewRows=[];
let screenshotObjectUrl='';
let screenshotOcrLayout=null;
let screenshotSmartCells=[];

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

const OCR_MONTHS={
  JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,
  JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,
  OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12
};
const OCR_DAY_NAMES=new Set(['MON','MONDAY','TUE','TUES','TUESDAY','WED','WEDNESDAY','THU','THUR','THURS','THURSDAY','FRI','FRIDAY','SAT','SATURDAY','SUN','SUNDAY']);

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

function parseScreenshotText(text){
  const source=$('screenshotSource')?.value||'auto';
  const defaultTarget=$('screenshotTarget')?.value||'auto';
  const isCrewGrid=/INDIVIDUAL\s+CREW\s+SCHEDULE\s+REPORT/i.test(String(text||''));
  if(screenshotSmartCells.length&&(source==='roster'||isCrewGrid)){
    const smartRows=parseSmartCrewScheduleCells(screenshotSmartCells);
    if(smartRows.length)return smartRows;
  }
  if(screenshotOcrLayout&&(source==='roster'||isCrewGrid)){
    const gridRows=parseCrewScheduleGrid(screenshotOcrLayout,text);
    if(gridRows.length)return gridRows;
    const fallbackRows=crewScheduleUnparsedRows(screenshotOcrLayout,text);
    if(fallbackRows.length)return fallbackRows;
  }
  const cleaned=String(text||'')
    .replace(/[—–]/g,'-')
    .replace(/[|]/g,' ')
    .replace(/\r/g,'')
    .split('\n')
    .map(x=>x.replace(/\s+/g,' ').trim())
    .filter(Boolean);

  if(!cleaned.length)return[];

  // Split OCR into date-based blocks. This works well for roster cards and LogTen list screenshots.
  const blocks=[];
  let cur=null;
  for(const line of cleaned){
    const dates=ocrDateMatches(line);
    if(dates.length){
      if(cur)blocks.push(cur);
      cur={date:normalizeScreenshotDate(dates[0]),lines:[line]};
    }else if(cur){
      cur.lines.push(line);
    }else{
      cur={date:'',lines:[line]};
    }
  }
  if(cur)blocks.push(cur);

  const home=upper(appSettings().homeBase||'CMN');
  const rows=[];

  for(const block of blocks){
    const blob=block.lines.join(' ');
    const dutyType=classifyScreenshotDuty(blob);
    const flights=screenshotFlightNumbers(blob);
    const routes=screenshotRoutes(blob);
    const times=screenshotTimes(blob);
    const airports=screenshotAirports(blob);
    const autoRoster=source==='roster'||(/\bROSTER\b/i.test(text))||(/\b\d+\s*FLIGHTS?\b/i.test(blob));
    const target=defaultTarget==='auto'?(autoRoster?'roster':'entries'):defaultTarget;

    // For roster duty cards, the visible start/end is often the duty window, not sector times.
    // Preserve it as an internal Duty row and keep sector times blank unless they are clearly sector-level.
    const dutyCount=(blob.match(/\b(\d+)\s*FLIGHTS?\b/i)||[])[1];
    const isRosterDutyBlock=target==='roster' && (Number(dutyCount)>1 || flights.length>1);

    if(isRosterDutyBlock && block.date){
      rows.push(makeScreenshotRow({
        target:'duty',date:block.date,dutyType:'Duty',
        start:times[0]||'',end:times[1]||'',
        remarks:'Imported from screenshot roster'
      }));
    }

    if(dutyType!=='Flight' && dutyType!=='Duty' && !flights.length){
      const route=routes[0]||[];
      rows.push(makeScreenshotRow({
        target:target==='roster'?'entries':target,
        date:block.date,dutyType,
        dep:route[0]||airports[0]||'',
        arr:route[1]||'',
        start:times[0]||'',end:times[1]||'',
        remarks:blob.slice(0,140)
      }));
      continue;
    }

    if(flights.length){
      for(let i=0;i<flights.length;i++){
        let dep='',arr='';
        if(routes[i]){dep=routes[i][0];arr=routes[i][1]}
        else if(routes.length===1 && flights.length===2){
          if(i===0){dep=routes[0][0];arr=routes[0][1]}
          else{dep=routes[0][1];arr=routes[0][0]}
        }else if(routes.length===1){
          dep=routes[0][0];arr=routes[0][1]
        }else if(airports.length>=2){
          dep=airports[Math.min(i,airports.length-2)]||airports[0];
          arr=airports[Math.min(i+1,airports.length-1)]||airports[1];
        }

        rows.push(makeScreenshotRow({
          target,
          date:block.date,
          dutyType:'Flight',
          flightNo:flights[i],
          dep,arr,
          start:isRosterDutyBlock?'':(times[i*2]||times[0]||''),
          end:isRosterDutyBlock?'':(times[i*2+1]||times[1]||''),
          remarks:'Imported from screenshot'
        }));
      }
      continue;
    }

    if(routes.length){
      for(let i=0;i<routes.length;i++){
        rows.push(makeScreenshotRow({
          target,date:block.date,dutyType:'Flight',
          dep:routes[i][0],arr:routes[i][1],
          start:times[i*2]||'',end:times[i*2+1]||'',
          remarks:'Imported from screenshot'
        }));
      }
      continue;
    }

    // Last-resort editable row. Nothing is imported until the user reviews it.
    if(block.date || dutyType!=='Flight' || blob.trim()){
      const safeType=(dutyType==='Flight'&&!flights.length&&!routes.length)?'To complete':dutyType;
      rows.push(makeScreenshotRow({
        target:target==='roster'?'entries':target,
        date:block.date,dutyType:safeType,
        dep:airports[0]||'',arr:airports[1]||'',
        start:times[0]||'',end:times[1]||'',
        remarks:blob.slice(0,220),rawText:blob.slice(0,220),
        parserNote:safeType==='To complete'?'Unrecognized OCR block.':''
      }));
    }
  }

  // Remove exact duplicate review rows.
  const seen=new Set();
  return rows.filter(r=>{
    const k=[r.target,r.date,r.dutyType,r.flightNo,r.dep,r.arr,r.start,r.end].join('|');
    if(seen.has(k))return false;
    seen.add(k);return true;
  });
}
function renderScreenshotReview(){
  const wrap=$('screenshotReviewWrap'),body=$('screenshotReviewBody'),summary=$('screenshotReviewSummary');
  if(!screenshotReviewRows.length){
    wrap.classList.add('hidden');body.innerHTML='';if(summary)summary.textContent='';return;
  }

  screenshotReviewRows.forEach(r=>r.needsReview=!screenshotRowReady(r));
  const stat=screenshotReviewSummaryData();
  if(summary){
    summary.className=`screenshot-review-summary ${stat.incomplete?'has-incomplete':'all-ready'}`;
    summary.textContent=stat.incomplete
      ?`${stat.ready} ready • ${stat.incomplete} row${stat.incomplete===1?'':'s'} to complete`
      :`${stat.ready} ready to import`;
  }

  const missingClass=(r,field)=>screenshotMissingFields(r).includes(field)?'shot-missing':'';
  const label={dutyType:'Type',flightNo:'Flight',dep:'From',arr:'To',start:'Start',end:'End',date:'Date'};

  body.innerHTML=screenshotReviewRows.map((r,i)=>{
    const missing=screenshotMissingFields(r);
    const status=missing.length?`Complete: ${missing.map(x=>label[x]||x).join(', ')}`:'Ready';
    return `<tr data-shot-review-row="${i}" class="${missing.length?'shot-needs-review':'shot-ready'}">
      <td><input type="checkbox" data-shot-row="${i}" data-shot-field="include" ${r.include?'checked':''}></td>
      <td><select data-shot-row="${i}" data-shot-field="target">
        <option value="entries" ${r.target==='entries'?'selected':''}>Entries</option>
        <option value="roster" ${r.target==='roster'?'selected':''}>Roster</option>
        <option value="duty" ${r.target==='duty'?'selected':''}>Duty</option>
      </select></td>
      <td class="${missingClass(r,'date')}"><input type="date" data-shot-row="${i}" data-shot-field="date" value="${esc(r.date)}"></td>
      <td class="${missingClass(r,'dutyType')}"><select data-shot-row="${i}" data-shot-field="dutyType">
        ${['To complete','Flight','DHD','DHP','STBY','Ground Course','Simulator','Day OFF','Duty'].map(x=>`<option ${r.dutyType===x?'selected':''}>${x}</option>`).join('')}
      </select></td>
      <td class="${missingClass(r,'flightNo')}"><input data-upper data-shot-row="${i}" data-shot-field="flightNo" value="${esc(r.flightNo)}"></td>
      <td class="${missingClass(r,'dep')}"><input data-upper maxlength="4" data-shot-row="${i}" data-shot-field="dep" value="${esc(r.dep)}"></td>
      <td class="${missingClass(r,'arr')}"><input data-upper maxlength="4" data-shot-row="${i}" data-shot-field="arr" value="${esc(r.arr)}"></td>
      <td class="${missingClass(r,'start')}"><input type="time" data-shot-row="${i}" data-shot-field="start" value="${esc(r.start)}"></td>
      <td class="${missingClass(r,'end')}"><input type="time" data-shot-row="${i}" data-shot-field="end" value="${esc(r.end)}"></td>
      <td><input data-shot-row="${i}" data-shot-field="remarks" value="${esc(r.remarks)}"><div class="shot-row-status">${esc(status)}${r.parserNote?` • ${esc(r.parserNote)}`:''}</div></td>
    </tr>`;
  }).join('');
  wrap.classList.remove('hidden');
}
function updateScreenshotReviewFromControl(el){
  const i=Number(el.dataset.shotRow),field=el.dataset.shotField;
  if(!Number.isInteger(i)||!screenshotReviewRows[i]||!field)return;
  screenshotReviewRows[i][field]=field==='include'?!!el.checked:(field==='dep'||field==='arr'||field==='flightNo'?upper(el.value):el.value);
  screenshotReviewRows[i].needsReview=!screenshotRowReady(screenshotReviewRows[i]);
}
function clearScreenshotReview(){
  screenshotReviewRows=[];
  screenshotOcrLayout=null;
  screenshotSmartCells=[];
  $('screenshotReviewBody').innerHTML='';
  $('screenshotReviewWrap').classList.add('hidden');
}
async function loadTesseractBrowser(){
  if(window.Tesseract)return window.Tesseract;
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-pilotlog-tesseract]');
    if(existing){
      existing.addEventListener('load',resolve,{once:true});
      existing.addEventListener('error',()=>reject(new Error('OCR library could not be loaded.')),{once:true});
      return;
    }
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.async=true;s.dataset.pilotlogTesseract='1';
    s.onload=resolve;s.onerror=()=>reject(new Error('OCR library could not be loaded. Check the internet connection.'));
    document.head.appendChild(s);
  });
  if(!window.Tesseract)throw new Error('OCR library unavailable.');
  return window.Tesseract;
}

async function prepareScreenshotForOcr(file){
  const bitmap=await createImageBitmap(file);
  try{
    const pixels=Math.max(1,bitmap.width*bitmap.height),maxPixels=12_000_000;
    const scale=Math.min(2.5,Math.max(1,Math.sqrt(maxPixels/pixels)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    try{ctx.filter='grayscale(1) contrast(1.28)'}catch{}
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    try{ctx.filter='none'}catch{}
    return canvas;
  }finally{
    if(bitmap.close)bitmap.close();
  }
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
function cropRosterCellCanvas(source,rect){
  const scale=2;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(rect.width*scale));
  canvas.height=Math.max(1,Math.round(rect.height*scale));
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  try{ctx.filter='grayscale(1) contrast(1.48)'}catch{}
  ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);
  try{ctx.filter='none'}catch{}
  return canvas;
}
function smartCellUsefulText(text){
  const s=String(text||'').replace(/\s+/g,' ').trim();
  if(!s)return false;
  if(/^(?:\d{1,2}[:.]\d{2}|\d+(?:[.,]\d+)?|\s|-)+$/.test(s))return false;
  return /[A-Z]{2,}|\d{2,}/i.test(s);
}
async function recognizeCrewScheduleCells(worker,T,source,layout,text,status){
  const rects=crewScheduleCellRects(layout,text,source.width,source.height);
  if(rects.length<4)return[];
  const cells=[];

  if(T.PSM?.SINGLE_BLOCK){
    try{await worker.setParameters({tessedit_pageseg_mode:T.PSM.SINGLE_BLOCK})}catch{}
  }

  for(let i=0;i<rects.length;i++){
    const rect=rects[i];
    status.textContent=`Smart roster scan — reading day ${i+1}/${rects.length}…`;
    const crop=cropRosterCellCanvas(source,rect);
    try{
      const result=await worker.recognize(crop);
      const cellText=String(result?.data?.text||'').replace(/\r/g,'').split('\n')
        .map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
      if(smartCellUsefulText(cellText))cells.push({date:rect.date,text:cellText,confidence:Number(result?.data?.confidence||0)});
    }catch(e){
      console.warn('Smart cell OCR failed',rect.date,e);
      cells.push({date:rect.date,text:'',confidence:0,error:true});
    }
  }
  return cells;
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

async function runScreenshotOcr(file){
  const status=$('screenshotImportStatus');
  status.textContent='Loading OCR engine…';
  const T=await loadTesseractBrowser();
  let worker=null;
  try{
    worker=await T.createWorker('eng',T.OEM?.LSTM||1,{
      logger:m=>{
        if(m.status==='recognizing text'&&!/^Smart roster scan/.test(status.textContent||''))status.textContent=`Reading roster structure… ${Math.round((m.progress||0)*100)}%`;
        else if(m.status&&!/^Smart roster scan/.test(status.textContent||''))status.textContent=`OCR: ${m.status}`;
      }
    });
    status.textContent='Preparing screenshot…';
    let input=file;
    try{input=await prepareScreenshotForOcr(file)}catch(e){console.warn('Screenshot preprocessing skipped',e)}
    if(T.PSM?.SPARSE_TEXT){try{await worker.setParameters({tessedit_pageseg_mode:T.PSM.SPARSE_TEXT})}catch{}}
    status.textContent='Reading roster structure… 0%';
    const result=await worker.recognize(input,{}, {blocks:true});
    screenshotOcrLayout={blocks:result?.data?.blocks||[]};
    screenshotSmartCells=[];
    const text=result?.data?.text||'';
    const source=$('screenshotSource')?.value||'auto';
    const looksCrew=/INDIVIDUAL\s+CREW\s+SCHEDULE\s+REPORT/i.test(text);
    if((source==='roster'||looksCrew)&&input?.width&&input?.height){
      screenshotSmartCells=await recognizeCrewScheduleCells(worker,T,input,screenshotOcrLayout,text,status);
    }
    status.textContent=screenshotSmartCells.length?`Smart roster scan complete — ${screenshotSmartCells.length} populated day(s) read.`:'Roster structure read. Preparing review…';
    return text;
  }finally{
    if(worker)try{await worker.terminate()}catch{}
  }
}
async function importReviewedScreenshot(){
  const selected=screenshotReviewRows.filter(r=>r.include);
  if(!selected.length)return alert('No reviewed rows selected.');

  const incomplete=selected.filter(r=>!screenshotRowReady(r));
  if(incomplete.length){
    renderScreenshotReview();
    return alert(`${incomplete.length} selected row${incomplete.length===1?' is':'s are'} incomplete. Complete the yellow fields or uncheck the row before importing.`);
  }

  snapshotFlights('before-screenshot-import');

  const activities=coreActivityRows();
  let entryCount=0,rosterCount=0,dutyCount=0,duplicates=0;

  for(const r of selected){
    const date=normalizeScreenshotDate(r.date);
    if(!date){continue}

    if(r.target==='duty' || r.dutyType==='Duty' || r.dutyType==='Day OFF'){
      const type=r.dutyType==='Day OFF'?'Day OFF':'Flight Duty';
      const exists=activities.find(x=>isDutyActivityRecord(x)&&x.date===date&&upper(x.dutyType||'')===upper(type)&&String(x.onDuty||'')===String(r.start||'')&&String(x.offDuty||'')===String(r.end||''));
      if(exists){duplicates++;continue}
      activities.push(stamp({id:makeActivityId(),recordKind:'activity',activityCategory:'DUTY',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:type,date,onDuty:r.start||'',offDuty:r.end||'',dutyMinutes:r.start&&r.end?timeSpanMins(r.start,r.end):0,remarks:r.remarks||'Imported from screenshot',source:'screenshot'}));
      dutyCount++;continue;
    }

    if(r.target==='roster'){
      const flightNo=r.flightNo?rosterFlightLabel(r.flightNo):'';
      const exists=activities.find(x=>isFlight(x)&&x.date===date&&upper(x.flightNo)===upper(flightNo)&&upper(x.dep)===upper(r.dep)&&upper(x.arr)===upper(r.arr));
      if(exists){duplicates++;continue}
      activities.push(stamp({id:makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',date,flightNo,dep:upper(r.dep),arr:upper(r.arr),schedOut:r.start||'',schedIn:r.end||'',source:'screenshot'}));
      rosterCount++;continue;
    }

    const dutyType=r.dutyType||'Flight';
    const flightNo=(dutyType==='Flight')?(r.flightNo?composeFlightNo(r.flightNo):''):'';
    const exists=activities.find(x=>x.source==='screenshot'&&x.date===date&&x.dutyType===dutyType&&upper(x.flightNo)===upper(flightNo)&&upper(x.dep)===upper(r.dep)&&upper(x.arr)===upper(r.arr)&&String(x.schedOut||x.onDuty||'')===String(r.start||''));
    if(exists){duplicates++;continue}

    const obj=stamp({
      id:makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.COMPLETED,source:'screenshot',dutyType,date,flightNo,reg:'',type:dutyType==='Simulator'?'A320':'',
      dep:upper(r.dep),arr:upper(r.arr),
      schedOut:dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP'?r.start||'':'',
      schedIn:dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP'?r.end||'':'',
      schedBlock:(dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP')&&r.start&&r.end?timeSpanMins(r.start,r.end):0,
      onDuty:['Ground Course','Simulator','STBY'].includes(dutyType)?r.start||'':'',
      offDuty:['Simulator','STBY'].includes(dutyType)?r.end||'':'',
      out:'',off:'',on:'',in:'',block:0,flight:0,simulatorTime:0,
      credit:0,
      role:'PIC',instructionType:'',night:'00:00',sim:dutyType==='Simulator'?'yes':'no',ifr:'yes',
      dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,
      courseType:dutyType==='Ground Course'?upper(r.remarks||''):'',
      remarks:r.remarks||'Imported from screenshot',locked:false
    });
    obj.credit=creditMinsForEntry(obj);
    activities.push(obj);entryCount++;
  }

  commitCoreActivities(activities);
  reconcileAllDuties();
  autoDetectTrips(false);
  await render();
  renderTrips();
  $('screenshotImportStatus').textContent=`Imported ${entryCount} entries, ${rosterCount} roster sectors, ${dutyCount} duties. ${duplicates} duplicates skipped.`;
  alert(`Screenshot import complete: ${entryCount} entries • ${rosterCount} roster • ${dutyCount} duties • ${duplicates} duplicates skipped`);
}

function download(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function logTenExport(){const fs=coreActivityRows().filter(isCompletedLogbookEntry);if(!fs.length)return alert('No entries to export');const h=['flight_flightDate','flight_type','flight_flightNumber','flight_from','flight_to','flight_scheduledDepartureTime','flight_actualDepartureTime','flight_takeoffTime','flight_landingTime','flight_scheduledArrivalTime','flight_actualArrivalTime','flight_totalTime','flight_pic','flight_sic','flight_dualGiven','flight_simulator','flight_ground','flight_night','flight_dayTakeoffs','flight_nightTakeoffs','flight_dayLandings','flight_nightLandings','flight_onDutyTime','flight_offDutyTime','flight_remarks','aircraft_aircraftID','aircraftType_type','flight_selectedApproach1'];const rows=fs.map(f=>{const total=isFlight(f)?fmt(f.block):'',sim=isSim(f)?fmt(f.simulatorTime||0):'',ground=isGround(f)?fmt(PILOTLOG_RULES.fixed.groundTripDutyMins):'',dual=f.instructionType?fmt(isSim(f)?f.simulatorTime:f.block):'';return[f.date,'',f.flightNo||'',f.dep||'',f.arr||'',f.schedOut||'',f.out||'',f.off||'',f.on||'',f.schedIn||'',f.in||'',total,picMins(f)?total:'',sicMins(f)?total:'',dual,sim,ground,f.night||'00:00',f.dayTakeoffs||0,f.nightTakeoffs||0,f.dayLandings||0,f.nightLandings||0,f.onDuty||'',f.offDuty||'',f.remarks||'',f.reg||'',f.type||'',f.approachType||f.approaches?.[0]?.type||'']});download(`PilotLog_LogTen_${today()}.txt`,[h.join('\t'),...rows.map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t'))].join('\n'),'text/tab-separated-values')}

/* Payroll */
function monthNow(){return new Date().toISOString().slice(0,7)}
function inMonth(date,month){return String(date||'').slice(0,7)===month}
function money(v){return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}
function trainingSector(f){return isFlight(f)&&f.trainingSector===true&&(!f._payrollRosterSynthetic||f._trainingAuthoritative===true)}
function tierPay(hours,st){hours=Math.max(0,Number(hours)||0);const a=Number(st.t1Max)||0,b=Math.max(a,Number(st.t2Max)||a),c=Math.max(b,Number(st.t3Max)||b);let left=hours,total=0,h=Math.min(left,a);total+=h*Number(st.t1Rate||0);left-=h;h=Math.min(Math.max(0,left),b-a);total+=h*Number(st.t2Rate||0);left-=h;h=Math.min(Math.max(0,left),c-b);total+=h*Number(st.t3Rate||0);left-=h;if(left>0)total+=left*Number(st.t4Rate||0);return total}
function seniorityPct(st,month){if(!st.joinDate)return 0;const start=new Date(`${st.joinDate}T00:00:00Z`),[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0,23,59,59));const years=(end-start)/(365.2425*86400000);return years>12?Number(st.seniority12||0):years>2?Number(st.seniority2||0):0}
function monthExtras(month){const all=loadObject(PAY_MONTH_KEY,{});return {dayOffCount:0,arrears:0,dayOffRemarks:{},...(all[month]||{})}}
function saveMonthExtras(month,x){const all=loadObject(PAY_MONTH_KEY,{});all[month]=x;all._updatedAt=new Date().toISOString();saveObject(PAY_MONTH_KEY,all)}

function dayOffEventsForMonth(month,sourceEntries=null){
  const flagged=(sourceEntries||entryActivityRows())
    .filter(f=>inMonth(f.date,month)&&f.callFromDayOff)
    .sort((a,b)=>`${a.date}${a.onDuty||a.schedOut||a.out||''}`.localeCompare(`${b.date}${b.onDuty||b.schedOut||b.out||''}`));

  const byDate=new Map();
  flagged.forEach(f=>{
    if(!byDate.has(f.date))byDate.set(f.date,{date:f.date,entries:[]});
    byDate.get(f.date).entries.push(f);
  });
  return [...byDate.values()];
}
function saveDayOffRemark(month,date,remark){
  const ex=monthExtras(month);
  ex.dayOffRemarks={...(ex.dayOffRemarks||{}),[date]:String(remark||'')};
  saveMonthExtras(month,ex);
}
function dayOffEventLabel(ev){
  const entries=ev.entries||[],first=entries[0]||{};
  const flights=entries.filter(isFlight);
  if(flights.length){
    const a=flights[0],b=flights.at(-1);
    return `${a.dep||''}${b.arr?' → '+b.arr:''}${a.flightNo?' • '+a.flightNo:''}`;
  }
  return `${first.dutyType||'Duty'}${first.dep?' • '+first.dep:''}`;
}

function calculatePayrollProjection(month){
  const st=paySettings(),
    rosterPrimary=rosterMonthAvailable(month),
    fs=operationalEntriesForMonth(month),
    sourceName=rosterPrimary?'Roster':(fs.some(f=>String(f.source||'').toLowerCase()==='logten')?'LogTen Pro':'Logbook'),
    trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month),
    tripResults=calculateSavedTripProjections(trips,operationalEntriesForTrips()),
    extras=monthExtras(month),
    dayOffEvents=dayOffEventsForMonth(month,fs),
    dayOffCount=dayOffEvents.length,
    calculatedCreditMins=fs.reduce((n,f)=>n+creditMinsForEntry(f,fs),0),
    nonFlightCredit=fs.reduce((acc,f)=>{const c=creditMinsForEntry(f,fs);if(!isFlight(f)&&c>0){acc.count++;acc.mins+=c}return acc},{count:0,mins:0}),
    creditMins=calculatedCreditMins,
    training=fs.filter(trainingSector).length,
    sims=fs.filter(isSim).length,
    layMins=tripResults.reduce((n,t)=>n+(Number(t.cashAmount||0)>0?0:Number(t.layover)||0),0),
    layHours=layMins/60,
    seniorPct=seniorityPct(st,month),
    seniority=Number(st.base||0)*seniorPct/100,
    fixed=Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0),
    flightPay=tierPay(creditMins/60,st),
    trainingPay=training*Number(st.trainingRate||0),
    layoverPay=tripResults.reduce((n,t)=>n+(Number(t.allowance)||0),0),
    simPay=sims*Number(st.simAllowance||0),
    dayOffPay=dayOffCount*Number(st.dayOffRate||0),
    arrears=Number(extras.arrears||0),
    total=fixed+flightPay+trainingPay+layoverPay+simPay+dayOffPay+arrears;

  return{st,extras,sourceName,rosterPrimary,dayOffEvents,dayOffCount,creditMins,nonFlightCreditCount:nonFlightCredit.count,nonFlightCreditMins:nonFlightCredit.mins,training,sims,layMins,layHours,tripResults,seniorPct,seniority,fixed,flightPay,trainingPay,layoverPay,simPay,dayOffPay,arrears,total};
}
function fxStore(){return loadObject(FX_KEY,{})}
function payrollFxTargetDate(month){const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),day=Math.min(30,last);return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
function payrollConversionCurrency(){const cur=appCurrency();return cur==='MAD'?'EUR':cur}
async function getMonthFx(month,target=appCurrency()){
  target=upper(target);if(target==='MAD')return{rate:1,date:payrollFxTargetDate(month),locked:true,provisional:false,from:'MAD',to:'MAD'};
  const store=fxStore(),key=`payroll:${month}:MAD:${target}`;if(store[key]?.locked)return store[key];
  const [y,m]=month.split('-').map(Number),targetDateStr=payrollFxTargetDate(month),now=new Date(),targetDate=new Date(`${targetDateStr}T23:59:59Z`),nextMonth=new Date(Date.UTC(y,m,1));
  if(now<targetDate&&now<nextMonth){const got=await latestFx('MAD',target);return{...got,locked:false,provisional:true,from:'MAD',to:target}}
  const got=await fxForDate('MAD',target,targetDateStr),locked={...got,locked:true,provisional:false,from:'MAD',to:target};store[key]=locked;saveObject(FX_KEY,store);return locked;
}
const PAY_MAP={setJoinDate:'joinDate',setBase:'base',setAllowance:'allowance',setTransport:'transport',setPos:'pos',setTelephone:'telephone',setUniform:'uniform',setMeal:'meal',setDeduction:'deduction',setSeniority2:'seniority2',setSeniority12:'seniority12',setT1Max:'t1Max',setT1Rate:'t1Rate',setT2Max:'t2Max',setT2Rate:'t2Rate',setT3Max:'t3Max',setT3Rate:'t3Rate',setT4Rate:'t4Rate',setTrainingRate:'trainingRate',setLayoverRate:'layoverRate',setSimAllowance:'simAllowance',setSimCredit:'simCredit',setGroundCredit:'groundCredit',setDayOffRate:'dayOffRate'};
function fillPaySettings(){const st=paySettings();Object.entries(PAY_MAP).forEach(([id,k])=>{if($(id))$(id).value=st[k]})}
function readPaySettings(){const st={};Object.entries(PAY_MAP).forEach(([id,k])=>st[k]=k==='joinDate'?$(id).value:Number($(id).value||0));return st}
let payrollRenderToken=0;
async function renderPayroll(){
  const token=++payrollRenderToken,month=$('payrollMonth').value||monthNow(),displayCur=appCurrency(),cur=payrollConversionCurrency();$('payrollMonth').value=month;updateCurrencyUI();
  const ex=monthExtras(month),p=PilotLogEngine.payroll(month);$('payArrears').value=ex.arrears||0;$('payTotalSource').textContent=moneyCurrency(p.total,'MAD');$('payTotalMain').textContent='…';$('payFxStatus').textContent='Loading FX conversion…';
  let fx;try{fx=await getMonthFx(month,cur)}catch{if(token!==payrollRenderToken)return;$('payTotalMain').textContent='FX unavailable';$('payFxStatus').textContent='FX unavailable. The authoritative Payroll total remains safely displayed in MAD/DHM.';return}
  if(token!==payrollRenderToken)return;const cv=v=>(Number(v)||0)*Number(fx.rate||1),displayValue=v=>displayCur==='MAD'?(Number(v)||0):cv(v),unit=currencyOutputCode(displayCur);
  $('payTotalMain').textContent=moneyCurrency(cv(p.total),cur);
  $('payBreakdown').innerHTML=[
    ['Data source',p.sourceName,0],['Fixed salary','',p.fixed],['Seniority',money(p.seniorPct)+'%',p.seniority],['Credit H',fmt(p.creditMins),p.flightPay],['NF CH',String(p.nonFlightCreditCount),fmt(p.nonFlightCreditMins),'credit-info'],['Training sectors',String(p.training),p.trainingPay],['Layover',fmt(p.layMins),p.layoverPay],['Simulator allowance',String(p.sims),p.simPay],['Call from Day OFF',String(p.dayOffCount),p.dayOffPay],['Arrears / adjustments','',p.arrears]
  ].map(([n,q,v,kind],i)=>`<div class="pay-breakdown-row ${i%2?'pay-breakdown-alt':''}"><span class="pay-breakdown-label">${esc(n)}</span><span class="pay-breakdown-qty">${esc(q)}</span><b class="money pay-breakdown-amount">${kind==='credit-info'?esc(v):(n==='Data source'?'—':money(displayValue(v))+' '+unit)}</b></div>`).join('');
  const remarks=p.extras.dayOffRemarks||{};$('payDayOffDetails').innerHTML=p.dayOffEvents.length?p.dayOffEvents.map(ev=>{const remark=remarks[ev.date]||'';return `<div class="pay-dayoff-row"><div class="pay-dayoff-main"><b>${esc(displayDate(ev.date))}</b><div class="small">${esc(dayOffEventLabel(ev))}</div><div class="small">${moneyCurrency(displayValue(p.st.dayOffRate||0),displayCur)} premium</div></div><div class="pay-dayoff-remark-wrap"><label>Remark</label><input class="pay-dayoff-remark" data-dayoff-date="${esc(ev.date)}" value="${esc(remark)}" placeholder="e.g. Not paid / email sent"></div></div>`}).join(''):'<div class="empty">No Day OFF calls in this payroll month.</div>';
  $('payFxStatus').innerHTML=`Authoritative total: MAD (DHM) • MAD → ${esc(cur)} ${Number(fx.rate).toFixed(6)} • ${esc(displayDate(fx.date))} ${fx.locked?'<span class="fx-lock">LOCKED</span>':'<span class="fx-live">LIVE</span>'}${fx.provisional?' • provisional until payroll FX lock':''}`;
}

/* Expiry / validity tracking */
const EXPIRY_CATEGORIES=['license','medical','instructor','course','aircraft','english'];
let expiryPendingPhotoData='';

function expiryDaysRemaining(expiry,now=new Date()){
  if(!expiry)return null;
  const end=new Date(`${expiry}T00:00:00`);
  if(!Number.isFinite(end.getTime()))return null;
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  return Math.ceil((end-start)/86400000);
}
function expiryStatus(expiry,now=new Date()){
  const days=expiryDaysRemaining(expiry,now);
  if(days===null)return{days:null,state:'unknown',label:'NO EXPIRY'};
  if(days<0)return{days,state:'expired',label:`EXPIRED ${Math.abs(days)} DAY${Math.abs(days)===1?'':'S'} AGO`};
  if(days<=30)return{days,state:'warning',label:`${days} DAY${days===1?'':'S'} REMAINING`};
  return{days,state:'valid',label:`${days} DAYS REMAINING`};
}
function expiryCategoryLabel(category){
  return category==='license'?'LICENCE':
    category==='medical'?'MEDICAL':
    category==='instructor'?'INSTRUCTOR RATING':
    category==='course'?'RECURRENT COURSE':
    category==='aircraft'?'AIRCRAFT ENDORSED':
    category==='english'?'LPC ENGLISH':'EXPIRY';
}
function expiryRecords(category){
  return load(EXPIRY_KEY)
    .filter(x=>x.category===category)
    .sort((a,b)=>String(a.expiry||'9999-99-99').localeCompare(String(b.expiry||'9999-99-99')));
}
function expiryTitle(x){
  if(x.category==='medical')return [x.medicalClass||'MEDICAL','MEDICAL',x.authority].filter(Boolean).join(' • ');
  if(x.category==='course')return upper(x.name||'COURSE');
  if(x.category==='instructor')return upper(x.name||'INSTRUCTOR RATING');
  if(x.category==='aircraft')return ['AIRCRAFT ENDORSED',x.aircraftType||x.name].filter(Boolean).join(' • ');
  if(x.category==='english')return ['LPC ENGLISH',x.englishLevel?`LEVEL ${x.englishLevel}`:''].filter(Boolean).join(' • ');
  return [x.authority,x.name||'LICENCE'].filter(Boolean).join(' • ');
}
function expirySubtitle(x){
  const parts=[];
  if(x.number)parts.push(`NO. ${upper(x.number)}`);
  if(x.lastCheck)parts.push(`${x.category==='aircraft'?'ENDORSED':'LAST CHECK'} ${displayDate(x.lastCheck)}`);
  if(x.courseDate)parts.push(`${x.category==='english'?'DATE PERFORMED':'COURSE'} ${displayDate(x.courseDate)}`);
  if(x.endorsedBy)parts.push(`ENDORSED BY ${upper(x.endorsedBy)}`);
  if(x.issuer)parts.push(upper(x.issuer));
  if(x.category==='aircraft'&&x.authority)parts.push(upper(x.authority));
  if(x.category==='english'&&x.authority)parts.push(upper(x.authority));
  return parts.join(' • ');
}
function expiryRowHtml(x){
  const s=expiryStatus(x.expiry);
  const noExpiry=x.category==='english'&&String(x.englishLevel)==='6'&&!x.expiry;
  const actions=[];
  if(x.photoData)actions.push(`<button class="secondary" data-view-expiry-photo="${x.id}">VIEW</button>`);
  actions.push(`<button class="secondary" data-toggle-expiry-lock="${x.id}">${x.locked?'UNLOCK':'LOCK'}</button>`);
  if(!x.locked){
    actions.push(`<button class="secondary" data-edit-expiry="${x.id}">EDIT</button>`);
    actions.push(`<button class="danger" data-delete-expiry="${x.id}">DELETE</button>`);
  }
  return `<div class="expiry-row expiry-${s.state}${x.locked?' expiry-locked':''}">
    <div class="expiry-main">
      <div class="expiry-title-line"><b>${esc(upper(expiryTitle(x)))}</b>${x.locked?'<span class="pill expiry-lock-pill">LOCKED</span>':''}</div>
      ${expirySubtitle(x)?`<div class="small">${esc(upper(expirySubtitle(x)))}</div>`:''}
      ${x.remarks?`<div class="small">${esc(upper(x.remarks))}</div>`:''}
    </div>
    <div class="expiry-meta">
      <b>${x.expiry?esc(displayDate(x.expiry)):(noExpiry?'NO EXPIRY':'—')}</b>
      <span>${esc(upper(s.label))}</span>
      <div class="list-actions">${actions.join('')}</div>
    </div>
  </div>`;
}
function renderExpiry(){
  const map={
    license:'expiryLicences',
    medical:'expiryMedicals',
    instructor:'expiryInstructorRatings',
    course:'expiryCourses',
    aircraft:'expiryAircraft',
    english:'expiryEnglish'
  };
  Object.entries(map).forEach(([category,id])=>{
    const rows=expiryRecords(category);
    $(id).innerHTML=rows.length?rows.map(expiryRowHtml).join(''):'<div class="empty">NO RECORDS YET.</div>';
  });
}
function setExpiryFieldVisible(id,visible){
  const el=$(id)?.closest('[data-expiry-field]');
  if(el)el.classList.toggle('hidden',!visible);
}
function setExpiryFields(ids){
  const all=['expiryName','expiryAuthority','expiryNumber','expiryLastCheck','expiryCourseDate','expiryMedicalClass','expiryEnglishLevel','expiryAircraftType','expiryEndorsedBy','expiryExpiry','expiryIssuer','expiryPhotoInput','expiryRemarks'];
  all.forEach(id=>setExpiryFieldVisible(id,ids.includes(id)));
}
function addYearsIso(date,years){
  const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return'';
  const y=Number(m[1])+Number(years),mo=Number(m[2]),d=Number(m[3]);
  const last=new Date(Date.UTC(y,mo,0)).getUTCDate();
  return `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function easaEnglishExpiry(date,level){
  if(String(level)==='4')return addYearsIso(date,4);
  if(String(level)==='5')return addYearsIso(date,6);
  if(String(level)==='6')return'';
  return'';
}
function applyEnglishExpiryDefault(){
  if($('expiryCategory').value!=='english')return;
  const authority=upper($('expiryAuthority').value||'');
  if(authority&&authority!=='EASA')return;
  const date=$('expiryCourseDate').value,level=$('expiryEnglishLevel').value;
  if(!date||!level)return;
  $('expiryExpiry').value=easaEnglishExpiry(date,level);
  $('expiryExpiryHint').textContent=String(level)==='6'
    ?'EASA FCL.055: LEVEL 6 DOES NOT REQUIRE REASSESSMENT. EXPIRY REMAINS EDITABLE FOR OTHER AUTHORITIES.'
    :`EASA FCL.055 DEFAULT: LEVEL ${level} • ${level==='4'?'4':'6'} YEARS. EXPIRY REMAINS EDITABLE.`;
}
function configureExpiryEditor(category){
  const c=category||'license';
  $('expiryCategory').value=c;
  $('expiryEditorTitle').textContent=`${$('expiryEditId').value?'EDIT':'ADD'} ${expiryCategoryLabel(c)}`;
  $('expiryExpiry').required=true;
  $('expiryExpiryHint').textContent='';
  $('expiryNameLabel').textContent='LICENCE / TYPE';
  $('expiryNumberLabel').textContent='LICENCE / CERTIFICATE NUMBER';
  $('expiryLastCheckLabel').textContent='LAST CHECK';
  $('expiryCourseDateLabel').textContent='COURSE DATE';
  $('expiryIssuerLabel').textContent='ISSUED BY';

  if(c==='license'){
    setExpiryFields(['expiryName','expiryAuthority','expiryNumber','expiryLastCheck','expiryExpiry','expiryRemarks']);
    $('expiryName').placeholder='ATPL';
  }else if(c==='medical'){
    setExpiryFields(['expiryAuthority','expiryMedicalClass','expiryNumber','expiryLastCheck','expiryExpiry','expiryIssuer','expiryRemarks']);
    $('expiryNumberLabel').textContent='MEDICAL CERTIFICATE NUMBER';
  }else if(c==='instructor'){
    setExpiryFields(['expiryName','expiryAuthority','expiryNumber','expiryLastCheck','expiryExpiry','expiryRemarks']);
    $('expiryNameLabel').textContent='INSTRUCTOR RATING';
    $('expiryName').placeholder='TRI / SFI / CRMI / TRE';
  }else if(c==='course'){
    setExpiryFields(['expiryName','expiryAuthority','expiryCourseDate','expiryExpiry','expiryIssuer','expiryRemarks']);
    $('expiryNameLabel').textContent='COURSE';
    $('expiryName').placeholder='CRM / SMS / GRT / DGR';
    $('expiryIssuerLabel').textContent='PROVIDER / ISSUER';
  }else if(c==='aircraft'){
    setExpiryFields(['expiryAircraftType','expiryAuthority','expiryLastCheck','expiryEndorsedBy','expiryExpiry','expiryPhotoInput','expiryRemarks']);
    $('expiryLastCheckLabel').textContent='DATE ENDORSED';
  }else if(c==='english'){
    setExpiryFields(['expiryAuthority','expiryCourseDate','expiryEnglishLevel','expiryExpiry','expiryRemarks']);
    $('expiryCourseDateLabel').textContent='DATE PERFORMED';
    if(!$('expiryEditId').value&&!$('expiryAuthority').value)$('expiryAuthority').value='EASA';
    $('expiryExpiryHint').textContent='EASA FCL.055: LEVEL 4 = 4 YEARS • LEVEL 5 = 6 YEARS • LEVEL 6 = NO REASSESSMENT. EXPIRY IS EDITABLE.';
    if($('expiryEnglishLevel').value==='6')$('expiryExpiry').required=false;
  }
  updateExpiryPhotoControls();
}
function resetExpiryEditor(category='license'){
  $('expiryForm').reset();
  $('expiryEditId').value='';
  $('expiryCategory').value=category;
  expiryPendingPhotoData='';
  $('expiryPhotoInput').value='';
  configureExpiryEditor(category);
}
function updateExpiryPhotoControls(){
  const has=!!expiryPendingPhotoData;
  $('expiryFormPhotoViewBtn')?.classList.toggle('hidden',!has);
  $('expiryFormPhotoRemoveBtn')?.classList.toggle('hidden',!has);
}
function openExpiryEditor(category,item=null){
  resetExpiryEditor(category);
  if(item){
    if(item.locked){alert('THIS EXPIRY ITEM IS LOCKED. UNLOCK IT BEFORE EDITING.');return}
    $('expiryEditId').value=item.id;
    $('expiryCategory').value=item.category;
    $('expiryName').value=upper(item.name||'');
    $('expiryAuthority').value=upper(item.authority||'');
    $('expiryNumber').value=upper(item.number||'');
    $('expiryLastCheck').value=item.lastCheck||'';
    $('expiryCourseDate').value=item.courseDate||'';
    $('expiryMedicalClass').value=upper(item.medicalClass||'');
    $('expiryEnglishLevel').value=String(item.englishLevel||'');
    $('expiryAircraftType').value=upper(item.aircraftType||'');
    $('expiryEndorsedBy').value=upper(item.endorsedBy||'');
    $('expiryExpiry').value=item.expiry||'';
    $('expiryIssuer').value=upper(item.issuer||'');
    $('expiryRemarks').value=upper(item.remarks||'');
    expiryPendingPhotoData=item.photoData||'';
    configureExpiryEditor(item.category);
  }
  $('expiryEditorWrap').classList.remove('hidden');
  $('expiryEditorWrap').scrollIntoView({behavior:'smooth',block:'start'});
}
function saveExpiryFromForm(){
  const category=$('expiryCategory').value;
  const expiry=$('expiryExpiry').value;
  const level=$('expiryEnglishLevel').value;
  if(category==='medical'&&!$('expiryMedicalClass').value)return alert('SELECT CLASS 1 OR CLASS 2.');
  if(category==='aircraft'&&!$('expiryAircraftType').value.trim())return alert('ENTER THE AIRCRAFT ENDORSED.');
  if(category==='english'&&!$('expiryCourseDate').value)return alert('ENTER THE DATE PERFORMED.');
  if(category==='english'&&!level)return alert('SELECT THE ENGLISH LEVEL.');
  if(!expiry&&!(category==='english'&&level==='6'))return alert('PLEASE ENTER AN EXPIRY DATE.');

  const rows=load(EXPIRY_KEY),id=$('expiryEditId').value||makeId(),existing=rows.find(x=>x.id===id);
  if(existing?.locked)return alert('THIS EXPIRY ITEM IS LOCKED.');

  const item=stamp({
    id,
    category,
    name:category==='english'?'LPC ENGLISH':category==='aircraft'?'AIRCRAFT ENDORSED':upper($('expiryName').value.trim()),
    authority:upper($('expiryAuthority').value.trim()),
    number:upper($('expiryNumber').value.trim()),
    lastCheck:$('expiryLastCheck').value,
    courseDate:$('expiryCourseDate').value,
    medicalClass:upper($('expiryMedicalClass').value),
    englishLevel:level,
    aircraftType:upper($('expiryAircraftType').value.trim()),
    endorsedBy:upper($('expiryEndorsedBy').value.trim()),
    expiry,
    issuer:upper($('expiryIssuer').value.trim()),
    remarks:upper($('expiryRemarks').value.trim()),
    photoData:expiryPendingPhotoData||'',
    locked:!!existing?.locked,
    source:existing?.source||'manual',manualOverride:true
  });
  const i=rows.findIndex(x=>x.id===id);
  item._syncRev=Number(existing?._syncRev||0)+1;
  if(i>=0)rows[i]={...rows[i],...item};else rows.push(item);
  save(EXPIRY_KEY,rows);markCloudEdited('expiry',item,existing?'edit':'create');
  $('expiryEditorWrap').classList.add('hidden');
  renderExpiry();
  scheduleAutoSync('expiry-save');
}
async function expiryPhotoDataFromFile(file){
  if(!file||!String(file.type||'').startsWith('image/'))throw new Error('SELECT AN IMAGE FILE.');
  const bitmap=await createImageBitmap(file);
  try{
    const max=1400,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let data=canvas.toDataURL('image/jpeg',.72);
    if(data.length>900000)data=canvas.toDataURL('image/jpeg',.55);
    if(data.length>1400000)throw new Error('IMAGE TOO LARGE. CHOOSE A SMALLER PHOTO.');
    return data;
  }finally{if(bitmap.close)bitmap.close()}
}
async function profilePhotoDataFromFile(file){
  if(!file||!String(file.type||'').startsWith('image/'))throw new Error('SELECT AN IMAGE FILE.');
  const bitmap=await createImageBitmap(file);
  try{
    const max=512,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),size=Math.max(1,Math.round(Math.min(bitmap.width,bitmap.height)*scale));
    const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
    const sourceSize=Math.min(bitmap.width,bitmap.height),sx=(bitmap.width-sourceSize)/2,sy=(bitmap.height-sourceSize)/2,ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.drawImage(bitmap,sx,sy,sourceSize,sourceSize,0,0,size,size);
    const data=canvas.toDataURL('image/jpeg',.78);if(data.length>500000)throw new Error('IMAGE TOO LARGE. CHOOSE A SMALLER PHOTO.');return data;
  }finally{if(bitmap.close)bitmap.close()}
}
function updateProfilePhotoSettings(){
  const data=appSettings().profilePhotoData||'',preview=$('profilePhotoPreview');
  if(preview){preview.classList.toggle('hidden',!data);if(data)preview.src=data;else preview.removeAttribute('src')}
  $('profilePhotoFallback')?.classList.toggle('hidden',!!data);$('removeProfilePhoto')?.classList.toggle('hidden',!data);
}
function showExpiryPhoto(data){
  if(!data)return;
  $('expiryPhotoViewerImg').src=data;
  $('expiryPhotoViewer').classList.remove('hidden');
  $('expiryPhotoViewer').setAttribute('aria-hidden','false');
}
function hideExpiryPhoto(){
  $('expiryPhotoViewer').classList.add('hidden');
  $('expiryPhotoViewer').setAttribute('aria-hidden','true');
  $('expiryPhotoViewerImg').removeAttribute('src');
}
function hideExpiryAddMenu(){
  $('expiryAddMenu').classList.add('hidden');
  $('expiryAddMenu').setAttribute('aria-hidden','true');
}
function showExpiryAddMenu(){
  $('expiryAddMenu').classList.remove('hidden');
  $('expiryAddMenu').setAttribute('aria-hidden','false');
}
function bindExpiryEvents(){
  $('expiryAddBtn').addEventListener('click',showExpiryAddMenu);
  $('expiryAddCancel').addEventListener('click',hideExpiryAddMenu);
  $('expiryAddMenu').addEventListener('click',e=>{
    if(e.target===$('expiryAddMenu'))hideExpiryAddMenu();
    const b=e.target.closest('[data-add-expiry]');
    if(!b)return;
    hideExpiryAddMenu();
    openExpiryEditor(b.dataset.addExpiry);
  });

  $('expiryCancelBtn').addEventListener('click',()=>{$('expiryEditorWrap').classList.add('hidden');resetExpiryEditor()});
  $('expiryForm').addEventListener('submit',e=>{e.preventDefault();saveExpiryFromForm()});
  $('expiryEnglishLevel').addEventListener('change',()=>{
    $('expiryExpiry').required=$('expiryEnglishLevel').value!=='6';
    applyEnglishExpiryDefault();
  });
  $('expiryCourseDate').addEventListener('change',applyEnglishExpiryDefault);
  $('expiryAuthority').addEventListener('change',applyEnglishExpiryDefault);

  $('expiryPhotoInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      expiryPendingPhotoData=await expiryPhotoDataFromFile(file);
      updateExpiryPhotoControls();
    }catch(err){alert(err.message||'PHOTO COULD NOT BE ADDED.')}
    finally{e.target.value=''}
  });
  $('expiryFormPhotoViewBtn').addEventListener('click',()=>showExpiryPhoto(expiryPendingPhotoData));
  $('expiryFormPhotoRemoveBtn').addEventListener('click',()=>{
    if(!confirm('REMOVE THE ATTACHED PHOTO?'))return;
    expiryPendingPhotoData='';
    updateExpiryPhotoControls();
  });
  $('expiryPhotoCloseBtn').addEventListener('click',hideExpiryPhoto);
  $('expiryPhotoViewer').addEventListener('click',e=>{if(e.target===$('expiryPhotoViewer'))hideExpiryPhoto()});

  document.addEventListener('click',e=>{
    const photo=e.target.closest('[data-view-expiry-photo]');
    if(photo){
      const x=load(EXPIRY_KEY).find(v=>v.id===photo.dataset.viewExpiryPhoto);
      if(x?.photoData)showExpiryPhoto(x.photoData);
      return;
    }
    const lock=e.target.closest('[data-toggle-expiry-lock]');
    if(lock){
      const rows=load(EXPIRY_KEY),x=rows.find(v=>v.id===lock.dataset.toggleExpiryLock);
      if(!x)return;
      const next=!x.locked;
      if(!confirm(next?'LOCK THIS EXPIRY ITEM?':'UNLOCK THIS EXPIRY ITEM?'))return;
      x.locked=next;x._updatedAt=new Date().toISOString();x._syncRev=Number(x._syncRev||0)+1;
      save(EXPIRY_KEY,rows);markCloudEdited('expiry',x,next?'lock':'unlock');renderExpiry();scheduleAutoSync(next?'expiry-lock':'expiry-unlock');
      return;
    }
    const edit=e.target.closest('[data-edit-expiry]');
    if(edit){
      const x=load(EXPIRY_KEY).find(v=>v.id===edit.dataset.editExpiry);
      if(x)openExpiryEditor(x.category,x);
      return;
    }
    const del=e.target.closest('[data-delete-expiry]');
    if(del){
      const x=load(EXPIRY_KEY).find(v=>v.id===del.dataset.deleteExpiry);
      if(x?.locked)return alert('THIS EXPIRY ITEM IS LOCKED. UNLOCK IT BEFORE DELETING.');
      if(!confirm('DELETE THIS EXPIRY RECORD?'))return;
      markCloudDeleted('expiry',x||del.dataset.deleteExpiry);
      save(EXPIRY_KEY,load(EXPIRY_KEY).filter(x=>x.id!==del.dataset.deleteExpiry));
      renderExpiry();
      scheduleAutoSync('expiry-delete');
    }
  });
}
/* Cloud — v8.2 local-first verified generations */
const SUPABASE_URL='https://ytlfygmojojipdjeppic.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_a3P-hh1BBqsQ0zRiY1uquA_YgiFcIg0';
const SUPABASE_TABLE='pilotlog_entries';
const CLOUD_SESSION_KEY='pilotlog7_cloud_session_v1';

const SYNC_SINGLETONS=[[PAY_SETTINGS_KEY,'paySettings'],[PAY_MONTH_KEY,'payMonth'],[FX_KEY,'fx'],[APP_SETTINGS_KEY,'appSettings']];
function cloudUserPrefix(userId){return `${SYNC_PROTOCOL}:u:${stableHash128(String(userId||'' )).slice(0,16)}`}
function cloudActiveMetaId(userId){return `${cloudUserPrefix(userId)}:meta:active`}
function cloudGenerationPrefix(userId,generation){return `${cloudUserPrefix(userId)}:g:${generation}:`}
const SNAPSHOT_CHUNK_ITEMS=125;
const AUTO_SYNC_KEY='pilotlog7_auto_sync_v1';
const WEEKLY_BACKUP_INTERVAL_MS=7*24*60*60*1000;
const BACKUP_DB_NAME='pilotlog7-weekly-backup';
const BACKUP_STORE='snapshots';
let autoSyncTimer=null,cloudSyncInProgress=false;

// Fresh installs/reset devices default to manual Sync now. Auto Sync can still be enabled explicitly.
function autoSyncEnabled(){return localStorage.getItem(AUTO_SYNC_KEY)==='yes'}
function setAutoSyncEnabled(v){localStorage.setItem(AUTO_SYNC_KEY,v?'yes':'no')}
function markLocalOnlyImport(label='Bulk import'){
  localStorage.setItem(CLOUD_DIRTY_KEY,'1');
  localStorage.setItem(CLOUD_PENDING_IMPORT_KEY,`${label} • ${new Date().toISOString()}`);
  setAutoSyncEnabled(false);
  if($('autoSyncEnabled'))$('autoSyncEnabled').value='no';
  if($('cloudStatus')){$('cloudStatus').textContent=`${label} stored locally. Review it, then press Sync now to publish a verified cloud copy.`;$('cloudStatus').dataset.state='ok'}
}
function backupDue(createdAt){
  if(!createdAt)return true;
  const t=Date.parse(createdAt);
  return !Number.isFinite(t)||Date.now()-t>=WEEKLY_BACKUP_INTERVAL_MS;
}
function openWeeklyBackupDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(BACKUP_DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(BACKUP_STORE))db.createObjectStore(BACKUP_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Backup database unavailable'));
  });
}
async function weeklyBackup(){
  const db=await openWeeklyBackupDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(BACKUP_STORE,'readonly'),req=tx.objectStore(BACKUP_STORE).get('weekly');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
  finally{db.close()}
}
async function storeWeeklyBackup(snapshot){
  const db=await openWeeklyBackupDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(BACKUP_STORE,'readwrite');tx.objectStore(BACKUP_STORE).put(snapshot,'weekly');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Backup write aborted'))})}
  finally{db.close()}
}
function backupPayload(){
  return{version:VERSION,createdAt:new Date().toISOString(),data:{database:normalizeOperationalDatabase(operationalDatabase)}};
}
async function createWeeklyBackup(force=false){const current=await weeklyBackup();if(!force&&!backupDue(current?.createdAt))return current;const snapshot=backupPayload();await storeWeeklyBackup(snapshot);await renderWeeklyBackupStatus();return snapshot}
async function renderWeeklyBackupStatus(){const el=$('weeklyBackupStatus');if(!el)return;try{const b=await weeklyBackup();el.value=b?.createdAt?`${displayDateTime(b.createdAt)} • ${b.version||'unknown version'}`:'No backup yet'}catch(e){el.value='Backup unavailable';console.warn('Backup status unavailable',e)}}
async function restoreWeeklyBackup(){
  const b=await weeklyBackup();if(!b?.data)return alert('No weekly backup available.');
  if(!confirm(`Restore weekly backup from ${displayDateTime(b.createdAt)}? Current local PilotLog data will be replaced.`))return false;
  await replaceOperationalDatabase(migrateSnapshotToOperationalDatabase(b.data));reconcileAllDuties();localStorage.setItem(CLOUD_DIRTY_KEY,'1');localStorage.setItem(CLOUD_PENDING_IMPORT_KEY,'Weekly backup restored locally');
  await render();renderTrips();renderPayroll();renderSettings();alert('Weekly backup restored locally. Review it before pressing Sync now.');return true;
}
async function ensureWeeklyBackupBeforeSync(){const current=await weeklyBackup();if(!current||backupDue(current.createdAt))await createWeeklyBackup(true)}
async function autoSyncNow(reason='auto'){
  if(!autoSyncEnabled()||cloudSyncInProgress||!navigator.onLine)return false;
  const session=await cloudSession();if(!session?.access_token)return false;
  return syncSupabase({silent:true,reason});
}
function scheduleAutoSync(reason='change',delay=1500){
  const passive=new Set(['startup','visible','online','enabled','sign-in','periodic']);
  if(!passive.has(String(reason||'')))localStorage.setItem(CLOUD_DIRTY_KEY,'1');
  if(!autoSyncEnabled())return;
  clearTimeout(autoSyncTimer);autoSyncTimer=setTimeout(()=>autoSyncNow(reason).catch(e=>console.warn('Auto Sync failed',reason,e)),delay);
}
function cloudStoredSession(){return loadObject(CLOUD_SESSION_KEY,null)}
function saveCloudSession(s){if(!s){localStorage.removeItem(CLOUD_SESSION_KEY);return}const expiresAt=s.expires_at||Math.floor(Date.now()/1000)+(Number(s.expires_in)||3600);localStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify({...s,expires_at:expiresAt}))}
function waitMs(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function cloudFetch(path,{method='GET',body=null,token='',headers={},timeoutMs=30000,retries=1}={}){
  const attempts=Math.max(1,Number(retries||0)+1);let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),Math.max(5000,Number(timeoutMs)||30000));
    try{
      const res=await fetch(`${SUPABASE_URL}${path}`,{method,signal:ctrl.signal,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token||SUPABASE_PUBLISHABLE_KEY}`,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
      const text=await res.text();let data=null;if(text){try{data=JSON.parse(text)}catch{data=text}}
      if(!res.ok){const msg=(data&&typeof data==='object'&&(data.msg||data.message||data.error_description||data.error))||`HTTP ${res.status}`;const err=new Error(msg);err.status=res.status;if((res.status===429||res.status>=500)&&attempt<attempts){lastError=err;await waitMs(500*attempt);continue}throw err}
      return data;
    }catch(e){let err=e;if(e?.name==='AbortError')err=new Error(`Cloud request timed out after ${Math.round((Number(timeoutMs)||30000)/1000)} seconds.`);else if(e instanceof TypeError)err=new Error('Cloud network request failed.');lastError=err;const retryable=e?.name==='AbortError'||e instanceof TypeError||Number(e?.status)===429||Number(e?.status)>=500;if(retryable&&attempt<attempts){await waitMs(500*attempt);continue}throw err}
    finally{clearTimeout(timer)}
  }
  throw lastError||new Error('Cloud request failed.');
}
async function refreshCloudSession(session){if(!session?.refresh_token)return null;const data=await cloudFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});saveCloudSession(data);return data}
async function cloudSession(){let s=cloudStoredSession();if(!s)return null;const now=Math.floor(Date.now()/1000);if(!s.access_token||Number(s.expires_at||0)<=now+60){try{s=await refreshCloudSession(s)}catch(e){saveCloudSession(null);return null}}return s}

async function fetchRowsByPrefix(token,prefix,select='id,data,updated_at'){
  const pageSize=500,all=[];
  for(let offset=0;;offset+=pageSize){
    const page=await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?select=${encodeURIComponent(select)}&id=like.${encodeURIComponent(prefix+'*')}&order=id.asc&limit=${pageSize}&offset=${offset}`,{token,headers:{Accept:'application/json'},timeoutMs:60000,retries:2});
    const rows=Array.isArray(page)?page:[];all.push(...rows);if(rows.length<pageSize)break;if(offset>100000)throw new Error('Cloud dataset is unexpectedly large; sync stopped safely.');
  }
  return all;
}
async function fetchActiveMeta(token,userId){
  const rows=await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?select=id,data,updated_at&id=eq.${encodeURIComponent(cloudActiveMetaId(userId))}&limit=1`,{token,headers:{Accept:'application/json'},timeoutMs:30000,retries:2});
  const row=Array.isArray(rows)?rows[0]:null,d=row?.data||null;if(!d||d.protocol!==SYNC_PROTOCOL||d.kind!=='active-meta')return null;return d.payload||null;
}
function snapshotSections(){const db=normalizeOperationalDatabase(operationalDatabase);return{databaseRecords:db.records,databaseValues:Object.entries(db.values).map(([key,value])=>({key,value})),databaseMeta:{schema:db.schema,schemaVersion:db.schemaVersion,updatedAt:db.updatedAt}}}
function localHasMeaningfulData(){const c=operationalDatabaseCounts();return c.activities>0||c.trips>0||c.expiry>0}
const SNAPSHOT_DIGEST_FORMAT='canonical-json-v1';
function canonicalJsonValue(v){
  if(Array.isArray(v))return v.map(canonicalJsonValue);
  if(v&&typeof v==='object'){const out={};for(const k of Object.keys(v).sort())out[k]=canonicalJsonValue(v[k]);return out}
  return v;
}
function canonicalJsonStringify(v){return JSON.stringify(canonicalJsonValue(v??null))}
function sectionDigest(v){return stableHash128(canonicalJsonStringify(v))}
function legacySectionDigest(v){return stableHash128(JSON.stringify(v??null))}
function buildSnapshotGeneration(revision,userId){
  const generation=`r${revision}-${Date.now().toString(36)}-${syncDeviceId().slice(-8)}`,sections=snapshotSections(),rows=[],counts={},digests={},chunkCounts={};
  Object.entries(sections).forEach(([section,value])=>{
    const items=Array.isArray(value)?value:[value];counts[section]=Array.isArray(value)?value.length:1;digests[section]=sectionDigest(value);
    const total=Math.max(1,Math.ceil(items.length/SNAPSHOT_CHUNK_ITEMS));chunkCounts[section]=total;
    for(let i=0;i<total;i++){
      const chunk=items.slice(i*SNAPSHOT_CHUNK_ITEMS,(i+1)*SNAPSHOT_CHUNK_ITEMS);
      rows.push({id:`${cloudGenerationPrefix(userId,generation)}${section}:${String(i).padStart(4,'0')}`,user_id:userId,updated_at:new Date().toISOString(),data:{protocol:SYNC_PROTOCOL,kind:'snapshot-chunk',generation,section,index:i,totalChunks:total,isArray:Array.isArray(value),items:chunk}});
    }
  });
  const meta={revision,generation,version:VERSION,digestFormat:SNAPSHOT_DIGEST_FORMAT,createdAt:new Date().toISOString(),counts,digests,chunkCounts,rowCount:rows.length};
  return{generation,rows,meta};
}
function uploadBatches(rows,maxBytes=700000,maxRows=8){
  const out=[];let batch=[],bytes=2;
  for(const row of rows){const n=JSON.stringify(row).length+1;if(batch.length&&(batch.length>=maxRows||bytes+n>maxBytes)){out.push(batch);batch=[];bytes=2}batch.push(row);bytes+=n}
  if(batch.length)out.push(batch);return out;
}
async function pushCloudRows(rows,token,silent=false){
  const batches=uploadBatches(rows),total=batches.length;
  for(let i=0;i<total;i++){
    if($('cloudStatus'))$('cloudStatus').textContent=`${silent?'Auto syncing':'Publishing verified snapshot'}… upload ${i+1}/${total}`;
    await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?on_conflict=id`,{method:'POST',token,body:batches[i],timeoutMs:90000,retries:3,headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
  }
}
async function verifyGenerationIds(token,userId,generation,expectedRows){
  if($('cloudStatus'))$('cloudStatus').textContent='Verifying uploaded cloud snapshot…';
  const got=await fetchRowsByPrefix(token,cloudGenerationPrefix(userId,generation),'id');
  const expected=new Set(expectedRows.map(r=>r.id)),actual=new Set(got.map(r=>r.id));
  if(expected.size!==actual.size)throw new Error(`Cloud verification failed: expected ${expected.size} chunks, found ${actual.size}. The previous central database remains active.`);
  for(const id of expected)if(!actual.has(id))throw new Error('Cloud verification failed: one or more snapshot chunks are missing. The previous central database remains active.');
}
async function activateGeneration(token,userId,meta){
  const row={id:cloudActiveMetaId(userId),user_id:userId,updated_at:new Date().toISOString(),data:{protocol:SYNC_PROTOCOL,kind:'active-meta',payload:meta}};
  await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?on_conflict=id`,{method:'POST',token,body:[row],timeoutMs:60000,retries:3,headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
}
async function cleanupOldGeneration(token,userId,generation){
  if(!generation)return;
  try{await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?user_id=eq.${encodeURIComponent(userId)}&id=like.${encodeURIComponent(cloudGenerationPrefix(userId,generation)+'*')}`,{method:'DELETE',token,timeoutMs:60000,retries:1,headers:{Prefer:'return=minimal'}})}catch(e){console.warn('Old cloud generation cleanup deferred',e)}
}
async function publishLocalSnapshot(session,remoteMeta,silent){
  const remoteRev=Math.max(0,Number(remoteMeta?.revision)||0),localBase=Math.max(0,Number(localStorage.getItem(CLOUD_BASE_REV_KEY))||0);
  if(remoteMeta&&localBase!==remoteRev)throw new Error(`Central database changed on another device (server revision ${remoteRev}, this device ${localBase}). Download the latest database before publishing local changes.`);
  const nextRev=remoteRev+1,built=buildSnapshotGeneration(nextRev,session.user.id),oldGeneration=remoteMeta?.generation||'';
  await pushCloudRows(built.rows,session.access_token,silent);await verifyGenerationIds(session.access_token,session.user.id,built.generation,built.rows);
  // Read the just-uploaded generation back through Supabase before activation.
  // Canonical digests make this verification insensitive to JSONB object-key ordering.
  const uploadedRows=await fetchRowsByPrefix(session.access_token,cloudGenerationPrefix(session.user.id,built.generation),'id,data,updated_at');
  reconstructSnapshot(built.meta,uploadedRows);
  await activateGeneration(session.access_token,session.user.id,built.meta);
  localStorage.setItem(CLOUD_BASE_REV_KEY,String(nextRev));localStorage.setItem(CLOUD_DIRTY_KEY,'0');localStorage.removeItem(CLOUD_PENDING_IMPORT_KEY);localStorage.setItem(SYNC_READY_KEY,'1');
  await cleanupOldGeneration(session.access_token,session.user.id,oldGeneration);
  return built.meta;
}
function reconstructSnapshot(meta,rows){
  const groups={};
  for(const row of rows){const d=row?.data||{};if(d.protocol!==SYNC_PROTOCOL||d.kind!=='snapshot-chunk'||d.generation!==meta.generation)continue;(groups[d.section]||(groups[d.section]=[])).push(d)}
  const out={},canonicalFormat=meta?.digestFormat===SNAPSHOT_DIGEST_FORMAT,legacyFormat=!meta?.digestFormat;
  for(const section of Object.keys(meta.counts||{})){
    const chunks=(groups[section]||[]).sort((a,b)=>Number(a.index)-Number(b.index)),expectedChunks=Number(meta.chunkCounts?.[section]||0);
    if(chunks.length!==expectedChunks)throw new Error(`Central database is incomplete: ${section} has ${chunks.length}/${expectedChunks} chunks. Local data was not replaced.`);
    const seen=new Set();
    for(let i=0;i<chunks.length;i++){
      const c=chunks[i],idx=Number(c.index);
      if(!Number.isInteger(idx)||idx!==i||seen.has(idx)||Number(c.totalChunks)!==expectedChunks||c.section!==section||c.generation!==meta.generation||c.protocol!==SYNC_PROTOCOL||c.kind!=='snapshot-chunk')
        throw new Error(`Central database chunk structure mismatch in ${section}. Local data was not replaced.`);
      seen.add(idx);
    }
    const items=chunks.flatMap(c=>Array.isArray(c.items)?c.items:[]),isArray=chunks[0]?.isArray!==false,value=isArray?items:(items[0]||{});
    const count=isArray?items.length:1;if(count!==Number(meta.counts?.[section]||0))throw new Error(`Central database count mismatch in ${section}. Local data was not replaced.`);
    const expected=meta.digests?.[section];
    if(canonicalFormat){
      if(sectionDigest(value)!==expected)throw new Error(`Central database integrity check failed in ${section}. Local data was not replaced.`);
    }else if(legacyFormat){
      // db8 snapshots created before v8.6 hashed ordinary JSON.stringify output.
      // PostgreSQL jsonb is allowed to reorder object keys, so that old digest can change
      // even when the stored values are identical. Accept the legacy generation only
      // after the strict generation/chunk/count checks above. New publications always
      // use canonical-json-v1 and return to full content-digest verification.
      if(legacySectionDigest(value)!==expected)console.warn(`PilotLog legacy digest compatibility used for ${section}; structural verification passed.`);
    }else{
      throw new Error(`Central database uses an unsupported integrity format in ${section}. Local data was not replaced.`);
    }
    out[section]=value;
  }
  return out;
}
async function fetchCentralSnapshot(session,meta){
  if(!meta?.generation)throw new Error('Central database metadata has no active generation.');
  const rows=await fetchRowsByPrefix(session.access_token,cloudGenerationPrefix(session.user.id,meta.generation),'id,data,updated_at');return reconstructSnapshot(meta,rows);
}
function loadSyncLedger(){const rows=load(SYNC_LEDGER_KEY);return Array.isArray(rows)?rows:[]}
function saveSyncLedger(rows){save(SYNC_LEDGER_KEY,Array.isArray(rows)?rows:[])}
function ledgerTarget(kind,item,includeSource=true){
  const obj=item&&typeof item==='object'?item:null,recordId=obj?.id||String(item||''),sourceKey=includeSource&&obj?syncSourceKey(obj):'';return{collection:String(kind||''),recordId,sourceKey};
}
function appendSyncLedger(action,kind,item,options={}){
  const target=ledgerTarget(kind,item,options.includeSource!==false),event={eventId:makeId(),action:String(action||'edit'),...target,at:new Date().toISOString(),deviceId:syncDeviceId(),recordRev:item&&typeof item==='object'?recordRevision(item):0};
  if(options.note)event.note=String(options.note);if(options.count!=null)event.count=Number(options.count)||0;
  const rows=loadSyncLedger();rows.push(event);saveSyncLedger(rows);localStorage.setItem(CLOUD_DIRTY_KEY,'1');return event;
}
function markCloudEdited(kind,item,action='edit',options={}){return appendSyncLedger(action,kind,item,options)}
function markCloudCollectionEdited(kind,action='edit-collection',options={}){return appendSyncLedger(action,kind,'*',{...options,includeSource:false})}
function markCloudDeleted(kind,item,options={}){return appendSyncLedger('delete',kind,item,options)}
function markCloudCollectionDeleted(kind,options={}){return appendSyncLedger('delete-collection',kind,'*',{...options,includeSource:false})}
function loadCloudTombstones(){return loadSyncLedger().filter(x=>x?.action==='delete'||x?.action==='delete-collection')}
function saveCloudTombstones(rows){
  const existing=loadSyncLedger(),known=new Set(existing.map(x=>x.eventId));for(const row of (rows||[])){const e=row?.eventId?row:{eventId:makeId(),action:row?.action||'delete',collection:row?.collection||row?.kind||'',recordId:row?.recordId||row?.id||'',sourceKey:row?.sourceKey||'',at:row?.at||new Date().toISOString(),deviceId:row?.deviceId||syncDeviceId(),recordRev:Number(row?.recordRev)||0};if(!known.has(e.eventId)){existing.push(e);known.add(e.eventId)}}saveSyncLedger(existing);
}
function ledgerEventTime(e){return String(e?.at||'')}
function ledgerMatches(e,kind,item){
  if(!e||e.collection!==String(kind||''))return false;if(e.recordId==='*')return true;
  const target=ledgerTarget(kind,item,true);return (!!target.recordId&&e.recordId===target.recordId)||!!(target.sourceKey&&e.sourceKey&&e.sourceKey===target.sourceKey);
}
function effectiveCloudDeletion(kind,item,ledger=loadSyncLedger()){
  const events=(ledger||[]).filter(e=>ledgerMatches(e,kind,item)).sort((a,b)=>ledgerEventTime(a).localeCompare(ledgerEventTime(b)));if(!events.length)return null;
  let deleted=null,specific=false;
  for(const e of events){
    if(e.action==='delete'){deleted=e;specific=true;continue}
    if(e.action==='delete-collection'){deleted=e;specific=false;continue}
    // A delete is cleared only by a later action for this specific record/source.
    // Collection-wide maintenance events (for example Lock All) must never resurrect deleted rows.
    if(deleted&&e.recordId!=='*'&&ledgerEventTime(e)>ledgerEventTime(deleted)){deleted=null;specific=false}
  }
  if(deleted&&!specific&&item&&typeof item==='object'&&String(item._updatedAt||'')>ledgerEventTime(deleted))return null;return deleted;
}
function activityDeletionFromLedger(item,ledger=loadSyncLedger()){
  return effectiveCloudDeletion('activities',item,ledger)||
    (isEntryActivityRecord(item)&&effectiveCloudDeletion('flights',item,ledger))||
    (isFlight(item)&&effectiveCloudDeletion('roster',item,ledger))||
    (isDutyActivityRecord(item)&&effectiveCloudDeletion('duties',item,ledger));
}
function importSuppressedByDeletion(kind,item){return kind==='activities'?!!activityDeletionFromLedger(item):!!effectiveCloudDeletion(kind,item)}
function deletedByCloudState(kind,item){return kind==='activities'?!!activityDeletionFromLedger(item):!!effectiveCloudDeletion(kind,item)}
function mergeSyncLedgers(a,b){const out=[],seen=new Set();for(const e of [...(a||[]),...(b||[])]){if(!e||!e.eventId||seen.has(e.eventId))continue;seen.add(e.eventId);out.push(e)}return out.sort((x,y)=>ledgerEventTime(x).localeCompare(ledgerEventTime(y)))}
function syncRecordKey(kind,row){const sk=syncSourceKey(row);return sk?`${kind}|source|${sk}`:`${kind}|id|${row?.id||''}`}
function newerSyncRecord(a,b){
  if(!a)return b;if(!b)return a;const ta=String(a._updatedAt||''),tb=String(b._updatedAt||'');if(ta!==tb)return ta>tb?a:b;const ra=recordRevision(a),rb=recordRevision(b);return ra>=rb?a:b;
}
function mergeSyncCollection(kind,localRows,remoteRows,ledger){
  const map=new Map();for(const row of [...(remoteRows||[]),...(localRows||[])]){if(!row)continue;const k=syncRecordKey(kind,row);map.set(k,newerSyncRecord(map.get(k),row))}
  return [...map.values()].filter(row=>!effectiveCloudDeletion(kind,row,ledger));
}
function applyLedgerToUnifiedRecords(records,ledger){
  const out=[];
  for(const source of (records||[])){
    const row=normalizeCoreActivity(source,source?.activityCategory==='DUTY'?'duties':'');
    const deleted=effectiveCloudDeletion('activities',row,ledger)||
      (isEntryActivityRecord(row)&&effectiveCloudDeletion('flights',row,ledger))||
      (isFlight(row)&&effectiveCloudDeletion('roster',row,ledger))||
      (isDutyActivityRecord(row)&&effectiveCloudDeletion('duties',row,ledger));
    if(!deleted)out.push(row);
  }
  return out;
}
function mergeUnifiedDatabases(localDatabase,remoteDatabase){
  const local=normalizeOperationalDatabase(localDatabase),remote=normalizeOperationalDatabase(remoteDatabase),ledger=mergeSyncLedgers(local.values[SYNC_LEDGER_KEY]||[],remote.values[SYNC_LEDGER_KEY]||[]),map=new Map();
  for(const row of [...(remote.records||[]),...(local.records||[])]){
    if(!row)continue;const key=syncRecordKey('activities',row),prior=map.get(key),newer=newerSyncRecord(prior,row),older=newer===row?prior:row;
    map.set(key,older?mergeCoreActivities(older,newer):normalizeCoreActivity(newer,newer?.activityCategory==='DUTY'?'duties':''));
  }
  const values={...remote.values,...local.values,[SYNC_LEDGER_KEY]:ledger};
  values[TRIPS_KEY]=mergeSyncCollection('trips',local.values[TRIPS_KEY]||[],remote.values[TRIPS_KEY]||[],ledger);
  values[EXPIRY_KEY]=mergeSyncCollection('expiry',local.values[EXPIRY_KEY]||[],remote.values[EXPIRY_KEY]||[],ledger);
  return normalizeOperationalDatabase({...local,records:applyLedgerToUnifiedRecords([...map.values()],ledger),values,updatedAt:new Date().toISOString()});
}
function mergeSnapshotsForSync(local,remote){
  const localDb=migrateSnapshotToOperationalDatabase(local),remoteDb=migrateSnapshotToOperationalDatabase(remote);
  return{database:mergeUnifiedDatabases(localDb,remoteDb)};
}
async function applySnapshotToLocal(snapshot,revision,{dirty=false}={}){
  const remote=migrateSnapshotToOperationalDatabase(snapshot),ledger=mergeSyncLedgers(loadSyncLedger(),remote.values[SYNC_LEDGER_KEY]||[]);
  remote.values[SYNC_LEDGER_KEY]=ledger;remote.records=applyLedgerToUnifiedRecords(remote.records,ledger);
  await replaceOperationalDatabase(remote);reconcileAllDuties();localStorage.setItem(CLOUD_BASE_REV_KEY,String(revision||0));localStorage.setItem(CLOUD_DIRTY_KEY,dirty?'1':'0');if(!dirty)localStorage.removeItem(CLOUD_PENDING_IMPORT_KEY);localStorage.setItem(SYNC_READY_KEY,'1');return{database:remote};
}
async function downloadCentralSnapshot(session,meta){
  if($('cloudStatus'))$('cloudStatus').textContent='Downloading verified central snapshot…';const snapshot=await fetchCentralSnapshot(session,meta);return applySnapshotToLocal(snapshot,meta.revision,{dirty:false});
}


async function updateCloudStatus(){
  const el=$('cloudStatus');if(!el)return;
  try{
    const s=await cloudSession(),last=localStorage.getItem('pilotlog7_last_cloud_sync');if(!s){el.textContent='Not signed in';el.dataset.state='';return}
    const email=s.user?.email||localStorage.getItem(LAST_EMAIL_KEY)||'';if(email)localStorage.setItem(LAST_EMAIL_KEY,email);if($('cloudEmail'))$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';
    const dirty=localStorage.getItem(CLOUD_DIRTY_KEY)==='1',pending=localStorage.getItem(CLOUD_PENDING_IMPORT_KEY)||'';
    el.textContent=dirty?(pending?`${pending.split(' • ')[0]} ready locally • press Sync now after review`:'Local changes waiting for Sync now'):`Signed in${email?' as '+email:''}${last?' • Last sync '+new Date(last).toLocaleString():''}`;el.dataset.state=dirty?'':'ok';
  }catch(e){el.textContent='Cloud unavailable: '+e.message;el.dataset.state='error'}
}
async function cloudSignUp(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6)return alert('Enter an email and a password of at least 6 characters.');localStorage.setItem(LAST_EMAIL_KEY,email);$('cloudStatus').textContent='Creating account…';const data=await cloudFetch('/auth/v1/signup',{method:'POST',body:{email,password},headers:{'x-client-info':'pilotlog-web'}});if(data?.access_token){saveCloudSession(data);$('cloudPassword').value='';await updateCloudStatus();alert('Account created and signed in.')}else{$('cloudStatus').textContent='Account created. Check your email to confirm it, then sign in.';alert('Account created. Check your email to confirm it, then sign in.')}}
async function cloudSignIn(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return alert('Enter email and password.');localStorage.setItem(LAST_EMAIL_KEY,email);$('cloudStatus').textContent='Signing in…';const data=await cloudFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},headers:{'x-client-info':'pilotlog-web'}});saveCloudSession(data);$('cloudPassword').value='';await updateCloudStatus();if(autoSyncEnabled())scheduleAutoSync('sign-in',300);alert('Signed in.')}
async function cloudSignOut(){const email=$('cloudEmail').value.trim()||localStorage.getItem(LAST_EMAIL_KEY)||'';if(email)localStorage.setItem(LAST_EMAIL_KEY,email);const s=await cloudSession();if(s?.access_token){try{await cloudFetch('/auth/v1/logout',{method:'POST',token:s.access_token})}catch{}}saveCloudSession(null);$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';$('cloudPassword').value='';await updateCloudStatus()}
async function syncSupabase(options={}){
  const silent=!!options.silent;if(cloudSyncInProgress)return false;cloudSyncInProgress=true;const btn=$('syncCloudBtn');if(btn)btn.disabled=true;if($('cloudStatus'))$('cloudStatus').textContent='Checking central database…';
  try{
    const session=await cloudSession();if(!session?.access_token)throw new Error('Sign in first.');await ensureWeeklyBackupBeforeSync();
    const remoteMeta=await fetchActiveMeta(session.access_token,session.user.id),dirty=localStorage.getItem(CLOUD_DIRTY_KEY)==='1';
    if(!remoteMeta){
      if(!localHasMeaningfulData()){if(!silent)alert('No verified central database exists yet. Import/restore your complete data locally first, review it, then press Sync now.');return false}
      if(silent)return false;
      if(!dirty)localStorage.setItem(CLOUD_DIRTY_KEY,'1');
      if(!confirm('No verified central database exists yet. Publish THIS complete local database as the first central copy?'))return false;
      const meta=await publishLocalSnapshot(session,null,false);localStorage.setItem('pilotlog7_last_cloud_sync',new Date().toISOString());await updateCloudStatus();alert(`Verified central database created • revision ${meta.revision} • ${Number(meta.counts?.databaseRecords||0).toLocaleString('en-US')} unique activity records.`);return true;
    }
    if(dirty){
      const localBase=Math.max(0,Number(localStorage.getItem(CLOUD_BASE_REV_KEY))||0),remoteRev=Math.max(0,Number(remoteMeta.revision)||0);
      if(localBase!==remoteRev){if($('cloudStatus'))$('cloudStatus').textContent='Merging changes from another device…';const local=snapshotSections(),remote=await fetchCentralSnapshot(session,remoteMeta),merged=mergeSnapshotsForSync(local,remote);await applySnapshotToLocal(merged,remoteRev,{dirty:true})}
      const meta=await publishLocalSnapshot(session,remoteMeta,silent);localStorage.setItem('pilotlog7_last_cloud_sync',new Date().toISOString());await updateCloudStatus();if(!silent)alert(`Verified central database updated • revision ${meta.revision}.`);return true;
    }
    await downloadCentralSnapshot(session,remoteMeta);localStorage.setItem('pilotlog7_last_cloud_sync',new Date().toISOString());await render();renderTrips();renderPayroll();renderSettings();await updateCloudStatus();if(!silent)alert(`Verified central database downloaded • revision ${remoteMeta.revision}.`);return true;
  }catch(e){if($('cloudStatus')){$('cloudStatus').textContent='Database sync stopped safely: '+e.message;$('cloudStatus').dataset.state='error'}if(!silent)alert('PilotLog database sync stopped safely: '+e.message);if(silent)throw e;return false}
  finally{cloudSyncInProgress=false;if(btn)btn.disabled=false}
}

function deleteIndexedDb(name){return new Promise(resolve=>{try{const r=indexedDB.deleteDatabase(name);r.onsuccess=()=>resolve(true);r.onerror=()=>resolve(false);r.onblocked=()=>resolve(false)}catch{resolve(false)}})}
async function wipeCurrentUserCloud(session){
  if(!session?.access_token||!session?.user?.id)throw new Error('Sign in first so PilotLog can identify which cloud data to erase.');
  await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?user_id=eq.${encodeURIComponent(session.user.id)}`,{method:'DELETE',token:session.access_token,timeoutMs:60000,retries:2,headers:{Prefer:'return=minimal'}});
}
async function clearPilotLogLocalStorage(){
  try{await flushFlightStore()}catch{}
  operationalDatabase=emptyOperationalDatabase();flightStoreReady=false;
  for(const k of Object.keys(localStorage))if(k.startsWith('pilotlog_')||k.startsWith('pilotlog7_')||k.startsWith('pilotlog8_')||k.startsWith('pilotlog9_'))localStorage.removeItem(k);
  for(const k of Object.keys(sessionStorage))if(k.startsWith('pilotlog_')||k.startsWith('pilotlog7_')||k.startsWith('pilotlog8_')||k.startsWith('pilotlog9_'))sessionStorage.removeItem(k);
  await Promise.all([FLIGHT_DB_NAME,LEGACY_FLIGHT_DB_NAME,LOGTEN_ARCHIVE_DB,BACKUP_DB_NAME,'pilotlog7-airports','pilotlog-core-data','pilotlog-logten-archive','pilotlog-weekly-backup','pilotlog-airports'].map(deleteIndexedDb));
  if(globalThis.caches){for(const k of await caches.keys())if(k.startsWith('pilotlog-'))await caches.delete(k)}
  localStorage.setItem(SYNC_READY_KEY,'1');
  localStorage.setItem(CLOUD_BASE_REV_KEY,'0');
  localStorage.setItem(CLOUD_DIRTY_KEY,'0');
}
async function deepFactoryResetPilotLog(){
  const session=await cloudSession();
  if(!session?.access_token)return alert('Sign in to Cloud Sync first. Deep Reset erases both your Supabase PilotLog data and this device.');
  if(!confirm('ERASE OLD DATABASE: permanently delete ALL existing PilotLog records from Supabase and format ALL PilotLog data on this device?\n\nThis is intentionally irreversible. Export/keep your LogTen migration package first.'))return false;
  const phrase=prompt('Type RESET PILOTLOG to erase the old database and initialize PilotLog:');
  if(phrase!=='RESET PILOTLOG')return alert('Deep Reset cancelled. Nothing was erased.');
  const btn=$('deepResetBtn');if(btn)btn.disabled=true;
  try{
    if($('cloudStatus'))$('cloudStatus').textContent='Deep Reset… erasing cloud database';
    await wipeCurrentUserCloud(session);
    if($('cloudStatus'))$('cloudStatus').textContent='Deep Reset… formatting this device';
    await clearPilotLogLocalStorage();
    alert('Old PilotLog database erased completely. The PilotLog central database is initialized blank and this device has been deeply formatted.');
    location.reload();return true;
  }catch(e){
    console.error('Deep Reset failed',e);alert('Database erase stopped safely: '+e.message+'\n\nPilotLog did not format the device because the Supabase erase did not complete.');return false;
  }finally{if(btn)btn.disabled=false}
}


async function deepLocalResetPilotLog(){
  if(!confirm('Reset ALL PilotLog data on THIS DEVICE only? Cloud data will not be touched.'))return false;
  const phrase=prompt('Type RESET DEVICE to confirm:');if(phrase!=='RESET DEVICE')return alert('Device reset cancelled. Nothing was erased.');
  try{await clearPilotLogLocalStorage();alert('This device is now blank and ready for PilotLog v8.3.0. Import locally or download a verified central snapshot.');location.reload();return true}catch(e){alert('Device reset failed: '+e.message);return false}
}

/* UI render */
function logbookEntryStartDate(f){
  if(!f?.date)return null;
  let t='';
  if(isFlight(f)){
    t=f.onDuty||shiftTime(f.schedOut||f.out||f.off,-60)||f.schedOut||f.out||f.off||'00:00';
  }else{
    t=f.onDuty||f.schedOut||f.out||'00:00';
  }
  const d=zuluDate(f.date,t);
  return d&&Number.isFinite(d.getTime())?d:null;
}
function nextLogbookEntryId(fs,now=new Date()){
  const future=(fs||[])
    .map(f=>({f,start:logbookEntryStartDate(f)}))
    .filter(x=>x.start&&x.start>=now)
    .sort((a,b)=>a.start-b.start);
  if(future.length)return future[0].f.id;

  const past=(fs||[])
    .map(f=>({f,start:logbookEntryStartDate(f)}))
    .filter(x=>x.start&&x.start<now)
    .sort((a,b)=>b.start-a.start);
  return past[0]?.f?.id||null;
}
function scrollEntriesToNextDuty(){
  const anchor=$('entriesNextDutyAnchor');
  if(!anchor){scrollTo(0,0);return}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const top=anchor.getBoundingClientRect().top+window.scrollY-18;
    window.scrollTo({top:Math.max(0,top),left:0,behavior:'auto'});
  }));
}
function scrollLogbookToEntry(entryId){
  if(!entryId){scrollEntriesToNextDuty();return}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const row=document.querySelector(`[data-logbook-entry-id="${CSS.escape(String(entryId))}"]`);
    if(!row){scrollEntriesToNextDuty();return}
    const top=row.getBoundingClientRect().top+window.scrollY-18;
    window.scrollTo({top:Math.max(0,top),left:0,behavior:'auto'});
  }));
}
function show(id,options={}){
  if(!$('addView').classList.contains('hidden')&&id!=='addView')saveEntryDraft();

  const dashboardMode=id==='dashboardView';
  document.querySelectorAll('main>section').forEach(s=>{
    const visible=s.id===id||(dashboardMode&&s.id==='totalsView');
    s.classList.toggle('hidden',!visible);
  });

  document.querySelectorAll('.nav button').forEach(b=>
    b.classList.toggle('active',b.dataset.view===id)
  );

  if(id==='dashboardView')renderTotals();
  if(id==='totalsView')renderTotals();
  if(id==='tripsView')renderTrips();
  if(id==='payrollView')renderPayroll();
  if(id==='expiryView')renderExpiry();
  if(id==='settingsView')renderSettings();

  if(id==='flightsView'){
    if(options.logbookEntryId){
      const ordered=entryActivityRows().filter(isCompletedLogbookEntry).filter(f=>logbookMatchesQuery(f,logbookSearchQuery)).sort((a,b)=>`${b.date}${b.onDuty||b.schedOut||b.out||''}`.localeCompare(`${a.date}${a.onDuty||a.schedOut||a.out||''}`));
      const idx=ordered.findIndex(f=>f.id===options.logbookEntryId);if(idx>=0)logbookRenderLimit=Math.max(logbookRenderLimit,idx+1);
    }
    renderEntriesSafe();
    if(options.logbookEntryId)scrollLogbookToEntry(options.logbookEntryId);
    else scrollEntriesToNextDuty();
    return;
  }

  if(id==='rosterView'){
    Promise.resolve(renderRoster()).then(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));
    return;
  }

  scrollTo({top:0,left:0,behavior:'smooth'});
}
function monthLabel(date){
  if(!date)return'';
  const d=new Date(`${String(date).slice(0,7)}-01T00:00:00Z`);
  try{return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}
  catch{return String(date).slice(0,7)}
}
function flightHtml(fs,full=false,creditContext=null){
  if(!fs.length)return'<div class="empty">No entries yet.</div>';
  let html='',lastMonth='',nextAnchorAdded=false;
  const nextId=full?nextLogbookEntryId(fs):null;

  fs.forEach(f=>{
    const entryDate=String(f.date||'').slice(0,10);
    const month=entryDate.slice(0,7);

    if(full&&!nextAnchorAdded&&nextId&&f.id===nextId){
      html+='<div id="entriesNextDutyAnchor" class="entries-next-duty-anchor" aria-hidden="true"></div>';
      nextAnchorAdded=true;
    }

    if(full&&month&&month!==lastMonth){
      html+=`<div class="month-separator"><span>${esc(monthLabel(f.date))}</span></div>`;
      lastMonth=month;
    }

    const d=f.totalDuty?`<div class="small">Duty ${fmt(f.totalDuty)} • ${f.sectors||0} sectors</div>`:'';
    const startInfo=isGround(f)&&f.onDuty?`<div class="small">Start ${esc(f.onDuty)} Z</div>`:'';

    const openAttrs=full?` data-edit-flight="${esc(f.id)}" role="button" tabindex="0" aria-label="Open logbook entry ${esc(displayDate(f.date))} ${esc(f.flightNo||'')}"`:'';
    html+=`<div class="flight${full?' logbook-entry-clickable':''}" data-logbook-entry-id="${esc(f.id)}"${openAttrs}><div><div class="route">${esc(isSim(f)?(f.location||f.dep||'Simulator'):(f.dep||f.dutyType||'Entry'))}${!isSim(f)&&f.arr?` → ${esc(f.arr)}`:''}</div><div class="small">${esc(displayDate(f.date))} ${esc(f.flightNo||'')}</div>${startInfo}<span class="pill">${esc(f.dutyType||'Flight')}</span>${f.type?`<span class="pill">${esc(f.type)}</span>`:''}${f.instructionType?`<span class="pill green">${esc(f.instructionType)}</span>`:''}${f.callFromDayOff?'<span class="pill warning">Day OFF call</span>':''}${f.locked?'<span class="pill green" title="Locked">🔒</span>':'<span class="pill" title="Unlocked">🔓</span>'}${d}</div><div class="meta"><b>${fmt(isFlight(f)?f.block:isSim(f)?(Number(f.simulatorTime)||0):isGround(f)?PILOTLOG_RULES.fixed.groundTripDutyMins:isPositioning(f)?scheduleBlockMins(f):0)}</b><br><span class="small">Credit ${fmt(PilotLogEngine.credit(f,creditContext?.get(String(f.date||''))||null))}</span>${full&&!f.locked?`<div class="list-actions"><button class="danger" data-delete-flight="${esc(f.id)}">Delete</button></div>`:''}</div></div>`;
  });

  if(full&&!nextAnchorAdded)html+='<div id="entriesNextDutyAnchor" class="entries-next-duty-anchor" aria-hidden="true"></div>';
  return html;
}

function isoDateLocal(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function calculateDashboardDutyRows(startOffset,count){
  const today=new Date(),duties=dutyActivityRows(),groups=rosterGroups();
  const rows=[];
  for(let i=startOffset;i<startOffset+count;i++){
    const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+i),date=isoDateLocal(d),month=date.slice(0,7);
    const dayLabel=i===0?'Today':new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(d);
    let type='OFF / No duty',report='',end='',sectors=0,route='',detail='';

    if(rosterMonthAvailable(month)){
      // If the month has a roster, the dashboard is a roster view: never infer OFF from an incomplete Logbook.
      const dayGroups=rosterDayGroups(groups,date);
      const flightGroups=dayGroups.filter(g=>g.kind==='flight');
      if(flightGroups.length){
        const firstG=flightGroups[0],lastG=flightGroups.at(-1),first=firstG.items[0]||{},home=upper(appSettings().homeBase||'CMN');
        type='Flight Duty';report=firstG.start||shiftTime(first.std,-60);end=lastG.end||shiftTime(lastG.items.at(-1)?.sta,30);
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
          type='Flight Duty';report=first.onDuty||ext?.report||shiftTime(first.schedOut||first.out,-60);end=last.offDuty||ext?.end||shiftTime(last.schedIn||last.in,30);sectors=actualFlights.length;
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
function dashboardDutyRows(startOffset,count){
  return PilotLogEngine.dashboard(startOffset,count).map(row=>`<div class="duty-week-row${row.today?' today-duty-row':''}">
      <div class="duty-week-date"><b>${esc(row.dayLabel)}</b><span>${esc(displayDate(row.date))}</span></div>
      <div class="duty-week-main"><b>${esc(row.type)}</b>${row.route?`<div class="small">${esc(row.route)}</div>`:''}${row.detail?`<div class="small">${esc(row.detail)}</div>`:''}</div>
      <div class="duty-week-time">${row.report||row.end?`<b>${esc(row.report||'--:--')} – ${esc(row.end||'--:--')}</b><div class="small">${row.sectors?`${row.sectors} sector${row.sectors===1?'':'s'}`:'Duty'}</div>`:'<span class="small">—</span>'}</div>
    </div>`).join('');
}



const RECOVERY_SNAPSHOT_PREFIX='recovery:';
const RECOVERY_SNAPSHOT_LIMIT=3;
let recoverySnapshotQueue=Promise.resolve(),lastRecoverySignature='';
function recoveryHash(text){
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return `${text.length}:${(h>>>0).toString(16)}`;
}
async function storeRecoveryFlightSnapshot(snapshot){
  const db=await openWeeklyBackupDb();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(BACKUP_STORE,'readwrite'),store=tx.objectStore(BACKUP_STORE),key=`${RECOVERY_SNAPSHOT_PREFIX}${snapshot.at}`;
      store.put(snapshot,key);
      const q=store.getAllKeys();
      q.onsuccess=()=>{
        const keys=(q.result||[]).map(String).filter(k=>k.startsWith(RECOVERY_SNAPSHOT_PREFIX)).sort().reverse();
        keys.slice(RECOVERY_SNAPSHOT_LIMIT).forEach(k=>store.delete(k));
      };
      q.onerror=()=>reject(q.error);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Recovery snapshot write aborted'));
    });
  }finally{db.close()}
}
function snapshotFlights(reason='safety'){
  try{
    const parsed=entryActivityRows();if(!Array.isArray(parsed)||!parsed.length)return;
    const current=JSON.stringify(parsed),signature=recoveryHash(current);if(signature===lastRecoverySignature)return;
    lastRecoverySignature=signature;
    const snapshot={at:new Date().toISOString(),reason,count:parsed.length,signature,data:parsed};
    recoverySnapshotQueue=recoverySnapshotQueue.then(()=>storeRecoveryFlightSnapshot(snapshot)).catch(e=>console.warn('PilotLog recovery snapshot skipped',e));
  }catch(e){console.warn('PilotLog recovery snapshot skipped',e)}
}
async function migrateLegacyFlightSnapshots(){
  const raw=localStorage.getItem(LEGACY_FLIGHT_BACKUP_KEY);if(!raw)return;
  try{
    const legacy=JSON.parse(raw);if(!Array.isArray(legacy)||!legacy.length){localStorage.removeItem(LEGACY_FLIGHT_BACKUP_KEY);return}
    const selected=legacy.filter(x=>Array.isArray(x?.data)&&x.data.length).slice(0,RECOVERY_SNAPSHOT_LIMIT).reverse();
    for(const x of selected){
      const at=x.at||new Date().toISOString(),text=JSON.stringify(x.data);
      await storeRecoveryFlightSnapshot({at,reason:`legacy-${x.reason||'snapshot'}`,count:x.data.length,signature:recoveryHash(text),data:x.data});
    }
    localStorage.removeItem(LEGACY_FLIGHT_BACKUP_KEY);
  }catch(e){console.warn('Legacy recovery snapshot migration deferred',e)}
}
let logbookSearchQuery='',logbookRenderLimit=400,logbookAutoLoadObserver=null;
const LOGBOOK_RENDER_STEP=400;
function observeLogbookAutoLoad(remaining){
  if(logbookAutoLoadObserver){logbookAutoLoadObserver.disconnect();logbookAutoLoadObserver=null}
  const sentinel=$('logbookAutoLoadSentinel');
  if(!remaining||!sentinel||!('IntersectionObserver' in window))return;
  logbookAutoLoadObserver=new IntersectionObserver(entries=>{
    if(!entries.some(entry=>entry.isIntersecting))return;
    logbookAutoLoadObserver.disconnect();logbookAutoLoadObserver=null;
    setTimeout(()=>{logbookRenderLimit+=LOGBOOK_RENDER_STEP;renderEntriesSafe()},0);
  },{root:null,rootMargin:'0px 0px 800px 0px',threshold:0});
  logbookAutoLoadObserver.observe(sentinel);
}
function logbookAirportText(code){
  const c=upper(code||''),a=airportIndex?.[c];return [c,a?.iata,a?.icao,a?.name,a?.city,a?.country].filter(Boolean).join(' ');
}
function logbookSearchText(f){
  return [f.flightNo,f.dep,f.arr,f.reg,f.type,f.location,f.picName,f.sicName,f.soName,f.instructorName,f.role,f.instructionType,f.remarks,logbookAirportText(f.dep),logbookAirportText(f.arr),logbookAirportText(f.location)].filter(Boolean).join(' ').toUpperCase();
}
function logbookMatchesQuery(f,q){
  const terms=String(q||'').trim().toUpperCase().split(/\s+/).filter(Boolean);if(!terms.length)return true;const hay=logbookSearchText(f);return terms.every(t=>hay.includes(t));
}
function entriesByDate(rows){
  const map=new Map();
  for(const f of (rows||[])){
    const key=String(f?.date||'');
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(f);
  }
  return map;
}
function calculateLogbookStats(rows,total){
  const all=rows||[],flights=all.filter(isFlight),sims=all.filter(isSim),byDate=entriesByDate(all);
  return{entries:all.length,total:Number(total)||0,sectors:flights.length,block:sum(flights,f=>Number(f.block)||0),credit:sum(all,f=>creditMinsForEntry(f,byDate.get(String(f.date||''))||[])),simulators:sims.length};
}
function renderLogbookSearchStats(rows,total){
  const el=$('logbookSearchStats');if(!el)return;const stats=PilotLogEngine.logbookStats(rows,total);
  const q=String(logbookSearchQuery||'').trim();el.innerHTML=`<b>${stats.entries.toLocaleString('en-US')}</b> ${q?'matching':'logbook'} entr${stats.entries===1?'y':'ies'} • <b>${stats.sectors.toLocaleString('en-US')}</b> sectors • Block <b>${fmt(stats.block)}</b> • Credit <b>${fmt(stats.credit)}</b>${stats.simulators?` • Simulator <b>${stats.simulators}</b>`:''}${q?` • from ${stats.total.toLocaleString('en-US')} total`:''}`;
}
async function lockAllLogbookEntries(){
  const rows=entryActivityRows(),targets=rows.filter(f=>isCompletedLogbookEntry(f)&&!f.locked),count=targets.length;if(!count){alert('All Logbook entries are already locked.');return}
  if(!confirm(`Lock all Logbook entries?\n\n${count.toLocaleString('en-US')} unlocked entr${count===1?'y':'ies'} will be locked.\nOnly the lock state will change; flight data will not be modified.`))return;
  const ids=new Set(targets.map(x=>x.id)),now=new Date().toISOString(),updated=rows.map(x=>ids.has(x.id)?{...x,locked:true,_syncRev:recordRevision(x)+1,_updatedAt:now}:x);await replaceEntryActivitiesDurable(updated);await flushFlightStore();markCloudCollectionEdited('activities','lock-all',{count});scheduleAutoSync('lock-all-entries');renderEntriesSafe();alert(`${count.toLocaleString('en-US')} Logbook entr${count===1?'y':'ies'} locked.`);
}

function renderEntriesSafe(){
  try{
    const all=entryActivityRows().filter(isCompletedLogbookEntry),creditContext=entriesByDate(all);
    const fs=all.filter(f=>logbookMatchesQuery(f,logbookSearchQuery)).sort((a,b)=>{
      const kb=`${b.date}${b.onDuty||b.schedOut||b.out||''}`;
      const ka=`${a.date}${a.onDuty||a.schedOut||a.out||''}`;
      return kb.localeCompare(ka);
    });
    const target=$('allFlights'),visible=fs.slice(0,Math.max(LOGBOOK_RENDER_STEP,logbookRenderLimit));
    if(target){
      const remaining=Math.max(0,fs.length-visible.length);
      target.innerHTML=flightHtml(visible,true,creditContext)+(remaining?'<div id="logbookAutoLoadSentinel" class="logbook-auto-load-sentinel" aria-hidden="true"></div>':'');
      observeLogbookAutoLoad(remaining);
    }
    renderLogbookSearchStats(fs,all.length);
    return fs;
  }catch(e){
    console.error('Entries render failed',e);
    const target=$('allFlights');
    if(target)target.innerHTML='<div class="empty">Entries could not be displayed. Stored data has not been deleted.</div>';
    try{return entryActivityRows()||[]}catch{return[]}
  }
}


function cleanupExistingDuplicatesOnce(){
  const key='pilotlog7_dedupe_semantic_v1';
  if(localStorage.getItem(key)==='1')return 0;
  // Previous releases already ran the same semantic dedupe. Do not re-scan a large
  // LogTen archive just because the app version changed.
  const alreadyDone=Object.keys(localStorage).some(k=>k.startsWith('pilotlog7_dedupe_')&&localStorage.getItem(k)==='1');
  if(alreadyDone){localStorage.setItem(key,'1');return 0}
  const current=entryActivityRows();
  const stableLogTen=current.filter(x=>x?.logtenUniqueId).length;
  if(current.length>2500&&stableLogTen>current.length*0.7){localStorage.setItem(key,'1');return 0}
  const result=dedupeFlightEntriesSemantic(current);
  if(result.removed){
    snapshotFlights('before-version-dedupe');
    replaceActivitySelection(isEntryActivityRecord,result.entries);
    reconcileAllDuties();
  }
  localStorage.setItem(key,'1');
  return result.removed;
}

async function render(){
  cleanupExistingDuplicatesOnce();
  refreshEntrySuggestions();
  try{reconcileAllDuties()}catch(e){console.error('Duty reconciliation failed',e)}
  // Heavy Logbook DOM generation is lazy: flightsView renders it only when opened.
  // This keeps Dashboard, save, sync and roster actions responsive even with a large archive.

  try{
    if($('dashboardTodayDuty'))$('dashboardTodayDuty').innerHTML=dashboardDutyRows(0,1);
    if($('dashboardNextDuties'))$('dashboardNextDuties').innerHTML=dashboardDutyRows(1,6);
  }catch(e){
    console.error('Dashboard 7-day view failed',e);
    if($('dashboardTodayDuty'))$('dashboardTodayDuty').innerHTML='<div class="empty">Today duty temporarily unavailable.</div>';
    if($('dashboardNextDuties'))$('dashboardNextDuties').innerHTML='<div class="empty">Next duties temporarily unavailable.</div>';
  }
  try{
    await renderFtl('dashboardFtl',true);
  }catch(e){console.error('FTL totals view failed',e)}
  // Roster is also rendered on demand by show('rosterView').
}


const ROSTER_MONTH_NAMES=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
let rosterCalendarMonth=monthNow(),rosterSelectedDate=today(),suppressRosterCalendarClickUntil=0;
function rosterShiftMonth(month,amount){
  const [year,number]=String(month||monthNow()).split('-').map(Number),d=new Date(year,Math.max(0,number-1)+Number(amount||0),1);
  return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function rosterCalendarDates(month){
  const [year,number]=String(month||monthNow()).split('-').map(Number),first=new Date(year,number-1,1),mondayOffset=(first.getDay()+6)%7,start=new Date(year,number-1,1-mondayOffset),out=[];
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);out.push(isoDateLocal(d))}
  return out;
}
function rosterDayGroups(groups,date){
  return(groups||[]).filter(g=>g.date===date).sort((a,b)=>
    String(a.sortTime||a.start||'99:99').localeCompare(String(b.sortTime||b.start||'99:99'))
  );
}
function rosterCalendarYears(groups){
  const currentYear=new Date().getFullYear(),selectedYear=Number(String(rosterCalendarMonth).slice(0,4))||currentYear,years=(groups||[]).map(g=>Number(String(g.date||'').slice(0,4))).filter(Number.isFinite);
  const min=Math.min(currentYear,selectedYear,...years),max=Math.max(currentYear+3,selectedYear,...years),out=[];
  for(let y=min;y<=max;y++)out.push(y);
  return out;
}
function rosterCalendarEventType(group){
  const type=upper(group.kind==='flight'?'FLIGHT':canonicalDutyType(group.activityType||'Duty','Duty'));
  if(type==='DAY OFF'||type==='OFF')return'off';
  if(type==='STBY')return'stby';
  if(type==='SIMULATOR')return'sim';
  if(type==='DHD'||type==='DHP')return'positioning';
  if(type==='GROUND COURSE')return'ground';
  return type==='FLIGHT'?'flight':'duty';
}
function rosterCalendarEvents(dayGroups){
  const events=[];
  for(const g of dayGroups||[]){
    if(g.kind==='flight'){
      for(const r of g.items||[])events.push({type:'flight',label:[upper(r.dep||''),upper(r.arr||'')].filter(Boolean).join('-')||rosterFlightLabel(r.flightNo||'FLIGHT')});
      continue;
    }
    const type=canonicalDutyType(g.activityType||'Duty','Duty'),u=upper(type),label=u==='DAY OFF'?'OFF':u==='SIMULATOR'?'SIM':u==='GROUND COURSE'?'GROUND':u;
    events.push({type:rosterCalendarEventType(g),label});
  }
  return events;
}
function rosterCalendarCells(month,groups,todayKey){
  return rosterCalendarDates(month).map(date=>{
    const dayGroups=rosterDayGroups(groups,date),events=rosterCalendarEvents(dayGroups),outside=date.slice(0,7)!==month,selected=date===rosterSelectedDate,isToday=date===todayKey,visible=events.slice(0,2),extra=Math.max(0,events.length-visible.length);
    return`<button type="button" class="roster-calendar-day${outside?' outside':''}${selected?' selected':''}${isToday?' today':''}${events.length?' has-events':''}" data-roster-date="${date}" aria-pressed="${selected?'true':'false'}"><span class="roster-day-number">${Number(date.slice(8,10))}</span><span class="roster-day-events">${visible.map(ev=>`<span class="roster-event roster-event-${ev.type}">${esc(ev.label)}</span>`).join('')}${extra?`<span class="roster-event-more">+${extra}</span>`:''}</span></button>`;
  }).join('');
}

function rosterMonthLabel(date){
  if(!date)return'';
  const d=new Date(`${String(date).slice(0,7)}-01T00:00:00Z`);
  try{return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}
  catch{return String(date).slice(0,7)}
}
function renderAerolineConnect(){
  const cfg=aerolineConfig();
  if($('aerolineCrewId'))$('aerolineCrewId').value=cfg.crewId||'';
  if($('aerolineCrewProfileId'))$('aerolineCrewProfileId').value=cfg.crewProfileID||'';
  if($('aerolineCrewType'))$('aerolineCrewType').value=cfg.crewType||'';
  if($('aerolineConnectStatus')&&$('aerolineConnectStatus').dataset.state!=='busy'){
    $('aerolineConnectStatus').textContent=aerolineConnectionStatusText();
    if(!$('aerolineConnectStatus').dataset.state||$('aerolineConnectStatus').dataset.state==='idle')$('aerolineConnectStatus').dataset.state=aerolineDirectSyncAvailable()?'ok':'idle';
  }
}
async function renderRoster(){
  const box=$('rosterList');if(!box)return;
  cleanupRosterDuplicates();
  if($('aerolineImportStatus'))$('aerolineImportStatus').textContent=aerolineImportStatusText();
  renderAerolineConnect();
  const todayKey=isoDateLocal(new Date()),groups=rosterGroups(),month=rosterCalendarMonth||monthNow();
  const panelMonths=[rosterShiftMonth(month,-1),month,rosterShiftMonth(month,1)],calendarPanels=panelMonths.map((panelMonth,i)=>`<div class="roster-calendar-panel${i===1?' current':''}" data-roster-panel-month="${panelMonth}"><div class="roster-calendar-grid">${rosterCalendarCells(panelMonth,groups,todayKey)}</div></div>`).join('');
  const selectedGroups=rosterSelectedDate?rosterDayGroups(groups,rosterSelectedDate):[],agenda=rosterSelectedDate?await rosterGroupHtml(selectedGroups,true):'<div class="empty">Select a day to view its roster details.</div>';
  box.innerHTML=`
    <div class="roster-calendar-shell">
      <div class="roster-month-row"><label for="rosterMonthSelect">Roster month</label><input id="rosterMonthSelect" type="month" value="${esc(month)}"></div>
      <div class="roster-calendar-actions"><button type="button" class="secondary" data-roster-today>Today</button></div>
      <div class="roster-weekdays">${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="roster-calendar-viewport" data-roster-calendar-swipe><div class="roster-calendar-track">${calendarPanels}</div></div>
    </div>
    <div class="roster-agenda" id="rosterAgenda">
      <div class="roster-agenda-title">${rosterSelectedDate?esc(displayDate(rosterSelectedDate)):'Roster details'}</div>
      <div class="roster-agenda-list">${agenda}</div>
    </div>`;
}

let entryReturnContext=null;
let entryRosterActivityContext=null;
let dutyRosterContext=null;
function setEntryReturnContext(view,entryId=''){
  entryReturnContext=view?{view,entryId}:null;
  const b=$('entryBackBtn');if(!b)return;
  b.classList.toggle('hidden',!entryReturnContext);
  if(entryReturnContext)b.textContent=view==='flightsView'?'← Back to Logbook':'← Back to Roster';
}
function clearEntryRosterActivityContext(){
  entryRosterActivityContext=null;
  if($('dutyTypeFlight'))$('dutyTypeFlight').disabled=false;
  if($('lockEntryBtn'))$('lockEntryBtn').classList.remove('hidden');
  if($('entryRosterDeleteBtn'))$('entryRosterDeleteBtn').classList.add('hidden');
  if($('saveEntryBtn'))$('saveEntryBtn').textContent='Save to Logbook';
  if($('returnFlight'))$('returnFlight').classList.remove('hidden');
  if($('clearForm'))$('clearForm').classList.remove('hidden');
}
function setRosterActivityEditorUI(type){
  if($('saveEntryBtn'))$('saveEntryBtn').textContent='Save changes';
  if($('returnFlight'))$('returnFlight').classList.add('hidden');
  if($('clearForm'))$('clearForm').classList.add('hidden');
  if($('entryLockStatus')){
    $('entryLockStatus').textContent=`Roster ${type||'activity'} • editable directly from Roster.`;
    $('entryLockStatus').classList.remove('success');
  }
}
function openRosterEntryModule(id){
  const item=entryActivityRows().find(x=>x.id===id);if(!item)return false;
  const rule=activityRule(item);if(rule.editor!=='entry')return false;
  loadEntryToForm(item,{rosterActivity:true});setEntryReturnContext('rosterView',item.id);show('addView');return true;
}
function resetDutyEditor(){
  dutyRosterContext=null;$('dutyForm')?.reset();if($('dutyEditId'))$('dutyEditId').value='';if($('dutyDate'))$('dutyDate').value=today();
  if($('dutyEditorTitle'))$('dutyEditorTitle').textContent='Add duty';if($('dutySaveBtn'))$('dutySaveBtn').textContent='Save duty';
  $('dutyBackBtn')?.classList.add('hidden');$('dutyDeleteRosterBtn')?.classList.add('hidden');
}
function dutyEditorType(type){const t=canonicalDutyType(type||'Duty','Duty');return t==='STBY'?'Standby':t}
function openRosterDutyModule(id){
  const item=dutyActivityRows().find(x=>x.id===id);if(!item)return false;
  dutyRosterContext={id:item.id};$('dutyEditId').value=item.id;$('dutyDate').value=item.date||today();$('dutyType').value=dutyEditorType(item.type||'Duty');
  $('reportTime').value=item.report||'';$('endDuty').value=item.end||'';$('dutyNotes').value=item.notes||'';
  $('dutyEditorTitle').textContent=`Edit roster ${canonicalDutyType(item.type||'Duty','Duty')}`;$('dutySaveBtn').textContent='Save changes';$('dutyBackBtn').classList.remove('hidden');$('dutyDeleteRosterBtn').classList.remove('hidden');
  show('dutyView');return true;
}
function deleteRosterEntryActivity(){
  const ctx=entryRosterActivityContext;if(!ctx?.id)return false;const victim=coreActivityRows().find(x=>x.id===ctx.id);if(!victim)return false;
  if(!confirm('Delete this roster activity? It will disappear completely.'))return false;
  markCloudDeleted('activities',victim);removeCoreActivities(x=>x.id===ctx.id);reconcileAllDuties();clearEntryRosterActivityContext();setEntryReturnContext(null);renderRoster();renderDuty();show('rosterView');scheduleAutoSync('roster-delete');return true;
}
function deleteRosterDutyActivity(){
  const id=dutyRosterContext?.id;if(!id)return false;if(!confirm('Delete this roster activity? It will disappear completely.'))return false;
  const victim=coreActivityRows().find(x=>x.id===id);markCloudDeleted('activities',victim||id);removeCoreActivities(x=>x.id===id);reconcileAllDuties();resetDutyEditor();renderDuty();show('rosterView');scheduleAutoSync('roster-delete');return true;
}


async function clearImportedRosterData(){
  const activities=coreActivityRows(),removed=activities.filter(x=>x?.aerolineRosterPlanned&&!x.manualOverride&&!x.locked&&x.activityStatus!==ACTIVITY_STATUS.COMPLETED),removedFlights=removed.filter(isFlight).length,removedEntries=removed.filter(x=>!isFlight(x)&&!isDutyActivityRecord(x)).length,removedDuties=removed.filter(isDutyActivityRecord).length;
  removed.forEach(x=>{if(x.id)markCloudDeleted('activities',x,{includeSource:false})});
  commitCoreActivities(activities.filter(x=>!removed.includes(x)));await persistCoreActivities();
  const currentSource=String($('entrySourceDisplay')?.dataset.source||'').toLowerCase();
  if(currentSource==='aeroline'||currentSource==='roster'){clearEntryDraft();resetEntry()}
  reconcileAllDuties();return{roster:removedFlights,entries:removedEntries,duties:removedDuties};
}



function renderDuty(){const ds=dutyActivityRows().sort((a,b)=>String(b.date).localeCompare(String(a.date)));$('dutyList').innerHTML=ds.length?ds.map(d=>`<div class="rowitem"><div><b>${esc(d.type)}</b><div class="small">${esc(displayDate(d.date))} • ${esc(d.notes||'')}</div></div><div class="meta"><b>${fmt(d.minutes)}</b><br>${esc(d.report||'')}–${esc(d.end||'')}<div class="list-actions"><button class="danger" data-delete-duty="${d.id}">Delete</button></div></div></div>`).join(''):'<div class="empty">No duties yet.</div>'}
function aircraftIcaoType(entry){
  const raw=upper(entry?.type||entry?.aircraftType||'').replace(/A32O/g,'A320').trim(),compact=raw.replace(/[^A-Z0-9]/g,'');
  if(!raw)return'';
  if(compact.startsWith('A319'))return'A319';
  if(compact.startsWith('A320'))return'A320';
  if(compact==='A36'||compact==='BE36')return'BE36';
  if(compact.startsWith('C172'))return'C172';
  if(compact.startsWith('P66'))return'OSCR';
  if(compact.startsWith('PA34'))return'PA34';
  if(compact.startsWith('PA42')||compact==='720'||compact==='PAY3')return'PAY3';
  if(compact.startsWith('R2160')||compact==='R200')return'R200';
  return compact.length<=4?compact:raw;
}
function buildAircraftTypeBreakdown(flying,simulators){
  const rows=new Map(),ensure=(code)=>{if(!rows.has(code))rows.set(code,{code,variants:new Set(),flight:0,pic:0,sic:0,instruction:0,simulator:0,simInstruction:0});return rows.get(code)};
  flying.forEach(f=>{const code=aircraftIcaoType(f);if(!code)return;const r=ensure(code),mins=totalFlightMins(f);r.variants.add(upper(f.type||f.aircraftType||code));r.flight+=mins;r.pic+=picMins(f);r.sic+=sicMins(f);r.instruction+=flightInstrMins(f)});
  // The list represents aircraft actually flown. Simulator-only devices/types
  // are not promoted to aircraft rows; simulator time is attached only when
  // that ICAO type already exists among real flights.
  simulators.forEach(f=>{const code=aircraftIcaoType(f);if(!code||!rows.has(code))return;const r=rows.get(code);r.variants.add(upper(f.type||f.aircraftType||code));r.simulator+=Number(f.simulatorTime)||0;r.simInstruction+=simInstrMins(f)});
  return[...rows.values()].sort((a,b)=>b.flight-a.flight||a.code.localeCompare(b.code)).map(r=>({...r,variants:[...r.variants].filter(Boolean).sort()}));
}
function normalizedApproaches(entry){
  if(Array.isArray(entry?.approaches)&&entry.approaches.some(a=>upper(a?.type||'')))return entry.approaches.map(a=>({type:upper(a?.type||''),quantity:Math.max(1,Number(a?.quantity)||1)})).filter(a=>a.type);
  const type=upper(entry?.approachType||'');return type?[{type,quantity:1}]:[];
}
function buildTotalsModel(entries,now=new Date()){
  const all=entries||[],flying=all.filter(f=>activityRule(f).totals==='flight'),simulators=all.filter(f=>activityRule(f).totals==='simulator');
  const a320Flights=flying.filter(isA320Entry),a320Sims=simulators.filter(isA320Entry);
  return{
    flying,simulators,a320Flights,a320Sims,aircraftTypes:buildAircraftTypeBreakdown(flying,simulators),
    totalFlight:sum(flying,totalFlightMins),totalSimulator:sum(simulators,f=>Number(f.simulatorTime)||0),a320Flight:sum(a320Flights,totalFlightMins),a320Pic:sum(a320Flights,picMins),a320Sic:sum(a320Flights,sicMins),
    a320FlightInstruction:sum(a320Flights,flightInstrMins),a320SimInstruction:sum(a320Sims,simInstrMins),a320SimulatorTime:sum(a320Sims,f=>Number(f.simulatorTime)||0),
    rightSeat:sum(flying,f=>upper(f.seatPosition||'')==='RIGHT'?totalFlightMins(f):0)
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
  const approachCount=Object.values(approaches).reduce((n,v)=>n+(Number(v)||0),0),dayLandings=sum(all,f=>Number(f.dayLandings)||0),nightLandings=sum(all,f=>Number(f.nightLandings)||0);
  return{...model,periods,approachTypes,approaches,approachCount,dayLandings,nightLandings};
}
// The UI consumes projections from this single calculation service; renderers only format its results.
const PilotLogEngine=Object.freeze({
  activity:(entry,context=null)=>calculateActivityMetrics(entry,context),
  credit:(entry,context=null)=>creditMinsForEntry(entry,context),
  dutySessions:(entries=null)=>buildDutySessions(entries||entryActivityRows()),
  operationalMonth:month=>operationalEntriesForMonth(month),
  operationalTrips:()=>operationalEntriesForTrips(),
  trip:(start,end,cashAmount=0,entries=null)=>calculateTripMetrics(start,end,cashAmount,entries),
  savedTrip:(trip,entries=null)=>calculateSavedTripProjection(trip,entries),
  savedTrips:(trips=null,entries=null)=>calculateSavedTripProjections(trips,entries),
  payroll:month=>calculatePayrollProjection(month),
  totals:(entries,now=new Date())=>buildTotalsProjection(entries,now),
  logbookStats:(rows,total)=>calculateLogbookStats(rows,total),
  dashboard:(startOffset,count)=>calculateDashboardDutyRows(startOffset,count)
});
async function renderTotals(){
  const model=PilotLogEngine.totals(coreActivityRows().filter(isCompletedLogbookEntry));
  $('tTotalFlight').textContent=fmt(model.totalFlight);if($('tTotalSimulator'))$('tTotalSimulator').textContent=fmt(model.totalSimulator);$('tA320Total').textContent=fmt(model.a320Flight);if($('tA320Simulator'))$('tA320Simulator').textContent=fmt(model.a320SimulatorTime);$('tA320Pic').textContent=fmt(model.a320Pic);$('tA320Sic').textContent=fmt(model.a320Sic);$('tA320FlightInstruction').textContent=fmt(model.a320FlightInstruction);$('tA320SimInstruction').textContent=fmt(model.a320SimInstruction);$('tRightSeat').textContent=fmt(model.rightSeat);
  $('periodTotals').innerHTML=model.periods.map(([n,v])=>`<div class="stat-row"><span>${n}</span><b>${fmt(v)}</b></div>`).join('');
  $('approachTotals').innerHTML=[
    `<div class="stat-row"><span>Total recorded approaches</span><b>${model.approachCount}</b></div>`,
    `<div class="stat-row"><span>Day landings</span><b>${model.dayLandings}</b></div>`,
    `<div class="stat-row"><span>Night landings</span><b>${model.nightLandings}</b></div>`,
    ...model.approachTypes.map(a=>`<div class="stat-row"><span>${esc(a)}</span><b>${model.approaches[a]}</b></div>`)
  ].join('');
  $('aircraftBreakdown').innerHTML=model.aircraftTypes.length?model.aircraftTypes.map(r=>{
    const details=[`Total ${fmt(r.flight)}`];if(r.pic)details.push(`PIC ${fmt(r.pic)}`);if(r.sic)details.push(`SIC ${fmt(r.sic)}`);if(r.instruction)details.push(`Instruction ${fmt(r.instruction)}`);if(r.simulator)details.push(`Simulator ${fmt(r.simulator)} (separate)`);if(r.simInstruction)details.push(`Sim instruction ${fmt(r.simInstruction)}`);
    return`<div class="stat-row aircraft-breakdown-row"><span><b>${esc(r.code)}</b><div class="small">ICAO • ${r.variants.map(esc).join(', ')}</div></span><div class="aircraft-breakdown-values">${details.map((x,i)=>`<${i?'span':'b'}>${esc(x)}</${i?'span':'b'}>`).join('')}</div></div>`;
  }).join(''):'<div class="empty">No aircraft flight time recorded.</div>';
}


function buildTripEntryLookup(sourceEntries){
  const fs=sourceEntries||[],byId=new Map(),timed=[];
  for(const f of fs){
    if(f?.id)byId.set(f.id,f);
    const a=tripSequenceStart(f),b=tripSequenceEnd(f);
    if(a&&b)timed.push({entry:f,start:a.getTime(),end:b.getTime()});
  }
  timed.sort((a,b)=>a.start-b.start);
  return{byId,timed};
}
function tripIncludedEntries(t,sourceEntries=null,sourceLookup=null){
  const fs=sourceEntries||operationalEntriesForTrips(),lookup=sourceLookup||null;
  if(Array.isArray(t.includedEntryIds)&&t.includedEntryIds.length){
    const index=lookup?.byId||new Map(fs.map(f=>[f.id,f])),selected=t.includedEntryIds.map(id=>index.get(id)).filter(Boolean).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
    if(selected.length)return selected;
  }
  const s=new Date(t.start),e=new Date(t.end),sm=s.getTime(),em=e.getTime();
  if(lookup?.timed)return lookup.timed.filter(x=>x.start<em&&x.end>sm).map(x=>x.entry);
  return fs.filter(f=>{
    const a=tripSequenceStart(f),b=tripSequenceEnd(f);
    return a&&b&&a<e&&b>s;
  }).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
}
function renderTripInspector(tripId){
  const wrap=$('tripInspectorWrap'),box=$('tripInspector');
  const saved=load(TRIPS_KEY).find(x=>x.id===tripId),sourceEntries=PilotLogEngine.operationalTrips();
  const t=PilotLogEngine.savedTrip(saved,sourceEntries);
  if(!t){wrap.classList.add('hidden');box.innerHTML='';return}
  const entries=tripIncludedEntries(t,sourceEntries),s=new Date(t.start),e=new Date(t.end);
  const rows=entries.map(f=>{
    const a=tripSequenceStart(f),b=tripSequenceEnd(f);
    const dur=a&&b?Math.round((b-a)/60000):0;
    const charge=tripChargeLabel(f);
    return `<div class="rowitem">
      <div>
        <b>${esc(displayDate(f.date))} • ${esc(f.dutyType||'Flight')} ${esc(f.flightNo||'')}</b>
        <div class="small">${esc(f.dep||'')} ${f.arr?'→ '+esc(f.arr):''}</div>
        <div class="small">${charge}</div>
      </div>
      <div class="meta">
        <b>${a?esc(a.toISOString().slice(11,16)):'--:--'}–${b?esc(b.toISOString().slice(11,16)):'--:--'} Z</b>
        <br><span class="small">${fmt(dur)}</span>
      </div>
    </div>`;
  }).join('');
  box.innerHTML=
    `<div class="stat-row"><span>Trip start</span><b>${esc(displayDateTime(s.toISOString().slice(0,16)))} Z</b></div>
     <div class="stat-row"><span>Trip end</span><b>${esc(displayDateTime(e.toISOString().slice(0,16)))} Z</b></div>
     <div class="stat-row"><span>Total trip time</span><b>${fmt(t.trip)}</b></div>
     <div class="stat-row"><span>Duty subtracted</span><b>${fmt(t.duty)}</b></div>
     <div class="stat-row"><span>Layover time</span><b>${fmt(t.layover)}</b></div>
     <div class="stat-row"><span>Layover pay</span><b>${esc(tripDisplayMoney(t).allowanceText)}</b></div>
     <div class="section-title inner">Included entries</div>
     ${rows||'<div class="empty">No entries found for this trip.</div>'}`;
  wrap.classList.remove('hidden');
  wrap.scrollIntoView({behavior:'smooth',block:'start'});
}
function tripFirstDhdDestination(t,sourceEntries=null,sourceLookup=null){
  const entries=tripIncludedEntries(t,sourceEntries,sourceLookup);
  const base=upper(t.base||appSettings().homeBase||'CMN');
  const firstDhd=entries.find(f=>isPositioning(f)&&upper(f.dep)===base&&upper(f.arr)!==base&&upper(f.arr||''));
  if(firstDhd?.arr)return upper(firstDhd.arr);
  const stations=String(t.stations||'').split(',').map(s=>upper(s.trim())).filter(Boolean);
  if(stations.length)return stations[0];
  const firstAway=entries.find(f=>upper(f.arr||'')&&upper(f.arr)!==base);
  if(firstAway?.arr)return upper(firstAway.arr);
  return upper(base||'TRIP');
}
function tripReferenceLabel(t){
  const d=new Date(t.start);
  if(!Number.isFinite(d.getTime()))return '';
  return d.toLocaleDateString('en-GB',{month:'long',year:'numeric'}).toUpperCase();
}
function tripDisplayName(t,sourceEntries=null,sourceLookup=null){
  const dest=tripFirstDhdDestination(t,sourceEntries,sourceLookup);
  const ref=tripReferenceLabel(t);
  return [dest,ref].filter(Boolean).join(' ');
}
function tripDisplayMoney(t){
  const cur=appCurrency(),cash=Number(t.cashAmount||0),cashPart=(()=>{if(!(cash>0))return'';const base=`Cash ${money(cash)} ${upper(t.cashCurrency||'')}`;if(upper(t.cashFxTo||'')===cur&&Number(t.cashConverted)>=0&&Number(t.cashFxRate)>0)return `${base} ≈ ${moneyCurrency(t.cashConverted,cur)} • FX ${displayDate(t.cashFxDate||t.cashFxTripStartDate||'')}`;return `${base}${t.cashFxDate?` • FX frozen ${displayDate(t.cashFxDate)}`:''}`})();
  const allowance=Number(t.cashAmount||0)>0?0:Number(t.allowance||0);
  const allowanceText=allowance===0?moneyCurrency(0,cur):(cur==='MAD'?moneyCurrency(allowance,'MAD'):(upper(t.tripFxTo||'')===cur&&Number(t.tripFxMadRate)>0?moneyCurrency(allowance*Number(t.tripFxMadRate),cur):`FX unavailable (${currencyOutputCode(cur)})`));return{cashPart,allowanceText};
}
function renderTrips(){
  updateCurrencyUI();
  const saved=load(TRIPS_KEY).sort((a,b)=>String(b.start).localeCompare(String(a.start))),sourceEntries=saved.length?PilotLogEngine.operationalTrips():[],ts=PilotLogEngine.savedTrips(saved,sourceEntries),sourceLookup=buildTripEntryLookup(sourceEntries);
  $('tripList').innerHTML=ts.length?ts.map(t=>{const m=tripDisplayMoney(t);return `<div class="rowitem"><div><b>${esc(tripDisplayName(t,sourceEntries,sourceLookup)||'TRIP')}</b><div class="small">${esc(displayDateTime(t.start))} → ${esc(displayDateTime(t.end))}${t.cashEligible?' • Positioning cash eligible':''}${m.cashPart?` • ${esc(m.cashPart)}`:''}</div></div><div class="meta"><b>${fmt(t.layover)}</b><br><span class="small">${esc(m.allowanceText)} allowance${Number(t.cashAmount||0)>0?' • CASH RECEIVED: LAYOVER PAY 0':''}</span><div class="list-actions"><button class="secondary" data-view-trip="${t.id}">View duties</button><button class="secondary" data-edit-trip="${t.id}">Edit</button><button class="danger" data-delete-trip="${t.id}">Delete</button></div></div></div>`}).join(''):'<div class="empty">No trips yet.</div>';
}
function renderReconciliationReview(){
  const box=$('reconciliationReview');if(!box)return;
  const rows=load(RECONCILIATION_REVIEW_KEY);
  if(!rows.length){box.innerHTML='Da controllare: nessun collegamento volo ambiguo.';return}
  box.innerHTML=`<b>Da controllare — ${rows.length}</b>`+rows.map(row=>`<div>${esc(displayDate(row.date))} • ${esc(row.flightNo||'Flight')} • ${esc(row.dep||'?')} → ${esc(row.arr||'?')} • ${esc(row.schedOut||'--:--')}–${esc(row.schedIn||'--:--')} Z</div>`).join('');
}
function renderSettings(){const st=appSettings();$('setHomeBase').value=st.homeBase||'CMN';$('setFlightPrefix').value=st.flightPrefix||'MAC';$('setAircraftPrefix').value=st.aircraftPrefix||'CN-NM';$('setProfileName').value=st.profileName||'';$('setProfileRole').value=st.profileRole||'Captain';if($('setCurrency'))$('setCurrency').value=appCurrency();$('autoSyncEnabled').value=autoSyncEnabled()?'yes':'no';$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||$('cloudEmail').value||'';if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();updatePrefixUI();updateAppHeader();updateProfilePhotoSettings();updateCurrencyUI();fillPaySettings();renderWeeklyBackupStatus();updateCloudStatus();renderReconciliationReview();ensureAirportDb(false)}
function setEntryLockedUI(locked){$('flightForm').querySelectorAll('input:not(#editId),select,textarea').forEach(el=>{if(['blockDisplay','schedBlockDisplay','totalTimeDisplay','picDisplay','sicDisplay','flightInstructionDisplay','simInstructionDisplay','sectorDisplay','totalDutyDisplay','night'].includes(el.id))return;el.disabled=!!locked});$('creditDisplay').disabled=!!locked;if($('saveEntryBtn'))$('saveEntryBtn').disabled=!!locked;$('lockEntryBtn').disabled=false;$('lockEntryBtn').textContent=locked?'🔓 Unlock':'🔒 Lock';$('entryLockStatus').textContent=locked?'LOCKED • All entry data are protected from editing.':'Draft autosaves on this device. Lock the entry when all data are final.';$('entryLockStatus').classList.toggle('success',!!locked)}
const ENTRY_DRAFT_FIELDS=['editId','rosterLinkId','entryDraftId','dutyTypeFlight','date','flightNo','reg','type','simLocation','courseType','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','creditDisplay','role','seatPosition','callFromDayOff','picName','sicName','soName','instructorName','instructionType','night','ifr','pf','approachType','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','delayReason','remarks'];
let entryDraftTimer=null;
function entryDraftPool(){const v=load(ENTRY_DRAFTS_KEY);return Array.isArray(v)?v:[]}
function writeEntryDraftPool(rows){try{save(ENTRY_DRAFTS_KEY,(rows||[]).slice(-20));return true}catch(e){console.warn('Draft shelf unavailable',e);return false}}
function captureEntryDraft(){
  const data={};ENTRY_DRAFT_FIELDS.forEach(id=>{const el=$(id);if(el)data[id]=el.type==='checkbox'?el.checked:el.value});
  data.savedAt=new Date().toISOString();data.source=$('entrySourceDisplay')?.dataset.source||'manual';
  if(!data.editId&&!data.entryDraftId){data.entryDraftId=makeId();$('entryDraftId').value=data.entryDraftId}
  return data;
}
function draftMeaningful(d){
  if(!d)return false;
  if(d.editId||d.rosterLinkId)return true;
  const textFields=['flightNo','reg','type','simLocation','courseType','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','seatPosition','picName','sicName','soName','instructorName','instructionType','approachType','delayReason','remarks'];
  return textFields.some(k=>String(d[k]||'').trim())||d.dutyTypeFlight!=='Flight'||(d.date&&d.date!==today())||d.role!=='PIC'||!!d.callFromDayOff||d.ifr==='no'||d.pf==='yes'||['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].some(k=>Number(d[k]||0)>0)||durMins(d.creditDisplay||'0:00')>0;
}
function saveEntryDraft(){
  const d=captureEntryDraft();
  try{saveObject(ENTRY_DRAFT_KEY,d)}catch(e){console.warn('Active draft save unavailable',e)}
  if(!d.editId&&d.source==='manual'&&draftMeaningful(d)){
    const rows=entryDraftPool(),i=rows.findIndex(x=>x.entryDraftId===d.entryDraftId);if(i>=0)rows[i]=d;else rows.push(d);writeEntryDraftPool(rows);
  }
  renderEntryDraftShelf();return d;
}
function removeDraftFromPool(id){if(!id)return;writeEntryDraftPool(entryDraftPool().filter(x=>x.entryDraftId!==id))}
function clearEntryDraft(){const id=$('entryDraftId')?.value||loadObject(ENTRY_DRAFT_KEY,null)?.entryDraftId||'';try{removeBusinessValue(ENTRY_DRAFT_KEY)}catch{};removeDraftFromPool(id);renderEntryDraftShelf()}
function clearAllEntryDrafts(){try{removeBusinessValue(ENTRY_DRAFT_KEY);save(ENTRY_DRAFTS_KEY,[])}catch{};renderEntryDraftShelf()}
function restoreEntryDraftObject(d){
  if(!d)return false;
  ENTRY_DRAFT_FIELDS.forEach(id=>{const el=$(id);if(el&&d[id]!==undefined){if(el.type==='checkbox')el.checked=!!d[id];else el.value=d[id]}});
  if($('entrySourceDisplay')){$('entrySourceDisplay').dataset.source=d.source||'manual';setEntrySourceDisplay(d.source||'manual')}
  if(!$('entryDraftId').value&&!$('editId').value)$('entryDraftId').value=d.entryDraftId||makeId();
  setEntryTypeUI();setEntryLockedUI(false);if($('dutyTypeFlight').value==='Flight'&&$('schedOut').value&&!$('onDuty').value)syncOnDutyFromScheduleOut();calcEntry();updateAirportInfo();updateExaminerRemarkReminder();updateDelayUI();renderEntryDraftShelf();return true;
}
function restoreEntryDraft(){
  let d=loadObject(ENTRY_DRAFT_KEY,null);
  if(!d){const rows=entryDraftPool().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||'')));d=rows[0]||null}
  return restoreEntryDraftObject(d);
}
function openEntryDraft(id){const d=entryDraftPool().find(x=>x.entryDraftId===id);if(!d)return false;try{saveObject(ENTRY_DRAFT_KEY,d)}catch{};resetEntry(false);restoreEntryDraftObject(d);show('addView');return true}
function deleteEntryDraft(id){if(!id)return;const active=loadObject(ENTRY_DRAFT_KEY,null);removeDraftFromPool(id);if(active?.entryDraftId===id)removeBusinessValue(ENTRY_DRAFT_KEY);if($('entryDraftId')?.value===id)resetEntry(false);renderEntryDraftShelf()}
function renderEntryDraftShelf(){
  const box=$('entryDraftShelf');if(!box)return;
  const rows=entryDraftPool().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||'')));
  if(!rows.length){box.classList.add('hidden');box.innerHTML='';return}
  const current=$('entryDraftId')?.value||'';
  box.innerHTML=`<div class="draft-shelf-title"><b>Unsaved manual drafts</b><span>${rows.length}</span></div>`+rows.map(d=>{
    const sim=d.dutyTypeFlight==='Simulator',route=sim?(d.simLocation||'SIM'):[d.dep,d.arr].filter(Boolean).join(' → '),label=[d.date||'',d.flightNo?composeFlightNo(d.flightNo):'',route||d.dutyTypeFlight||'Draft'].filter(Boolean).join(' • ');
    return `<div class="draft-shelf-row${d.entryDraftId===current?' active':''}"><span>${esc(label)}</span><div><button type="button" class="secondary" data-open-entry-draft="${esc(d.entryDraftId)}">Open</button><button type="button" class="danger" data-delete-entry-draft="${esc(d.entryDraftId)}">Discard</button></div></div>`;
  }).join('');
  box.classList.remove('hidden');
}
function validEntryForSilentSave(){const dt=$('dutyTypeFlight').value;if(!$('date').value)return false;if((dt==='Flight'||dt==='DHD'||dt==='DHP')&&(!$('dep').value.trim()||!$('arr').value.trim()))return false;return true}
function silentAutosaveExisting(){clearTimeout(entryDraftTimer);entryDraftTimer=setTimeout(()=>{saveEntryDraft()},180)}
function scrollRosterAgendaIntoView(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>$('rosterAgenda')?.scrollIntoView({behavior:'smooth',block:'start'})));
}
function bindPilotLogSwipeGestures(){
  let addStart=null,calendarStart=null;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    const p=e.touches[0],stamp={x:p.clientX,y:p.clientY,at:Date.now()};
    if(!$('addView')?.classList.contains('hidden'))addStart=stamp;
    else{
      const viewport=e.target.closest('[data-roster-calendar-swipe]'),track=viewport?.querySelector('.roster-calendar-track');
      if(viewport&&track)calendarStart={...stamp,viewport,track,width:viewport.getBoundingClientRect().width,axis:null,lastX:p.clientX,lastAt:Date.now()};
    }
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!calendarStart||e.touches.length!==1)return;
    const p=e.touches[0],dx=p.clientX-calendarStart.x,dy=p.clientY-calendarStart.y;
    if(!calendarStart.axis&&Math.max(Math.abs(dx),Math.abs(dy))>6)calendarStart.axis=Math.abs(dx)>Math.abs(dy)*1.1?'x':'y';
    if(calendarStart.axis!=='x')return;
    e.preventDefault();
    const width=Math.max(1,calendarStart.width),drag=Math.max(-width,Math.min(width,dx));
    calendarStart.lastX=p.clientX;calendarStart.lastAt=Date.now();
    calendarStart.track.classList.add('dragging');
    calendarStart.track.style.transform=`translate3d(calc(-100% + ${drag}px),0,0)`;
  },{passive:false});
  document.addEventListener('touchend',e=>{
    const p=e.changedTouches?.[0];if(!p)return;
    if(addStart){
      const dx=p.clientX-addStart.x,dy=p.clientY-addStart.y,elapsed=Date.now()-addStart.at;addStart=null;
      if(dx>=70&&Math.abs(dx)>Math.abs(dy)*1.25&&elapsed<1200){saveEntryDraft();setEntryReturnContext(null);show('flightsView',{logbookEntryId:$('editId')?.value||''})}
      return;
    }
    if(calendarStart){
      const swipe=calendarStart,dx=p.clientX-swipe.x,dy=p.clientY-swipe.y,elapsed=Date.now()-swipe.at;calendarStart=null;
      if(swipe.axis!=='x'||Math.abs(dx)<=Math.abs(dy)){swipe.track.classList.remove('dragging');swipe.track.style.transform='';return}
      e.preventDefault();
      const speed=Math.abs(dx)/Math.max(1,elapsed),commit=Math.abs(dx)>=Math.min(80,Math.max(1,swipe.width)*.22)||speed>.45,direction=dx<0?1:-1;
      suppressRosterCalendarClickUntil=Date.now()+450;
      swipe.track.classList.remove('dragging');
      swipe.track.style.transform=commit?(direction>0?'translate3d(-200%,0,0)':'translate3d(0,0,0)'):'translate3d(-100%,0,0)';
      if(commit)setTimeout(()=>{rosterCalendarMonth=rosterShiftMonth(rosterCalendarMonth,direction);rosterSelectedDate='';renderRoster()},240);
    }
  },{passive:false});
  document.addEventListener('touchcancel',()=>{
    if(!calendarStart)return;
    calendarStart.track.classList.remove('dragging');calendarStart.track.style.transform='translate3d(-100%,0,0)';calendarStart=null;
  },{passive:true});
}
function syncOffDutyFromActualIn(){if($('dutyTypeFlight').value!=='Flight')return;const inn=$('in').value;if(inn)$('offDuty').value=shiftTime(inn,30);else if($('schedIn').value)$('offDuty').value=shiftTime($('schedIn').value,30)}
function syncProfileNameWithRole(force=false){
  const st=appSettings(),name=upper(st.profileName||'');if(!name)return;
  const source=$('entrySourceDisplay')?.dataset.source||'manual';if(!force&&source!=='manual')return;
  const role=$('role')?.value||'PIC',target=role==='PIC'?'picName':role==='SIC'?'sicName':'instructorName';
  ['picName','sicName','instructorName'].forEach(id=>{if(id!==target&&aerolineSamePerson($(id)?.value||'',name))$(id).value=''});
  if($(target))$(target).value=name;
}
function applyProfileDefaultsToEntry(){
  const st=appSettings(),name=upper(st.profileName||''),profileRole=st.profileRole||'Captain';
  if(profileRole==='Captain'){
    $('role').value='PIC';
    if(name&&!$('picName').value)$('picName').value=name;
  }else if(profileRole==='First Officer'){
    $('role').value='SIC';
    if(name&&!$('sicName').value)$('sicName').value=name;
  }
}
function applyAerolineFlightRoleRuleToForm(r){
  if(!r||r.source!=='aeroline')return false;
  const self=upper(appSettings().profileName||''),profileRole=appSettings().profileRole||'Captain',crew=(Array.isArray(r.aerolineCrew)?r.aerolineCrew:[]).map(upper).filter(Boolean);
  if(profileRole==='Captain'&&self){
    $('role').value='PIC';$('picName').value=self;
    if(crew.length===1){$('sicName').value=crew[0];$('soName').value=''}
    else if(crew.length>1){$('sicName').value='';$('soName').value=''}
    if(aerolineSamePerson($('instructorName').value,self))$('instructorName').value='';
    if(r.aerolineLineTraining)$('instructionType').value='Flight Instruction';
    return true;
  }
  if(profileRole==='First Officer'&&self){$('role').value='SIC';$('sicName').value=self;return true}
  return false;
}
function applyRosterCarryToForm(r){
  const c=rosterCarryDefaultsForItem(r);
  if(!c)return false;
  $('reg').value=aircraftIdInput(c.reg||'');
  $('type').value=upper(c.type||'');
  $('role').value=c.role||$('role').value;
  $('picName').value=upper(c.picName||'');
  $('sicName').value=upper(c.sicName||'');
  $('soName').value=upper(c.soName||'');
  $('instructorName').value=upper(c.instructorName||'');
  $('instructionType').value=c.instructionType||'';
  $('seatPosition').value=c.seatPosition||'';
  $('ifr').value=c.ifr||'yes';
  $('pf').value=c.pf||'no';
  return true;
}

function resetEntry(clearDraft=true){
  if(clearDraft)clearEntryDraft();clearEntryRosterActivityContext();
  const f=$('flightForm');f.reset();$('editId').value='';$('entryDraftId').value=makeId();if($('rosterLinkId'))$('rosterLinkId').value='';
  if($('entrySourceDisplay'))$('entrySourceDisplay').dataset.source='manual';setEntrySourceDisplay('manual');updatePrefixUI();
  $('date').value=today();$('dutyTypeFlight').value='Flight';$('role').value='PIC';$('seatPosition').value='';$('callFromDayOff').checked=false;$('night').value='00:00';$('ifr').value='yes';$('pf').value='no';$('approachType').value='';$('delayReason').value='';$('simLocation').value='';
  ['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);applyProfileDefaultsToEntry();$('entryTitle').textContent='Add log entry';setEntryLockedUI(false);setEntryTypeUI();calcEntry();$('sectorDisplay').value='';$('totalDutyDisplay').value='';updateAirportInfo();renderEntryDraftShelf();
}
function loadEntryToForm(f,options={}){
  resetEntry(false);const rosterActivity=!!options.rosterActivity,canonicalType=canonicalDutyType(f.dutyType||'Flight');
  $('editId').value=f.id;$('entryDraftId').value='';if($('rosterLinkId'))$('rosterLinkId').value=rosterActivity?(f.id||''):'';
  if($('entrySourceDisplay'))$('entrySourceDisplay').dataset.source=f.source||'manual';setEntrySourceDisplay(f.source||'manual');$('callFromDayOff').checked=!!f.callFromDayOff;
  const map={dutyTypeFlight:'dutyType'};
  ['dutyTypeFlight','date','type','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','role','seatPosition','instructionType','night','ifr','pf','approachType','remarks','courseType','picName','sicName','soName','instructorName','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','delayReason'].forEach(id=>{let v=id==='dutyTypeFlight'?canonicalType:f[map[id]||id];if(id==='pf'&&v==null)v=(Number(f.dayTakeoffs||0)+Number(f.nightTakeoffs||0)+Number(f.dayLandings||0)+Number(f.nightLandings||0))>0?'yes':'no';$(id).value=v??''});
  $('flightNo').value=flightNoInput(f.flightNo||'');$('reg').value=isSim(f)?upper(f.reg||''):aircraftIdInput(f.reg||'');$('simLocation').value=upper(f.location||(isSim(f)?f.dep:'')||'');$('creditDisplay').value=fmt(PilotLogEngine.credit({...f,dutyType:canonicalType}));$('sectorDisplay').value=String(f.sectors||'');$('totalDutyDisplay').value=f.totalDuty?fmt(f.totalDuty):'';
  setEntryTypeUI();if(isDhp(f))$('creditDisplay').value=fmt(Number(f.credit)||0);calcEntry();
  if(rosterActivity&&rosterCanEditLockedActivity({...f,dutyType:canonicalType})){
    entryRosterActivityContext={id:f.id,type:canonicalType,preserveLocked:!!f.locked};setEntryLockedUI(false);$('dutyTypeFlight').disabled=true;$('lockEntryBtn').classList.add('hidden');$('entryRosterDeleteBtn').classList.remove('hidden');$('entryTitle').textContent=`Edit roster ${canonicalType}`;setRosterActivityEditorUI(canonicalType);
  }else{$('entryTitle').textContent=f.locked?'View locked entry':'Edit log entry';setEntryLockedUI(!!f.locked)}
  updateAirportInfo();updateDelayUI();saveEntryDraft();
}


function confirmPossibleDayOffPaid(){
  const rid=$('rosterLinkId')?.value||'';if(!rid||$('callFromDayOff')?.checked)return true;
  const r=coreActivityRows().find(x=>x.id===rid);if(!r?.aerolinePossibleDayOffPaid||r.dayOffPaidPromptDismissed)return true;
  const reason=r.aerolineDayOffPaidSignal||'AeroLINE roster change';
  const yes=confirm(`Possible Day Off Paid detected for ${displayDate(r.date)}.\n\nSignal: ${reason}.\n\nMark “Called to work from a scheduled day off”?`);
  if(yes){$('callFromDayOff').checked=true;r.dayOffPaidPromptConfirmed=true;r._syncRev=recordRevision(r)+1;r._updatedAt=new Date().toISOString();upsertCoreActivity(r);markCloudEdited('activities',r,'edit');return true}
  r.dayOffPaidPromptDismissed=true;r._syncRev=recordRevision(r)+1;r._updatedAt=new Date().toISOString();upsertCoreActivity(r);markCloudEdited('activities',r,'edit');return true;
}
function collectEntry(lockedOverride=null){
  const c=calcEntry(),dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight'),id=$('editId').value||makeActivityId(),existing=entryActivityRows().find(x=>x.id===id),delayMinutes=dutyType==='Flight'?formDelayMinutes():0;
  const sim=dutyType==='Simulator',flight=dutyType==='Flight';
  return stamp({
    id,dutyType,date:$('date').value,flightNo:flight?composeFlightNo($('flightNo').value):'',
    reg:sim?upper($('reg').value):composeAircraftId($('reg').value),type:upper($('type').value),location:sim?upper($('simLocation').value):'',
    dep:sim?'':upper($('dep').value),arr:sim?'':upper($('arr').value),schedOut:$('schedOut').value,schedIn:$('schedIn').value,schedBlock:c.schedBlock,
    onDuty:$('onDuty').value,offDuty:$('offDuty').value,out:(flight||sim)?$('out').value:'',off:flight?$('off').value:'',on:flight?$('on').value:'',in:(flight||sim)?$('in').value:'',
    block:flight?c.block:0,flight:flight?c.flight:0,simulatorTime:sim?c.simulatorTime:0,credit:c.credit,simCreditExplicit:sim?true:!!existing?.simCreditExplicit,groundCreditExplicit:dutyType==='Ground Course'?true:!!existing?.groundCreditExplicit,
    role:sim?'':$('role').value,seatPosition:sim?'':($('seatPosition')?.value||''),callFromDayOff:!!$('callFromDayOff')?.checked,instructionType:$('instructionType').value,
    trainingSector:flight&&$('instructionType').value==='Flight Instruction',instructorFlightTime:flight&&$('instructionType').value==='Flight Instruction'?c.block:0,
    trainerType:existing?.trainerType||'',aerolineTrainerType:existing?.aerolineTrainerType||'',pax:existing?.pax??'',fuel:existing?.fuel??'',
    night:sim?'00:00':$('night').value,sim:sim?'yes':'no',ifr:sim?'no':$('ifr').value,
    dayTakeoffs:sim?0:Number($('dayTakeoffs').value||0),nightTakeoffs:sim?0:Number($('nightTakeoffs').value||0),dayLandings:sim?0:Number($('dayLandings').value||0),nightLandings:sim?0:Number($('nightLandings').value||0),
    courseType:upper($('courseType')?.value||''),picName:upper($('picName')?.value||''),sicName:upper($('sicName')?.value||''),soName:upper($('soName')?.value||''),instructorName:upper($('instructorName')?.value||''),
    pf:sim?'no':($('pf')?.value||'no'),approachType:sim?'':upper($('approachType')?.value||''),approaches:sim||!$('approachType')?.value?[]:[{type:upper($('approachType').value),quantity:1}],delayMinutes,delayReason:delayMinutes?upper($('delayReason')?.value||''):'',remarks:$('remarks').value.trim(),
    locked:lockedOverride===null?!!existing?.locked:!!lockedOverride,source:existing?.source||$('entrySourceDisplay')?.dataset.source||'manual',manualOverride:true,
    recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:entryRosterActivityContext?(existing?.activityStatus===ACTIVITY_STATUS.PLANNED?ACTIVITY_STATUS.OPEN:(existing?.activityStatus||ACTIVITY_STATUS.OPEN)):ACTIVITY_STATUS.COMPLETED,
    completedAt:entryRosterActivityContext?existing?.completedAt||'':existing?.completedAt||new Date().toISOString()
  });
}
function persistEntry(lockIt=false){
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');if(!$('date').value){alert('Please enter the date.');return false}
  if((dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP')&&(!$('dep').value.trim()||!$('arr').value.trim())){alert('Please enter From and To.');return false}
  if(dutyType==='Flight'&&!promptDelayReasonIfNeeded())return false;
  const id=$('editId').value,fs=entryActivityRows(),existing=id?fs.find(x=>x.id===id):null,rosterEdit=!!(existing&&entryRosterActivityContext?.id===existing.id&&rosterCanEditLockedActivity(existing));
  if(existing?.locked&&!lockIt&&!rosterEdit){alert('This entry is locked. Unlock it before editing.');return false}
  const f=collectEntry(lockIt?true:(rosterEdit?null:false)),saved=upsertCoreActivity(f);$('editId').value=saved.id;markCloudEdited('activities',saved,lockIt?'lock':(existing?'edit':'create'));
  reconcileAllDuties();refreshEntrySuggestions();saveEntryDraft();scheduleAutoSync(lockIt?'lock-entry':'save-entry');return saved;
}



function runRosterLogbookIntegrityCheck(){
  const activities=coreActivityRows(),flights=activities.filter(isFlight),logbook=activities.filter(isCompletedLogbookEntry),ids=new Set(),duplicateIds=[],legacyFields=[],semanticDuplicates=[];
  for(const row of activities){
    if(ids.has(row.id))duplicateIds.push(row);else ids.add(row.id);
    const found=Object.values(LEGACY_ACTIVITY_FIELDS).filter(key=>Object.prototype.hasOwnProperty.call(row,key));if(found.length)legacyFields.push({row,fields:found});
  }
  const flightBuckets=new Map();
  for(const row of flights){
    const digits=rawFlightDigits(row.flightNo),key=digits&&row.date&&row.dep&&row.arr?`${row.date}|${digits}|${upper(row.dep)}|${upper(row.arr)}`:`${row.date||''}|${upper(row.dep)}|${upper(row.arr)}`;
    const bucket=flightBuckets.get(key)||[];
    for(const candidate of bucket)if(unifiedFlightMatch(candidate,row))semanticDuplicates.push([candidate,row]);
    bucket.push(row);flightBuckets.set(key,bucket);
  }
  const invalidLogbook=logbook.filter(x=>x.activityStatus!==ACTIVITY_STATUS.COMPLETED),missingCompleted=flights.filter(x=>x.activityStatus===ACTIVITY_STATUS.COMPLETED&&!logbook.some(y=>y.id===x.id));
  const issues=duplicateIds.length+legacyFields.length+semanticDuplicates.length+invalidLogbook.length+missingCompleted.length;
  const result={checkedAt:new Date().toISOString(),activities:activities.length,flights:flights.length,logbook:logbook.length,duplicateIds,legacyFields,semanticDuplicates,invalidLogbook,missingCompleted};
  const status=$('integrityStatus'),out=$('integrityResults');
  if(status)status.textContent=`${activities.length} Core activities checked • ${flights.length} flight records • ${logbook.length} completed Logbook records • ${issues} issue(s)`;
  if(out){
    if(!issues){out.innerHTML='<strong>PASS</strong> — Roster and Logbook are functional filters of the same Core activity records.'}
    else out.innerHTML=`<strong>REVIEW</strong> — duplicate IDs ${duplicateIds.length} • legacy view fields ${legacyFields.length} • duplicate flight records ${semanticDuplicates.length} • invalid Logbook filters ${invalidLogbook.length+missingCompleted.length}`;
  }
  return result;
}

document.addEventListener('DOMContentLoaded',async()=>{
  await initFlightStore();
  bindPilotLogSwipeGestures();
  document.querySelector('.nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b){e.preventDefault();show(b.dataset.view)}});
  document.addEventListener('change',e=>{
    if(e.target.id==='rosterMonthSelect'){
      if(/^\d{4}-\d{2}$/.test(e.target.value)){rosterCalendarMonth=e.target.value;rosterSelectedDate='';renderRoster()}return;
    }
    const el=e.target.closest('.pay-dayoff-remark');
    if(!el)return;
    const month=$('payrollMonth').value||monthNow();
    saveDayOffRemark(month,el.dataset.dayoffDate,el.value);
    scheduleAutoSync('payroll-dayoff-remark');
  });
  $('runIntegrityCheckBtn')?.addEventListener('click',runRosterLogbookIntegrityCheck);
  $('deepResetBtn')?.addEventListener('click',deepFactoryResetPilotLog);
  $('deepLocalResetBtn')?.addEventListener('click',deepLocalResetPilotLog);
  $('logbookAddBtn').addEventListener('click',()=>{setEntryReturnContext(null);if(!restoreEntryDraft())resetEntry(false);show('addView')});
  document.addEventListener('keydown',e=>{if((e.key!=='Enter'&&e.key!==' ')||e.target.closest('button,input,select,textarea'))return;const row=e.target.closest('[data-edit-flight]');if(!row)return;e.preventDefault();row.click()});
  $('logbookSearch')?.addEventListener('input',e=>{logbookSearchQuery=e.target.value||'';logbookRenderLimit=LOGBOOK_RENDER_STEP;renderEntriesSafe();if(logbookSearchQuery.trim().length>=2&&!airportDbLoaded)ensureAirportDb(false).then(()=>renderEntriesSafe()).catch(()=>{})});
  $('clearLogbookSearch')?.addEventListener('click',()=>{logbookSearchQuery='';logbookRenderLimit=LOGBOOK_RENDER_STEP;if($('logbookSearch'))$('logbookSearch').value='';renderEntriesSafe();$('logbookSearch')?.focus()});
  $('lockAllEntriesBtn')?.addEventListener('click',()=>lockAllLogbookEntries().catch(err=>alert('Lock all entries failed: '+err.message)));
  $('entryBackBtn').addEventListener('click',()=>{
    saveEntryDraft();
    const ctx=entryReturnContext;setEntryReturnContext(null);
    if(ctx?.view==='flightsView')show('flightsView',{logbookEntryId:ctx.entryId||$('editId').value});
    else if(ctx?.view==='rosterView')show('rosterView');
    else show('flightsView');
  });
  $('entryRosterDeleteBtn')?.addEventListener('click',deleteRosterEntryActivity);
  $('dutyBackBtn')?.addEventListener('click',()=>{resetDutyEditor();show('rosterView')});
  $('dutyDeleteRosterBtn')?.addEventListener('click',deleteRosterDutyActivity);
  bindExpiryEvents();
  document.querySelectorAll('[data-upper]').forEach(el=>el.addEventListener('input',()=>{const p=el.selectionStart;el.value=upper(el.value);try{el.setSelectionRange(p,p)}catch{}}));
  $('flightForm').addEventListener('input',silentAutosaveExisting);
  $('flightForm').addEventListener('change',silentAutosaveExisting);
  ['dep','arr','simLocation'].forEach(id=>$(id).addEventListener('change',async()=>{await updateAirportInfo();calcEntry();if(['dep','arr'].includes(id))await calcNightForForm();silentAutosaveExisting()}));
  $('date').addEventListener('change',()=>{calcEntry();silentAutosaveExisting()});
  ['out','off','on','in','schedOut','schedIn','onDuty','offDuty','role','instructionType','pf','approachType'].forEach(id=>$(id).addEventListener('input',async()=>{if(id==='schedOut')syncOnDutyFromScheduleOut();if(id==='in')syncOffDutyFromActualIn();if(id==='role')syncProfileNameWithRole();calcEntry();if(['out','off','on','in','pf'].includes(id))await calcNightForForm();silentAutosaveExisting()}));
  $('out').addEventListener('change',()=>{updateDelayUI();if(formDelayMinutes()>0&&!$('delayReason').value)promptDelayReasonIfNeeded();silentAutosaveExisting()});
  $('role').addEventListener('input',updateExaminerRemarkReminder);
  $('dutyTypeFlight').addEventListener('change',()=>{const dt=canonicalDutyType($('dutyTypeFlight').value);if(dt==='Ground Course')$('creditDisplay').value=fmt(PilotLogEngine.credit({dutyType:'Ground Course',credit:0,groundCreditExplicit:false,source:'manual'}));setEntryTypeUI();if(dt==='Flight')syncProfileNameWithRole();calcEntry();silentAutosaveExisting()});
  $('courseType').addEventListener('input',()=>calcEntry());
  $('onDuty').addEventListener('input',()=>calcEntry());
  $('creditDisplay').addEventListener('change',()=>{const dt=canonicalDutyType($('dutyTypeFlight').value);if(dt==='Simulator'||dt==='DHP'||dt==='Ground Course')$('creditDisplay').value=fmt(durMins($('creditDisplay').value));if(dt==='DHD')$('creditDisplay').value='0:00';calcEntry();silentAutosaveExisting()});
  $('flightForm').addEventListener('submit',e=>e.preventDefault());
  $('entryDraftShelf').addEventListener('click',e=>{const open=e.target.closest('[data-open-entry-draft]');if(open){openEntryDraft(open.dataset.openEntryDraft);return}const del=e.target.closest('[data-delete-entry-draft]');if(del&&confirm('Discard this unsaved draft?'))deleteEntryDraft(del.dataset.deleteEntryDraft)});
  $('returnFlight').addEventListener('click',createReturnFlight);
  $('clearForm').addEventListener('click',()=>{setEntryReturnContext(null);resetEntry()});
  $('saveEntryBtn').addEventListener('click',async()=>{
    if(canonicalDutyType($('dutyTypeFlight').value)==='Flight')await calcNightForForm();
    const rosterId=$('rosterLinkId')?.value||'',returnToRoster=entryReturnContext?.view==='rosterView';
    if(!confirmPossibleDayOffPaid())return;const saved=persistEntry(false);if(!saved)return;
    clearEntryDraft();await render();
    if(returnToRoster||rosterId){clearEntryRosterActivityContext();setEntryReturnContext(null);show('rosterView');scheduleAutoSync(rosterId?'roster-flight-complete':'roster-activity-save',300)}
    else show('flightsView',{logbookEntryId:saved.id});
  });
  $('lockEntryBtn').addEventListener('click',async()=>{const id=$('editId').value,existing=id?coreActivityRows().find(x=>x.id===id):null;if(existing?.locked){if(!confirm('Unlock this entry and allow editing?'))return;existing.locked=false;existing._updatedAt=new Date().toISOString();existing._syncRev=recordRevision(existing)+1;upsertCoreActivity(existing);markCloudEdited('activities',existing,'unlock');setEntryLockedUI(false);saveEntryDraft();scheduleAutoSync('unlock-entry');return}if(canonicalDutyType($('dutyTypeFlight').value)==='Flight')await calcNightForForm();if(!confirmPossibleDayOffPaid())return;if(!confirm('Lock this entry? Its data will be protected from accidental editing.'))return;const saved=persistEntry(true);if(!saved)return;setEntryLockedUI(true);saveEntryDraft();await render();const latest=coreActivityRows().find(x=>x.id===saved.id);if(latest)loadEntryToForm(latest);show('addView')});
  $('dutyForm').addEventListener('submit',e=>{e.preventDefault();const id=$('dutyEditId')?.value||makeActivityId(),existing=coreActivityRows().find(x=>x.id===id),rep=$('reportTime').value,end=$('endDuty').value,d=stamp({...existing,id,recordKind:'activity',activityCategory:'DUTY',activityStatus:existing?.activityStatus||ACTIVITY_STATUS.COMPLETED,dutyType:$('dutyType').value,date:$('dutyDate').value,onDuty:rep,offDuty:end,dutyMinutes:timeSpanMins(rep,end),remarks:$('dutyNotes').value.trim(),manualOverride:true});upsertCoreActivity(d);markCloudEdited('activities',d,existing?'edit':'create');reconcileAllDuties();const returnToRoster=!!dutyRosterContext;resetDutyEditor();renderDuty();render();scheduleAutoSync('duty-save');if(returnToRoster)show('rosterView')});
  ['tripStart','tripEnd'].forEach(id=>$(id).addEventListener('input',tripCalc));$('tripCashAmount')?.addEventListener('input',tripCalc);['tripCashAmount','tripCashCurrency','tripStart'].forEach(id=>$(id)?.addEventListener('change',()=>tripMoneyConversion()));$('calcTrip').addEventListener('click',()=>tripMoneyConversion());$('clearTrip').addEventListener('click',resetTrip);
  $('tripForm').addEventListener('submit',async e=>{e.preventDefault();const c=tripCalc();if(!c)return alert('Enter a valid Trip Start and Trip End.');const fx=await tripMoneyConversion();if(fx?.error)return alert(fx.error);const ts=load(TRIPS_KEY),id=$('tripEditId').value||makeId(),existing=ts.find(x=>x.id===id),cashAmount=Number($('tripCashAmount')?.value||0),cashCurrency=upper($('tripCashCurrency')?.value||''),cashRates={...(existing?.cashFxRates||{})};if(cashAmount>0&&fx?.cashRate>0)cashRates[appCurrency()]={from:cashCurrency,to:appCurrency(),rate:fx.cashRate,date:fx.cashFxDate,tripStartDate:fx.tripStartDate};const t=stamp({...existing,id,base:upper(appSettings().homeBase||'CMN'),stations:upper($('tripStations').value),start:$('tripStart').value,end:$('tripEnd').value,trip:c.trip,duty:c.duty,layover:c.layover,allowance:c.allowance,allowanceCurrency:'MAD',cashEligible:existing?.cashEligible||false,cashAmount,cashCurrency,cashConverted:cashAmount>0?Number(fx?.cashConverted||0):0,cashEur:appCurrency()==='EUR'&&cashAmount>0?Number(fx?.cashConverted||0):Number(existing?.cashEur||0),cashFxFrom:cashAmount>0?cashCurrency:'',cashFxTo:cashAmount>0?appCurrency():'',cashFxRate:cashAmount>0?Number(fx?.cashRate||0):0,cashFxDate:cashAmount>0?String(fx?.cashFxDate||''):'',cashFxTripStartDate:cashAmount>0?String(fx?.tripStartDate||''):'',cashFxRates:cashRates,tripFxTo:appCurrency(),tripFxMadRate:Number(fx?.madRate||0),tripFxDate:String(fx?.cashFxDate||fx?.tripStartDate||''),tripFxTripStartDate:String(fx?.tripStartDate||''),manualOverride:true,remarks:$('tripRemarks').value.trim()}),i=ts.findIndex(x=>x.id===id);if(i>=0)ts[i]=t;else ts.push(t);save(TRIPS_KEY,ts);markCloudEdited('trips',t,existing?'edit':'create');resetTrip();renderTrips();renderPayroll();scheduleAutoSync('trip-save');alert('Trip saved.')});
  $('screenshotFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    clearScreenshotReview();
    $('screenshotOcrWrap').classList.add('hidden');
    if(screenshotObjectUrl)URL.revokeObjectURL(screenshotObjectUrl);
    screenshotObjectUrl=URL.createObjectURL(file);
    $('screenshotPreview').src=screenshotObjectUrl;
    $('screenshotPreviewWrap').classList.remove('hidden');
    try{
      const text=await runScreenshotOcr(file);
      $('screenshotOcrText').value=text;
      $('screenshotOcrWrap').classList.remove('hidden');
      screenshotReviewRows=parseScreenshotText(text);
      renderScreenshotReview();
      const crewGrid=/INDIVIDUAL\s+CREW\s+SCHEDULE\s+REPORT/i.test(text),smart=screenshotSmartCells.length;
      $('screenshotImportStatus').textContent=screenshotReviewRows.length
        ?`${smart?'Smart Cell Scan':'OCR'} complete${crewGrid?' — Crew Schedule detected':''}. ${screenshotReviewRows.length} review row(s) created${smart?` from ${smart} populated day(s)`:''}. Complete yellow fields before importing.`
        :'OCR complete, but no structured rows were detected. Review the OCR text or try a sharper/full-page screenshot.';
    }catch(err){
      console.error('Screenshot OCR failed',err);
      $('screenshotOcrWrap').classList.remove('hidden');
      $('screenshotImportStatus').textContent=`OCR unavailable: ${err.message} You can paste or type recognized text manually and press Parse / Re-parse.`;
    }
  });
  $('parseScreenshotText').addEventListener('click',()=>{
    screenshotReviewRows=parseScreenshotText($('screenshotOcrText').value);
    renderScreenshotReview();
    $('screenshotImportStatus').textContent=screenshotReviewRows.length?`${screenshotReviewRows.length} review row(s) detected.`:'No structured rows detected. Adjust the OCR text or choose the correct screenshot type.';
  });
  $('screenshotReviewBody').addEventListener('input',e=>updateScreenshotReviewFromControl(e.target));
  $('screenshotReviewBody').addEventListener('change',e=>{updateScreenshotReviewFromControl(e.target);renderScreenshotReview()});
  $('importScreenshotReviewed').addEventListener('click',()=>importReviewedScreenshot().then(()=>scheduleAutoSync('screenshot-import')).catch(err=>{console.error(err);alert('Screenshot import failed: '+err.message)}));
  $('clearScreenshotReview').addEventListener('click',()=>{clearScreenshotReview();$('screenshotImportStatus').textContent='Review cleared. The OCR text is still available.'});
  $('exportEasaPdf').addEventListener('click',exportEasaStylePdf);
  $('exportExperienceCsv').addEventListener('click',exportExperienceCsv);
  $('exportBackupJson').addEventListener('click',exportFullBackupJson);
  $('restoreBackupJsonFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await restoreFullBackupJsonFile(file)}catch(err){console.error('Full backup restore failed',err);alert('Restore failed: '+err.message)}finally{e.target.value=''}});
  $('exportCsv').addEventListener('click',()=>{const d=coreActivityRows().filter(isCompletedLogbookEntry);if(!d.length)return alert('No entries to export');const cols=['dutyType','date','flightNo','reg','type','location','dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty','totalDuty','sectors','out','off','on','in','block','flight','simulatorTime','credit','role','seatPosition','callFromDayOff','instructionType','night','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','ifr','pf','approachType','remarks','locked'];download('pilotlog_logbook.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  $('exportLogTen').addEventListener('click',logTenExport);
  const updateEasaRangeUI=()=>{const period=$('easaExportMode').value==='period';$('easaFrom').disabled=!period;$('easaTo').disabled=!period};
  $('easaExportMode').addEventListener('change',updateEasaRangeUI);updateEasaRangeUI();
  $('aerolineLoginBtn').addEventListener('click',()=>{
    try{aerolineOpenLogin();$('aerolineConnectStatus').textContent='AeroLINE opened in a new tab. Sign in there, then return here and press Sync AeroLINE.';$('aerolineConnectStatus').dataset.state='busy'}
    catch(err){$('aerolineConnectStatus').textContent=err.message;$('aerolineConnectStatus').dataset.state='error'}
  });
  $('saveAerolineSetupBtn').addEventListener('click',()=>{
    const crewId=String($('aerolineCrewId').value||'').trim(),crewProfileRaw=String($('aerolineCrewProfileId').value||'').trim(),crewProfileID=crewProfileRaw?Number(crewProfileRaw):0,crewType=upper($('aerolineCrewType').value||'');
    if(crewId&&!/^\d+$/.test(crewId))return alert('Crew ID must contain digits only.');
    if(crewProfileRaw&&!Number.isFinite(crewProfileID))return alert('Crew Profile ID is not valid.');
    saveAerolineConfig({crewId,crewProfileID,crewType});renderAerolineConnect();alert('AeroLINE setup saved on this device.');
  });
  $('aerolineSyncBtn').addEventListener('click',async()=>{
    const month=$('aerolineSyncMonth').value;
    if(!month)return alert('Select the AeroLINE roster month.');
    const status=$('aerolineConnectStatus'),button=$('aerolineSyncBtn');
    markLocalOnlyImport('AeroLINE direct import in progress');
    button.disabled=true;status.textContent='Connecting to AeroLINE…';status.dataset.state='busy';
    try{
      const r=await syncAerolineMonth(month),imported=r.flightsAdded+r.activitiesAdded+r.offAdded,updated=r.flightsUpdated+r.activitiesUpdated+r.offUpdated,expiryText=r.expiryImport?` • Expiry ${r.expiryImport.added} added / ${r.expiryImport.updated} updated`:'';
      autoDetectTrips(false);await render();await renderRoster();renderDuty();markLocalOnlyImport('AeroLINE direct import');
      status.textContent=`Connected • ${r.monthLabel||month} • ${r.flights.length} flights • ${r.activities.length} activities • ${r.daysOff.length} OFF • ${imported} added • ${updated} updated${r.staleRemoved?` • ${r.staleRemoved} stale removed`:''}${expiryText}`;status.dataset.state='ok';
    }catch(err){console.error('AeroLINE direct sync failed',err);status.textContent=err.message;status.dataset.state='error'}
    finally{button.disabled=false}
  });
  $('aerolineRosterFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    markLocalOnlyImport('AeroLINE JSON import in progress');
    try{
      const text=await file.text(),payload=JSON.parse(String(text||'').replace(/^\uFEFF/,''));
      const r=importAerolineRosterObject(payload);e.target.value='';
      autoDetectTrips(false);await render();await renderRoster();renderDuty();renderAerolineConnect();markLocalOnlyImport('AeroLINE JSON import');
      const imported=r.flightsAdded+r.activitiesAdded+r.offAdded,updated=r.flightsUpdated+r.activitiesUpdated+r.offUpdated,expiryText=r.expiryImport?` • Expiry ${r.expiryImport.added} added / ${r.expiryImport.updated} updated`:'';
      const extras=r.unsupported.length?` • Unsupported codes: ${r.unsupported.join(', ')}`:'';
      $('aerolineImportStatus').textContent=`${r.monthLabel||'AeroLINE'} • ${r.flights.length} flights • ${r.activities.length} activities • ${r.daysOff.length} OFF • ${imported} added • ${updated} updated${r.staleRemoved?` • ${r.staleRemoved} stale removed`:''}${expiryText}${extras}`;
      alert(`AeroLINE roster imported: ${r.monthLabel||''}\n${r.flights.length} flights • ${r.activities.length} activities • ${r.daysOff.length} OFF\n${imported} added • ${updated} updated${r.staleRemoved?` • ${r.staleRemoved} stale removed`:''}${expiryText}`);
    }catch(err){e.target.value='';console.error('AeroLINE import failed',err);alert('AeroLINE import failed: '+err.message)}
  });
  $('logTenFullFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    markLocalOnlyImport('Complete LogTen migration in progress');showImportProgress('Importing LogTen Pro');
    try{
      $('logTenImportStatus').textContent='Importing complete LogTen migration… progress is shown on screen.';
      const r=await importLogTenMigrationPackage(file);e.target.value='';
      setImportProgress(99,'Import complete • refreshing PilotLog…');await render();renderDuty();setImportProgress(100,'Complete');await yieldToUi();
      markLocalOnlyImport(`Complete LogTen migration — ${r.total.toLocaleString('en-US')} rows ready`);
      if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();
      const span=r.manifest?.dateFrom&&r.manifest?.dateTo?`\n${displayDate(r.manifest.dateFrom)} – ${displayDate(r.manifest.dateTo)}`:'';
      $('logTenImportStatus').textContent=`Complete LogTen migration • ${r.total.toLocaleString('en-US')} logbook rows • ${r.imported.toLocaleString('en-US')} added • ${r.updated.toLocaleString('en-US')} matched/updated • ${(r.expiryImport?.total||0)} licences/validities • ${(r.tripImport?.total||0)} trips. Credit H is calculated from Scheduled Block Hours. Original SQLite database archived locally • verified local rows ${r.verified.toLocaleString('en-US')}. Nothing has been sent to cloud.`;
      const ex=r.expiryImport||{imported:0,updated:0,total:0},tr=r.tripImport||{imported:0,updated:0,total:0};
      alert(`Complete LogTen migration imported.${span}\nLogbook: ${r.imported.toLocaleString('en-US')} new • ${r.updated.toLocaleString('en-US')} matched/updated\nLicences/validities: ${ex.imported} new • ${ex.updated} updated\nTrips: ${tr.imported} new • ${tr.updated} updated\nCredit H: calculated from Scheduled Block Hours.\nOriginal LogTen database archived byte-for-byte on this device.\n\nLOCAL VERIFY: ${r.verified.toLocaleString('en-US')} LogTen IDs present.\nNothing has been sent to cloud.`);
    }catch(err){e.target.value='';console.error('Complete LogTen import failed',err);if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();$('logTenImportStatus').textContent='Complete LogTen migration failed: '+err.message;alert('Complete LogTen migration failed: '+err.message)}
    finally{hideImportProgress()}
  });
  $('exportLogTenArchive').addEventListener('click',()=>exportArchivedLogTenDatabase().catch(err=>alert('LogTen archive export failed: '+err.message)));
  $('logTenFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;markLocalOnlyImport('LogTen Tab import in progress');try{const r=logTenImport(await file.text());e.target.value='';autoDetectTrips(false);await render();markLocalOnlyImport('LogTen Tab import');$('logTenImportStatus').textContent=`Imported ${r.imported} new, repaired/updated ${r.updated}, simulators ${r.sims}, other duties ${r.other}${r.duplicatesRemoved?`, duplicates merged ${r.duplicatesRemoved}`:''}.`;alert(`LogTen import complete.${r.duplicatesRemoved?` ${r.duplicatesRemoved} duplicate${r.duplicatesRemoved===1?'':'s'} merged.`:''}`)}catch(err){alert('LogTen import failed: '+err.message)}});
  $('calendarFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;markLocalOnlyImport('Calendar import in progress');try{const events=parseIcs(await file.text());if(!events.length)throw new Error('No calendar events found.');const r=importCalendar(events);e.target.value='';autoDetectTrips(false);await render();markLocalOnlyImport('Calendar import');$('calendarImportStatus').textContent=`Imported ${r.sectors} flight sectors, ${r.duties} duties and ${r.other} other entries. ${r.skipped} skipped.`;alert(`Imported: ${r.sectors} flights • ${r.duties} duties • ${r.other} other entries`)}catch(err){alert('Calendar import failed: '+err.message)}});
  $('rosterFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;markLocalOnlyImport('Roster CSV import in progress');const rows=parseCsv(await file.text());if(rows.length<2)return alert('CSV contains no data');const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''),aliases={date:['date','day'],flightNo:['flightno','flightnumber','flight','flt'],dep:['dep','departure','from','origin'],arr:['arr','arrival','to','destination'],std:['std','departuretime','scheduleddeparture','offblock'],sta:['sta','arrivaltime','scheduledarrival','onblock']},fieldFor=h=>Object.keys(aliases).find(k=>aliases[k].includes(norm(h)))||null,map=rows[0].map(fieldFor),imp=rows.slice(1).map(r=>{const o={id:makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',source:'roster'};map.forEach((k,i)=>{if(k)o[k]=r[i]||''});o.date=normalDate(o.date);o.schedOut=o.std||'';o.schedIn=o.sta||'';delete o.std;delete o.sta;['dep','arr','flightNo'].forEach(k=>o[k]=upper(o[k]));if(o.flightNo)o.flightNo=rosterFlightLabel(o.flightNo);return o}).filter(x=>x.date&&(x.dep||x.arr||x.flightNo));commitCoreActivities([...coreActivityRows(),...imp]);e.target.value='';await render();markLocalOnlyImport('Roster CSV import');alert(`${imp.length} roster sectors imported`)});
  $('detectTripsBtn').addEventListener('click',()=>autoDetectTrips(true));
  $('profilePhotoInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{const profilePhotoData=await profilePhotoDataFromFile(file);saveAppSettings({profilePhotoData});updateAppHeader();updateProfilePhotoSettings();scheduleAutoSync('profile-photo')}
    catch(err){alert(err.message||'PHOTO COULD NOT BE ADDED.')}
    finally{e.target.value=''}
  });
  $('removeProfilePhoto').addEventListener('click',()=>{
    if(!confirm('REMOVE THE PERSONAL PHOTO AND RESTORE THE PILOTLOG LOGO?'))return;
    saveAppSettings({profilePhotoData:''});updateAppHeader();updateProfilePhotoSettings();scheduleAutoSync('profile-photo-remove');
  });
  $('appSettingsForm').addEventListener('submit',async e=>{e.preventDefault();const previousCurrency=appCurrency(),nextCurrency=upper($('setCurrency')?.value||'MAD');saveAppSettings({homeBase:upper($('setHomeBase').value)||'CMN',flightPrefix:cleanPrefix($('setFlightPrefix').value)||'MAC',aircraftPrefix:cleanPrefix($('setAircraftPrefix').value)||'CN-NM',profileName:$('setProfileName').value.trim(),profileRole:$('setProfileRole').value||'Captain',currency:ISO_CURRENCIES.includes(nextCurrency)?nextCurrency:'MAD'});setAutoSyncEnabled($('autoSyncEnabled').value==='yes');if(previousCurrency!==appCurrency())await refreshTripFxForCurrency(appCurrency());renderSettings();renderTrips();renderPayroll();if(!$('editId').value)applyProfileDefaultsToEntry();refreshEntrySuggestions();scheduleAutoSync('settings');alert('Settings saved.')});
  $('refreshAirportsBtn').addEventListener('click',()=>ensureAirportDb(true));
  $('cloudEmail').addEventListener('change',()=>localStorage.setItem(LAST_EMAIL_KEY,$('cloudEmail').value.trim()));
  $('cloudSignUpBtn').addEventListener('click',async()=>{try{await cloudSignUp()}catch(e){alert('Create account failed: '+e.message)}});
  $('cloudSignInBtn').addEventListener('click',async()=>{try{await cloudSignIn()}catch(e){alert('Sign in failed: '+e.message)}});
  $('cloudSignOutBtn').addEventListener('click',async()=>{try{await cloudSignOut()}catch(e){alert('Sign out failed: '+e.message)}});
  $('syncCloudBtn').addEventListener('click',()=>syncSupabase({silent:false,reason:'manual'}));
  $('backupNowBtn').addEventListener('click',async()=>{try{await createWeeklyBackup(true);alert('Weekly backup updated.')}catch(e){alert('Backup failed: '+e.message)}});
  $('restoreWeeklyBackupBtn').addEventListener('click',()=>restoreWeeklyBackup().catch(e=>alert('Restore failed: '+e.message)));
  $('autoSyncEnabled').addEventListener('change',()=>{setAutoSyncEnabled($('autoSyncEnabled').value==='yes');if(autoSyncEnabled())scheduleAutoSync('enabled',300)});

  $('payrollMonth').addEventListener('change',renderPayroll);$('recalcPayroll').addEventListener('click',()=>{const month=$('payrollMonth').value||monthNow(),ex=monthExtras(month);saveMonthExtras(month,{...ex,dayOffCount:0,arrears:Number($('payArrears').value||0)});scheduleAutoSync('payroll-month');renderPayroll()});
  $('paySettingsForm').addEventListener('submit',e=>{e.preventDefault();saveObject(PAY_SETTINGS_KEY,{...readPaySettings(),_updatedAt:new Date().toISOString()});setEntryTypeUI();renderPayroll();scheduleAutoSync('payroll-settings');alert('Payroll settings saved.')});
  $('resetPaySettings').addEventListener('click',()=>{if(confirm('Restore default rates?')){saveObject(PAY_SETTINGS_KEY,PAY_DEFAULTS);fillPaySettings();renderPayroll()}});
  $('deleteAll').addEventListener('click',async()=>{if(confirm('Delete ALL saved log entries? This cannot be undone.')){const targets=coreActivityRows().filter(isCompletedLogbookEntry),ids=new Set(targets.map(x=>x.id));targets.forEach(x=>markCloudDeleted('activities',x,{includeSource:false}));removeCoreActivities(x=>ids.has(x.id));await persistCoreActivities();clearAllEntryDrafts();await render();scheduleAutoSync('delete-all-entries')}});
  $('clearRoster').addEventListener('click',async()=>{if(confirm('Clear the complete imported roster? Flights, OFF, DHD/DHP, standby and training roster activities will be removed. Locked Logbook entries are preserved.')){const r=await clearImportedRosterData();await render();renderDuty();renderTrips();scheduleAutoSync('clear-roster');alert(`Roster cleared: ${r.roster} sectors • ${r.entries} activities • ${r.duties} duties removed.`)}});
  $('exportRoster').addEventListener('click',()=>{const d=rosterFlightRows();if(!d.length)return alert('No roster to export');const cols=['date','flightNo','dep','arr','std','sta','status'];download('pilotlog_roster.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  document.addEventListener('click',async e=>{let b=e.target.closest('[data-roster-today]');if(b){rosterSelectedDate=today();rosterCalendarMonth=rosterSelectedDate.slice(0,7);await renderRoster();scrollRosterAgendaIntoView();return}
    b=e.target.closest('[data-roster-date]');if(b){if(Date.now()<suppressRosterCalendarClickUntil)return;const date=b.dataset.rosterDate;rosterSelectedDate=rosterSelectedDate===date?'':date;if(rosterSelectedDate)rosterCalendarMonth=date.slice(0,7);await renderRoster();if(rosterSelectedDate)scrollRosterAgendaIntoView();return}
    b=e.target.closest('[data-delete-flight]');if(b){if(!confirm('Confirm to delete this log entry?'))return;const victim=coreActivityRows().find(f=>f.id===b.dataset.deleteFlight);markCloudDeleted('activities',victim||b.dataset.deleteFlight);removeCoreActivities(f=>f.id===b.dataset.deleteFlight);reconcileAllDuties();await render();scheduleAutoSync('delete-flight');return}
    b=e.target.closest('[data-edit-flight]');if(b){const f=coreActivityRows().find(x=>x.id===b.dataset.editFlight);if(f){loadEntryToForm(f);setEntryReturnContext('flightsView',f.id);show('addView')}return}
    b=e.target.closest('[data-edit-roster-entry]');if(b){openRosterEntryModule(b.dataset.editRosterEntry);return}
    b=e.target.closest('[data-edit-roster-duty]');if(b){openRosterDutyModule(b.dataset.editRosterDuty);return}
    b=e.target.closest('[data-delete-duty]');if(b){if(!confirm('Confirm to delete this duty?'))return;const victim=coreActivityRows().find(d=>d.id===b.dataset.deleteDuty);markCloudDeleted('activities',victim||b.dataset.deleteDuty);removeCoreActivities(d=>d.id===b.dataset.deleteDuty);reconcileAllDuties();renderDuty();await render();scheduleAutoSync('delete-duty');return}
    b=e.target.closest('[data-view-trip]');if(b){renderTripInspector(b.dataset.viewTrip);return}
    b=e.target.closest('[data-edit-trip]');if(b){const saved=load(TRIPS_KEY).find(x=>x.id===b.dataset.editTrip),t=PilotLogEngine.savedTrip(saved);if(!t)return;$('tripEditId').value=t.id;$('tripStations').value=t.stations||'';$('tripStart').value=t.start||'';$('tripEnd').value=t.end||'';$('tripLayover').value=fmt(t.layover||0);$('tripAllowance').value=tripDisplayMoney(t).allowanceText;$('tripCashAmount').value=Number(t.cashAmount||0)||'';$('tripCashCurrency').value=upper(t.cashCurrency||'USD');$('tripCashConverted').value=upper(t.cashFxTo||'')===appCurrency()&&Number(t.cashFxRate)>0?moneyCurrency(Number(t.cashConverted||0),appCurrency()):'';$('tripRemarks').value=t.remarks||'';tripMoneyConversion();$('tripForm').scrollIntoView({behavior:'smooth',block:'start'});return}
    b=e.target.closest('[data-delete-trip]');if(b){if(!confirm('Confirm to delete this trip?'))return;const rows=load(TRIPS_KEY),victim=rows.find(t=>t.id===b.dataset.deleteTrip);markCloudDeleted('trips',victim||b.dataset.deleteTrip);save(TRIPS_KEY,rows.filter(t=>t.id!==b.dataset.deleteTrip));renderTrips();$('tripInspectorWrap')?.classList.add('hidden');scheduleAutoSync('delete-trip');return}    b=e.target.closest('[data-roster-action]');if(b){
      const r=rosterFlightRows().find(x=>x.id===b.dataset.rosterAction);if(!r)return;
      const existing=savedEntryForRosterSector(r);
      if(existing){
        loadEntryToForm(existing);if($('rosterLinkId'))$('rosterLinkId').value=r.id;setEntryReturnContext('rosterView',existing.id);
      }else{
        setEntryReturnContext('rosterView','');saveEntryDraft();resetEntry(false);if($('rosterLinkId'))$('rosterLinkId').value=r.id;
        // Complete the same authoritative activity record; never create a second Logbook copy.
        $('editId').value=r.id;
        if($('entrySourceDisplay')){$('entrySourceDisplay').dataset.source=r.source==='aeroline'?'aeroline':'roster';setEntrySourceDisplay($('entrySourceDisplay').dataset.source)}
        $('date').value=r.date;$('flightNo').value=flightNoInput(composeFlightNo(r.flightNo));$('dep').value=r.dep;$('arr').value=r.arr;$('schedOut').value=r.std;$('schedIn').value=r.sta;$('type').value=upper(r.type||'');$('reg').value=aircraftIdInput(r.reg||'');
        applyRosterCarryToForm(r);applyProfileDefaultsToEntry();if(r.picName)$('picName').value=upper(r.picName);if(r.sicName)$('sicName').value=upper(r.sicName);if(r.instructorName)$('instructorName').value=upper(r.instructorName);if(r.instructionType)$('instructionType').value=r.instructionType;applyAerolineFlightRoleRuleToForm(r);
        const g=rosterGroups().find(x=>x.kind==='flight'&&x.items.some(i=>i.id===r.id));if(g){const ordered=[...g.items].sort((a,b)=>(a.std||'').localeCompare(b.std||''));if(ordered[0]?.id===r.id)$('onDuty').value=g.start||'';if(ordered.at(-1)?.id===r.id)$('offDuty').value=g.end||''}
        $('remarks').value=r.remarks||r.aerolineTrainingLabel||'Imported from roster';$('entryTitle').textContent='Complete roster flight';calcEntry();await updateAirportInfo();saveEntryDraft();
      }
      show('addView');
      return;
    }
  });
  document.addEventListener('keydown',e=>{const row=e.target.closest('.roster-agenda-clickable');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click()}});
  window.addEventListener('online',()=>scheduleAutoSync('online',300));
  window.addEventListener('beforeunload',()=>{try{if(!$('addView')?.classList.contains('hidden'))saveEntryDraft()}catch{}});
  window.addEventListener('pagehide',()=>{try{saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleAutoSync('visible',500);else{try{saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})}});
  setInterval(()=>scheduleAutoSync('periodic',300),10*60*1000);
  populateCurrencySelect($('setCurrency'),['MAD','EUR','USD','TRY','AED','GBP']);populateCurrencySelect($('tripCashCurrency'),QUICK_CASH_CURRENCIES);migrateExpirySemanticDuplicates();updateAppHeader();resetEntry(false);refreshEntrySuggestions();['picName','sicName','soName','instructorName','expiryEndorsedBy'].forEach(id=>setupSmartAutocomplete(id,()=>entrySuggestionDb.crew));setupSmartAutocomplete('type',()=>entrySuggestionDb.types);restoreEntryDraft();resetTrip();resetDutyEditor();$('payrollMonth').value=monthNow();if($('aerolineSyncMonth'))$('aerolineSyncMonth').value=monthNow();$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';fillPaySettings();renderDuty();renderSettings();renderAerolineConnect();migrateLegacyFlightSnapshots().catch(err=>console.warn('Legacy recovery migration deferred',err));const tripPlanKey='pilotlog9_roster_trip_recalc_v1';if(localStorage.getItem(tripPlanKey)!=='1'){try{autoDetectTrips(false,false);localStorage.setItem(tripPlanKey,'1')}catch(err){console.warn('Roster trip recalculation deferred',err)}}await render();show('rosterView');scheduleAutoSync('startup',1500);
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw-10.3.js').catch(err=>console.warn('Offline cache unavailable',err));}
  console.log('PilotLog v'+VERSION+' loaded');
});
})();
