import {createCrewDirectory} from './modules/crew-directory.mjs';
import {createSessionReader} from './modules/auth-session.mjs';
import {createStatistics} from './modules/statistics.mjs';
import {stableHash128,canonicalJsonStringify,sectionDigest,legacySectionDigest,contentHash,storedHash} from './modules/record-digest.mjs';
import {parseIcs,zuluTimes,classifyCalendarSummary} from './modules/calendar-import.mjs';
import {displayRows,editableRows,editableActivity,isEntryActivityRecord,copyJson} from './modules/activity-reads.mjs';
import {createExpiryPresentation} from './modules/expiry-presentation.mjs';
import {projectPayroll,macPayrollProjection,tierPay,seniorityPct,fixedSalaryAmount} from './modules/payroll-projection.mjs';
import {createTripProjection} from './modules/trip-projection.mjs';
import {createLogbookSearch} from './modules/logbook-search.mjs';
import {createRosterPlanning} from './modules/roster-planning.mjs';
import {createOperationalPersist} from './modules/operational-persist.mjs';
import {createActivityEngine} from './modules/activity-engine.mjs';
import {createDutySessions} from './modules/duty-sessions.mjs';
import {createWeeklyRest} from './modules/weekly-rest.mjs';
import {createFtlLimits} from './modules/ftl-limits.mjs';
import {createRosterGroups} from './modules/roster-groups.mjs';
import {sunAltitude,nightRouteMinutes} from './modules/night-route.mjs';
import {createCoreRecords} from './modules/core-records.mjs';
import {createAerolineRoster} from './modules/aeroline-roster.mjs';
import {createEasaExport} from './modules/easa-export.mjs';
import {createLogTenSqlite} from './modules/logten-sqlite.mjs';
import {createLogTenMigration} from './modules/logten-migration.mjs';
import {createScreenshotGrid} from './modules/screenshot-grid.mjs';
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
const VERSION='16.12'; // Existing backup and replication format.
const APP_VERSION='17.0.0-dev.4';
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
let operationalDatabase=null,flightStoreReady=false;

function emptyOperationalDatabase(){
  return{schema:'PilotLog Operational Database',schemaVersion:1,records:[],values:{},updatedAt:new Date().toISOString()};
}
function isOperationalDatabase(value){return !!(value&&value.schema==='PilotLog Operational Database'&&Number(value.schemaVersion)===1&&Array.isArray(value.records)&&value.values&&typeof value.values==='object')}
function normalizeOperationalDatabase(value){
  const db=isOperationalDatabase(value)?value:emptyOperationalDatabase();
  return{...db,records:normalizeCoreActivityRecords(Array.isArray(db.records)?db.records:[]),values:db.values&&typeof db.values==='object'?db.values:{},updatedAt:db.updatedAt||new Date().toISOString()};
}
function legacyLocalJson(key,def){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?def:v}catch{return def}}
function legacyLocalFlights(){const v=legacyLocalJson(LEGACY_FLIGHTS_STORAGE_KEY,[]);return Array.isArray(v)?copyJson(v):[]}
function openFlightStoreDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(FLIGHT_DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(FLIGHT_DB_STORE))db.createObjectStore(FLIGHT_DB_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('PilotLog data database unavailable'));
  });
}
async function readFlightStore(){
  if(window.PilotLogNative?.isNative)return window.PilotLogNative.readDatabase();
  const db=await openFlightStoreDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(FLIGHT_DB_STORE,'readonly'),req=tx.objectStore(FLIGHT_DB_STORE).get(FLIGHT_DB_RECORD);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error)})}
  finally{db.close()}
}
const operationalPersist=createOperationalPersist({
  getDatabase:()=>operationalDatabase,setDatabase:value=>{operationalDatabase=value},
  emptyDatabase:emptyOperationalDatabase,getStoreReady:()=>flightStoreReady,
  normalizeDatabase:normalizeOperationalDatabase,openDatabase:openFlightStoreDb,
  markLocalRevision,isImportStaging:()=>importStaging,
  metaKey:FLIGHT_DB_META_KEY,fallbackKey:FALLBACK_DB_KEY,storeName:FLIGHT_DB_STORE,recordKey:FLIGHT_DB_RECORD
});
function writeFlightStore(database,options){return operationalPersist.writeFlightStore(database,options)}
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
function rawFlightDigits(value){return coreRecords.rawFlightDigits(value)}
function rawCanonicalType(value,fallback='Flight'){return coreRecords.rawCanonicalType(value,fallback)}
function legacyActivityField(row,key){return coreRecords.legacyActivityField(row,key)}
function activityStatusRank(value){return coreRecords.activityStatusRank(value)}
function canonicalActivityStatus(source={},origin=''){return coreRecords.canonicalActivityStatus(source,origin)}
function stripLegacyActivityFields(row){return coreRecords.stripLegacyActivityFields(row)}
function normalizeCoreActivity(source={},origin=''){return coreRecords.normalizeCoreActivity(source,origin)}
function directUnifiedFlightMatch(a,b){return coreRecords.directUnifiedFlightMatch(a,b)}
function scheduledFlightIdentityMatch(a,b){return coreRecords.scheduledFlightIdentityMatch(a,b)}
function uniqueUnifiedFlightMatch(records,row){return coreRecords.uniqueUnifiedFlightMatch(records,row)}
function unifiedFlightMatch(a,b){return coreRecords.unifiedFlightMatch(a,b)}
function blankOperationalValue(value){return coreRecords.blankOperationalValue(value)}
function activityAuthorityScore(row){return coreRecords.activityAuthorityScore(row)}
function mergeCoreActivities(a,b){return coreRecords.mergeCoreActivities(a,b)}
function normalizeCoreActivityRecords(rows,previousById=null){return coreRecords.normalizeCoreActivityRecords(rows,previousById)}
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
    const duty=normalizeCoreActivity({...source,activityCategory:'OPERATIONAL'},'duties');
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
    if(stored!=null&&!isOperationalDatabase(stored))throw Object.assign(Error('Incompatible local database format'),{incompatible:true});
    if(isOperationalDatabase(stored)){
      operationalDatabase=stored;
      flightStoreReady=true;
      return operationalDatabase;
    }
    else if(isOperationalDatabase(fallback))operationalDatabase=normalizeOperationalDatabase(fallback);
    else operationalDatabase=migrateSnapshotToOperationalDatabase(legacySnapshot(await readLegacyFlightStore()));
    reconcileOperationalFlightIdentities();
    await writeFlightStore(operationalDatabase);
    flightStoreReady=true;
    try{localStorage.removeItem(FALLBACK_DB_KEY)}catch{}
    try{if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{})}catch{}
  }catch(e){
    if(e.incompatible||window.PilotLogNative?.isNative||operationalDatabase)throw e;
    console.warn('IndexedDB operational database unavailable; using one local fallback database',e);
    const savedFallback=legacyLocalJson(FALLBACK_DB_KEY,null);
    if(!isOperationalDatabase(savedFallback))throw e;
    operationalDatabase=savedFallback;flightStoreReady=false;
  }
  return operationalDatabase;
}
function queueFlightPersist(){return operationalPersist.queueFlightPersist()}
function scheduleFlightPersist(delay=0){return operationalPersist.scheduleFlightPersist(delay)}
async function flushFlightStore(){return operationalPersist.flushFlightStore()}
// Display projections can reuse immutable copies. Editors still receive independent mutable copies.
function displayActivityRows(){return displayRows(operationalDatabase?.records)}
function coreActivityRows(){return editableRows(operationalDatabase?.records)}
function activityById(id){return editableActivity(operationalDatabase?.records,id)}
function isDutyActivityRecord(x){return false}
function entryActivityRows(){return coreActivityRows().filter(isEntryActivityRecord)}
function rosterFlightRows(rows=coreActivityRows()){return rows.filter(x=>rawCanonicalType(x.dutyType)==='Flight').map(x=>({...x,std:x.schedOut||'',sta:x.schedIn||'',status:activityIncludedInResults(x)?'done':'planned'}))}
function dutyActivityRows(rows=coreActivityRows()){return rows.filter(x=>['Day OFF','Flight Duty','Duty','Sick Leave','Annual Leave'].includes(canonicalDutyType(x.dutyType||'','Duty'))).map(x=>({...x,type:x.dutyType||'Duty',report:x.onDuty||'',end:x.offDuty||'',minutes:entryDutyMins(x),notes:x.remarks||''}))}
function commitCoreActivities(rows){
  if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();
  const prior=new Map(operationalDatabase.records.map(r=>[r.id,r]));
  const next=normalizeCoreActivityRecords(Array.isArray(rows)?rows:[],prior).map(row=>{
    const old=prior.get(row.id);
    if(old&&(old===row||storedHash(old)===contentHash(row)||contentHash(normalizeCoreActivity(old))===contentHash(row)))return old;
    return {...row,_syncRev:old?recordRevision(old)+1:Math.max(1,recordRevision(row)),_updatedAt:new Date().toISOString()};
  });
  if(next.length===prior.size&&next.every(r=>prior.get(r.id)===r))return false;
  directory.replaceRows(operationalDatabase.records,next,prior);
  operationalDatabase.records=next;
  return touchOperationalDatabase();
}
function replaceActivitySelection(predicate,rows){
  // SAFETY INVARIANT: replacement/import may update supplied IDs but may not delete
  // existing records merely because they are absent from the incoming selection.
  const existing=coreActivityRows(),incoming=(rows||[]).map(x=>normalizeCoreActivity(x,isDutyActivityRecord(x)?'duties':'')),incomingIds=new Set(incoming.map(x=>String(x.id||'')).filter(Boolean));
  const kept=existing.filter(x=>!predicate(x)||!incomingIds.has(String(x.id||'')));
  return commitCoreActivities([...kept,...incoming]);
}
function upsertCoreActivity(source){
  const row=normalizeCoreActivity(source,isDutyActivityRecord(source)?'duties':''),records=operationalDatabase?.records.slice()||[],i=records.findIndex(x=>x.id===row.id);
  if(i>=0)records[i]=normalizeCoreActivity({...records[i],...row,id:records[i].id},isDutyActivityRecord(row)?'duties':'');else records.push(row);
  const refreshed=refreshProvisionalDutyRecords(records,row.id);
  commitCoreActivities(refreshed);
  refreshed.filter((r,index)=>r!==records[index]&&r.id!==row.id&&recordRevision(r)>recordRevision(records[index])).forEach(r=>markCloudEdited('activities',r,'duty-recalculate'));
  return activityById(row.id)||row;
}
function removeCoreActivities(predicate,options={}){if(options.manual!==true)throw new Error('PilotLog safety block: Core records can be removed only by an explicit manual user action.');return commitCoreActivities(coreActivityRows().filter(x=>!predicate(x)))}
async function persistCoreActivities(){await flushFlightStore();return true}
async function replaceEntryActivitiesDurable(rows){replaceActivitySelection(isEntryActivityRecord,(rows||[]).map(x=>({...x,activityCategory:'OPERATIONAL'})));await persistCoreActivities();return true}
function databaseValue(key,def){const v=operationalDatabase?.values?.[key];return v===undefined?def:v}
const load=k=>{if(BUSINESS_KEYS.has(k)){const v=databaseValue(k,[]);return Array.isArray(v)?copyJson(v):[]}try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return[]}};
function touchOperationalDatabase(){return operationalPersist.touchOperationalDatabase()}
const AUTHORITATIVE_ENTRY_FIELDS=['date','flightNo','dep','arr','type','variant','reg','location','schedOut','schedIn','schedBlock','out','off','on','in','block','totalFlightTime','multiPilot','pic','picUS','sic','ifrTime','airTime','night','picNight','totalInstrument','simulatorTime','simulatorTimeImported','sfiSfe','dualGiven','dualReceived','groundInstruction','stbyTime','credit','totalDuty','timeOverrides','manualFields','fieldSources','rolePic','instruction','examiner','simInstructor','simExaminer','rhs','pf','callFromDayOff','role','seatPosition','trainerType','aerolineTrainerType','approachType','approaches','picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name','cabinCrew','observerCrew','studentName','remarks','courseType','delayMinutes','pax','fuelAboard','fuelBurned','fuelMinimum','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','onDuty','offDuty','sectors','locked','manualOverride','creditImported','sim','logtenCustom','customNote','goArounds'];
function setLocalJson(k,v){
  if(BUSINESS_KEYS.has(k)){if(!operationalDatabase)operationalDatabase=emptyOperationalDatabase();const old=operationalDatabase.values[k];
    if([TRIPS_KEY,EXPIRY_KEY].includes(k)&&Array.isArray(old)){
      const byId=new Map(old.map(row=>[row.id,row]));
      v=v.map(row=>{const prev=byId.get(row.id);return prev&&contentHash(prev)===contentHash(row)?prev:row});
    }
    if(contentHash(old)===contentHash(v)||old==null&&v&&typeof v==='object'&&!Object.keys(v).length)return false;
    operationalDatabase.values[k]=copyJson(v);return touchOperationalDatabase()}
  const text=JSON.stringify(v);
  try{localStorage.setItem(k,text);return true}
  catch(e){
    const quota=e?.name==='QuotaExceededError'||e?.name==='NS_ERROR_DOM_QUOTA_REACHED'||e?.code===22||e?.code===1014;
    
    throw e;
  }
}
const save=(k,v)=>{
  return setLocalJson(k,v);
};
const loadObject=(k,def={})=>{if(BUSINESS_KEYS.has(k)){const v=databaseValue(k,def);return v&&typeof v==='object'&&!Array.isArray(v)?copyJson(v):def}try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?copyJson(v):def}catch{return def}};
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
function removeBusinessValue(k){if(!BUSINESS_KEYS.has(k)){localStorage.removeItem(k);return}return setLocalJson(k,BUSINESS_ARRAY_KEYS.has(k)?[]:null)}
async function replaceOperationalDatabase(database){const currentReplica=operationalDatabase?.replica162;
  operationalDatabase=normalizeOperationalDatabase(database);delete operationalDatabase.replica162;delete operationalDatabase.preSync162;
  if(currentReplica)operationalDatabase.replica162=currentReplica;
  touchOperationalDatabase();await flushFlightStore();return operationalDatabase}
function operationalDatabaseCounts(database=operationalDatabase){
  const records=database?.records||[],values=database?.values||{};
  return{activities:records.length,entries:records.filter(x=>activityIncludedInResults(x)&&(rawCanonicalType(x.dutyType)==='Flight'||rawCanonicalType(x.dutyType)==='Simulator')).length,roster:records.filter(x=>rawCanonicalType(x.dutyType)==='Flight').length,duties:records.filter(x=>String(x.activityCategory||'').toUpperCase()==='DUTY').length,trips:Array.isArray(values[TRIPS_KEY])?values[TRIPS_KEY].length:0,expiry:Array.isArray(values[EXPIRY_KEY])?values[EXPIRY_KEY].length:0};
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
function stableSourceId(kind,sourceKey){return `src-${String(kind||'item')}-${stableHash128(`${kind}|${sourceKey}`)}`}
function importCoreId(sourceKey){
  if(!sourceKey)return makeActivityId();
  const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes=stableHash128(sourceKey).match(/../g).slice(0,10);
  const id=bytes.map(b=>alphabet[parseInt(b,16)&31]).join('');
  const prior=operationalDatabase.records.find(r=>r.id===id);
  if(prior&&syncSourceKey(prior)!==sourceKey)throw Error('Import Core ID collision. Source data retained.');
  return id;
}
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
const durationPickerValue=m=>{const n=Math.max(0,Math.round(Number(m)||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`};
function setDurationPicker(el,value){if(!el)return;const n=numericTime(value);el.value=n===null?'':durationPickerValue(n)}
const PILOTLOG_RULES=Object.freeze({
  aliases:Object.freeze({
    'FLIGHT':'Flight','SIM':'Simulator','SIMULATOR':'Simulator','RT':'Simulator',
    'GROUND COURSE':'Ground Course','GROUND TRAINING':'Ground Course','GROUND TRAINING/COURSE':'Ground Course','GRT':'Ground Course',
    'DHD':'DHD','DHP':'DHP','STBY':'STBY','STANDBY':'STBY','HSBY':'STBY',
    'DAY OFF':'Day OFF','OFF':'Day OFF','FLIGHT DUTY':'Flight Duty','DUTY':'Duty','SICK LEAVE':'Sick Leave','ANNUAL LEAVE':'Annual Leave'
  }),
  activities:Object.freeze({
    'Flight':Object.freeze({editor:'flight',credit:'flight-schedule',trip:'duty',totals:'flight',rosterEditLocked:false}),
    'Simulator':Object.freeze({editor:'entry',credit:'editable-sim',trip:'duty',totals:'simulator',rosterEditLocked:true}),
    'Ground Course':Object.freeze({editor:'entry',credit:'editable-ground',trip:'fixed-ground',totals:'other',rosterEditLocked:true}),
    'DHD':Object.freeze({editor:'entry',credit:'editable',trip:'zero',totals:'other',rosterEditLocked:true}),
    'DHP':Object.freeze({editor:'entry',credit:'editable',trip:'credit',totals:'other',rosterEditLocked:true}),
    'STBY':Object.freeze({editor:'entry',credit:'stored',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Sick Leave':Object.freeze({editor:'entry',credit:'zero',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Annual Leave':Object.freeze({editor:'entry',credit:'zero',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Day OFF':Object.freeze({editor:'entry',credit:'zero',trip:'zero',totals:'other',rosterEditLocked:true}),
    'Flight Duty':Object.freeze({editor:'entry',credit:'zero',trip:'duty',totals:'other',rosterEditLocked:true}),
    'Duty':Object.freeze({editor:'entry',credit:'zero',trip:'duty',totals:'other',rosterEditLocked:true})
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
  return {type,...(PILOTLOG_RULES.activities[type]||{editor:'entry',credit:'stored',trip:'duty',totals:'other',rosterEditLocked:true})};
}
function rosterCanEditLockedActivity(value){const r=activityRule(value);return r.editor==='entry'&&r.rosterEditLocked===true}
let activityEngine;
function isMoroccoCode(code){return activityEngine.isMoroccoCode(code)}
function qualifiesMoroccoNightCredit(f){return activityEngine.qualifiesMoroccoNightCredit(f)}
function flightCreditMins(f,allEntries=null){return activityEngine.flightCreditMins(f,allEntries)}
function dutyGetsMoroccoNightPremium(f,allEntries=null){return activityEngine.dutyGetsMoroccoNightPremium(f,allEntries)}
function entryScheduleTotalMins(entry){return activityEngine.entryScheduleTotalMins(entry)}
function entryDutyMins(entry){return activityEngine.entryDutyMins(entry)}
const shiftTime=(t,delta)=>{const m=mins(t);if(m==null)return'';let x=(m+delta)%1440;if(x<0)x+=1440;return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`};
function signedMinuteDelta(from,to){const a=mins(from),b=mins(to);if(a==null||b==null)return 0;let d=b-a;if(d>720)d-=1440;if(d<-720)d+=1440;return d}
function formDelayMinutes(){if($('dutyTypeFlight')?.value!=='Flight')return 0;return Math.max(0,signedMinuteDelta($('schedOut')?.value,$('out')?.value))}
function updateDelayUI(){return formDelayMinutes()}
function syncOnDutyFromScheduleOut(){if(controlledDuty(activityById($('editId')?.value)))return;if(formTimeOverrides.onDuty||['aeroline','logten','calendar','screenshot','source','imported'].includes(String(formFieldSources.onDuty||'').toLowerCase()))return;const t=$('schedOut')?.value||'',positioning=isPositioning({dutyType:$('dutyTypeFlight')?.value||''});$('onDuty').value=t?(positioning?t:shiftTime(t,-60)):'';formFieldSources.onDuty=t?'calculated':''}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const csv=s=>`"${String(s??'').replace(/"/g,'""')}"`;
const dateOnly=d=>new Date(`${d}T00:00:00Z`);


const upper=s=>String(s||'').trim().toUpperCase();
const coreRecords=createCoreRecords({makeActivityId,recordRevision,entryManualField,canonicalDutyType,upper,isFlight,isDhd,isSim,isGround,isStby});
const {ACTIVITY_STATUS,LEGACY_ACTIVITY_FIELDS}=coreRecords;
const CREW_NAME_FIELDS=['picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name'];
const directory=createCrewDirectory({upper,isEntryActivityRecord,CREW_NAME_FIELDS});
const {crewName,entrySuggestionDb}=directory;
let directoryLimit=50;
function refreshEntrySuggestions(){
  const settings=databaseValue(APP_SETTINGS_KEY,{});
  if(!directory.refresh(operationalDatabase?.records,settings.crewDirectory,crewName(settings.profileName)))return;
  if($('aircraftTypeSuggestions'))$('aircraftTypeSuggestions').innerHTML=entrySuggestionDb.types.map(v=>`<option value="${esc(v)}"></option>`).join('');
  if($('crewDirectory')?.open)renderCrewDirectory();
}
function renderCrewDirectory(){
  const query=crewName($('crewDirectoryName').value);
  const matches=entrySuggestionDb.crew.filter(name=>name.includes(query));
  $('crewDirectoryList').innerHTML=matches.slice(0,directoryLimit).map(name=>`<div class="crew-directory-row"><span>${esc(name)}</span><button type="button" data-remove-crew="${esc(name)}" aria-label="Remove ${esc(name)} from directory">Remove</button></div>`).join('');
  $('crewDirectoryMore').classList.toggle('hidden',matches.length<=directoryLimit);
}
function editCrewDirectory(value,remove){
  const name=crewName(value);if(!name)return;
  const prefs=databaseValue(APP_SETTINGS_KEY,{}).crewDirectory||{};
  const added=new Set(prefs.added||[]),removed=new Set(prefs.removed||[]);
  if(remove){added.delete(name);removed.add(name)}else{removed.delete(name);added.add(name)}
  saveAppSettings({crewDirectory:{added:[...added].sort(),removed:[...removed].sort()}});
  refreshEntrySuggestions();
}
function bindCrewDirectory(){
  $('crewDirectory').addEventListener('toggle',()=>{if($('crewDirectory').open){refreshEntrySuggestions();renderCrewDirectory()}});
  $('crewDirectoryName').addEventListener('input',()=>{directoryLimit=50;renderCrewDirectory()});
  $('crewDirectoryForm').addEventListener('submit',e=>{e.preventDefault();editCrewDirectory($('crewDirectoryName').value,false)});
  $('crewDirectoryList').addEventListener('click',e=>{const button=e.target.closest('[data-remove-crew]');if(button)editCrewDirectory(button.dataset.removeCrew,true)});
  $('crewDirectoryMore').addEventListener('click',()=>{directoryLimit+=50;renderCrewDirectory()});
}
function setupSmartAutocomplete(inputId,getValues,minLength=0){
  const input=$(inputId);if(!input)return;
  const host=input.parentElement;host.classList.add('autocomplete-host');
  let menu=host.querySelector('.smart-autocomplete');
  if(!menu){menu=document.createElement('div');menu.className='smart-autocomplete hidden';host.appendChild(menu)}
  const hide=()=>menu.classList.add('hidden');
  const render=()=>{
    const q=crewName(input.value);
    if(q.length<minLength){hide();return}
    const vals=(getValues()||[]).filter(v=>!q||v.startsWith(q)||v.includes(q)).slice(0,8);
    if(!vals.length){hide();return}
    menu.innerHTML=vals.map(v=>`<button type="button" data-autocomplete-value="${esc(v)}">${esc(v)}</button>`).join('');
    menu.classList.remove('hidden');
  };
  input.addEventListener('focus',render);input.addEventListener('input',render);
  input.addEventListener('keydown',e=>{if(menu.classList.contains('hidden'))return;if(e.key==='Escape'){hide();return}if(e.key==='ArrowDown'){e.preventDefault();menu.querySelector('button')?.focus()}});
  menu.addEventListener('mousedown',e=>e.preventDefault());
  menu.addEventListener('click',e=>{const b=e.target.closest('[data-autocomplete-value]');if(!b)return;input.value=b.dataset.autocompleteValue;hide();input.dispatchEvent(new Event('input',{bubbles:true}))});
  host.addEventListener('focusout',()=>setTimeout(()=>{if(!host.contains(document.activeElement))hide()},120));
}

function displayDate(v){
  const s=String(v||'').slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:s;
}
function displayDateTime(v){
  const s=String(v||'');
  if(!s)return'';
  const parts=s.replace('T',' ').split(' ');
  return `${displayDate(parts[0])}${parts[1]?' '+parts[1].slice(0,5):''}`;
}

const sum=(a,f)=>a.reduce((x,y)=>x+(Number(f(y))||0),0);
const durMins=v=>{v=String(v||'').trim();const m=v.match(/^(\d+):(\d{1,2})$/);return m?Number(m[1])*60+Number(m[2]):0};
const scheduleBlockMins=f=>{
  if(f?.schedOut&&f?.schedIn)return timeSpanMins(f.schedOut,f.schedIn);
  return 0;
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
function normalizedFlightDigits(v){return coreRecords.normalizedFlightDigits(v)}
function entryCompleteness(f){return coreRecords.entryCompleteness(f)}
function mergeDuplicateEntries(a,b){return coreRecords.mergeDuplicateEntries(a,b)}
function exactOperationalMatch(a,b){return coreRecords.exactOperationalMatch(a,b)}
function dedupeFlightEntriesSemantic(entries){
  // SAFETY INVARIANT: no automatic deduplication, merge, or deletion.
  // Possible duplicates may be reviewed by the user, but records remain untouched.
  return{entries:[...(entries||[])],removed:0,removedIds:[]};
}
function isSim(f){return canonicalDutyType(f?.dutyType||'')==='Simulator'||f?.sim==='yes'}
function isLogbookEntry(f){return isFlight(f)||isSim(f)}
// LogTen's locked/open flag protects editing only. It never controls visibility,
// totals, payroll, exports, or calculation authority for imported LogTen records.
function activityIncludedInResults(f){return !!f&&(String(f.source||'').toLowerCase()==='logten'||f.activityStatus===ACTIVITY_STATUS.COMPLETED)}
function simulatorCompleted(f,now=new Date()){
  if(!isSim(f)||!f?.date)return false;
  const startTime=f.onDuty||'00:00',endTime=f.offDuty||f.onDuty||'23:59';
  const pair=dutyDateEnd(f.date,startTime,endTime),end=pair?.[1];
  if(!end||!Number.isFinite(end.getTime()))return String(f.date)<isoDateLocal(now);
  return end<=now;
}
function isCompletedLogbookEntry(f,now=new Date()){
  return f?.activityStatus==='DRAFT'||(isFlight(f)||isSim(f))&&activityIncludedInResults(f);
}
function isGround(f){return canonicalDutyType(f?.dutyType||'')==='Ground Course'}
function isDhd(f){return canonicalDutyType(f?.dutyType||'')==='DHD'}
function isDhp(f){return canonicalDutyType(f?.dutyType||'')==='DHP'}
function isPositioning(f){return isDhd(f)||isDhp(f)}
function isStby(f){return canonicalDutyType(f?.dutyType||'')==='STBY'}
function picMins(f){return timeGroupFinalValue(f,'pic')}
function sicMins(f){return timeGroupFinalValue(f,'sic')}
function flightInstrMins(f){return timeGroupFinalValue(f,'dualGiven')}
function simInstrMins(f){return timeGroupFinalValue(f,'sfiSfe')}

function isA320Entry(f){
  const raw=upper(f?.type||'');
  const norm=raw.replace(/A32O/g,'A320').replace(/[^A-Z0-9]/g,'');
  return norm.includes('A320');
}
function totalFlightMins(f){return timeGroupFinalValue(f,'totalFlightTime')}

const TIME_GROUP_DEFS=Object.freeze([
  Object.freeze({key:'totalFlightTime',label:'Total Flight Time'}),
  Object.freeze({key:'multiPilot',label:'Multi-pilot'}),
  Object.freeze({key:'pic',label:'PIC'}),
  Object.freeze({key:'picUS',label:'PIC U/S'}),
  Object.freeze({key:'sic',label:'SIC'}),
  Object.freeze({key:'ifrTime',label:'IFR'}),
  Object.freeze({key:'airTime',label:'Air Time'}),
  Object.freeze({key:'night',label:'Night'}),
  Object.freeze({key:'picNight',label:'PIC Night'}),
  Object.freeze({key:'simulatorTime',label:'Simulator Time'}),
  Object.freeze({key:'sfiSfe',label:'SFI/SFE'}),
  Object.freeze({key:'dualGiven',label:'Dual Given'}),
  Object.freeze({key:'dualReceived',label:'Dual Received'}),
  Object.freeze({key:'groundInstruction',label:'Ground Instruction'}),
  Object.freeze({key:'stbyTime',label:'STBY'}),
  Object.freeze({key:'credit',label:'Credit Hours'}),
  Object.freeze({key:'totalDuty',label:'Total Duty'})
]);
const TIME_GROUP_KEYS=new Set(TIME_GROUP_DEFS.map(x=>x.key));
const TIME_GROUP_INPUT_IDS=Object.freeze({totalFlightTime:'totalFlightTimeDisplay',multiPilot:'multiPilotDisplay',pic:'picDisplay',picUS:'picUSDisplay',sic:'sicDisplay',ifrTime:'ifrTimeDisplay',airTime:'airTimeDisplay',night:'night',picNight:'picNightDisplay',simulatorTime:'simulatorTimeDisplay',sfiSfe:'sfiSfeDisplay',dualGiven:'dualGivenDisplay',dualReceived:'dualReceivedDisplay',groundInstruction:'groundInstructionDisplay',stbyTime:'stbyTimeDisplay',credit:'creditDisplay',totalDuty:'totalDutyDisplay'});
let formTimeOverrides={},formLoading=false;
let formManualFields={};
let formFieldSources={};
function emptyTimeGroupSettings(){return Object.fromEntries(TIME_GROUP_DEFS.map(x=>[x.key,{showTotal:false,showCard:false,autoSync:false}]))}
function timeGroupSettings(){
  const saved=appSettings().timeGroups||{},out=emptyTimeGroupSettings();
  TIME_GROUP_DEFS.forEach(({key})=>{const v=saved[key]||{};out[key]={showTotal:v.showTotal===true,showCard:v.showCard===true,autoSync:v.autoSync===true}});
  return out;
}
function numericTime(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  if(typeof value==='string'&&/^\d+:\d{1,2}$/.test(value.trim()))return durMins(value);
  const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):null;
}
function optionalDuration(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  if(typeof value==='number')return numericTime(value);
  const text=String(value).trim();return /^\d+:\d{1,2}$/.test(text)?durMins(text):null;
}
function fmtOptional(value){const n=numericTime(value);return n===null?'':fmt(n)}
function entryHasTimeValue(entry,key){return !!entry&&Object.prototype.hasOwnProperty.call(entry,key)&&numericTime(entry[key])!==null}
function entryTimeOverride(entry,key){
  return !!(entry?.timeOverrides&&typeof entry.timeOverrides==='object'&&entry.timeOverrides[key]===true);
}
function entryManualField(entry,key){
  if(entry?.manualFields&&typeof entry.manualFields==='object'&&entry.manualFields[key]===true)return true;
  return entryTimeOverride(entry,key);
}
function entryFieldSource(entry,key){return String(entry?.fieldSources?.[key]||'').toLowerCase()}
function entryFieldIsSource(entry,key){return ['aeroline','logten','calendar','screenshot','source','imported'].includes(entryFieldSource(entry,key))}
function sourceFieldMerge(existing,incoming){
  const out={...existing};
  const protectedAll=!!existing?.locked;
  const existingIsLogTen=String(existing?.source||'').toLowerCase()==='logten';
  const incomingIsLogTen=String(incoming?.source||'').toLowerCase()==='logten';
  const preserved=new Set();
  for(const [key,value] of Object.entries(incoming||{})){
    if(['id','manualFields','timeOverrides','fieldSources','manualOverride','locked','_updatedAt','_syncRev'].includes(key))continue;
    if(protectedAll||entryManualField(existing,key)){preserved.add(key);continue}
    /* Once LogTen is imported, keep its source record exactly as imported. Future AeroLINE/source merges
       must not reinterpret or replace LogTen fields. Manual editing remains field-authoritative. */
    if(existingIsLogTen&&!incomingIsLogTen&&Object.prototype.hasOwnProperty.call(existing,key)){preserved.add(key);continue}
    if(value===undefined||value===null||value==='')continue;
    out[key]=value;
  }
  out.manualFields={...(existing?.manualFields||{})};
  out.timeOverrides={...(existing?.timeOverrides||{})};
  out.fieldSources={...(existing?.fieldSources||{})};
  for(const [key,value] of Object.entries(incoming?.fieldSources||{}))if(!preserved.has(key)&&!entryManualField(existing,key)&&!protectedAll)out.fieldSources[key]=value;
  for(const key of Object.keys(out.manualFields))if(out.manualFields[key]===true)out.fieldSources[key]='manual';
  for(const key of Object.keys(out.timeOverrides))if(out.timeOverrides[key]===true)out.fieldSources[key]='manual';
  return out;
}
function entryRoleIsPic(entry){return entry?.rolePic===true||entry?.role==='PIC'}
function knownMulticrewAircraft(entry){return isA320Entry(entry)}
function userIsSimTrainer(entry){return !!(entry&&(entry.simInstructor===true||entry.simExaminer===true||(entry.source==='logten'&&entryHasTimeValue(entry,'sfiSfe')&&numericTime(entry.sfiSfe)>0)))}
function entryBlockMins(entry){
  if((entryTimeOverride(entry,'block')||entryManualField(entry,'block'))&&entryHasTimeValue(entry,'block'))return numericTime(entry.block);
  if(entryFieldIsSource(entry,'block')&&entryHasTimeValue(entry,'block'))return numericTime(entry.block);
  if(entry?.out&&entry?.in)return timeSpanMins(entry.out,entry.in);
  return entryHasTimeValue(entry,'block')?numericTime(entry.block):0;
}
function calculatedTimeGroupValue(entry,key,allEntries=null){return activityEngine.calculatedTimeGroupValue(entry,key,allEntries)}
function timeGroupFinalValue(entry,key,allEntries=null){return activityEngine.timeGroupFinalValue(entry,key,allEntries)}

const APP_DEFAULTS={homeBase:'CMN',flightPrefix:'MAC',aircraftPrefix:'CN-NM',profileName:'',profileRole:'Captain',profilePhotoData:'',profilePhotoUpdatedAt:'',nightStart:'18:00',nightEnd:'05:00',nightPremiumPct:50,currency:'MAD',currency2:'',payrollRegime:'IBC',macDependents:0,timeGroups:{}};
function appSettings(){return {...APP_DEFAULTS,...loadObject(APP_SETTINGS_KEY,{})}}
function saveAppSettings(v){if(v.profilePhotoData===appSettings().profilePhotoData)delete v.profilePhotoUpdatedAt;if(Object.entries(v).every(([k,x])=>contentHash(x)===contentHash(appSettings()[k])))return;saveObject(APP_SETTINGS_KEY,{...appSettings(),...v,_updatedAt:new Date().toISOString()})}
function payrollRegime(){return upper(appSettings().payrollRegime||'IBC')==='MAC'?'MAC':'IBC'}
function macDependents(){return Math.max(0,Math.min(6,Math.trunc(Number(appSettings().macDependents)||0)))}
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
  const table=await fetchFxCandidates(fxUrlsForDate(dateStr));
  if(table.date!==dateStr)throw Error('Requested historical FX date unavailable');
  return {table,date:dateStr};
}
async function fetchLatestFxTable(){const j=await fetchFxCandidates(fxUrlsForDate('latest'));return{table:j,date:String(j.date||today())}}
async function fxForDate(from,to,dateStr){from=upper(from);to=upper(to);if(from===to)return{rate:1,date:dateStr};const x=await fetchFxTableForDate(dateStr);return{rate:fxRateFromTable(x.table,from,to),date:x.date}}
async function latestFx(from,to){from=upper(from);to=upper(to);if(from===to)return{rate:1,date:today()};const x=await fetchLatestFxTable();return{rate:fxRateFromTable(x.table,from,to),date:x.date}}
function cleanPrefix(v){return upper(v).replace(/\s+/g,'')}
function composeFlightNo(raw){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^3O\d/i.test(s))return prefix+s.slice(2);if(/^\d+$/.test(s))return prefix+s;return s}
function flightNoInput(full){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(full);if(prefix&&s.startsWith(prefix))return s.slice(prefix.length);if(/^3O\d/i.test(s))return s.slice(2);return s}
function composeAircraftId(raw){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^[A-Z]{1,3}-[A-Z0-9-]+$/.test(s))return s;return prefix+s}
function aircraftIdInput(full){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(full);return prefix&&s.startsWith(prefix)?s.slice(prefix.length):s}
function equipmentKey(kind,registration){return kind+'|'+upper(registration)}
function equipmentDirectory(){
  const entries=new Map();
  for(const row of operationalDatabase?.records||[]){
    if((!isSim(row)&&!isFlight(row))||row.activityStatus==='DRAFT'||!isCompletedLogbookEntry(row)||!row.reg||!row.type)continue;
    const key=equipmentKey(isSim(row)?'Simulator':'Aircraft',row.reg);
    const model={type:upper(row.type),variant:upper(row.variant||'')};
    if(!entries.has(key))entries.set(key,model);
    else if(JSON.stringify(entries.get(key))!==JSON.stringify(model))entries.set(key,null);
  }
  for(const [key,model] of Object.entries(appSettings().equipmentDirectory||{})){
    if(model===null)entries.delete(key);
    else entries.set(key,model);
  }
  return entries;
}
function setEquipment(key,model){
  const directory={...appSettings().equipmentDirectory,[key]:model};
  saveAppSettings({equipmentDirectory:directory});
}
function rememberEquipment(row){
  if((!isSim(row)&&!isFlight(row))||!row.reg||!row.type||!(entryManualField(row,'type')||entryManualField(row,'variant')||entryManualField(row,'reg')))return;
  const key=equipmentKey(isSim(row)?'Simulator':'Aircraft',row.reg);
  const saved=appSettings().equipmentDirectory||{};
  if(Object.hasOwn(saved,key)){
    const prior=saved[key];
    if(prior?.learned&&prior.type===upper(row.type)&&!prior.variant&&row.variant&&entryManualField(row,'variant')){
      setEquipment(key,{...prior,variant:upper(row.variant)});
    }
    return;
  }
  const model={type:upper(row.type),variant:upper(row.variant||'')};
  const known=equipmentDirectory();
  if(known.has(key)&&JSON.stringify(known.get(key))!==JSON.stringify(model))return;
  setEquipment(key,{...model,learned:true});
}
function applyEquipment(){
  if(!['Flight','Simulator'].includes($('dutyTypeFlight').value))return;
  if(formLoading||activityById($('editId').value)?.locked)return;
  const simulator=$('dutyTypeFlight').value==='Simulator';
  const reg=simulator?upper($('reg').value):composeAircraftId($('reg').value);
  const model=equipmentDirectory().get(equipmentKey(simulator?'Simulator':'Aircraft',reg));
  if(!model)return;
  for(const key of ['type','variant']){
    if(formManualFields[key]||($(key).value&&formFieldSources[key]!=='aircraft-db'))continue;
    $(key).value=model[key];formFieldSources[key]='aircraft-db';
  }
}
function renderEquipment(){
  const list=$('equipmentList');list.replaceChildren();
  for(const [key,model] of [...equipmentDirectory()].sort(([a],[b])=>a.localeCompare(b))){
    const button=document.createElement('button');button.type='button';button.className='secondary';
    const [kind,registration]=key.split('|');
    button.textContent=[kind,registration,model?.type,model?.variant,model?'':'Review conflicting entries'].filter(Boolean).join(' · ');
    button.onclick=()=>{
      $('equipmentKind').value=kind;$('equipmentReg').value=registration;
      $('equipmentType').value=model?.type||'';$('equipmentVariant').value=model?.variant||'';
    };
    list.append(button);
  }
}
function updatePrefixUI(){const st=appSettings();$('flightPrefixLabel').textContent=cleanPrefix(st.flightPrefix||'MAC');$('aircraftPrefixLabel').textContent=cleanPrefix(st.aircraftPrefix||'CN-NM')}

function updateAppHeader(){
  const st=appSettings(),name=String(st.profileName||'').trim(),role=String(st.profileRole||'').trim();
  const descriptor=[role,name].filter(Boolean).join(' ');
  if($('appTitle'))$('appTitle').textContent=descriptor?`PilotLog of ${descriptor}`:'PilotLog';
  if($('appTagline'))$('appTagline').textContent='PilotLog — your personal LogBook';
  const photo=$('profileHeaderPhoto'),mark=document.querySelector('.brand-mark svg'),hasPhoto=!!st.profilePhotoData;
  if(photo){photo.classList.toggle('hidden',!hasPhoto);if(hasPhoto){if(photo.getAttribute('src')!==st.profilePhotoData)photo.src=st.profilePhotoData}else photo.removeAttribute('src')}
  if(mark)mark.classList.toggle('hidden',hasPhoto);
  document.title=descriptor?`PilotLog of ${descriptor}`:'PilotLog';
}


/* Airport DB: fallback + IndexedDB cache of the public mwgg Airports dataset. */
const AIRPORT_SOURCE='https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const AIRPORT_FALLBACK={
CMN:{iata:'CMN',icao:'GMMN',name:'Mohammed V International Airport',city:'Casablanca',country:'MA',lat:33.3675,lon:-7.58997,tz:'Africa/Casablanca'},
NDR:{iata:'NDR',icao:'GMMW',name:'Nador International Airport',city:'Nador',country:'MA',lat:34.9888,lon:-3.0282,tz:'Africa/Casablanca'},
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
function zuluDate(date,time){if(!date||!time)return null;return new Date(`${date}T${time}:00Z`)}
function endZuluDate(date,start,end){const s=zuluDate(date,start),e=zuluDate(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return e}
function dateAtOrAfter(baseDate,time,reference=null){
  let d=zuluDate(baseDate,time);if(!d)return null;
  if(reference&&d<reference)d.setUTCDate(d.getUTCDate()+1);
  return d;
}
function applyPfCounts(depNight,arrNight){
  const pf=!!$('pfCheck')?.checked;
  $('dayTakeoffs').value=pf&&!depNight?1:0;$('nightTakeoffs').value=pf&&depNight?1:0;
  $('dayLandings').value=pf&&!arrNight?1:0;$('nightLandings').value=pf&&arrNight?1:0;
}
async function calcNightForForm(){
  const date=$('date').value,dep=await airport($('dep').value),arr=await airport($('arr').value);
  const out=$('out').value,inn=$('in').value;
  if(!date||!dep||!arr||!out||!inn){
    if(!formTimeOverrides.night&&timeGroupSettings().night.autoSync)$('night').value='';
    applyPfCounts(false,false);
    $('nightStatus').textContent='Night auto: enter valid From/To and OUT/IN.';return 0;
  }
  const start=zuluDate(date,out),end=endZuluDate(date,out,inn),night=nightRouteMinutes(start,end,dep,arr),depNight=!!start&&sunAltitude(start,dep.lat,dep.lon)<-6,arrNight=!!end&&sunAltitude(end,arr.lat,arr.lon)<-6;
  if(!formTimeOverrides.night&&timeGroupSettings().night.autoSync)setDurationPicker($('night'),night);
  applyPfCounts(depNight,arrNight);
  $('nightStatus').textContent=`Night auto OUT–IN: ${fmt(night)} • take-off ${depNight?'night':'day'} • landing ${arrNight?'night':'day'}${$('pfCheck')?.checked?' • PF counts applied':' • PF not selected'}.`;
  return night;
}

/* Credit rules */
const PAY_DEFAULTS={joinDate:'2014-04-01',base:46500,allowance:8000,transport:2500,pos:4000,telephone:500,uniform:300,meal:520,deduction:-3000,seniority2:10,seniority5:null,seniority12:15,seniority25:null,groundCredit:5,simCredit:5,deductionMemo:null,t1Max:25,t1Rate:170,t2Max:50,t2Rate:370,t3Max:75,t3Rate:665,t4Rate:1400,trainingRate:500,layoverRate:25,simAllowance:1000,dayOffRate:1000};
function paySettings(){return {...PAY_DEFAULTS,...loadObject(PAY_SETTINGS_KEY,{})}}
const logtenSqlite=createLogTenSqlite();
const LOGTEN_TIME_COLUMNS=logtenSqlite.LOGTEN_TIME_COLUMNS;
activityEngine=createActivityEngine({
  upper,getAirportIndex:()=>airportIndex,zuluDate,tzParts,appSettings,mins,isFlight,dayEntries,scheduleBlockMins,
  timeSpanMins,isSim,isStby,isPositioning,entryTimeOverride,entryFieldIsSource,entryHasTimeValue,
  numericTime,entryBlockMins,controlledDuty,dutyLastId,controlledDutyMinutes,requiresManualDutyControl,
  nightRouteMinutes,endZuluDate,timeGroupSettings,timeGroupKeys:TIME_GROUP_KEYS,entryManualField,entryFieldSource,
  isManualFlight,knownMulticrewAircraft,entryRoleIsPic,userIsSimTrainer,paySettings,activityRule,
  canonicalDutyType,logtenTimeColumns:()=>LOGTEN_TIME_COLUMNS
});
function creditMinsForEntry(f,allEntries=null){return activityEngine.creditMinsForEntry(f,allEntries)}
function calculateActivityMetrics(f,allEntries=null){return activityEngine.calculateActivityMetrics(f,allEntries)}
function formRoleValue(existing={}){
  if($('rolePicCheck')?.checked)return 'PIC';
  if(formManualFields.rolePic||existing.manualFields?.rolePic)return '';
  const role=String(existing.role||'').toUpperCase();
  return ['SIC','PICUS','PIC U/S'].includes(role)?role:'';
}
function formActivityInput(){
  const dutyType=canonicalDutyType($('dutyTypeFlight')?.value||'Flight');
  const existing=activityById($('editId')?.value)||{};
  const timeValues={};TIME_GROUP_DEFS.forEach(({key})=>{const id=TIME_GROUP_INPUT_IDS[key],value=optionalDuration($(id)?.value);if(value!==null)timeValues[key]=value});
  const blockValue=optionalDuration($('blockDisplay')?.value);
  const out=$('out')?.value||'',inn=$('in')?.value||'';
  return{...existing,...timeValues,id:$('editId')?.value||'',dutyType,date:$('date')?.value||'',flightNo:composeFlightNo($('flightNo')?.value||''),dep:upper($('dep')?.value||''),arr:upper($('arr')?.value||''),schedOut:$('schedOut')?.value||'',schedIn:$('schedIn')?.value||'',onDuty:$('onDuty')?.value||'',offDuty:$('offDuty')?.value||'',out,off:$('off')?.value||'',on:$('on')?.value||'',in:inn,block:blockValue===null?(out&&inn?timeSpanMins(out,inn):0):blockValue,timeOverrides:{...(existing.timeOverrides||{}),...formTimeOverrides},role:formRoleValue(existing),rolePic:!!$('rolePicCheck')?.checked,instruction:!!$('instructionCheck')?.checked,examiner:!!$('examinerCheck')?.checked,simInstructor:!!$('simInstructorCheck')?.checked,simExaminer:!!$('simExaminerCheck')?.checked,rhs:!!$('rhsCheck')?.checked,pf:!!$('pfCheck')?.checked?'yes':'no',trainerType:upper($('trainerTypeInput')?.value||existing?.trainerType||''),aerolineTrainerType:existing?.aerolineTrainerType||''};
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
    ...formCrewSnapshot(),
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
    rolePic:!!$('rolePicCheck')?.checked,
    picName:upper($('picName')?.value||''),
    sicName:upper($('sicName')?.value||''),
    soName:upper($('soName')?.value||''),
    instructorName:upper($('instructorName')?.value||''),
    instruction:!!$('instructionCheck')?.checked,
    examiner:!!$('examinerCheck')?.checked,
    rhs:!!$('rhsCheck')?.checked,
    pf:$('pfCheck')?.checked?'yes':'no',
    variant:upper($('variant')?.value||'')
  };
}
function latestFlightForReturn(){
  return coreActivityRows().filter(f=>isFlight(f)&&activityIncludedInResults(f)).sort((a,b)=>
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

  $('type').value=upper(src.type||'');
  $('variant').value=upper(src.variant||'');

  const regPrefix=(appSettings().aircraftPrefix||'CN-NM').toUpperCase();
  let reg=String(src.reg||'');
  if(reg.toUpperCase().startsWith(regPrefix))reg=reg.slice(regPrefix.length);
  $('reg').value=upper(reg);

  $('dep').value=upper(src.arr||'');
  $('arr').value=upper(src.dep||'');

  $('rolePicCheck').checked=src.rolePic===true||src.role==='PIC';
  $('picName').value=upper(src.picName||'');
  $('sicName').value=upper(src.sicName||'');
  $('soName').value=upper(src.soName||'');
  $('instructorName').value=upper(src.instructorName||'');
  $('instructionCheck').checked=src.instruction===true;$('examinerCheck').checked=src.examiner===true;$('rhsCheck').checked=src.rhs===true||upper(src.seatPosition||'')==='RIGHT';$('pfCheck').checked=src.pf==='yes';

  setEntryTypeUI();
  updateExaminerRemarkReminder();
  calcEntry();
  updateAirportInfo();
  syncProfileNameWithRole();
  beginCoreActivity('Flight',src);
  $('schedOut')?.focus();
}

function updateExaminerRemarkReminder(){
  const box=$('examinerRemarkReminder');if(!box)return;
  const active=$('dutyTypeFlight')?.value==='Flight' && $('role')?.value==='Examiner';
  box.classList.toggle('hidden',!active);
}

function setEntryTypeUI(){
  const dt=canonicalDutyType($('dutyTypeFlight').value||'Flight'),sim=dt==='Simulator',flight=dt==='Flight',positioning=dt==='DHD'||dt==='DHP',ground=dt==='Ground Course',standby=dt==='STBY',dayOff=dt==='Day OFF',genericDuty=dt==='Flight Duty'||dt==='Duty';
  $('dutyTypeFlight').value=dt;
  $('flightForm').dataset.activityType=dt;
  $('flightForm').classList.toggle('duty-layout',!flight);
  $('flightForm').classList.toggle('activity-layout',sim||positioning||ground);
  document.querySelector('.entry-counter-strip')?.classList.toggle('hidden',!flight);
  document.querySelectorAll('[data-entry-field]').forEach(el=>{el.classList.remove('hidden');el.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false)});
  if($('regLabel'))$('regLabel').textContent=sim?'SIM Registration':'Aircraft ID';
  if($('typeLabel'))$('typeLabel').textContent=sim?'SIM Type':'Aircraft Type';
  if($('depLabel'))$('depLabel').textContent=sim?'Location':ground||standby?'Location':'From — IATA/ICAO';
  if($('aircraftPrefixLabel'))$('aircraftPrefixLabel').style.display=sim?'none':'';
  if($('reg'))$('reg').placeholder=sim?'SIM-01':'Q';
  if($('onDutyLabel'))$('onDutyLabel').textContent=flight?'On Duty (Z)':'Duty On (Z)';
  if($('offDutyLabel'))$('offDutyLabel').textContent=flight?'Off Duty (Z)':'Duty Off (Z)';
  if($('schedOutLabel'))$('schedOutLabel').textContent=positioning?'Start (Z)':'Schedule OUT (Z)';
  if($('schedInLabel'))$('schedInLabel').textContent=positioning?'End (Z)':'Schedule IN (Z)';
  $('schedOut').readOnly=false;$('schedIn').readOnly=false;$('blockDisplay').readOnly=false;
  TIME_GROUP_DEFS.forEach(({key})=>{const id=TIME_GROUP_INPUT_IDS[key];if($(id))$(id).readOnly=false});

  const allowed=flight?new Set(['flightNo','reg','type','variant','dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty','out','off','on','in','block','picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name','approachType','approachCategory','pax','fuelAboard','fuelBurned','fuelMinimum']):
    sim?new Set(['reg','type','dep','schedOut','schedIn','schedBlock','onDuty','offDuty','picName','sicName','instructorName','examinerName']):
    positioning?new Set(['dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty']):
    ground?new Set(['dep','courseType','trainerType','onDuty','offDuty','block']):
    standby?new Set(['dep','onDuty','offDuty','block']):
    genericDuty?new Set(['onDuty','offDuty']):
    dayOff?new Set():new Set();
  document.querySelectorAll('[data-entry-field]').forEach(el=>{if(!allowed.has(el.dataset.entryField))el.classList.add('hidden')});

  const settings=timeGroupSettings(),applicable=flight?new Set(['totalFlightTime','multiPilot','pic','picUS','sic','ifrTime','airTime','night','picNight','dualGiven','dualReceived','credit','totalDuty']):sim?new Set(['simulatorTime','sfiSfe','credit','totalDuty']):ground?new Set(['groundInstruction','credit','totalDuty']):standby?new Set(['stbyTime','credit','totalDuty']):positioning?new Set(['credit','totalDuty']):genericDuty?new Set(['totalDuty']):new Set();
  document.querySelectorAll('[data-time-group]').forEach(el=>{const key=el.dataset.timeGroup;el.classList.toggle('hidden',!applicable.has(key)||(key!=='totalDuty'&&settings[key]?.showCard!==true))});
  document.querySelectorAll('[data-flight-counter]').forEach(el=>el.classList.toggle('hidden',!flight));
  const visibleTimeGroups=[...document.querySelectorAll('[data-time-group]')].some(el=>!el.classList.contains('hidden'));
  $('breakdownTitle')?.classList.toggle('hidden',!visibleTimeGroups&&!flight);$('breakdownGrid')?.classList.toggle('hidden',!visibleTimeGroups&&!flight);
  $('nightStatus')?.classList.toggle('hidden',!flight||settings.night.showCard!==true);
  $('remarksWrap')?.classList.remove('hidden');$('calcPreview')?.classList.remove('hidden');

  const checks={pic:flight,pf:flight,instruction:flight,examiner:flight,simTrainer:sim,rhs:flight};
  Object.entries(checks).forEach(([key,show])=>document.querySelector(`[data-entry-check="${key}"]`)?.classList.toggle('hidden',!show));
  $('checkboxTitle')?.classList.toggle('hidden',!(flight||sim||ground||standby||positioning));$('checkboxGrid')?.classList.toggle('hidden',!(flight||sim||ground||standby||positioning));
  if(!flight){$('rolePicCheck').checked=false;$('pfCheck').checked=false;$('instructionCheck').checked=false;$('examinerCheck').checked=false;$('rhsCheck').checked=false;}
  if(!sim){$('simInstructorCheck').checked=false;$('simExaminerCheck').checked=false;}
  if($('simTrainerCheck'))$('simTrainerCheck').checked=sim&&($('simInstructorCheck').checked||$('simExaminerCheck').checked);
  if(positioning&&!controlledDuty(activityById($('editId')?.value))){for(const [key,schedule] of [['onDuty','schedOut'],['offDuty','schedIn']]){if(!formTimeOverrides[key]&&!formManualFields[key]&&!['manual','aeroline','logten','calendar','screenshot','source','imported'].includes(String(formFieldSources[key]||'').toLowerCase()))$(key).value=$(schedule).value||''}}
  const current=activityById($('editId').value),duty=controlledDuty(current),manual=flight&&requiresManualDutyControl(current||{dutyType:'Flight',source:'manual'});
  $('offDuty').readOnly=!!(flight&&(manual||duty)&&duty?.control.state!=='CLOSED');
  $('totalDutyDisplay').readOnly=!!(flight&&(manual||duty));
  if(!flight)['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);
  updateDelayUI();renderEntryDraftShelf();updateDutyControls();
  if(activityById($('editId').value)?.locked)setEntryLockedUI(true);
}
function calcEntry(){
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');
  let input={...formActivityInput(),dutyType};
  const source=formFieldSources.credit;
  if(!formLoading&&!formManualFields.credit&&(source==='awaiting-role'||source==='entry-default')){
    input={...input,trainerType:$('trainerTypeInput').value,courseType:$('courseType').value};
    const setting=trainingCreditSetting(input);
    if(source==='awaiting-role'&&setting){
      const value=Math.round(paySettings()[setting]*60);
      setDurationPicker($('creditDisplay'),value);
      formTimeOverrides.credit=true;formFieldSources.credit='entry-default';
      input={...input,credit:value,timeOverrides:{...input.timeOverrides,credit:true}};
    }else if(source==='entry-default'&&!setting){
      setDurationPicker($('creditDisplay'),null);
      formTimeOverrides.credit=false;formFieldSources.credit='awaiting-role';
      input={...input,credit:null,timeOverrides:{...input.timeOverrides,credit:false}};
    }
  }
  let c=PilotLogEngine.activity(input),settings=timeGroupSettings();
  setDurationPicker($('schedBlockDisplay'),c.schedBlock);
  if(!formTimeOverrides.block&&dutyType==='Flight')setDurationPicker($('blockDisplay'),c.block);
  input={...input,block:optionalDuration($('blockDisplay')?.value)??c.block,totalDuty:optionalDuration($('totalDutyDisplay')?.value),simulatorTime:optionalDuration($('simulatorTimeDisplay')?.value),credit:optionalDuration($('creditDisplay')?.value)};
  const alwaysCalculated=new Set(['totalFlightTime','airTime','simulatorTime','sfiSfe','credit','totalDuty']);
  TIME_GROUP_DEFS.forEach(({key})=>{
    const el=$(TIME_GROUP_INPUT_IDS[key]);if(!el)return;
    if(key==='totalDuty'&&(controlledDuty(input)||requiresManualDutyControl(input))){
      const duty=controlledDuty(input),control=duty?provisionalDutyControl(duty.root,dutySequenceFor(duty.root).map(r=>r.id===input.id?input:r),duty.control):null;
      const lastId=control?.endEntryId||control?.memberIds?.at(-1)||duty?.root.id;
      setDurationPicker(el,control?.state==='CLOSED'&&input.id===(control.totalDutyAtLast?lastId:duty.root.id)?controlledDutyMinutes(control):null);
      if(control?.provisional&&control.state==='CLOSED'&&input.id===lastId&&!formTimeOverrides.offDuty)$('offDuty').value=hhmm(new Date(control.end));
      return;
    }
    if(key==='credit'&&formFieldSources.credit==='awaiting-role'&&['Simulator','Ground Course'].includes(dutyType)){
      setDurationPicker(el,null);return;
    }
    if(formTimeOverrides[key]||entryManualField(input,key)||entryFieldSource(input,key)==='manual')return;
    if(alwaysCalculated.has(key)||settings[key]?.autoSync===true){
      if(key==='simulatorTime'&&input.simulatorTimeImported===true&&el.value&&settings.simulatorTime.autoSync!==true)return;
      if(key==='credit'&&dutyType==='Simulator'&&!userIsSimTrainer(input)&&!input.creditImported&&!entryFieldIsSource(input,'credit')&&!entryManualField(input,'credit')){el.value='';return}
      if(key==='credit'&&dutyType==='Ground Course'&&!entryManualField(input,'credit')&&!entryFieldIsSource(input,'credit')&&!input.creditImported){
        const trainer=upper($('trainerTypeInput')?.value||'');
        setDurationPicker(el,trainer==='TNE'?0:trainer==='GI'||trainer==='SOD'||upper(input.courseType)==='SOD'?Math.round(paySettings().groundCredit*60):null);
        formFieldSources.credit='calculated';return;
      }
      if(key==='groundInstruction'&&!entryHasTimeValue(input,'groundInstruction')){el.value='';return}
      setDurationPicker(el,calculatedTimeGroupValue(input,key));formFieldSources[key]='calculated';
    }
  });
  c=PilotLogEngine.activity({...input,simulatorTime:optionalDuration($('simulatorTimeDisplay')?.value),totalDuty:optionalDuration($('totalDutyDisplay')?.value),credit:optionalDuration($('creditDisplay')?.value)});
  $('role').value=formRoleValue(input);$('seatPosition').value=input.rhs?'Right':'Left';$('ifr').value='';$('pf').value=input.pf;
  if(dutyType==='DHD'||dutyType==='DHP')$('calcPreview').textContent=`${dutyType} • ${$('dep').value||'—'} → ${$('arr').value||'—'} • ${$('schedOut').value||'--:--'}–${$('schedIn').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Ground Course')$('calcPreview').textContent=`Ground Course • ${$('dep').value||'—'} • ${$('courseType').value||'Course'}${$('onDuty').value?' • Start '+$('onDuty').value+' Z':''} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='STBY')$('calcPreview').textContent=`STBY • ${$('dep').value||'—'} • ${$('onDuty').value||'--:--'}–${$('offDuty').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Simulator')$('calcPreview').textContent=`Schedule Block ${fmt(c.schedBlock)} • Simulator ${fmtOptional(optionalDuration($('simulatorTimeDisplay')?.value))||'—'} • Total Duty ${fmtOptional(optionalDuration($('totalDutyDisplay')?.value))||'—'} • Credit ${$('creditDisplay')?.value||'—'}`;
  else{const premium=dutyGetsMoroccoNightPremium({...formActivityInput(),dutyType:'Flight'})?` • Morocco Night +${appSettings().nightPremiumPct}%`:'';$('calcPreview').textContent=`Schedule Block ${fmt(c.schedBlock)} • Block ${fmt(c.block)} • Air Time ${$('airTimeDisplay')?.value||'—'} • Credit ${$('creditDisplay')?.value||'—'}${premium}`}
  updateDelayUI();document.querySelectorAll('[data-counter-shortcut]').forEach(button=>{const count=Number($(button.dataset.counterShortcut)?.value||0);button.querySelector('b').textContent=String(count);button.classList.toggle('count-active',count>0);button.disabled=!!$('dayTakeoffs')?.disabled});return c;
}
function updateSimulatorTrainerFromForm(){
  const checked=!!$('simTrainerCheck')?.checked;
  // Preserve the source role; the single checkbox controls the shared trainer rule.
  if(!checked){$('simInstructorCheck').checked=false;$('simExaminerCheck').checked=false}
  else if(!$('simInstructorCheck').checked&&!$('simExaminerCheck').checked)$('simInstructorCheck').checked=true;
  for(const key of ['simInstructor','simExaminer']){formManualFields[key]=true;formFieldSources[key]='manual'}
  calcEntry();silentAutosaveExisting();
}

/* Duty + EASA FTL — one deterministic operational-duty engine. */
function dtFromZulu(date,time){return zuluDate(date,time)}
function dutyDateEnd(date,start,end){const s=dtFromZulu(date,start),e=dtFromZulu(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return[s,e]}
function entryChrono(f){const t=f.out||f.schedOut||f.std||f.onDuty||'00:00';return `${f.date}T${t}`}
function compareLogbookEntries(a,b){return entryChrono(b).localeCompare(entryChrono(a))}
function dayEntries(date,fs=entryActivityRows()){return fs.filter(f=>f.date===date).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)))}
function externalDutyForDate(date){return dutyActivityRows().filter(d=>d.date===date).sort((a,b)=>(a.report||'').localeCompare(b.report||''))[0]||null}

const MAX_REASONABLE_DUTY_MIN=18*60;
function hhmm(d){return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`}
const dutySessions=createDutySessions({controlledDuty,isPositioning,requiresManualDutyControl,isFlight,isSim,shiftTime,zuluDate,dateAtOrAfter,hhmm,maxReasonableDutyMin:MAX_REASONABLE_DUTY_MIN});
function flightDutyWindow(f){return dutySessions.flightDutyWindow(f)}
function buildDutySessions(fs=entryActivityRows()){return dutySessions.buildDutySessions(fs)}
function totalDutyMinsForRows(rows){
  return (rows||[]).reduce((sum,row)=>sum+timeGroupFinalValue(row,'totalDuty',rows||[]),0);
}
// Duty button state is stored on the first flight in the same Core collection.
function isManualFlight(entry){return !!entry&&isFlight(entry)&&String(entry.source||'manual').toLowerCase()==='manual'}
// Preserve historical, explicitly entered duty times; never infer a new manual release.
function requiresManualDutyControl(entry){return !!entry&&isFlight(entry)&&(entry.manualDutyMode===true||isManualFlight(entry)&&(!entry.offDuty||entryFieldSource(entry,'offDuty')==='calculated'))}
// Only controls explicitly created/edited in 14.8 use a provisional endpoint.
function provisionalDutyControl(root,members,control){
  if(control.provisional!==true)return control;
  const ordered=[...members].sort((a,b)=>dutyActivityKey(a).localeCompare(dutyActivityKey(b))),last=ordered.at(-1);
  if(!last)return control;
  const finish=isFlight(last)?(last.in||last.schedIn):isSim(last)?last.schedIn:(last.dutyActivityEnd||last.schedIn||last.offDuty);
  const baseTime=isFlight(last)?last.out||last.schedOut:last.schedOut||last.onDuty;
  const base=finish?dateAtOrAfter(last.date,finish,zuluDate(last.date,baseTime)||new Date(control.start)):null;
  const end=base?new Date(+base+(isFlight(last)||isSim(last)?30:0)*60000):null;
  return {...control,memberIds:ordered.map(r=>r.id),endEntryId:last.id,state:end&&+end>=Date.parse(control.start)?'CLOSED':'OPEN',end:end&&+end>=Date.parse(control.start)?end.toISOString():'',endBasis:isFlight(last)&&last.in?'actual':'scheduled',totalDutyAtLast:true};
}
function refreshProvisionalDutyRecords(records,changedId){
  let result=records;
  const roots=records.filter(r=>r.dutyControl?.provisional===true&&(r.id===changedId||r.dutyControl.memberIds?.includes(changedId)));
  for(const root of roots){
    const ids=new Set(root.dutyControl.memberIds||[root.id]),members=result.filter(r=>ids.has(r.id)),control=provisionalDutyControl(root,members,root.dutyControl);
    result=result.map(r=>{
      if(!ids.has(r.id))return r;
      const next=controlledDutyFields(r,root,control);
      const changed=['onDuty','offDuty','totalDuty'].some(key=>next[key]!==r[key])||JSON.stringify(next.dutyControl)!==JSON.stringify(r.dutyControl)||next.coreInput?.totalDutyDisplay!==r.coreInput?.totalDutyDisplay;
      return changed?stamp(next):next;
    });
  }
  return result;
}
function totalDutyRowsForTotals(rows=coreActivityRows()){
  return rows.filter(r=>activityIncludedInResults(r)||controlledDuty(r)?.control.provisional!==undefined);
}
function controlledDutyMinutes(control){return control?.state==='CLOSED'?Math.max(0,Math.round((Date.parse(control.end)-Date.parse(control.start))/60000))||0:0}
function dutyEndTime(entry,fallback=''){
  const duty=controlledDuty(entry);
  if(duty)return duty.control.state==='CLOSED'?hhmm(new Date(duty.control.end)):'';
  return requiresManualDutyControl(entry)?'':entry?.offDuty||fallback;
}
function dutyEligible(entry){return !!entry&&canonicalDutyType(entry.dutyType||'Flight')!=='Day OFF'}
function dutySequenceFor(reference,rows=coreActivityRows()){
  const duty=controlledDuty(reference);if(!duty)return reference?[reference]:[];
  return [...new Set([duty.root.id,...(duty.control.memberIds||[])])].map(id=>rows.find(r=>r.id===id)).filter(Boolean);
}
function openDutyReference(reference=null){
  const own=controlledDuty(reference);if(own?.control.state==='OPEN')return own.root;
  const candidates=coreActivityRows().filter(f=>f.dutyControl?.state==='OPEN'&&(!reference?.screenshotDutyStart||f.dutyControl.start===reference.screenshotDutyStart));
  return candidates.length===1?candidates[0]:null;
}
function dutyLastId(duty){return duty.control.endEntryId||duty.control.memberIds?.at(-1)||duty.root.id}
function selectedDuty(){const root=coreActivityRows().find(r=>r.id===$('dutyTarget')?.value);return root?.dutyControl?{root,control:root.dutyControl}:null}
function dutyActivityKey(entry){return `${entry.date||''}T${entry.out||entry.schedOut||entry.dutyActivityReport||entry.onDuty||'00:00'}`}
function dutyRange(first,last,oldDuty){
  const from=dutyActivityKey(first),to=dutyActivityKey(last);
  if(to<from)throw new Error('The selected last activity is before the first activity. Correct the dates or press DUTY ON on the first activity.');
  const endpointDuty=controlledDuty(last);if(endpointDuty&&endpointDuty.root.id!==oldDuty?.root.id)throw new Error('The selected last activity belongs to another duty. Choose the duty of this activity.');
  const members=coreActivityRows().filter(r=>{const own=controlledDuty(r);return dutyEligible(r)&&dutyActivityKey(r)>=from&&dutyActivityKey(r)<=to&&(!own||own.root.id===oldDuty?.root.id)&&(!first.screenshotDutyStart||!r.screenshotDutyStart||r.screenshotDutyStart===first.screenshotDutyStart)}).sort((a,b)=>dutyActivityKey(a).localeCompare(dutyActivityKey(b)));
  return [first,...members.filter(r=>r.id!==first.id&&r.id!==last.id),...(last.id!==first.id?[last]:[])];
}
let dutyActionBusy=false;
async function runDutyAction(action){
  if(dutyActionBusy)return;dutyActionBusy=true;updateDutyControls();
  try{await action()}catch(error){console.error('Duty operation failed',error);alert(error.message||'Duty operation failed.')}finally{dutyActionBusy=false;updateDutyControls()}
}
async function saveDutyChange(first,members,control,oldDuty,selectedId){
  const before=coreActivityRows(),ids=new Set(members.map(r=>r.id)),oldIds=new Set(oldDuty?dutySequenceFor(oldDuty.root).map(r=>r.id):[]);
  const nextControl=provisionalDutyControl(first,members,{...control,totalDutyAtLast:true,id:control.id||makeActivityId(),memberIds:members.map(r=>r.id)});
  const changed=[];
  const after=before.map(row=>{
    if(ids.has(row.id)){const next=stamp(controlledDutyFields({...row,dutyControl:null},first,nextControl));changed.push(next);return next}
    if(oldIds.has(row.id)){const next=stamp({...row,dutyControl:null,dutyRootId:'',onDuty:'',offDuty:'',totalDuty:null,fieldSources:{...row.fieldSources,onDuty:'',offDuty:'',totalDuty:''},coreInput:row.coreInput?{...row.coreInput,onDuty:'',offDuty:'',totalDutyDisplay:''}:undefined});changed.push(next);return next}
    return row;
  });
  commitCoreActivities(after);
  try{await persistCoreActivities()}catch(error){commitCoreActivities(before);try{await persistCoreActivities()}catch{};throw new Error('Duty was not saved. The previous state has been restored; check storage and try again.')}
  changed.forEach(row=>markCloudEdited('activities',row,'duty-edit'));
  await persistCoreActivities();
  loadEntryToForm(coreActivityRows().find(r=>r.id===selectedId));scheduleAutoSync('duty-edit');
}
function dutyOn(){return runDutyAction(async()=>{
  saveEntryDraft();const current=activityById($('editId').value);
  if(!dutyEligible(current))return;
  const duty=selectedDuty()||controlledDuty(current);
  const departure=zuluDate(current.date,current.schedOut||'');
  const report=current.dutyActivityReport||current.onDuty;
  let start=duty?.root.id===current.id?new Date(duty.control.start):report?zuluDate(current.date,report):departure?new Date(+departure-(isFlight(current)||isSim(current)?60:0)*60000):null;
  if(duty?.root.id!==current.id&&report&&departure&&start>departure)start.setUTCDate(start.getUTCDate()-1);
  if(!start||!Number.isFinite(+start))throw new Error('Enter the reporting time and activity date before pressing DUTY ON.');
  const last=duty?coreActivityRows().find(r=>r.id===dutyLastId(duty)):current;
  if(!last)throw new Error('The last activity is missing. Correct the duty endpoint first.');
  const members=dutyRange(current,last,duty),control={...(duty?.control||{}),state:'OPEN',provisional:false,start:start.toISOString(),end:'',endEntryId:'',endBasis:''};
  if(control.state==='CLOSED'&&Date.parse(control.end)<+start)throw new Error('Duty start must not be after duty end. Correct the dates or times.');
  await saveDutyChange(current,members,control,duty,current.id);
})}
function dutyOff(){return runDutyAction(async()=>{
  saveEntryDraft();const current=activityById($('editId').value);
  if(!dutyEligible(current))return;
  const open=openDutyReference(current),duty=selectedDuty()||controlledDuty(current)||(open?{root:open,control:open.dutyControl}:null);
  if(!duty)throw new Error('Select the duty to correct below the buttons, or open a duty with DUTY ON first.');
  const members=dutyRange(duty.root,current,duty),start=new Date(duty.control.start);
  const finish=isFlight(current)?current.in:isSim(current)?current.schedIn:(current.dutyActivityEnd||current.offDuty||current.schedIn);
  let end;
  if(duty.control.state==='CLOSED'&&duty.control.provisional!==true&&dutyLastId(duty)===current.id)end=new Date(duty.control.end);
  else{
    if(!finish)throw new Error(isFlight(current)?'Enter Actual IN of this flight.':'Enter the end time of this activity.');
    const activityStart=zuluDate(current.date,current.out||current.schedOut||current.dutyActivityReport||'')||start;
    const base=dateAtOrAfter(current.date,finish,activityStart);end=base?new Date(+base+(isFlight(current)||isSim(current)?30:0)*60000):null;
  }
  if(!end||!Number.isFinite(+end)||end<start)throw new Error('Check the activity date and end time.');
  await saveDutyChange(duty.root,members,{...duty.control,state:'CLOSED',provisional:false,endBasis:'actual',end:end.toISOString(),endEntryId:current.id},duty,current.id);
})}
function updateDutyControls(){
  const entry=activityById($('editId')?.value),duty=controlledDuty(entry),eligible=dutyEligible(entry);
  for(const [id,active] of [['dutyOnBtn',!!duty&&entry.id===duty.root.id],['dutyOffBtn',!!duty&&duty.control.state==='CLOSED'&&!duty.control.provisional&&entry.id===dutyLastId(duty)]]){const b=$(id);if(b){b.classList.toggle('duty-confirmed',active);b.setAttribute('aria-pressed',String(active));b.disabled=!eligible||dutyActionBusy}}
  const target=$('dutyTarget');if(target){
    const entryChanged=target.dataset.entryId!==entry?.id,previous=entryChanged?'':target.value;
    target.dataset.entryId=entry?.id||'';
    const roots=coreActivityRows().filter(r=>r.dutyControl).sort((a,b)=>String(b.dutyControl.start).localeCompare(String(a.dutyControl.start)));
    target.innerHTML='<option value="">New duty / choose duty to correct</option>'+roots.map(r=>`<option value="${esc(r.id)}">${esc(r.date)} · ${esc(r.flightNo||r.dutyType)} · ${esc(r.dutyControl.provisional?'PROVISIONAL':r.dutyControl.state)}</option>`).join('');
    target.value=entryChanged?(duty?.root.id||''):previous;
    target.disabled=!eligible||dutyActionBusy;
  }
  for(const [field,key,endpoint] of [['dutyStartDate','start',!!duty&&entry.id===duty.root.id],['dutyEndDate','end',!!duty&&duty.control.state==='CLOSED'&&entry.id===dutyLastId(duty)]]){const el=$(field);if(el){el.hidden=!endpoint;el.disabled=!endpoint;el.value=endpoint?duty.control[key].slice(0,10):''}}
  if(duty){$('onDuty').disabled=false;$('offDuty').disabled=false}
  if($('onDuty'))$('onDuty').readOnly=!!duty&&entry.id!==duty.root.id;
  if($('offDuty'))$('offDuty').readOnly=!!duty?(duty.control.state==='CLOSED'?entry.id!==dutyLastId(duty):isFlight(entry)||isSim(entry)):false;
  const status=$('dutyState');if(status)status.textContent=duty?`${duty.control.provisional?'PROVISIONAL · '+(duty.control.endBasis==='actual'?'Actual IN':'Scheduled IN'):duty.control.state} · ${dutySequenceFor(duty.root).length} activities`:'';
}
function dutyClockOnDate(value,reference){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||'')||!Number.isFinite(reference?.getTime()))return null;
  const date=zuluDate(reference.toISOString().slice(0,10),value),delta=date-reference;
  if(delta>12*3600000)date.setUTCDate(date.getUTCDate()-1);
  else if(delta< -12*3600000)date.setUTCDate(date.getUTCDate()+1);
  return date;
}
function controlledDutyFields(entry,root,control){
  const closed=control.state==='CLOSED',timeOverrides={...(entry.timeOverrides||{})},manualFields={...(entry.manualFields||{})};
  for(const key of ['onDuty','offDuty','totalDuty']){if(key==='onDuty'&&entry.id===root.id&&control.startBasis==='manual')continue;delete timeOverrides[key];delete manualFields[key]}
  const lastId=control.endEntryId||(control.memberIds||[root.id]).at(-1);
  const onDuty=entry.id===root.id?hhmm(new Date(control.start)):'',offDuty=closed&&entry.id===lastId?hhmm(new Date(control.end)):'',totalDuty=closed?(entry.id===(control.totalDutyAtLast?lastId:root.id)?controlledDutyMinutes(control):(control.totalDutyAtLast?null:0)):null;
  return {...entry,dutyActivityReport:entry.dutyActivityReport||(entry.fieldSources?.onDuty!=='duty-control'?entry.onDuty:'')||'',dutyActivityEnd:entry.dutyActivityEnd||(entry.fieldSources?.offDuty!=='duty-control'?entry.offDuty:'')||'',onDuty,offDuty,totalDuty,timeOverrides,manualFields,fieldSources:{...(entry.fieldSources||{}),onDuty:entry.id===root.id&&control.startBasis==='manual'?'manual':'duty-control',offDuty:closed?'duty-control':'',totalDuty:'duty-control'},dutyRootId:root.id,...(entry.id===root.id?{dutyControl:control}:{}),...(entry.coreInput?{coreInput:{...entry.coreInput,onDuty,offDuty,totalDutyDisplay:totalDuty===null?'':fmt(totalDuty)}}:{})};
}
function storeDutyControl(root,members,control,reason){
  control={...control,memberIds:members.map(f=>f.id)};
  for(const f of members){const row=upsertCoreActivity(stamp(controlledDutyFields(f,root,control)));markCloudEdited('activities',row,reason)}
}
function applyDutyToEntry(entry){
  const duty=controlledDuty(entry);
  if(duty)return controlledDutyFields(entry,duty.root,duty.control);
  return requiresManualDutyControl(entry)?{...entry,offDuty:'',totalDuty:null}:entry;
}
// Clearing the reporting time removes the entire explicit duty, including hidden links.
function resetControlledDuty(duty){
  const ids=new Set(dutySequenceFor(duty.root).map(r=>r.id));
  const changed=[];
  const after=coreActivityRows().map(row=>{
    if(!ids.has(row.id))return row;
    const timeOverrides={...row.timeOverrides},manualFields={...row.manualFields},fieldSources={...row.fieldSources};
    for(const key of ['onDuty','offDuty','totalDuty']){delete timeOverrides[key];delete manualFields[key];fieldSources[key]=''}
    // Explicit empty clocks must not be repopulated by schedule helpers.
    timeOverrides.onDuty=true;timeOverrides.offDuty=true;
    const next=stamp({...row,dutyControl:null,dutyRootId:'',dutyActivityReport:'',dutyActivityEnd:'',onDuty:'',offDuty:'',totalDuty:null,
      ...(isFlight(row)?{manualDutyMode:true}:{}),timeOverrides,manualFields,fieldSources,
      ...(row.coreInput?{coreInput:{...row.coreInput,onDuty:'',offDuty:'',totalDutyDisplay:'',dutyStartDate:'',dutyEndDate:''}}:{})});
    changed.push(next);return next;
  });
  commitCoreActivities(after);
  changed.forEach(row=>markCloudEdited('activities',row,'duty-reset'));
  for(const key of ['onDuty','offDuty','totalDuty']){delete formTimeOverrides[key];delete formManualFields[key];delete formFieldSources[key]}
  formTimeOverrides.onDuty=true;formTimeOverrides.offDuty=true;
  for(const id of ['onDuty','offDuty','totalDutyDisplay','dutyStartDate','dutyEndDate'])if($(id))$(id).value='';
  if($('dutyTarget'))$('dutyTarget').value='';
  updateDutyControls();scheduleAutoSync('duty-reset');
}
function syncControlledDutyEdit(){
  const entry=activityById($('editId')?.value),duty=controlledDuty(entry);if(!duty)return;
  if(entry.id===duty.root.id&&formTimeOverrides.onDuty&&!$('onDuty').value&&!$('onDuty').validity?.badInput){resetControlledDuty(duty);return}
  const control={...duty.control};let changed=false;
  if(entry.id===dutyLastId(duty)&&control.state==='CLOSED'&&formTimeOverrides.offDuty&&!$('offDuty').value&&!$('offDuty').validity?.badInput){
    Object.assign(control,{state:'OPEN',provisional:false,end:'',endEntryId:'',endBasis:'',minutes:0});
    storeDutyControl(duty.root,dutySequenceFor(duty.root),control,'duty-reopen');
    if($('totalDutyDisplay'))$('totalDutyDisplay').value='';
    updateDutyControls();scheduleAutoSync('duty-reopen');return;
  }
  if(entry.id===duty.root.id&&formTimeOverrides.onDuty&&($('onDuty').value!==hhmm(new Date(control.start))||$('dutyStartDate').value!==control.start.slice(0,10))){const start=zuluDate($('dutyStartDate').value||control.start.slice(0,10),$('onDuty').value);if(start&&Number.isFinite(+start)){control.start=start.toISOString();changed=true}}
  if(entry.id===(control.endEntryId||control.memberIds?.at(-1))&&control.state==='CLOSED'&&formTimeOverrides.offDuty&&($('offDuty').value!==hhmm(new Date(control.end))||$('dutyEndDate').value!==control.end.slice(0,10))){const end=zuluDate($('dutyEndDate').value||control.end.slice(0,10),$('offDuty').value);if(end&&Number.isFinite(+end)){control.end=end.toISOString();control.provisional=false;control.endBasis='manual';changed=true}}
  if(changed&&(control.state==='OPEN'||Date.parse(control.end)>=Date.parse(control.start))){control.minutes=controlledDutyMinutes(control);storeDutyControl(duty.root,dutySequenceFor(duty.root),control,'duty-edit')}
}
function controlledDuty(entry){
  const storedRoot=entry?.dutyRootId&&!entry.dutyControl?operationalDatabase?.records.find(f=>isEntryActivityRecord(f)&&f.id===entry.dutyRootId):null;
  const root=entry?.dutyControl?entry:storedRoot?copyJson(storedRoot):null;
  return root?.dutyControl?{root,control:root.dutyControl}:null;
}

function reconcileAllDuties(){
  return buildDutySessions(entryActivityRows());
}

/* EASA FTL — basic maximum daily FDP, acclimatised, no extension. ORO.FTL.205 Table 2. */
function tzParts(date,tz){try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const h=Number(p.find(x=>x.type==='hour')?.value||0),m=Number(p.find(x=>x.type==='minute')?.value||0);return h*60+m}catch{return date.getUTCHours()*60+date.getUTCMinutes()}}
function startOfDays(n,now=new Date()){const d=new Date(now);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-n+1);return d}
const ftlLimits=createFtlLimits({
  sum,dateOnly,totalFlightMins,startOfDays,flightRows:()=>entryActivityRows().filter(isFlight),
  tzParts,airport,zuluDate,timeSpanMins,rosterGroups
});
function fdpLimit(localStartMins,sectors){return ftlLimits.fdpLimit(localStartMins,sectors)}
function rollingFlight(n,now=new Date()){return ftlLimits.rollingFlight(n,now)}
function rollingDuty(n,now=new Date(),sessions=buildDutySessions()){return ftlLimits.rollingDuty(n,now,sessions)}
function calendarYearFlight(now=new Date()){return ftlLimits.calendarYearFlight(now)}
function rollingCalendar12Flight(now=new Date()){return ftlLimits.rollingCalendar12Flight(now)}
function ftlLimitState(value,limit){return ftlLimits.ftlLimitState(value,limit)}
function limitRow(name,value,limit){
  const s=ftlLimitState(value,limit);
  return `<div class="stat-row ftl-limit-row ftl-${s.state}"><span>${esc(name)}</span><b class="${s.textClass}">${fmt(value)} / ${fmt(limit)}</b></div>`;
}
function sessionFdp(s){return ftlLimits.sessionFdp(s)}
function rosterFdp(g){return ftlLimits.rosterFdp(g)}
function nextFdpCandidate(sessions,now=new Date()){return ftlLimits.nextFdpCandidate(sessions,now)}
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
function localTime(date,time,code){if(!time)return'';const a=airportIndex[upper(code)],d=parseUtcForRoster(date,time);if(!d)return time;try{return new Intl.DateTimeFormat('en-GB',{timeZone:a?.tz||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}catch{return time}}
const rosterGroupProjection=createRosterGroups({
  cleanPrefix,appSettings,upper,recordRevision,isPositioning,isSim,isStby,isGround,isDhd,isDhp,
  rosterFlightRows,entryChrono,dutyActivityRows,dutyEndTime,shiftTime,canonicalDutyType,activityIncludedInResults
});
function rosterFlightDigits(v){return rosterGroupProjection.rosterFlightDigits(v)}
function rosterFlightLabel(v){return rosterGroupProjection.rosterFlightLabel(v)}
function rosterActivitySameIdentity(a,b){return rosterGroupProjection.rosterActivitySameIdentity(a,b)}
function rosterSectorSameIdentity(a,b){return rosterGroupProjection.rosterSectorSameIdentity(a,b)}
function mergeRosterSector(a,b){return rosterGroupProjection.mergeRosterSector(a,b)}
function mergeRosterActivity(a,b){return rosterGroupProjection.mergeRosterActivity(a,b)}
function cleanupRosterDuplicates(){
  // SAFETY INVARIANT: Roster rendering/import must never merge or delete activities.
  // Duplicate-looking records are preserved for explicit user review.
  return 0;
}

function rosterGroups(rows=displayActivityRows()){return rosterGroupProjection.rosterGroups(rows)}
function savedEntryForRosterSector(r){
  if(!r||!activityIncludedInResults(r))return null;
  return coreActivityRows().find(x=>x.id===r.id&&isFlight(x))||null;
}
function rosterSectorCompleted(r){return !!r&&activityIncludedInResults(r)}
function crewCarryData(entry){
  if(!entry)return null;
  const crew={};
  CREW_NAME_FIELDS.forEach(key=>{crew[key]=entry[key]??''});
  for(let i=0;i<3;i++){const key=`attendant${i+1}Name`;if(!Object.prototype.hasOwnProperty.call(entry,key))crew[key]=entry.cabinCrew?.[i]||''}
  return {...crew,role:entry.role||'PIC',rolePic:entry.rolePic===true||entry.role==='PIC',cabinCrew:[crew.attendant1Name,crew.attendant2Name,crew.attendant3Name],observerCrew:Array.isArray(entry.observerCrew)?[...entry.observerCrew]:[],studentName:entry.studentName||'',instruction:entry.instruction===true,examiner:entry.examiner===true};
}
function formCrewSnapshot(){
  const crew=crewCarryData(activityById($('editId')?.value)||{});
  CREW_NAME_FIELDS.forEach(key=>{if($(key))crew[key]=upper($(key).value||'')});
  return {...crew,role:$('rolePicCheck')?.checked?'PIC':'SIC',rolePic:!!$('rolePicCheck')?.checked,cabinCrew:[crew.attendant1Name,crew.attendant2Name,crew.attendant3Name],instruction:!!$('instructionCheck')?.checked,examiner:!!$('examinerCheck')?.checked};
}
function applyCrewToForm(crew){
  if(!crew)return;
  $('rolePicCheck').checked=crew.role==='PIC';$('role').value=$('rolePicCheck').checked?'PIC':'SIC';
  CREW_NAME_FIELDS.forEach(key=>{if($(key))$(key).value=upper(crew[key]||'')});
  $('instructionCheck').checked=crew.instruction===true;$('examinerCheck').checked=crew.examiner===true;
}
function carryCrewToRosterFlight(entry){
  const aeroline=entry.source==='aeroline';
  if(!isFlight(entry)||entry.locked||entry.crewCarryApplied&&!aeroline||String(entry.source||'').toLowerCase()==='logten')return entry;
  if(isManualFlight(entry)&&!controlledDuty(entry))return entry;
  const previous=(aeroline?previousAerolineReturnSector(entry):null)||rosterCarryDefaultsForItem(entry);if(!previous)return entry;
  const crew=crewCarryData(previous),existingCrew=crewCarryData(entry),row={...entry,crewCarryApplied:true};
  let changed=!entry.crewCarryApplied;
  if(!previous.reg||!entry.reg||upper(previous.reg)===upper(entry.reg)){
    for(const key of ['type','variant']){
      if(previous[key]&&!row[key]&&!entryManualField(entry,key)){
        row[key]=previous[key];changed=true;
        if(row.coreInput)row.coreInput={...row.coreInput,[key]:row[key]};
      }
    }
  }
  for(const [key,value] of Object.entries(crew)){
    if(entryManualField(entry,key))continue;
    const current=CREW_NAME_FIELDS.includes(key)?existingCrew[key]:entry[key],empty=current==null||current===''||Array.isArray(current)&&!current.length;
    if(entryFieldIsSource(entry,key)&&(!aeroline||!empty))continue;
    if(empty||['instruction','examiner'].includes(key)&&!current){
      const next=key==='cabinCrew'?[row.attendant1Name||'',row.attendant2Name||'',row.attendant3Name||'']:value;
      if(JSON.stringify(current)!==JSON.stringify(next)){row[key]=next;changed=true}
    }
  }
  if(!changed)return entry;
  if(['attendant1Name','attendant2Name','attendant3Name'].some(key=>row[key]!==entry[key])&&!entryManualField(entry,'cabinCrew'))row.cabinCrew=['attendant1Name','attendant2Name','attendant3Name'].map(key=>row[key]??existingCrew[key]??'');
  // Manual clears remain protected; empty unedited fields can receive names entered later.
  if(row.coreInput){row.coreInput={...row.coreInput};CREW_NAME_FIELDS.forEach(key=>row.coreInput[key]=row[key]||'');row.coreInput.instructionCheck=row.instruction===true;row.coreInput.examinerCheck=row.examiner===true}
  return row;
}
function previousAerolineReturnSector(entry){
  if(!isFlight(entry)||entry.source!=='aeroline'||!entry.date||!(entry.out||entry.schedOut)||!entry.dep||!entry.arr)return null;
  const earlier=coreActivityRows().filter(f=>f.id!==entry.id&&isFlight(f)&&f.source==='aeroline'&&f.date&&(f.out||f.schedOut)&&
    (f.date===entry.date||entry.aerolineBlockId&&f.aerolineBlockId===entry.aerolineBlockId||f.aerolineArrivalDate===entry.date)&&entryChrono(f)<entryChrono(entry))
    .sort((a,b)=>entryChrono(b).localeCompare(entryChrono(a)));
  const previous=earlier[0];
  if(!previous||earlier[1]&&entryChrono(earlier[1])===entryChrono(previous)||upper(previous.dep)!==upper(entry.arr)||upper(previous.arr)!==upper(entry.dep))return null;
  return previous;
}
function carryAircraftToAerolineReturn(entry){
  if(!isFlight(entry)||entry.source!=='aeroline'||entry.locked)return entry;
  const previous=previousAerolineReturnSector(entry);if(!previous)return entry;
  // A different aircraft already assigned to the return must not inherit this type.
  if(upper(entry.reg)&&upper(previous.reg)!==upper(entry.reg))return entry;
  const row={...entry,fieldSources:{...entry.fieldSources},manualFields:{...entry.manualFields}};let changed=false;
  for(const key of ['reg','type','variant']){
    const current=upper(entry[key]),prior=upper(previous[key]);
    const moreSpecific=key==='type'&&current&&prior.startsWith(current+'-');
    if(entryManualField(entry,key)||!prior||(current&&!moreSpecific))continue;
    if(key==='variant'&&upper(entry.type)&&upper(previous.type)&&aircraftIcaoType(entry)!==aircraftIcaoType(previous))continue;
    row[key]=upper(previous[key]);row.fieldSources[key]='previous-sector';row.manualFields[key]=false;changed=true;
    if(entry.coreInput){row.coreInput={...(row.coreInput||entry.coreInput),[key]:key==='reg'?aircraftIdInput(row[key]):row[key]}}
  }
  if(!changed)return entry;
  return row;
}
function rosterCarryDefaultsForItem(r){
  const duty=controlledDuty(r),group=duty?null:rosterGroups().find(g=>g.items.some(x=>x.id===r?.id));
  if(!duty&&!group)return null;
  const items=(duty?dutySequenceFor(duty.root):[...group.items]).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
  const idx=items.findIndex(x=>x.id===r.id);
  if(idx<=0)return null;
  for(let i=idx-1;i>=0;i--){
    const prev=savedEntryForRosterSector(items[i]);
    if(!prev)continue;
    const previousDuty=controlledDuty(prev);if(previousDuty&&previousDuty.root.id!==duty?.root.id)continue;
    return{
      ...crewCarryData(prev),
      reg:prev.reg||'',type:prev.type||'',variant:prev.variant||'',role:prev.role||'PIC',rolePic:prev.rolePic===true||prev.role==='PIC',
      rhs:prev.rhs===true,seatPosition:prev.rhs===true?'Right':'',pf:'no'
    };
  }
  return null;
}

async function rosterGroupHtml(groups,interactive=false){
  if(!groups.length)return'<div class="empty">No roster activities for this day.</div>';
  let html='';

  for(const g of [...groups].sort((a,b)=>`${b.date}${b.sortTime||b.start||''}`.localeCompare(`${a.date}${a.sortTime||a.start||''}`))){
    const type=canonicalDutyType(g.activityType||'Duty','Duty'),u=upper(type);

    if(u==='DAY OFF'||u==='OFF'){
      const action=interactive&&g.dutyId?` ${summaryAttrs('edit-roster-duty',g.dutyId)}`:'';
      html+=`<div class="rowitem roster-agenda-row roster-day-off${action?' roster-agenda-clickable':''}"${action}><div><b>${esc(displayDate(g.date))} • Day OFF</b>${g.remarks?`<div class="small">${esc(g.remarks)}</div>`:''}</div><div class="meta"><span class="small">OFF</span></div></div>`;
      continue;
    }

    if(g.kind==='flight'){
      for(const r of [...g.items].sort(compareLogbookEntries)){
        const start=r.std?await localTime(r.date,r.std,r.dep):'--:--',end=r.sta?await localTime(r.date,r.sta,r.arr||r.dep):'--:--',done=rosterSectorCompleted(r);
        const info=r.aerolineTrainingLabel||r.aerolineTrainingDesc||'';
        const action=interactive?` ${summaryAttrs('roster-action',r.id)}`:'';
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
    if(interactive&&g.entryId)action=` ${summaryAttrs('edit-roster-entry',g.entryId)}`;
    else if(interactive&&g.dutyId)action=` ${summaryAttrs('edit-roster-duty',g.dutyId)}`;

    html+=`<div class="rowitem roster-agenda-row${action?' roster-agenda-clickable':''}"${action}><div><b>${esc(displayDate(g.date))} • ${esc(type)}</b>${detail?`<div class="small">${detail}</div>`:''}</div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time</span></div></div>`;
  }

  return html;
}

/* One activity collection. Roster and Logbook are filtered projections of the same records. */
const {rosterMonthAvailable,operationalEntriesForMonth,operationalEntriesForTrips}=createRosterPlanning({
  displayActivityRows,inMonth,activityIncludedInResults,isFlight,entryChrono,tripSequenceStart
});

/* Trips */
const {calculateTripMetrics,calculateSavedTripProjection,calculateSavedTripProjections}=createTripProjection({
  dayEntries,activityRule,tripSequenceStart,entryStart,zuluDate,creditMinsForEntry,
  controlledDuty,requiresManualDutyControl,shiftTime,dutyDateEnd,operationalEntriesForTrips,
  groundTripDutyMins:PILOTLOG_RULES.fixed.groundTripDutyMins,layoverRate:()=>paySettings().layoverRate,readTrips:()=>load(TRIPS_KEY)
});
function tripChargeLabel(f){
  const rule=activityRule(f);if(rule.trip==='zero')return isStby(f)?'Not deducted':'Excluded from duty';if(rule.trip==='credit')return`Credit ${fmt(PilotLogEngine.credit(f))} deducted`;if(rule.trip==='fixed-ground')return`${fmt(PILOTLOG_RULES.fixed.groundTripDutyMins)} fixed duty`;return'Included in duty';
}

let tripFormOverrides={};
function tripCalc(){
  const cashAmount=Number($('tripCashAmount')?.value||0),result=PilotLogEngine.trip($('tripStart').value,$('tripEnd').value,cashAmount);if(!result){$('tripLayover').value='0:00';$('tripAllowance').value='0.00';return null}
  if(tripFormOverrides.layover!=null){result.layover=tripFormOverrides.layover;result.allowance=cashAmount>0?0:result.layover/60*Number(paySettings().layoverRate||0)}
  if(cashAmount<=0&&tripFormOverrides.allowance!=null)result.allowance=tripFormOverrides.allowance;
  $('tripLayover').value=fmt(result.layover);$('tripAllowance').value=cashAmount>0?moneyCurrency(0,appCurrency()):moneyCurrency(result.allowance,'MAD');return result
}
function tripStartDateFromValue(v){return String(v||'').slice(0,10)}
function tripFxCache(t,target,from,startDate){
  const x=t?.cashFxRates?.[target];if(x&&upper(x.from||'')===from&&(String(x.tripStartDate||'')===startDate||t?.createdDate===x.tripStartDate)&&Number(x.rate)>0)return x;
  if(target==='EUR'&&Number(t?.cashAmount)>0&&Number(t?.cashEur)>0&&String(t?.cashFxDate||'')&&upper(t?.cashCurrency||'')===from){return{from,to:'EUR',rate:Number(t.cashEur)/Number(t.cashAmount),date:String(t.cashFxDate),tripStartDate:startDate}}
  return null;
}
function tripMoneyConversion(){
  const c=tripCalc();if(!c)return null;
  const amount=Number($('tripCashAmount')?.value||0),from=upper($('tripCashCurrency')?.value||''),startDate=tripStartDateFromValue($('tripStart')?.value),existing=load(TRIPS_KEY).find(x=>x.id===$('tripEditId')?.value);
  const to=existing?.cashFxTo&&from===upper(existing.cashCurrency)?existing.cashFxTo:appCurrency();
  if($('tripCashConvertedLabel'))$('tripCashConvertedLabel').textContent='Cash value in '+currencyOutputCode(to);
  if(amount>0&&!ISO_CURRENCIES.includes(from))return {...c,error:'Select a valid cash currency.'};
  const manual=tripFormOverrides.cashConverted,manualMatch=manual&&manual.from===from&&manual.to===to&&manual.date===startDate&&manual.amount===amount;
  const created=existing?existing.createdDate||'':today();
  const exact=existing?.cashFxRate>0&&upper(existing.cashFxFrom||existing.cashCurrency)===from&&(existing.cashFxTo===to||!existing.cashFxTo&&from===to)?{rate:existing.cashFxRate,date:existing.cashFxDate,manual:existing.cashFxManual}:tripFxCache(existing,to,from,startDate);
  const cashMonth=existing?.cashMonth||(!existing?monthNow():'');
  const cached=exact&&!existing?.cashFxProvisional?exact:cashMonth?monthRate(cashMonth,from,to,true):exact;

  const rate=amount<=0?0:manualMatch?manual.value/amount:from===to?1:Number(cached?.rate||0);
  const provisional=!!(amount>0&&!manualMatch&&from!==to&&cached?.provisional);
  const converted=rate>0?amount*rate:null;
  if($('tripCashConverted'))$('tripCashConverted').value=converted===null?'':moneyCurrency(converted,to);
  if($('tripAllowance'))$('tripAllowance').value=moneyCurrency(c.allowance,'MAD');
  return {...c,cashConverted:converted,cashRate:rate,cashFxDate:rate>0?(manualMatch||from===to?created:cached?.date||''):'',cashFrom:from,cashTo:to,madRate:1,tripStartDate:startDate,cashFxProvisional:provisional,cashFxPending:amount>0&&(!rate||provisional),cashFxManual:!!manualMatch||!!(exact?.manual),error:''};
}
let tripFxRefreshBusy=false,tripFxRescan=false;
function tripFxIdentity(t){return JSON.stringify([t.start,t.cashAmount,t.cashCurrency,t.cashFxManual,t.cashFxRate,t.cashFxTo,t.cashFxDate])}
async function refreshPendingTripFx(){
  if(tripFxRefreshBusy){tripFxRescan=true;return {changed:false,failed:0}}
  if(navigator.onLine===false)return {changed:false,failed:0};
  tripFxRefreshBusy=true;let changed=false,failed=0;
  const owner=cloudStoredSession()?.user?.id,archive=operationalDatabase;
  try{
    for(const snapshot of load(TRIPS_KEY)){
      const amount=Number(snapshot.cashAmount||0),from=upper(snapshot.cashCurrency||''),startDate=snapshot.createdDate,target=upper(snapshot.cashFxTo||'');
      if(!snapshot.cashMonth||!snapshot.cashFxPending||!target||!(amount>0)||!from||snapshot.cashFxManual)continue;
      try{
        const info=await requestMonthlyRate(snapshot.cashMonth,from,target);
        if(!info?.locked||archive!==operationalDatabase||owner!==cloudStoredSession()?.user?.id)continue;
        const rate=info.rate,current=load(TRIPS_KEY),i=current.findIndex(t=>t.id===snapshot.id);
        if(i<0||!current[i].cashFxPending||current[i].cashMonth!==snapshot.cashMonth||tripFxIdentity(current[i])!==tripFxIdentity(snapshot))continue;
        const date=info?.date||startDate,provisional=false;
        const entry={from,to:target,rate,date,tripStartDate:startDate,provisional};
        const updated=stamp({...current[i],cashFxRates:{...current[i].cashFxRates,[target]:entry},cashFxFrom:from,cashFxTo:target,cashFxRate:rate,cashFxDate:date,cashFxTripStartDate:startDate,cashConverted:amount*rate,cashEur:target==='EUR'?amount*rate:current[i].cashEur,cashFxPending:false,cashFxProvisional:provisional});
        current[i]=updated;save(TRIPS_KEY,current);markCloudEdited('trips',updated,'trip-fx-update');changed=true;
      }catch{failed++}
    }
    if(changed){renderTrips();renderTripCashPayment($('payrollMonth')?.value||monthNow());if($('tripEditId')?.value)tripMoneyConversion();scheduleAutoSync('trip-fx-update')}
    return {changed,failed};
  }finally{tripFxRefreshBusy=false;if(tripFxRescan){tripFxRescan=false;queueMicrotask(refreshPendingTripFx)}}
}
function resetTrip(){tripFormOverrides={};$('tripForm').reset();$('tripEditId').value='';$('tripLayover').value='0:00';$('tripAllowance').value=moneyCurrency(0);if($('tripCashConverted'))$('tripCashConverted').value='';if($('tripCashCurrency'))$('tripCashCurrency').value='USD';updateCurrencyUI()}
function updateCurrencyUI(){
  const cur=appCurrency();if($('tripAllowanceLabel'))$('tripAllowanceLabel').textContent='Total Layover Allowance (DHM)';if($('tripCashConvertedLabel'))$('tripCashConvertedLabel').textContent=`Cash value in ${currencyOutputCode(cur)}`;
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
/* Imports */
function entrySig(f){return [f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.schedIn,f.onDuty,f.offDuty].map(x=>upper(x)).join('|')}
function dutySig(d){return [d.date,d.type,d.report,d.end,d.notes].map(x=>upper(x)).join('|')}
let importStaging=false;
function commitImport(operation){
  const previous=operationalDatabase;
  operationalDatabase={...previous,values:{...previous.values}};importStaging=true;
  try{
    const result=operation();
    importStaging=false;
    if(operationalDatabase.records!==previous.records||Object.keys(operationalDatabase.values).some(k=>operationalDatabase.values[k]!==previous.values[k]))touchOperationalDatabase();
    else operationalDatabase=previous;
    return result;
  }catch(error){operationalDatabase=previous;throw error}
  finally{importStaging=false}
}
function importCalendar(events){return commitImport(()=>applyCalendarImport(events))}
function applyCalendarImport(events){
  const activities=coreActivityRows(),seenActivities=new Set(activities.map(entrySig)),seenDuties=new Set(dutyActivityRows().map(dutySig));let sectors=0,duties=0,other=0,skipped=0;
  events.forEach(ev=>{const c=classifyCalendarSummary(upper(ev.SUMMARY)),z=zuluTimes(ev.DESCRIPTION),date=ev._start.date;if(['ignore','unknown'].includes(c.kind)){skipped++;return}
    if(c.kind==='flight'){
      const schedOut=z.out||ev._start.time||'',schedIn=z.inn||(ev._end?.time||''),sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,f=stamp({id:sourceExisting?.id||importCoreId(ev.UID?'calendar:'+ev.UID:''),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',date,flightNo:composeFlightNo(c.flightNo),dep:c.dep,arr:c.arr,type:'',reg:'',schedOut,schedIn,schedBlock:timeSpanMins(schedOut,schedIn),onDuty:z.report||shiftTime(schedOut,-60),offDuty:z.end||shiftTime(schedIn,30),out:'',off:'',on:'',in:'',block:null,credit:creditMinsForEntry({dutyType:'Flight',date,dep:c.dep,schedOut,schedIn}),rolePic:appSettings().profileRole==='Captain',role:appSettings().profileRole==='Captain'?'PIC':'SIC',instruction:false,simInstructor:false,simExaminer:false,night:null,sim:'no',ifr:'',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,remarks:'Imported from calendar',source:'calendar',calendarUid:ev.UID||''});
      const existingIndex=activities.findIndex(x=>x.id===f.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],f);skipped++;return}
      const signature=entrySig(f);if(!seenActivities.has(signature)){activities.push(f);seenActivities.add(signature);sectors++}else skipped++;return;
    }
    if(c.kind==='duty'){
      const rep=z.report||ev._start.time||'',end=z.end||(ev._end?.time||''),sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,d=stamp({id:sourceExisting?.id||importCoreId(ev.UID?'calendar:'+ev.UID:''),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:c.dutyType,date,onDuty:rep,offDuty:end,totalDuty:timeSpanMins(rep,end),remarks:ev.SUMMARY||'',source:'calendar',calendarUid:ev.UID||''}),sd=dutySig({date,type:c.dutyType,report:rep,end,notes:ev.SUMMARY||''});
      const existingIndex=activities.findIndex(x=>x.id===d.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],d);skipped++;return}
      if(!seenDuties.has(sd)){activities.push(d);seenDuties.add(sd);duties++}else skipped++;return;
    }
    if(c.kind==='entry'){
      const start=ev._start.time||'',end=ev._end?.time||'',sim=c.dutyType==='Simulator',positioning=c.dutyType==='DHD'||c.dutyType==='DHP',ground=c.dutyType==='Ground Course',sourceExisting=ev.UID?activities.find(x=>x.source==='calendar'&&x.calendarUid===ev.UID):null,f=stamp({id:sourceExisting?.id||importCoreId(ev.UID?'calendar:'+ev.UID:''),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:c.dutyType,date,flightNo:'',dep:c.dep||'',arr:c.arr||'',type:c.aircraftType||'',reg:'',schedOut:sim||positioning?start:'',schedIn:sim||positioning?end:'',schedBlock:sim||positioning?timeSpanMins(start,end):0,onDuty:sim?shiftTime(start,-60):start,offDuty:sim?shiftTime(end,30):end,totalDuty:timeSpanMins(sim?shiftTime(start,-60):start,sim?shiftTime(end,30):end),out:'',off:'',on:'',in:'',block:null,simulatorTime:sim?timeSpanMins(start,end):null,credit:null,rolePic:false,instruction:false,simInstructor:false,simExaminer:false,night:null,sim:sim?'yes':'no',ifr:'',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,courseType:ground?upper(ev.SUMMARY||''):'',remarks:`Imported from calendar: ${ev.SUMMARY||''}`,source:'calendar',calendarUid:ev.UID||''});
      const existingIndex=activities.findIndex(x=>x.id===f.id);if(existingIndex>=0){activities[existingIndex]=mergeCoreActivities(activities[existingIndex],f);skipped++;return}
      const signature=entrySig(f);if(!seenActivities.has(signature)){activities.push(initialTrainingCreditSource(f));seenActivities.add(signature);other++}else skipped++;
    }
  });commitCoreActivities(activities);reconcileAllDuties();return{sectors,duties,other,skipped}
}

/* AeroLINE native roster JSON import */
const aerolineRoster=createAerolineRoster({upper,appSettings,rosterFlightLabel,rosterFlightDigits,normalDate,timeSpanMins,shiftTime,mins,rosterActivitySameIdentity});
function aerolineRoot(payload){return aerolineRoster.aerolineRoot(payload)}
function aerolineDateTime(v){return aerolineRoster.aerolineDateTime(v)}
function aerolineMonthLabel(root){return aerolineRoster.aerolineMonthLabel(root)}
function aerolineFlightKey(r){return aerolineRoster.aerolineFlightKey(r)}
function aerolineEventKey(r,code){return aerolineRoster.aerolineEventKey(r,code)}
function aerolineTrainingKey(r){return aerolineRoster.aerolineTrainingKey(r)}
function aerolineNormalizePersonName(v){return aerolineRoster.aerolineNormalizePersonName(v)}
function aerolineSamePerson(a,b){return aerolineRoster.aerolineSamePerson(a,b)}
function aerolineConfirmCrewIdentity(root){
  const rosterName=String(root?.crewName||'').trim(),profileName=String(appSettings().profileName||'').trim();
  if(!rosterName)return true;
  if(profileName&&aerolineSamePerson(rosterName,profileName))return true;
  return confirm(`Confirm this is ${rosterName}.`);
}
function aerolinePeople(v){return aerolineRoster.aerolinePeople(v)}
function aerolineSelfName(root){return aerolineRoster.aerolineSelfName(root)}
function aerolineOtherCrew(r,root){return aerolineRoster.aerolineOtherCrew(r,root)}
function aerolineRegistration(r){return aerolineRoster.aerolineRegistration(r)}
function aerolineTrainingMeta(root){return aerolineRoster.aerolineTrainingMeta(root)}
function aerolineTrainingForFlight(root,date,flightNo){return aerolineRoster.aerolineTrainingForFlight(root,date,flightNo)}
function aerolineTrainingForActivity(root,r,start){return aerolineRoster.aerolineTrainingForActivity(root,r,start)}
function aerolineTrainingLabel(tm,r){return aerolineRoster.aerolineTrainingLabel(tm,r)}
function aerolineIsAlc(tm,r){return aerolineRoster.aerolineIsAlc(tm,r)}
function aerolineIsLineTraining(tm,r){return aerolineRoster.aerolineIsLineTraining(tm,r)}
function aerolineIsSimulatorTraining(r,tm=null){return aerolineRoster.aerolineIsSimulatorTraining(r,tm)}
function aerolineTrainingCrewFields(root,tm,sim){return aerolineRoster.aerolineTrainingCrewFields(root,tm,sim)}
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
function aerolineValidationCategory(code){return aerolineRoster.aerolineValidationCategory(code)}
function parseAerolineValidations(root){return aerolineRoster.parseAerolineValidations(root)}
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
function parseAerolineRosterObject(payload){return aerolineRoster.parseAerolineRosterObject(payload)}
function aerolineWithinRange(date,start,end){return aerolineRoster.aerolineWithinRange(date,start,end)}
function aerolineTimeDistance(a,b){return aerolineRoster.aerolineTimeDistance(a,b)}
function aerolineRosterMatch(rows,incoming){return aerolineRoster.aerolineRosterMatch(rows,incoming)}
function aerolineActivityMatch(rows,incoming){return aerolineRoster.aerolineActivityMatch(rows,incoming)}
function aerolineThanksDates(root){return aerolineRoster.aerolineThanksDates(root)}
function importAerolineRosterObject(payload){return commitImport(()=>applyRosterImport(payload))}
function rosterSourceSignature(row){
  // Computed from the incoming company record, before any manual fields are merged.
  return contentHash(row);
}
function applyChangedRosterPlan(match,candidate,signature){
  const next={...match,...candidate,id:match.id,locked:match.locked,activityStatus:match.activityStatus,rosterSourceSignature:signature};
  next.manualFields={...match.manualFields};
  next.timeOverrides={...match.timeOverrides};
  next.fieldSources={...match.fieldSources,...candidate.fieldSources};
  for(const key of Object.keys(candidate)){
    if(key==='onDuty'&&match.onDuty&&(match.dutyRootId||match.dutyControl||entryManualField(match,key))){
      next.onDuty=match.onDuty;
      continue;
    }
    if(['id','activityStatus','locked','manualFields','timeOverrides','fieldSources'].includes(key))continue;
    delete next.manualFields[key];delete next.timeOverrides[key];
    next.fieldSources[key]='aeroline';
  }
  return next;
}
function rosterTimeWindow(row){
  const allDay=['Day OFF','Annual Leave','Sick Leave'].includes(row.dutyType);
  const start=zuluDate(row.date,allDay?'00:00':row.out||row.schedOut||row.onDuty);
  const end=zuluDate(row.aerolineArrivalDate||row.date,allDay?'00:00':row.in||row.schedIn||row.offDuty);
  if(!start||!end)return null;
  return [start.getTime(),end.getTime()+(allDay||end<start?86400000:0)];
}
function allowNewRosterActivity(candidate,personal){
  const window=rosterTimeWindow(candidate);
  if(!window)return true;
  const overlaps=personal.filter(row=>{
    const other=rosterTimeWindow(row);
    return other&&window[0]<other[1]&&other[0]<window[1];
  });
  if(!overlaps.length)return true;
  const describe=row=>[row.date,row.flightNo||row.dutyType,row.dep,row.arr].filter(Boolean).join(' ');
  return confirm('Roster overlap: '+describe(candidate)+'\nManual activities: '+overlaps.map(describe).join(', ')+'\nImport the roster activity as a separate entry? Your manual activities will be kept.');
}
function rosterSectorUpdate(match,candidate){
  if((match.out&&match.off)||match.date<today())return null;
  const signature=rosterSourceSignature(candidate);
  if(match.rosterSourceSignature===signature)return null;
  const oldStart=zuluDate(match.date,match.schedOut),newStart=zuluDate(candidate.date,candidate.schedOut);
  if(match.date===today()&&oldStart&&newStart&&oldStart<=new Date()&&newStart>new Date()){
    const detail=[match.date,match.flightNo,match.dep+'–'+match.arr,match.schedOut+'–'+match.schedIn+' → '+candidate.schedOut+'–'+candidate.schedIn].join(' · ');
    if(!confirm(detail+'\nIs this an operational delay or a schedule change?\nOK: Schedule Change — Update. Cancel: Operational Delay — Keep Original.'))return null;
  }
  // Legacy imports have no original source fingerprint. Keep existing overrides in that case.
  if(match.rosterSourceSignature&&newStart>new Date()){
    return applyChangedRosterPlan(match,candidate,signature);
  }
  const merged=sourceFieldMerge(match,candidate);
  if(contentHash(match)===contentHash(merged))return null;
  return {...merged,id:match.id,activityStatus:match.activityStatus,rosterSourceSignature:signature};
}
function applyRosterImport(payload){
  const parsed=parseAerolineRosterObject(payload),{start,end}=parsed;
  if(!aerolineConfirmCrewIdentity(parsed.root))throw new Error('AeroLINE import cancelled: crew identity not confirmed.');

  const expiryImport=importAerolineValidations(parsed.root);
  let activities=coreActivityRows();
  const personal=activities.filter(row=>!row.aerolineKey&&(!row.source||row.source==='manual'));
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
    const legMatch=r.aerolineFlightLegId&&activities.find(row=>row.aerolineFlightLegId===r.aerolineFlightLegId);
    const stableId=legMatch?.id||importCoreId('aeroline:'+r.aerolineKey),candidate=normalizeCoreActivity({id:stableId,...r,dutyType:'Flight',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED},'roster');
    if(importSuppressedByDeletion('activities',candidate))return;
    const match=activities.find(x=>x.aerolineKey&&x.aerolineKey===r.aerolineKey)||activities.find(x=>x.aerolineFlightLegId&&r.aerolineFlightLegId&&String(x.aerolineFlightLegId)===String(r.aerolineFlightLegId))||activities.find(x=>x.id===stableId);
    if(match){
      const updated=rosterSectorUpdate(match,candidate);
      if(!updated)return;
      activities[activities.indexOf(match)]=stamp(updated);
      flightsUpdated++;
    }else if(allowNewRosterActivity(candidate,personal)){activities.push(stamp({...candidate,rosterSourceSignature:rosterSourceSignature(candidate),rolePic:appSettings().profileRole==='Captain',role:appSettings().profileRole==='Captain'?'PIC':'SIC'}));flightsAdded++}
  });

  parsed.activities.forEach(a=>{
    incomingKeys.add(a.aerolineKey);
    const stableId=importCoreId('aeroline:'+a.aerolineKey),candidate=normalizeCoreActivity({id:stableId,...a,activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED},'entries');
    if(importSuppressedByDeletion('activities',candidate))return;
    const match=activities.find(x=>x.aerolineKey&&x.aerolineKey===a.aerolineKey)||activities.find(x=>x.id===stableId);
    if(match){
      if(isSim(match)&&(activityIncludedInResults(match)||Number(match.sfiSfe)>0||Number(match.simulatorTime)>0&&match.manualFields?.simulatorTime))return;
      const signature=rosterSourceSignature(candidate);
      if(match.rosterSourceSignature===signature)return;
      if(match.rosterSourceSignature){
        activities[activities.indexOf(match)]=stamp(applyChangedRosterPlan(match,candidate,signature));
        activitiesUpdated++;return;
      }
      const i=activities.indexOf(match),preserveGroundCredit=canonicalDutyType(match.dutyType||'')==='Ground Course'&&match.groundCreditExplicit===true;
      const incoming=preserveGroundCredit?{...a,credit:match.credit,groundCreditExplicit:true}:a,merged=sourceFieldMerge(match,incoming);
      activities[i]=normalizeCoreActivity(stamp({...applyNewTrainingCredit(merged),id:match.id,aerolineKey:a.aerolineKey,aerolineBlockId:a.aerolineBlockId,aerolineRosterPlanned:true,locked:!!match.locked,activityStatus:match.activityStatus||ACTIVITY_STATUS.PLANNED}),'entries');
      activitiesUpdated++;
    }else if(allowNewRosterActivity(candidate,personal)){activities.push(stamp({...initialTrainingCreditSource(candidate),rosterSourceSignature:rosterSourceSignature(candidate)}));activitiesAdded++}
  });

  parsed.daysOff.forEach(d=>{
    incomingKeys.add(d.aerolineKey);
    const stableId=importCoreId('aeroline:'+d.aerolineKey),candidate=normalizeCoreActivity({id:stableId,...d,activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED},'duties');
    if(importSuppressedByDeletion('activities',candidate))return;
    let match=activities.find(x=>x.aerolineKey===d.aerolineKey)||activities.find(x=>x.id===stableId);
    if(match){
      const i=activities.indexOf(match),merged=sourceFieldMerge(match,candidate);
      activities[i]=normalizeCoreActivity(stamp({...merged,id:match.id,aerolineKey:d.aerolineKey,aerolineBlockId:d.aerolineBlockId,aerolineRosterPlanned:true,activityStatus:match.activityStatus||ACTIVITY_STATUS.PLANNED}),'duties');offUpdated++;
    }else if(allowNewRosterActivity(candidate,personal)){activities.push(stamp(candidate));offAdded++}
  });

  // SAFETY INVARIANT: a roster import may add/update exact source identities only.
  // Missing rows in a later roster file are never interpreted as a deletion request.
  staleRemoved=0;

  if(activities.length!==operationalDatabase.records.length||activities.some((row,i)=>contentHash(row)!==storedHash(operationalDatabase.records[i])))snapshotFlights('before-aeroline-import');
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
function logTenImport(text){return commitImport(()=>applyLogTenTab(text))}
function applyLogTenTab(text){
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
      isDhpTransfer=isTransferType&&/\bDHP\b/.test(transferText);
    let dutyType=isSimulator?'Simulator':isGround?'Ground Course':isStandby?'STBY':'Flight';
    if(!isSimulator&&!isGround&&!isStandby&&isTransferType&&(looksLikeTransfer||!flightNoRaw)){
      const proposed=isDhpTransfer?'DHP':'DHD';
      const evidence=[remarks,flightNoRaw,g(r,'flight_from'),g(r,'flight_to')].filter(Boolean).join(' | ');
      const ok=confirm(`LogTen ${date}${flightNoRaw?` • ${flightNoRaw}`:''} appears to be ${proposed}.\n\nSource evidence: ${evidence||'LogTen transfer type'}\n\nClassify this record as ${proposed}?\nCancel leaves it as Flight for manual review.`);
      if(ok)dutyType=proposed;
    }
    const out=g(r,'flight_actualDepartureTime'),inn=g(r,'flight_actualArrivalTime'),off=g(r,'flight_takeoffTime'),on=g(r,'flight_landingTime'),schedOut=g(r,'flight_scheduledDepartureTime'),schedIn=g(r,'flight_scheduledArrivalTime'),schedBlock=schedOut&&schedIn?timeSpanMins(schedOut,schedIn):0,block=dutyType==='Flight'&&out&&inn?timeSpanMins(out,inn):null,dual=durMins(g(r,'flight_dualGiven')),sfiSfe=durMins(g(r,'flight_sfiSfe')),picRaw=g(r,'flight_pic'),sicRaw=g(r,'flight_sic'),pic=durMins(picRaw),sic=durMins(sicRaw),ifrTime=durMins(g(r,'flight_ifr')),creditRaw=g(r,'flight_credit'),creditImported=creditRaw!=='',dayLd=Number(g(r,'flight_dayLandings')||0),nightLd=Number(g(r,'flight_nightLandings')||0),dayTo=Number(g(r,'flight_dayTakeoffs')||0),nightTo=Number(g(r,'flight_nightTakeoffs')||0),onDuty=g(r,'flight_onDutyTime'),offDuty=g(r,'flight_offDutyTime');
    const f=stamp({dutyType,date,flightNo:dutyType==='Flight'?composeFlightNo(flightNoRaw):'',dep:upper(g(r,'flight_from')),arr:upper(g(r,'flight_to')),reg:upper(g(r,'aircraft_aircraftID')),type:upper(g(r,'aircraftType_type')),schedOut,schedIn,schedBlock,onDuty,offDuty,totalDuty:onDuty&&offDuty?timeSpanMins(onDuty,offDuty):null,out:dutyType==='Flight'?out:'',off:dutyType==='Flight'?off:'',on:dutyType==='Flight'?on:'',in:dutyType==='Flight'?inn:'',block,airTime:dutyType==='Flight'&&off&&on?timeSpanMins(off,on):null,totalFlightTime:dutyType==='Flight'?durMins(g(r,'flight_totalTime')):null,simulatorTime:isSimulator?simDur:null,simulatorTimeImported:isSimulator&&g(r,'flight_simulator')!=='',credit:creditImported?durMins(creditRaw):null,creditImported,rolePic:pic>0,role:pic>0?'PIC':sic>0?'SIC':'',pic:picRaw!==''?pic:null,sic:sicRaw!==''?sic:null,instruction:dutyType==='Flight'&&dual>0,simInstructor:false,simExaminer:false,night:g(r,'flight_night')||null,ifrTime,dualGiven:dual,sfiSfe,sim:isSimulator?'yes':'no',ifr:'',dayTakeoffs:dayTo,nightTakeoffs:nightTo,dayLandings:dayLd,nightLandings:nightLd,courseType:isGround?upper(remarks):'',remarks,picName:upper(g(r,'flight_selectedCrewPIC')||''),sicName:upper(g(r,'flight_selectedCrewSIC')||''),soName:upper(g(r,'flight_selectedCrewStudent')||''),instructorName:upper(g(r,'flight_selectedCrewInstructor')||''),examinerName:'',pf:(dayTo+nightTo+dayLd+nightLd)>0?'yes':'no',approachType:upper(g(r,'flight_selectedApproach1')||''),fieldSources:{...(schedOut?{schedOut:'logten'}:{}),...(schedIn?{schedIn:'logten'}:{}),...(schedOut&&schedIn?{schedBlock:'calculated'}:{}),...(onDuty?{onDuty:'logten'}:{}),...(offDuty?{offDuty:'logten'}:{}),...(onDuty&&offDuty?{totalDuty:'calculated'}:{}),...(out?{out:'logten'}:{}),...(off?{off:'logten'}:{}),...(on?{on:'logten'}:{}),...(inn?{in:'logten'}:{}),...(dutyType==='Flight'&&out&&inn?{block:'calculated'}:{}),...(dutyType==='Flight'&&off&&on?{airTime:'calculated'}:{}),...(g(r,'flight_totalTime')?{totalFlightTime:'logten'}:{}),...(isSimulator&&g(r,'flight_simulator')?{simulatorTime:'logten'}:{}),...(creditRaw?{credit:'logten'}:{}),...(picRaw?{pic:'logten'}:{}),...(sicRaw?{sic:'logten'}:{}),...(g(r,'flight_night')?{night:'logten'}:{}),...(g(r,'flight_ifr')?{ifrTime:'logten'}:{}),...(g(r,'flight_dualGiven')?{dualGiven:'logten'}:{}),...(g(r,'flight_sfiSfe')?{sfiSfe:'logten'}:{})},source:'logten',sourceRowType:logTenType,sourceRowKey:[date,logTenType,flightNoRaw,g(r,'flight_from'),g(r,'flight_to'),g(r,'flight_scheduledDepartureTime'),g(r,'flight_scheduledArrivalTime'),onDuty,offDuty,remarks].map(x=>upper(x)).join('|')});
    if(importSuppressedByDeletion('activities',f))return;
    // SAFETY INVARIANT: TAB import may update only the exact stable sourceRowKey.
    // Similar date/route/time/type records are never merged automatically.
    let match=fs.findIndex(x=>x.source==='logten'&&x.sourceRowKey&&x.sourceRowKey===f.sourceRowKey);
    if(match>=0){
      f.id=fs[match].id;
      fs[match]=mergeDuplicateEntries(fs[match],f);
      updated++;
    }else{
      f.id=importCoreId(syncSourceKey(f));
      fs.push(f);
      imported++;
    }
    if(isSimulator)sims++;
    if(!['Flight','Simulator'].includes(dutyType))other++;
  });

  replaceActivitySelection(isEntryActivityRecord,fs);
  reconcileAllDuties();
  return{imported,updated,sims,other,duplicatesRemoved:0}
}


// Read-only SQLite/Core Data import. WAL checksums and commit boundaries follow
// https://sqlite.org/fileformat.html; SHM is retained as the original WAL index.
function logTenSqliteSnapshot(database,wal,shm){return logtenSqlite.logTenSqliteSnapshot(database,wal,shm)}
function readLogTenSqlite(bytes){return logtenSqlite.readLogTenSqlite(bytes)}
function logTenSqliteEntries(db){return logtenSqlite.logTenSqliteEntries(db)}
async function parseLogTenCompleteFiles(files){
  const list=Array.from(files||[]);
  if(list.length===1&&/\.pilotlog-logten$/i.test(list[0].name))return parseLogTenMigrationPackage(await list[0].arrayBuffer());
  const main=list.filter(f=>/\.sql$/i.test(f.name));
  if(main.length!==1)throw new Error('Select LogTenCoreDataStore.sql together with its .sql-wal and .sql-shm files.');
  const file=main[0],wal=list.find(f=>f.name===file.name+'-wal'),shm=list.find(f=>f.name===file.name+'-shm');
  if(!wal||!shm||list.length!==3)throw new Error('Select all three LogTen files with the same basename: .sql, .sql-wal and .sql-shm.');
  const [originalDatabase,originalWal,originalShm]=await Promise.all([file,wal,shm].map(f=>f.arrayBuffer()));
  const snapshot=logTenSqliteSnapshot(originalDatabase,originalWal,originalShm),db=readLogTenSqlite(snapshot.database),entries=logTenSqliteEntries(db),dates=entries.map(r=>r.date).sort();
  return{database:snapshot.database,originalFiles:{database:originalDatabase,wal:originalWal,shm:originalShm},payload:{entries,manifest:{sourceName:file.name,flightRows:entries.length,sqliteTables:db.tableCount,dateFrom:dates[0],dateTo:dates.at(-1),walFrames:snapshot.walFrames}}};
}

/* Complete LogTen SQLite migration archive */
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
async function storeLogTenArchive(databaseBytes,manifest={},sourceFileName='LogTenCoreDataStore.sql',originalFiles=null){
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
    database:new Blob([databaseBytes],{type:'application/x-sqlite3'}),
    ...(originalFiles?{originalFiles:Object.fromEntries(Object.entries(originalFiles).map(([k,v])=>[k,new Blob([v])]))}:{})
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
function parseLogTenMigrationPackage(buffer){return logtenSqlite.parseLogTenMigrationPackage(buffer)}
const logtenMigration=createLogTenMigration({upper,canonicalDutyType,isFlight,isSim,scheduleBlockMins,importCoreId,numericTime,entryBlockMins,entryManualField,entryFieldSource,initialTrainingCreditSource,LOGTEN_TIME_COLUMNS});
function logTenLegacyRowKey(e){return logtenMigration.logTenLegacyRowKey(e)}
function logTenMigrationEntry(raw){return logtenMigration.logTenMigrationEntry(raw)}
function logTenMigrationFallbackMatch(existing,incoming){return logtenMigration.logTenMigrationFallbackMatch(existing,incoming)}
function mergeLogTenMigration(existing,incoming){return logtenMigration.mergeLogTenMigration(existing,incoming)}
function reconcileLogTenEntries(existingRows,rawEntries){return logtenMigration.reconcileLogTenEntries(existingRows,rawEntries)}
function mergeLogTenSupplementalRows(key,kind,rawRows){
  if(!Array.isArray(rawRows)||!rawRows.length)return{imported:0,updated:0,total:0};
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
  const parsed=await parseLogTenCompleteFiles(file?.arrayBuffer?[file]:file),manifest=parsed.payload.manifest||{},rawEntries=parsed.payload.entries;
  setImportProgress(5,`Package read • ${rawEntries.length.toLocaleString('en-US')} logbook rows found`);await yieldToUi();
  if(manifest.creditHoursOnlyPatch===true){
    throw new Error('Credit-Hours-only LogTen patches are not used in v8.6. Flight Credit H is calculated automatically from Scheduled Block Hours.');
  }
  setImportProgress(6,'Archiving original LogTen database…');
  await storeLogTenArchive(parsed.database,manifest,manifest.sourceName||'LogTenCoreDataStore.sql',parsed.originalFiles);
  snapshotFlights('before-logten-complete-import');
  setImportProgress(82,'Preparing import…');await yieldToUi();
  const {rows:fs,imported,updated,protectedMerged,conflicts,removedIds,expiryImport}=commitImport(()=>{
    const result=reconcileLogTenEntries(coreActivityRows(),rawEntries);
    replaceActivitySelection(isEntryActivityRecord,result.rows);
    const ids=new Set(coreActivityRows().map(r=>r.logtenUniqueId));
    if(rawEntries.some(r=>r.logtenUniqueId&&!ids.has(r.logtenUniqueId)))throw Error('Incomplete LogTen import');
    return {...result,expiryImport:mergeLogTenSupplementalRows(EXPIRY_KEY,'expiry',parsed.payload.expiry)};
  });
  const tripImport={imported:0,updated:0,total:0};
  await flushFlightStore();
  setImportProgress(94,'Verifying imported LogTen identities…');await yieldToUi();
  const persisted=entryActivityRows(),wanted=new Set(rawEntries.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean)),present=new Set(persisted.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean));
  const missing=[...wanted].filter(x=>!present.has(x));if(missing.length)throw new Error(`Local LogTen verification failed: ${missing.length} source rows are missing after import. Nothing has been sent to cloud.`);
  // Complete migration packages already carry stable LogTen identities. Avoid an O(n²)
  // semantic duplicate pass immediately after a 7k+ row import; it can stall mobile browsers.
  localStorage.setItem('pilotlog7_dedupe_semantic_v1','1');
  refreshEntrySuggestions();renderExpiry();renderTrips();setImportProgress(98,'Import verified • rebuilding PilotLog views…');await yieldToUi();
  return{imported,updated,protectedMerged,conflicts,conflictDetails:fs.flatMap(f=>(f.logtenImportConflicts||[]).map(c=>`${f.date} ${f.flightNo||f.dutyType} — ${c.field}: ${c.manual??"NULL"} (LogTen: ${c.logten??"NULL"})`)),total:rawEntries.length,manifest,archiveStored:true,expiryImport,tripImport,verified:wanted.size,localTotal:persisted.length};
}
/* Export */



const easaExport=createEasaExport({$,coreActivityRows,isFlight,isSim,activityIncludedInResults,simulatorCompleted,entryHasTimeValue,numericTime,timeGroupFinalValue,upper,fmt,sum,durMins,totalFlightMins,picMins,sicMins,flightInstrMins,today,host:globalThis});
const EASA_ROWS_PER_PAGE=easaExport.EASA_ROWS_PER_PAGE;
function euDate(v){return easaExport.euDate(v)}
function blankIfZero(v){return easaExport.blankIfZero(v)}
function blankCount(v){return easaExport.blankCount(v)}
function experienceFlights(){return easaExport.experienceFlights()}
function experienceSims(){return easaExport.experienceSims()}
function experienceRows(){return easaExport.experienceRows()}
function easaSimulatorMinutes(f){return easaExport.easaSimulatorMinutes(f)}
function slotSinglePilot(f,minutes,multiEngine){return easaExport.slotSinglePilot(f,minutes,multiEngine)}
function expTotals(list){return easaExport.expTotals(list)}
function plusTotals(a,b){return easaExport.plusTotals(a,b)}
function selectedExperiencePageRange(){return easaExport.selectedExperiencePageRange()}
function pdfEsc(v){return easaExport.pdfEsc(v)}
function pdfText(x,y,size,text,align='left',width=0,bold=false){return easaExport.pdfText(x,y,size,text,align,width,bold)}
function pdfLine(x1,y1,x2,y2,w=.35){return easaExport.pdfLine(x1,y1,x2,y2,w)}
function pdfRect(x,y,w,h,line=.35){return easaExport.pdfRect(x,y,w,h,line)}
function easaCell(c,x1,x2,y,text,size=8,align='center',bold=false){return easaExport.easaCell(c,x1,x2,y,text,size,align,bold)}
function easaRemarksCell(c,x1,x2,centerY,remarks){return easaExport.easaRemarksCell(c,x1,x2,centerY,remarks)}
function buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo,side){return easaExport.buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo,side)}
function makePdfDocument(pageStreams){return easaExport.makePdfDocument(pageStreams)}
function exportEasaStylePdf(){return easaExport.exportEasaStylePdf()}
function exportExperiencePdf(){
  const entries=[...experienceFlights(),...experienceSims()];
  if(!entries.length)return alert('No professional experience to export');
  const profile=appSettings(),pages=[];
  let stream='',y=0;
  function page(){
    if(stream)pages.push(stream);
    stream=pdfText(40,542,22,profile.profileName||'Professional experience','left',0,true);
    stream+=pdfText(40,516,13,[profile.profileRole,'Flight experience'].filter(Boolean).join('  |  '));
    y=466;
  }
  function heading(label){
    if(y<128)page();
    stream+=pdfText(40,y,14,label,'left',0,true);y-=27;
  }
  const columns=['Total flight','IFR','SP','MP','PIC','SIC','PICUS'];
  function header(){
    columns.forEach((label,i)=>stream+=pdfText(212+i*84,y,10,label,'left',0,true));y-=22;
  }
  function row(label,records){
    if(y<50){page();heading('Aircraft experience');header()}
    const t=expTotals(records);
    stream+=pdfText(40,y,11,label);
    [t.total,t.ifr,t.se+t.me,t.multi,t.pic,t.sic,t.picUS].forEach((n,i)=>stream+=pdfText(212+i*84,y,11,fmt(n)));
    y-=24;
  }
  page();heading('General');header();row('All aircraft',entries);
  y-=12;heading('Aircraft experience');header();
  const groups=new Map();
  for(const entry of entries.filter(isFlight)){
    const label=aircraftIcaoType(entry)||'Unspecified';
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(entry);
  }
  for(const [label,records] of [...groups].sort(([a],[b])=>a.localeCompare(b)))row(label,records);
  y-=12;heading('Training experience');
  const flight=sum(entries.filter(isFlight),flightInstrMins),sim=sum(entries.filter(isSim),simInstrMins);
  for(const [label,n] of [['Total',flight+sim],['In flight',flight],['In simulator',sim]]){
    stream+=pdfText(40,y,11,label)+pdfText(212,y,11,fmt(n));y-=22;
  }
  pages.push(stream);
  download('PilotLog_Experience_'+today()+'.pdf',makePdfDocument(pages),'application/pdf');
}
function exportFullBackupJson(){
  const payload={schema:'PilotLog Backup',version:VERSION,architecture:'single-authoritative-database',exportedAt:new Date().toISOString(),database:normalizeOperationalDatabase(operationalDatabase)};
  delete payload.database.replica162;delete payload.database.preSync162;
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
  reconcileOperationalFlightIdentities();await flushFlightStore();reconcileAllDuties();markLocalOnlyImport(`Full backup restored locally — ${counts.activities} unique activities`);await render();await renderRoster();renderDuty();renderTrips();renderPayroll();renderSettings();resetEntry(false);
  alert(`Full Backup restored locally.\n\n${counts.activities} unique activities • ${counts.roster} roster • ${counts.trips} trips • ${counts.expiry} expiry records.\n\nAuto Sync is OFF. Review this device before pressing Sync now.`);return true;
}


let screenshotReviewRows=[];
let screenshotObjectUrl='';
let screenshotOcrLayout=null;
let screenshotSmartCells=[];

const screenshotGrid=createScreenshotGrid({upper,canonicalDutyType,coreActivityRows,normalDate,rosterFlightDigits});
function normalizeScreenshotDate(v){return screenshotGrid.normalizeScreenshotDate(v)}
function normalizeOcrTime(v){return screenshotGrid.normalizeOcrTime(v)}
function classifyScreenshotDuty(text){return screenshotGrid.classifyScreenshotDuty(text)}
function screenshotFlightNumbers(text){return screenshotGrid.screenshotFlightNumbers(text)}
function screenshotRoutes(text){return screenshotGrid.screenshotRoutes(text)}
function screenshotTimes(text){return screenshotGrid.screenshotTimes(text)}
function screenshotAirports(text){return screenshotGrid.screenshotAirports(text)}
function ocrDateMatches(line){return screenshotGrid.ocrDateMatches(line)}
function screenshotMissingFields(r){return screenshotGrid.screenshotMissingFields(r)}
function screenshotRowReady(r){return screenshotGrid.screenshotRowReady(r)}
function makeScreenshotRow(o={}){return screenshotGrid.makeScreenshotRow(o)}
function screenshotReviewSummaryData(){return screenshotGrid.screenshotReviewSummaryData()}

const OCR_MONTHS={
  JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,
  JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,
  OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12
};
const OCR_DAY_NAMES=new Set(['MON','MONDAY','TUE','TUES','TUESDAY','WED','WEDNESDAY','THU','THUR','THURS','THURSDAY','FRI','FRIDAY','SAT','SATURDAY','SUN','SUNDAY']);

function screenshotBlockWords(blocks){return screenshotGrid.screenshotBlockWords(blocks)}
function screenshotWordLines(words){return screenshotGrid.screenshotWordLines(words)}
function crewScheduleYear(text){return screenshotGrid.crewScheduleYear(text)}
function crewScheduleDefaultMonth(text){return screenshotGrid.crewScheduleDefaultMonth(text)}
function cleanOcrToken(v){return screenshotGrid.cleanOcrToken(v)}
function crewScheduleDateHeaders(words,text){return screenshotGrid.crewScheduleDateHeaders(words,text)}
function clusterCrewHeaderRows(headers){return screenshotGrid.clusterCrewHeaderRows(headers)}
function crewScheduleFooterY(words,lastHeaderY){return screenshotGrid.crewScheduleFooterY(words,lastHeaderY)}
function crewScheduleCellWords(words,row,rowIndex,rows,headerIndex,footerY=null){return screenshotGrid.crewScheduleCellWords(words,row,rowIndex,rows,headerIndex,footerY)}
function gridLineFlightNos(line){return screenshotGrid.gridLineFlightNos(line)}
function inferScreenshotRoute(flightNo){return screenshotGrid.inferScreenshotRoute(flightNo)}
function gridCellRows(date,cellWords){return screenshotGrid.gridCellRows(date,cellWords)}
function parseCrewScheduleGrid(layout,text){return screenshotGrid.parseCrewScheduleGrid(layout,text)}


function crewScheduleUnparsedRows(layout,text){return screenshotGrid.crewScheduleUnparsedRows(layout,text)}

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


function crewScheduleCellRects(layout,text,width,height){return screenshotGrid.crewScheduleCellRects(layout,text,width,height)}
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
function smartCellUsefulText(text){return screenshotGrid.smartCellUsefulText(text)}
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
function gridCellTextRows(date,text){return screenshotGrid.gridCellTextRows(date,text)}
function parseSmartCrewScheduleCells(cells){return screenshotGrid.parseSmartCrewScheduleCells(cells)}

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
      activities.push(stamp({id:makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:type,date,onDuty:r.start||'',offDuty:r.end||'',totalDuty:r.start&&r.end?timeSpanMins(r.start,r.end):0,remarks:r.remarks||'Imported from screenshot',source:'screenshot'}));
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
      schedOut:['Flight','Simulator','DHD','DHP'].includes(dutyType)?r.start||'':'',
      schedIn:['Flight','Simulator','DHD','DHP'].includes(dutyType)?r.end||'':'',
      schedBlock:['Flight','Simulator','DHD','DHP'].includes(dutyType)&&r.start&&r.end?timeSpanMins(r.start,r.end):0,
      onDuty:['Flight','Simulator','Ground Course','STBY','DHD','DHP'].includes(dutyType)&&r.start?(dutyType==='Flight'||dutyType==='Simulator'?shiftTime(r.start,-60):r.start):'',
      offDuty:['Flight','Simulator','Ground Course','STBY','DHD','DHP'].includes(dutyType)&&r.end?(dutyType==='Flight'||dutyType==='Simulator'?shiftTime(r.end,30):r.end):'',
      out:'',off:'',on:'',in:'',block:null,simulatorTime:dutyType==='Simulator'&&r.start&&r.end?timeSpanMins(r.start,r.end):null,
      credit:null,
      rolePic:false,instruction:false,simInstructor:false,simExaminer:false,night:null,sim:dutyType==='Simulator'?'yes':'no',ifr:'',
      dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,
      courseType:dutyType==='Ground Course'?upper(r.remarks||''):'',
      remarks:r.remarks||'Imported from screenshot',locked:false
    });
    if(!['Simulator','Ground Course'].includes(dutyType))obj.credit=creditMinsForEntry(obj);
    activities.push(initialTrainingCreditSource(obj));entryCount++;
  }

  commitCoreActivities(activities);
  reconcileAllDuties();
  
  await render();
  renderTrips();
  $('screenshotImportStatus').textContent=`Imported ${entryCount} entries, ${rosterCount} roster sectors, ${dutyCount} duties. ${duplicates} duplicates skipped.`;
  alert(`Screenshot import complete: ${entryCount} entries • ${rosterCount} roster • ${dutyCount} duties • ${duplicates} duplicates skipped`);
}

function download(name,text,type='text/plain'){if(window.PilotLogNative?.isNative){window.PilotLogNative.exportFile(name,text,type).catch(e=>alert('Export not completed: '+(e.message||e)));return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function logTenExport(){
  const fs=coreActivityRows().filter(isCompletedLogbookEntry);if(!fs.length)return alert('No entries to export');
  const h=['flight_flightDate','flight_type','flight_flightNumber','flight_from','flight_to','flight_scheduledDepartureTime','flight_actualDepartureTime','flight_takeoffTime','flight_landingTime','flight_scheduledArrivalTime','flight_actualArrivalTime','flight_totalTime','flight_pic','flight_sic','flight_dualGiven','flight_simulator','flight_sfiSfe','flight_ground','flight_ifr','flight_night','flight_dayTakeoffs','flight_nightTakeoffs','flight_dayLandings','flight_nightLandings','flight_onDutyTime','flight_offDutyTime','flight_remarks','aircraft_aircraftID','aircraftType_type','flight_selectedApproach1'];
  const value=(f,key)=>{const n=timeGroupFinalValue(f,key,fs);return n>0?fmt(n):''};
  const rows=fs.map(f=>[f.date,'',f.flightNo||'',f.dep||'',f.arr||'',f.schedOut||'',f.out||'',f.off||'',f.on||'',f.schedIn||'',f.in||'',value(f,'totalFlightTime'),value(f,'pic'),value(f,'sic'),value(f,'dualGiven'),value(f,'simulatorTime'),value(f,'sfiSfe'),value(f,'groundInstruction'),value(f,'ifrTime'),value(f,'night'),f.dayTakeoffs||0,f.nightTakeoffs||0,f.dayLandings||0,f.nightLandings||0,f.onDuty||'',f.offDuty||'',f.remarks||'',f.reg||'',f.type||'',f.approachType||f.approaches?.[0]?.type||'']);
  download(`PilotLog_LogTen_${today()}.txt`,[h.join('\t'),...rows.map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t'))].join('\n'),'text/tab-separated-values');
}

/* Payroll */
function monthNow(){return new Date().toISOString().slice(0,7)}
function inMonth(date,month){return String(date||'').slice(0,7)===month}
function money(v){return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}
function instructionSectorForPayroll(f){return isFlight(f)&&f.instruction===true&&(!f._payrollRosterSynthetic||f._trainingAuthoritative===true)}
function showFixedSalary(st){
  const month=$('payrollMonth')?.value||monthNow();
  const amount=fixedSalaryAmount(st,Number(st.base||0)*seniorityPct(st,month)/100);
  $('fixedSalarySum').textContent=amount.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})+' DHM';
}
function monthExtras(month){const all=loadObject(PAY_MONTH_KEY,{});return {dayOffCount:0,arrears:0,dayOffRemarks:{},...(all[month]||{})}}
function saveMonthExtras(month,x){if(contentHash(x)===contentHash(monthExtras(month)))return;const all=loadObject(PAY_MONTH_KEY,{});all[month]=x;all._updatedAt=new Date().toISOString();saveObject(PAY_MONTH_KEY,all)}
function payrollSnapshotProjection(p){
  const keys=['fixed','creditMins','nonFlightCreditCount','nonFlightCreditMins','flightPay','training','trainingPay','layMins','layoverPay','sims','simPay','dayOffCount','dayOffPay','arrears','total','netPayroll','contractTarget','grossPayroll','taxableGross','cimrBase'];
  const result=Object.fromEntries(keys.map(key=>[key,p[key]]));
  result.st={...p.st};
  result.extras={dayOffRemarks:{...(p.extras.dayOffRemarks||{})}};
  result.dayOffEvents=p.dayOffEvents.map(ev=>({date:ev.date,entries:ev.entries.map(f=>({dutyType:f.dutyType,dep:f.dep,arr:f.arr,flightNo:f.flightNo}))}));
  if(p.tax)result.tax={...p.tax};
  return result;
}

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
  if(ex.validated)return;
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

const payrollRules={creditMinsForEntry,instructionSectorForPayroll,isSim,userIsSimTrainer,isFlight};
function calculatePayrollProjection(month){
  const st=paySettings(),
    rosterPrimary=rosterMonthAvailable(month),
    fs=operationalEntriesForMonth(month),
    trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month),
    tripResults=calculateSavedTripProjections(trips,operationalEntriesForTrips()),
    extras=monthExtras(month),
    dayOffEvents=dayOffEventsForMonth(month,fs);
  return projectPayroll({st,rosterPrimary,fs,tripResults,extras,dayOffEvents,month},payrollRules);
}

function calculateMacPayrollProjection(p){return macPayrollProjection(p,macDependents())}

function fxStore(){return loadObject(FX_KEY,{})}
function payrollConversionCurrency(){const cur=upper(appSettings().currency2||'');return cur!=='MAD'&&ISO_CURRENCIES.includes(cur)?cur:''}
function monthlyRateKey(month,from,to){return 'monthly:'+month+':'+from+':'+to}
function monthRate(month,from,to,allowPrevious=false){
  if(from===to)return {rate:1,date:month+'-01',locked:true,from,to};
  const rates=fxStore(),key=monthlyRateKey(month,from,to);
  if(rates[key]?.locked)return rates[key];
  if(from==='MAD'){
    const legacy=rates['payroll:'+month+':MAD:'+to];
    if(legacy?.locked)return legacy;
  }
  if(!allowPrevious)return null;
  const prior=Object.values(rates).filter(r=>r?.locked&&r.from===from&&r.to===to&&r.rate>0&&r.date<month+'-01').sort((a,b)=>b.date.localeCompare(a.date))[0];
  return prior?{...prior,locked:false,provisional:true}:null;
}
const monthlyRateRequests=new WeakMap();
function requestMonthlyRate(month,from,to){
  const local=monthRate(month,from,to);
  if(local||navigator.onLine===false)return Promise.resolve(local);
  const db=operationalDatabase,owner=cloudStoredSession()?.user?.id;
  if(!owner||!db?.replica162||db.replica162.user!==owner)return Promise.resolve(null);
  if(Date.now()<Date.parse(month+'-01T00:01:00Z'))return Promise.resolve(null);
  const key=monthlyRateKey(month,from,to),wireKey=JSON.stringify([FX_KEY,key]);
  let requests=monthlyRateRequests.get(db);
  if(!requests){requests=new Map();monthlyRateRequests.set(db,requests)}
  if(requests.has(key))return requests.get(key);
  const replica=db.replica162,generation=replica.generation;
  const check=()=>{if(operationalDatabase!==db||db.replica162!==replica||replica.generation!==generation||cloudStoredSession()?.user?.id!==owner)throw Error('Account or archive changed')};
  const task=(async()=>{
    const session=await cloudSession();check();if(!session||session.user.id!==owner)return null;
    const query=new URLSearchParams({select:'data',user_id:'eq.'+owner,'data->>kind':'eq.delta162','data->>key':'eq.'+wireKey,limit:'1'});
    let confirmedRevision=0;
    const read=async()=>{
      const rows=await cloudFetch('/rest/v1/'+SUPABASE_TABLE+'?'+query,{token:session.access_token,retries:0});check();
      if(!Array.isArray(rows))throw Error('Invalid monthly quote response');
      if(!rows.length)return null;
      const d=rows[0].data,r=d?.value;
      if(d?.key!==wireKey||!r?.locked||r.from!==from||r.to!==to||!(r.rate>0)||!Number.isFinite(r.rate)||d.hash!==contentHash(r))throw Error('Invalid monthly quote');
      if(!Number.isSafeInteger(d.rev)||d.rev<1)throw Error('Invalid monthly quote revision');
      confirmedRevision=d.rev;return r;
    };
    let rate=await read();check();
    if(!rate){
      let date=month+'-01',quote;
      // Published rates have daily precision. Walk back only when a dated table is unavailable.
      for(let day=0;day<8;day++){
        try{quote=await fxForDate(from,to,date);break}
        catch(error){check();if(!/404|historical FX date unavailable/i.test(error.message)||day===7)throw error}
        date=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      }
      check();
      const candidate={...quote,from,to,locked:true,provisional:false};
      const change={key:wireKey,base:0,value:candidate,hash:contentHash(candidate)};
      try{
        const reply=await sendReplicaDelta(session,generation,replica.cursor||0,[change]);check();
        const ack=reply?.acks?.[0];
        if(ack?.key!==wireKey||ack.hash!==change.hash||!(ack.rev>=1))throw Error('Missing monthly quote confirmation');
        confirmedRevision=ack.rev;rate=candidate;
      }catch(error){
        check();
        rate=await read();
        if(!rate)throw error;
      }
    }
    check();
    if(replica.sent?.[wireKey]||replica.conflicts?.[wireKey])throw Error('Monthly rate under review');
    if((replica.known?.[wireKey]?.rev||0)>confirmedRevision)throw Error('Monthly rate revision changed');
    replica.known[wireKey]={hash:contentHash(rate),rev:confirmedRevision};
    saveObject(FX_KEY,{...fxStore(),[key]:rate});
    return rate;
  })().finally(()=>requests.delete(key));
  requests.set(key,task);return task;
}
function sendReplicaDelta(session,generation,cursor,changes){
  return cloudFetch('/rest/v1/rpc/pilotlog_delta162',{method:'POST',token:session.access_token,retries:0,
    body:{pointer_id:cloudActiveMetaId(session.user.id),generation_id:generation,after_seq:cursor,changes}});
}
async function recoverPendingFx(){
  const month=monthNow(),currency=payrollConversionCurrency();
  const jobs=QUICK_CASH_CURRENCIES.filter(from=>from!==appCurrency()).map(from=>requestMonthlyRate(month,from,appCurrency()));
  if(currency)jobs.push(requestMonthlyRate(month,'MAD',currency));
  if(appCurrency()!=='MAD')jobs.push(requestMonthlyRate(month,'MAD',appCurrency()));
  jobs.push(refreshPendingTripFx());
  await Promise.allSettled(jobs);
}
const PAY_MAP={setSeniority5:'seniority5',setSeniority25:'seniority25',setGroundCredit:'groundCredit',setSimCredit:'simCredit',setDeductionMemo:'deductionMemo',setJoinDate:'joinDate',setBase:'base',setAllowance:'allowance',setTransport:'transport',setPos:'pos',setTelephone:'telephone',setUniform:'uniform',setMeal:'meal',setDeduction:'deduction',setSeniority2:'seniority2',setSeniority12:'seniority12',setT1Max:'t1Max',setT1Rate:'t1Rate',setT2Max:'t2Max',setT2Rate:'t2Rate',setT3Max:'t3Max',setT3Rate:'t3Rate',setT4Rate:'t4Rate',setTrainingRate:'trainingRate',setLayoverRate:'layoverRate',setSimAllowance:'simAllowance',setDayOffRate:'dayOffRate'};
function fillPaySettings(){const st=paySettings();Object.entries(PAY_MAP).forEach(([id,k])=>{if($(id))$(id).value=st[k]??''});$('tier4Above').textContent=$('setT3Max').value;showFixedSalary(st)}
function readPaySettings(){const st={};Object.entries(PAY_MAP).forEach(([id,k])=>st[k]=k==='joinDate'?$(id).value:$(id).value===''&&PAY_DEFAULTS[k]===null?null:Number($(id).value||0));return st}
function renderTripCashPayment(month){
  const container=$('payTripCash');if(!container)return;
  const frozen=monthExtras(month).validated;
  if(frozen){container.innerHTML=frozen.tripCashHtml||'';const heading=container.querySelector('h3');if(heading)heading.textContent='Trip cash';container.classList.toggle('hidden',!container.querySelector('.stat-row'));return}
  const target=appCurrency(),trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month&&Number(t.cashAmount)>0);
  container.classList.toggle('hidden',!trips.length);container.innerHTML=(!trips.length?'':'<h3>Trip cash</h3>'+trips.map(t=>{
    const fx=tripFxCache(t,target,upper(t.cashCurrency||''),tripStartDateFromValue(t.start));
    const conversion=fx?`${moneyCurrency(Number(t.cashAmount)*fx.rate,target)} · ${fx.provisional?'Provisional FX':'FX'} ${esc(displayDate(fx.date))}`:'FX pending';
    return `<div class="stat-row"><span>${esc(displayDate(tripStartDateFromValue(t.start)))} · ${esc(t.stations||'Trip')}<br><span class="small">${conversion}</span></span><b>${moneyCurrency(t.cashAmount,t.cashCurrency)}</b></div>`;
  }).join(''));
}
let payrollRenderToken=0;
async function renderPayroll(){
  const token=++payrollRenderToken,month=$('payrollMonth').value||monthNow(),ex=monthExtras(month),frozen=ex.validated||null,displayCur='MAD',cur=payrollConversionCurrency();$('payrollMonth').value=month;displayMonthPicker($('payrollMonth'));updateCurrencyUI();
  $('validatePayroll').classList.toggle('hidden',!!frozen);$('unlockPayroll').classList.toggle('hidden',!frozen);
  $('payrollValidationStatus').textContent=frozen?`Checked ${displayDate(String(frozen.validatedAt).slice(0,10))}`:'';
  renderTripCashPayment(month);
  const regime=frozen?.regime||payrollRegime(),baseProjection=frozen?null:PilotLogEngine.payroll(month),p=frozen?.projection||(regime==='MAC'?calculateMacPayrollProjection(baseProjection):baseProjection);
  if($('payrollRegimeBadge'))$('payrollRegimeBadge').textContent=regime;
  $('payMacSummaryWrap')?.classList.toggle('hidden',regime!=='MAC');
  const sourceTotal=regime==='MAC'?p.netPayroll:p.total;
  $('payTotalSource').textContent=moneyCurrency(sourceTotal,'MAD');$('payTotalMain').textContent='';
  const unit='DHM',displayValue=v=>Number(v)||0;
  // NF credit is included in flightPay. Show the marginal value at the month's own tier rates.
  const nfHours=p.nonFlightCreditMins;
  const nfQuantity=nfHours==null||p.nonFlightCreditCount==null?'—':p.nonFlightCreditCount+' '+(p.nonFlightCreditCount===1?'duty':'duties')+' · '+fmt(nfHours);
  const nfValue=nfHours==null||!p.st||p.flightPay==null||p.creditMins==null?'—':money(p.flightPay-tierPay((p.creditMins-nfHours)/60,p.st))+' DHM';
  if(regime==='MAC'){
    const t=p.tax;
    $('payMacSummary').innerHTML=[
      ['Contract / protected net target',p.contractTarget],['Estimated gross payroll',p.grossPayroll],['Taxable gross',p.taxableGross],['CIMR base',p.cimrBase],['CNSS',-t.cnss],['AMO',-t.amo],['CIMR',-t.cimr],['Ass. Maladie',-t.health],['Professional expense deduction',-t.professionalExpense],['Net imposable',t.netTaxable],['IR',-t.ir],['MAC net payroll',p.netPayroll]
    ].map(([n,v])=>`<div class="mac-summary-row"><span>${esc(n)}</span><b>${money(displayValue(v))} ${unit}</b></div>`).join('');
    $('payBreakdown').innerHTML=[
      ['Fix Salary','',p.fixed],['Credit H',fmt(p.creditMins),p.flightPay],['NF CH',nfQuantity,nfValue,'credit-info'],['Training sectors',String(p.training),p.trainingPay],['Layover (non-taxable)',fmt(p.layMins),p.layoverPay],['Simulator allowance',String(p.sims),p.simPay],['Call from Day OFF',String(p.dayOffCount),p.dayOffPay],['Adjustments','',p.arrears,'arrears']
    ].map(([n,q,v,kind],i)=>`<div class="pay-breakdown-row ${i%2?'pay-breakdown-alt':''}"><span class="pay-breakdown-label">${esc(n)}</span><span class="pay-breakdown-qty">${esc(q)}</span><b class="money pay-breakdown-amount">${kind==='arrears'&&!frozen?`<label class="pay-adjustment"><span aria-hidden="true">✎</span><input id="payArrears" aria-label="Adjustments in DHM" type="number" step="0.01" value="${Number(v)||0}"> DHM</label>`:kind==='credit-info'?'<small class="pay-reference">('+esc(v)+')</small>':money(displayValue(v))+' '+unit}</b></div>`).join('');
  }else{
    if($('payMacSummary'))$('payMacSummary').innerHTML='';
    $('payBreakdown').innerHTML=[
      ['Fix Salary','',p.fixed],['Credit H',fmt(p.creditMins),p.flightPay],['NF CH',nfQuantity,nfValue,'credit-info'],['Training sectors',String(p.training),p.trainingPay],['Layover',fmt(p.layMins),p.layoverPay],['Simulator allowance',String(p.sims),p.simPay],['Call from Day OFF',String(p.dayOffCount),p.dayOffPay],['Adjustments','',p.arrears,'arrears']
    ].map(([n,q,v,kind],i)=>`<div class="pay-breakdown-row ${i%2?'pay-breakdown-alt':''}"><span class="pay-breakdown-label">${esc(n)}</span><span class="pay-breakdown-qty">${esc(q)}</span><b class="money pay-breakdown-amount">${kind==='arrears'&&!frozen?`<label class="pay-adjustment"><span aria-hidden="true">✎</span><input id="payArrears" aria-label="Adjustments in DHM" type="number" step="0.01" value="${Number(v)||0}"> DHM</label>`:kind==='credit-info'?'<small class="pay-reference">('+esc(v)+')</small>':money(displayValue(v))+' '+unit}</b></div>`).join('');
  }
  const remarks=p.extras.dayOffRemarks||{};$('payDayOffDetails').innerHTML=p.dayOffEvents.length?p.dayOffEvents.map(ev=>{const remark=remarks[ev.date]||'';return `<div class="pay-dayoff-row"><div class="pay-dayoff-main"><b>${esc(displayDate(ev.date))}</b><div class="small">${esc(dayOffEventLabel(ev))}</div><div class="small">${moneyCurrency(displayValue(p.st.dayOffRate||0),displayCur)} premium</div></div><div class="pay-dayoff-remark-wrap"><label>Remark</label><input class="pay-dayoff-remark" data-dayoff-date="${esc(ev.date)}" value="${esc(remark)}" placeholder="e.g. Not paid / email sent"></div></div>`}).join(''):'<div class="empty">No Day OFF calls in this payroll month.</div>';
  $('payDayOffDetails').querySelectorAll('.pay-dayoff-remark').forEach(input=>input.disabled=!!frozen);
  $('payDayOffDetails').classList.toggle('hidden',!p.dayOffEvents.length);
  let fx=null;
  if(cur){
    try{
      fx=frozen?.conversionCurrency===cur&&frozen.fx?.rate?frozen.fx:monthRate(month,'MAD',cur,true)||fxStore()['payroll:'+month+':MAD:'+cur];
    }catch{fx=null}
    if(token!==payrollRenderToken)return;
    $('payTotalMain').textContent=fx?.rate?moneyCurrency(sourceTotal*fx.rate,cur):'';
  }
  return{projection:p,fx,regime,currency:displayCur,conversionCurrency:cur,tripCashHtml:$('payTripCash').innerHTML};
}

/* Expiry / validity tracking */
const EXPIRY_CATEGORIES=['license','medical','instructor','course','aircraft','english'];
let expiryPendingPhotoData='';

const {expiryStatus,expiryCategoryLabel,expiryTitle,expirySubtitle}=createExpiryPresentation({upper,isoDateLocal,displayDate});
function expiryRecords(category){
  return load(EXPIRY_KEY)
    .filter(x=>x.category===category)
    .sort((a,b)=>String(a.expiry||'9999-99-99').localeCompare(String(b.expiry||'9999-99-99')));
}
function expiryRowHtml(x){
  const s=expiryStatus(x.expiry,new Date(),x);
  const noExpiry=x.category==='english'&&String(x.englishLevel)==='6'&&!x.expiry;
  const actions=[];
  if(x.photoData)actions.push(`<button class="secondary" data-view-expiry-photo="${esc(x.id)}">${x.photoData.startsWith('data:application/pdf;')?'View PDF':'View image'}</button>`);
  return `<div class="expiry-row expiry-${s.state}${x.locked?' expiry-locked':''}" >
    <button class="expiry-card-edit" type="button" data-edit-expiry="${esc(x.id)}" aria-label="Edit ${esc(expiryTitle(x))}"></button>
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
  if(selectedSummary?.dataset.detailKind==='expiry')closeDetail();
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
    $(id).innerHTML=rows.length?rows.map(x=>`<button type="button" class="expiry-summary expiry-row expiry-${expiryStatus(x.expiry,new Date(),x).state}" ${summaryAttrs('expiry',x.id)}>${esc(upper(expiryTitle(x)))}</button>`).join(''):'<div class="empty">NO RECORDS YET.</div>';
  });
}
function setExpiryFieldVisible(id,visible){
  const el=$(id)?.closest('[data-expiry-field]');
  if(el)el.classList.toggle('hidden',!visible);
}
function setExpiryFields(ids){
  const all=['expiryName','expiryAuthority','expiryNumber','expiryLastCheck','expiryCourseDate','expiryMedicalClass','expiryEnglishLevel','expiryAircraftType','expiryEndorsedBy','expiryExpiry','expiryIssuer','expiryPhotoInput','expiryRemarks'];
  all.forEach(id=>setExpiryFieldVisible(id,id==='expiryPhotoInput'||ids.includes(id)));
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
let expiryAutosaveTimer=null, expiryAutosaveId=null;
function flushExpiryAutosave(){
  if(expiryAutosaveTimer===null)return;
  clearTimeout(expiryAutosaveTimer);
  expiryAutosaveTimer=null;
  const id=expiryAutosaveId;
  expiryAutosaveId=null;
  if(id===$('expiryEditId').value)saveExpiryFromForm({silent:true});
}
function resetExpiryEditor(category='license'){
  flushExpiryAutosave();
  $('expiryArchiveStatus').textContent='';
  $('expiryForm').reset();
  $('expiryEditId').value='';
  $('expiryCategory').value=category;
  expiryPendingPhotoData='';
  $('expiryPhotoInput').value='';
  configureExpiryEditor(category);
}
function updateExpiryPhotoControls(){
  const has=!!expiryPendingPhotoData;
  $('expiryArchiveActions').classList.toggle('hidden',!$('expiryEditId').value);
  $('expiryFormPhotoViewBtn')?.classList.toggle('hidden',!has);
  $('expiryFormPhotoRemoveBtn')?.classList.toggle('hidden',!has);
}
function openExpiryEditor(category,item=null){
  flushExpiryAutosave();
  if(item)item=load(EXPIRY_KEY).find(row=>row.id===item.id)||item;
  closeDetail();
  resetExpiryEditor(category);
  if(item){
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
  setExpiryEditorLocked(!!item?.locked);expiryBaseline=expiryContent();
  $('expiryEditorWrap').classList.remove('hidden');
  $('expiryEditorWrap').scrollIntoView({behavior:'smooth',block:'start'});
}
function setExpiryEditorLocked(locked){
  const form=$('expiryForm');
  form?.querySelectorAll('input:not(#expiryEditId):not(#expiryCategory),select').forEach(el=>el.disabled=!!locked);
  const id=$('expiryEditId')?.value,record=id?load(EXPIRY_KEY).find(x=>x.id===id):null;
  $('expiryToggleLockBtn').disabled=!record;
  $('expiryDeleteBtn').disabled=!record;
  $('expiryToggleLockBtn').textContent=locked?'UNLOCK':'LOCK';
}
let expiryBaseline='',tripBaseline='';
function formContent(id){
  return JSON.stringify([...$(id).elements].filter(el=>el.id&&el.type!=='button'&&el.type!=='submit'&&el.type!=='file').map(el=>[el.id,el.value]));
}
function expiryContent(){return formContent('expiryForm')+expiryPendingPhotoData}
function tripContent(){return formContent('tripForm')+JSON.stringify(tripFormOverrides)}
function saveExpiryFromForm(options={}){
  if(expiryBaseline===expiryContent())return;
  const silent=options.silent===true;
  const category=$('expiryCategory').value;
  const expiry=$('expiryExpiry').value;
  const level=$('expiryEnglishLevel').value;
  if(!silent&&category==='medical'&&!$('expiryMedicalClass').value)return alert('SELECT CLASS 1 OR CLASS 2.');
  if(!silent&&category==='aircraft'&&!$('expiryAircraftType').value.trim())return alert('ENTER THE AIRCRAFT ENDORSED.');
  if(!silent&&category==='english'&&!$('expiryCourseDate').value)return alert('ENTER THE DATE PERFORMED.');
  if(!silent&&category==='english'&&!level)return alert('SELECT THE ENGLISH LEVEL.');
  if(!silent&&!expiry&&!(category==='english'&&level==='6'))return alert('PLEASE ENTER AN EXPIRY DATE.');

  const rows=load(EXPIRY_KEY),id=$('expiryEditId').value||makeId(),existing=rows.find(x=>x.id===id);
  $('expiryEditId').value=id;
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
  renderExpiry();
  scheduleAutoSync('expiry-save');
  updateExpiryPhotoControls();setExpiryEditorLocked(false);expiryBaseline=expiryContent();
  return item;
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
let expiryPdfDocument=null, expiryPdfPage=1, expiryViewRevision=0;
async function renderExpiryPdfPage(number){
  const doc=expiryPdfDocument;
  if(!doc||number<1||number>doc.numPages)return;
  const revision=++expiryViewRevision;
  expiryPdfPage=number;
  $('expiryPdfPrevious').disabled=number===1;
  $('expiryPdfNext').disabled=number===doc.numPages;
  $('expiryPdfPage').textContent=number+' / '+doc.numPages;
  const canvas=document.createElement('canvas');
  try{
    const page=await doc.getPage(number);
    if(revision!==expiryViewRevision)return;
    const size=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(2,1800/Math.max(size.width,size.height))});
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    canvas.style.width='100%';
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    if(revision===expiryViewRevision)$('expiryPdfCanvas').replaceChildren(canvas);
  }catch{if(revision===expiryViewRevision)$('expiryPdfPage').textContent='Unable to display this PDF page.'}
}
async function showExpiryPhoto(data,type=''){
  if(!data)return;
  const pdf=type==='application/pdf'||data.startsWith('data:application/pdf;');
  $('expiryPhotoViewerImg').classList.toggle('hidden',pdf);
  $('expiryPdfViewer').classList.toggle('hidden',!pdf);
  if(!pdf)$('expiryPhotoViewerImg').src=data;
  $('expiryPhotoViewer').classList.remove('hidden');
  $('expiryPhotoViewer').setAttribute('aria-hidden','false');
  if(pdf){
    const revision=++expiryViewRevision;
    $('expiryPdfPage').textContent='Opening PDF…';
    $('expiryPdfNext').disabled=$('expiryPdfPrevious').disabled=true;
    try{
      const {openPdf}=await import('./document-pdf.mjs');
      const doc=await openPdf(await (await fetch(data)).blob(),!!window.PilotLogNative?.isNative);
      if(revision!==expiryViewRevision){await doc.destroy();return}
      expiryPdfDocument=doc;
      await renderExpiryPdfPage(1);
    }catch{if(revision===expiryViewRevision)$('expiryPdfPage').textContent='Unable to display this PDF.'}
  }
}
function hideExpiryPhoto(){
  ++expiryViewRevision;
  if(expiryPdfDocument){void expiryPdfDocument.destroy();expiryPdfDocument=null}
  $('expiryPdfCanvas').replaceChildren();
  $('expiryPhotoViewer').classList.add('hidden');
  $('expiryPhotoViewer').setAttribute('aria-hidden','true');
  $('expiryPhotoViewerImg').removeAttribute('src');
  if(expiryArchiveUrl){URL.revokeObjectURL(expiryArchiveUrl);expiryArchiveUrl=''}
}
function hideExpiryAddMenu(){
  $('expiryAddMenu').classList.add('hidden');
  $('expiryAddMenu').setAttribute('aria-hidden','true');
}
function showExpiryAddMenu(){
  $('expiryAddMenu').classList.remove('hidden');
  $('expiryAddMenu').setAttribute('aria-hidden','false');
}
async function expiryArchiveAction(action){
  const id=$('expiryEditId').value;
  const record=load(EXPIRY_KEY).find(x=>x.id===id);
  if(!record)throw Error('Save this expiry first.');
  if(action!=='open'&&record.locked)throw Error('Unlock this expiry first.');
  const session=await cloudSession();
  if(!session?.user?.id)throw Error('Sign in to access private copies.');
  const path=[session.user.id,encodeURIComponent(id),'document.jpg'].join('/');
  const endpoint=SUPABASE_URL+'/storage/v1/object/';
  const headers={apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token};
  let response;
  if(action==='save'){
    const photo=record.photoData;
    if(!/^data:(?:application\/pdf|image\/(?:jpeg|png|webp));base64,/i.test(photo||'')||photo!==expiryPendingPhotoData)throw Error('Save the attachment on this expiry first.');
    const blob=await (await fetch(photo)).blob();
    const body=window.PilotLogNative?.isNative?new File([blob],blob.type==='application/pdf'?'document.pdf':'document.jpg',{type:blob.type}):blob;
    response=await fetch(endpoint+'pilotlog-expiry/'+path,{method:'POST',headers:{...headers,'Content-Type':blob.type,'x-upsert':'true'},body});
  }else if(action==='remove'){
    if(!confirm('Remove this private online copy?'))return;
    response=await fetch(endpoint+'pilotlog-expiry',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[session.user.id+'/'+id+'/document.jpg']})});
  }else{
    response=await fetch(endpoint+'authenticated/pilotlog-expiry/'+path,{headers});
  }
  if(!response.ok)throw Error('Private copy unavailable ('+response.status+'). Check the archive setup and whether a copy was saved.');
  if(action==='open'){
    const blob=await response.blob();
    if($('expiryEditId').value!==id||cloudStoredSession()?.user?.id!==session.user.id)return;
    if(expiryArchiveUrl)URL.revokeObjectURL(expiryArchiveUrl);
    expiryArchiveUrl=URL.createObjectURL(blob);
    showExpiryPhoto(expiryArchiveUrl,blob.type);
  }else if($('expiryEditId').value===id){
    $('expiryArchiveStatus').textContent=action==='save'?'Private copy saved.':'Private copy removed.';
  }
}
let expiryArchiveUrl='';
function bindExpiryEvents(){
  $('expiryPdfPrevious').addEventListener('click',()=>renderExpiryPdfPage(expiryPdfPage-1));
  $('expiryPdfNext').addEventListener('click',()=>renderExpiryPdfPage(expiryPdfPage+1));
  $('expiryArchiveActions').addEventListener('click',async e=>{
    const button=e.target.closest('[data-expiry-archive]');
    if(!button)return;
    button.disabled=true;
    try{await expiryArchiveAction(button.dataset.expiryArchive)}
    catch(error){$('expiryArchiveStatus').textContent=error.message}
    finally{button.disabled=false}
  });
  $('expiryAddBtn').addEventListener('click',showExpiryAddMenu);
  $('expiryAddCancel').addEventListener('click',hideExpiryAddMenu);
  $('expiryAddMenu').addEventListener('click',e=>{
    if(e.target===$('expiryAddMenu'))hideExpiryAddMenu();
    const b=e.target.closest('[data-add-expiry]');
    if(!b)return;
    hideExpiryAddMenu();
    openExpiryEditor(b.dataset.addExpiry);
  });

  const queueExpiryAutosave=()=>{
    clearTimeout(expiryAutosaveTimer);
    expiryAutosaveId=$('expiryEditId').value;
    expiryAutosaveTimer=setTimeout(flushExpiryAutosave,180);
  };
  $('expiryForm').addEventListener('submit',e=>{e.preventDefault();saveExpiryFromForm({silent:true})});
  $('expiryForm').addEventListener('input',queueExpiryAutosave);
  $('expiryForm').addEventListener('change',queueExpiryAutosave);
  $('expiryEnglishLevel').addEventListener('change',()=>{
    $('expiryExpiry').required=$('expiryEnglishLevel').value!=='6';
    applyEnglishExpiryDefault();
  });
  $('expiryCourseDate').addEventListener('change',applyEnglishExpiryDefault);
  $('expiryAuthority').addEventListener('change',applyEnglishExpiryDefault);

  $('expiryPhotoInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const target=$('expiryEditId').value,category=$('expiryCategory').value;
      let attachment;
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
        if(file.size>2097152)throw Error('Choose a PDF of 2 MiB or less.');
        if(!(await file.slice(0,1024).text()).includes('%PDF-'))throw Error('Choose a valid PDF.');
        attachment=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result);
          reader.onerror=()=>reject(Error('The PDF could not be read.'));
          reader.readAsDataURL(file.slice(0,file.size,'application/pdf'));
        });
      }else attachment=await expiryPhotoDataFromFile(file);
      if($('expiryEditId').value!==target||$('expiryCategory').value!==category||$('expiryEditorWrap').classList.contains('hidden'))return;
      expiryPendingPhotoData=attachment;
      updateExpiryPhotoControls();
      queueExpiryAutosave();
    }catch(err){alert(err.message||'PHOTO COULD NOT BE ADDED.')}
    finally{e.target.value=''}
  });
  $('expiryFormPhotoViewBtn').addEventListener('click',()=>showExpiryPhoto(expiryPendingPhotoData));
  $('expiryFormPhotoRemoveBtn').addEventListener('click',()=>{
    if(!confirm('REMOVE THIS ATTACHMENT?'))return;
    expiryPendingPhotoData='';
    updateExpiryPhotoControls();
    queueExpiryAutosave();
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
    const lock=e.target.closest('#expiryToggleLockBtn');
    if(lock){
      flushExpiryAutosave();
      const rows=load(EXPIRY_KEY),x=rows.find(v=>v.id===$('expiryEditId').value);
      if(!x)return;
      const next=!x.locked;
      x.locked=next;x._updatedAt=new Date().toISOString();x._syncRev=Number(x._syncRev||0)+1;
      save(EXPIRY_KEY,rows);markCloudEdited('expiry',x,next?'lock':'unlock');renderExpiry();scheduleAutoSync(next?'expiry-lock':'expiry-unlock');setExpiryEditorLocked(next);
      return;
    }
    const edit=e.target.closest('[data-edit-expiry]');
    if(edit){
      const x=load(EXPIRY_KEY).find(v=>v.id===edit.dataset.editExpiry);
      if(x){closeDetail();openExpiryEditor(x.category,x)}
      return;
    }
    const del=e.target.closest('#expiryDeleteBtn');
    if(del){
      const x=load(EXPIRY_KEY).find(v=>v.id===$('expiryEditId').value);
      if(!x)return;
      if(!confirm('DELETE THIS EXPIRY RECORD?'))return;
      clearTimeout(expiryAutosaveTimer);expiryAutosaveTimer=null;expiryAutosaveId=null;
      markCloudDeleted('expiry',x,{manual:true});
      save(EXPIRY_KEY,load(EXPIRY_KEY).filter(v=>v.id!==x.id));
      renderExpiry();
      $('expiryEditorWrap').classList.add('hidden');resetExpiryEditor();
      scheduleAutoSync('expiry-delete');
    }
  });
}
/* Cloud — v8.2 local-first verified generations */
const SUPABASE_URL='https://nexa-phase1.invalid';
const SUPABASE_PUBLISHABLE_KEY='phase1-offline';
const SUPABASE_TABLE='pilotlog_entries';
const CLOUD_SESSION_KEY='pilotlog7_cloud_session_v1';

const SYNC_SINGLETONS=[[PAY_SETTINGS_KEY,'paySettings'],[PAY_MONTH_KEY,'payMonth'],[FX_KEY,'fx'],[APP_SETTINGS_KEY,'appSettings']];
function cloudUserPrefix(userId){return `${SYNC_PROTOCOL}:u:${stableHash128(String(userId||'' )).slice(0,16)}`}
function cloudActiveMetaId(userId){return `${cloudUserPrefix(userId)}:meta:active`}
function cloudGenerationPrefix(userId,generation){return `${cloudUserPrefix(userId)}:g:${generation}:`}
const SNAPSHOT_CHUNK_ITEMS=40;
const AUTO_SYNC_KEY='pilotlog7_auto_sync_v1';
const WEEKLY_BACKUP_INTERVAL_MS=7*24*60*60*1000;
const BACKUP_DB_NAME='pilotlog7-weekly-backup';
const BACKUP_STORE='snapshots';
let autoSyncTimer=null,periodicSyncTimer=null,retrySyncTimer=null,cloudSyncInProgress=false,syncDatabaseReady=false;
const SYNC_LOCAL_REV='pilotlog7_sync_local_revision_16',SYNC_BLOCK='pilotlog7_sync_block_16',SYNC_LOG='pilotlog7_sync_log_16';
const SYNC_OWNER='pilotlog7_sync_owner_16',SYNC_RECEIPT='pilotlog7_sync_activation_16';
function bootDataSignature(){
  const db=operationalDatabase;
  const values=Object.fromEntries(Object.entries(db.values).filter(([,v])=>v!=null&&(typeof v!=='object'||Object.keys(v).length)));
  return sectionDigest([db.records,values]);
}
function localRevision(){return Number(localStorage.getItem(SYNC_LOCAL_REV)||0)}
function markLocalRevision(){
  if(bootKnown&&!operationalDatabase.replica162&&!operationalDatabase.preSync162)operationalDatabase.preSync162={known:bootKnown,legacyDirty};
  localStorage.setItem(SYNC_LOCAL_REV,String(localRevision()+1));
  syncDirty();
}
function clearSyncTimers(){
  clearTimeout(autoSyncTimer);clearTimeout(periodicSyncTimer);clearTimeout(retrySyncTimer);
  autoSyncTimer=periodicSyncTimer=retrySyncTimer=null;
}
function armPeriodicSync(){
  clearTimeout(periodicSyncTimer);
  if(!autoSyncEnabled()||!syncDatabaseReady||localStorage.getItem(SYNC_BLOCK)||retrySyncTimer)return;
  periodicSyncTimer=setTimeout(()=>{periodicSyncTimer=null;runAutomaticSync('periodic')},600000);
}
function runAutomaticSync(reason){
  if(!autoSyncEnabled()||!cloudStoredSession()||localStorage.getItem(SYNC_BLOCK)){armPeriodicSync();return}
  syncSupabase({silent:true,reason});
}
function scheduleAutoSync(reason,eventTime){
  // Local changes already go through touchOperationalDatabase. Only these events arm an early sync.
  if(!['startup','sign-in'].includes(reason)||cloudSyncInProgress||!autoSyncEnabled()||!syncDatabaseReady||localStorage.getItem(SYNC_BLOCK)||retrySyncTimer)return;
  clearTimeout(autoSyncTimer);clearTimeout(periodicSyncTimer);
  autoSyncTimer=setTimeout(()=>{autoSyncTimer=null;runAutomaticSync(reason)},eventTime==null?5000:Math.max(0,eventTime+5000-Date.now()));
}


// Fresh installs/reset devices default to manual Sync now. Auto Sync can still be enabled explicitly.
function autoSyncEnabled(){return localStorage.getItem(AUTO_SYNC_KEY)==='yes'}
function setAutoSyncEnabled(v){localStorage.setItem(AUTO_SYNC_KEY,v?'yes':'no');if(!v)clearSyncTimers()}
function markLocalOnlyImport(){syncDirty()}
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
  await replaceOperationalDatabase(migrateSnapshotToOperationalDatabase(b.data));reconcileAllDuties();syncDirty();localStorage.setItem(CLOUD_PENDING_IMPORT_KEY,'Weekly backup restored locally');
  await render();renderTrips();renderPayroll();renderSettings();alert('Weekly backup restored locally. Review it before pressing Sync now.');return true;
}
async function ensureWeeklyBackupBeforeSync(){const current=await weeklyBackup();if(!current||backupDue(current.createdAt))await createWeeklyBackup(true)}
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
      if(!res.ok){const msg=(data&&typeof data==='object'&&(data.msg||data.message||data.error_description||data.error))||`HTTP ${res.status}`;const err=new Error(msg);err.status=res.status;err.code=data?.code;if((res.status===429||res.status>=500)&&attempt<attempts){lastError=err;await waitMs(500*attempt);continue}throw err}
      return data;
    }catch(e){let err=e;if(e?.name==='AbortError')err=new Error(`Cloud request timed out after ${Math.round((Number(timeoutMs)||30000)/1000)} seconds.`);else if(e instanceof TypeError)err=new Error('Cloud network request failed.');lastError=err;const retryable=e?.name==='AbortError'||e instanceof TypeError||Number(e?.status)===429||Number(e?.status)>=500;if(retryable&&attempt<attempts){await waitMs(500*attempt);continue}throw err}
    finally{clearTimeout(timer)}
  }
  throw lastError||new Error('Cloud request failed.');
}
const {cloudSession}=createSessionReader({cloudStoredSession,saveCloudSession,
  requestRefresh:token=>cloudFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:token},retries:0})
});
function payslipPayrollForMonth(month){
    const saved=monthExtras(month).validated;
    const regime=saved?.regime||payrollRegime();
    const base=saved?.projection||PilotLogEngine.payroll(month);
    return {regime,projection:saved?.projection||(regime==='MAC'?calculateMacPayrollProjection(base):base)};
}
async function startPayslips(){
  const {initializePayslips}=await import('./payslips.mjs?v=16.12');
  const native=window.PilotLogNative;
  initializePayslips({
    auth:{session:cloudSession,url:()=>SUPABASE_URL,key:()=>SUPABASE_PUBLISHABLE_KEY},
    forMonth:payslipPayrollForMonth,
    nativeMode:!!native?.isNative,
    store:native?.isNative?native.payslips:undefined,
    exportFile:native?.isNative?(...args)=>native.exportFile(...args):undefined
  });
}
async function fetchRowsByPrefix(token,prefix,select='id,data,updated_at'){
  const pageSize=500,all=[];
  for(let offset=0;;offset+=pageSize){
    const page=await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?select=${encodeURIComponent(select)}&id=like.${encodeURIComponent(prefix+'*')}&order=id.asc&limit=${pageSize}&offset=${offset}`,{token,headers:{Accept:'application/json'},timeoutMs:60000,retries:0});
    const rows=Array.isArray(page)?page:[];all.push(...rows);if(rows.length<pageSize)break;if(offset>100000)throw new Error('Cloud dataset is unexpectedly large; sync stopped safely.');
  }
  return all;
}
async function syncStep(label,operation){
  try{return await operation()}catch(error){
    error.message=label+' · '+error.message;
    throw error;
  }
}
async function fetchActiveMeta(token,userId){
  const rows=await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?select=id,data,updated_at&id=eq.${encodeURIComponent(cloudActiveMetaId(userId))}&limit=1`,{token,headers:{Accept:'application/json'},timeoutMs:30000,retries:0});
  const row=Array.isArray(rows)?rows[0]:null,d=row?.data||null;if(!row)return null;if(!d||d.protocol!==SYNC_PROTOCOL||d.kind!=='active-meta')throw Error('Incompatible cloud pointer');validateSyncMeta(d.payload);return d.payload;
}
function snapshotSections(){const db=operationalDatabase;return{databaseRecords:db.records.filter(r=>r.activityStatus!=='DRAFT'),databaseValues:Object.entries(db.values).filter(([k])=>![ENTRY_DRAFT_KEY,ENTRY_DRAFTS_KEY].includes(k)).map(([key,value])=>({key,value})),databaseMeta:{schema:db.schema,schemaVersion:db.schemaVersion,updatedAt:db.updatedAt}}}
function localHasMeaningfulData(){return recordMap(operationalDatabase).size>0}
const SNAPSHOT_DIGEST_FORMAT='canonical-json-v1';
function buildSnapshotGeneration(revision,userId){
  const generation=`r${revision}-${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(3)),n=>n.toString(36)).join('-')}`,sections=freezeSnapshot(JSON.parse(JSON.stringify(snapshotSections()))),rows=[],counts={},digests={},chunkCounts={};
  Object.entries(sections).forEach(([section,value])=>{
    const items=Array.isArray(value)?value:[value];counts[section]=Array.isArray(value)?value.length:1;digests[section]=sectionDigest(value);
    const total=Math.max(1,Math.ceil(items.length/SNAPSHOT_CHUNK_ITEMS));chunkCounts[section]=total;
    for(let i=0;i<total;i++){
      const chunk=items.slice(i*SNAPSHOT_CHUNK_ITEMS,(i+1)*SNAPSHOT_CHUNK_ITEMS);
      rows.push({id:`${cloudGenerationPrefix(userId,generation)}${section}:${String(i).padStart(4,'0')}`,user_id:userId,updated_at:new Date().toISOString(),data:{protocol:SYNC_PROTOCOL,kind:'snapshot-chunk',generation,section,index:i,totalChunks:total,isArray:Array.isArray(value),items:chunk,checks:chunk.map(syncFieldChecks)}});
    }
  });
  const meta={revision,generation,version:VERSION,syncVersion:16,previousGeneration:null,digestFormat:SNAPSHOT_DIGEST_FORMAT,createdAt:new Date().toISOString(),counts,digests,chunkCounts,rowCount:rows.length};
  return{generation,rows,meta};
}
function uploadBatches(rows,maxBytes=350000,maxRows=3){
  const out=[];let batch=[],bytes=2;
  for(const row of rows){const n=JSON.stringify(row).length+1;if(batch.length&&(batch.length>=maxRows||bytes+n>maxBytes)){out.push(batch);batch=[];bytes=2}batch.push(row);bytes+=n}
  if(batch.length)out.push(batch);return out;
}
async function pushCloudRows(rows,token,silent=false){
  const batches=uploadBatches(rows),total=batches.length;
  for(let i=0;i<total;i++){
    if($('cloudStatus'))$('cloudStatus').textContent=`${silent?'Auto syncing':'Publishing verified snapshot'}… upload ${i+1}/${total}`;
    await syncStep('Upload '+(i+1)+'/'+total+' '+batches[i][0].data.section,()=>cloudFetch(`/rest/v1/${SUPABASE_TABLE}`,{method:'POST',token,body:batches[i],timeoutMs:90000,retries:0,headers:{Prefer:'return=minimal'}}));
  }
}
function freezeSnapshot(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freezeSnapshot);Object.freeze(value)}
  return value;
}
function validateSyncMeta(meta){
  if(!meta||typeof meta.version!=='string'||!/^\d+(?:\.\d+)*$/.test(meta.version)||!Number.isSafeInteger(meta.revision)||meta.revision<1||!meta.generation||
    (meta.syncVersion!=null&&meta.syncVersion!==16)||Number(String(meta.version).split('.')[0])>16||
    (meta.digestFormat&&meta.digestFormat!==SNAPSHOT_DIGEST_FORMAT))throw Error('Incompatible central database revision or format');
  const sections=['databaseRecords','databaseValues','databaseMeta'];
  if(Object.keys(meta.counts||{}).sort().join()!==sections.sort().join())throw Error('Invalid central database section manifest');
  for(const key of sections){
    if(!Number.isSafeInteger(meta.counts[key])||meta.counts[key]<0||!meta.digests?.[key]||
       !Number.isSafeInteger(meta.chunkCounts?.[key])||meta.chunkCounts[key]<1)throw Error('Invalid manifest: '+key);
  }
  if(meta.counts.databaseMeta!==1||Object.values(meta.chunkCounts).reduce((a,b)=>a+b,0)!==meta.rowCount)throw Error('Invalid manifest: rowCount');
}
function syncFieldChecks(item){
  const fields=Object.create(null);
  function visit(value,path){
    if(value&&typeof value==='object'){
      fields[path]=Array.isArray(value)?'a'+value.length:'o';
      for(const key of Object.keys(value))visit(value[key],path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
    }else fields[path]=sectionDigest(value);
  }
  visit(item,'');return {id:item?.id||item?.key||'',fields};
}
function diagnoseChunkFields(section,chunks){
  for(const chunk of chunks){
    for(const [index,item] of chunk.items.entries()){
      const reference=chunk.checks?.[index],actual=syncFieldChecks(item);
      if(!reference)throw Error(section+' chunk '+chunk.index+' record '+index+': missing verification fields');
      for(const path of new Set([...Object.keys(reference.fields),...Object.keys(actual.fields)])){
        if(reference.fields[path]!==actual.fields[path])throw Error('Integrity: '+section+' ['+(reference.id||index)+'] '+(path||'/'));
      }
    }
  }
}
function checkAccount(session){
  if(cloudStoredSession()?.user?.id!==session.user.id)throw Error('Account changed during sync');
}
async function publishLocalSnapshot(session,remoteMeta,silent){
  const revision=(remoteMeta?.revision||0)+1,local=localRevision(),built=buildSnapshotGeneration(revision,session.user.id);
  built.meta.previousGeneration=remoteMeta?.generation||null;
  await pushCloudRows(built.rows,session.access_token,silent);
  await fetchCentralSnapshot(session,built.meta);
  checkAccount(session);
  const receipt={user:session.user.id,generation:built.generation,revision,local,meta:built.meta,verifiedAt:Date.now()};
  localStorage.setItem(SYNC_RECEIPT,JSON.stringify(receipt));
  await activateVerifiedGeneration(session,receipt);
}
async function activateVerifiedGeneration(session,receipt){
  await syncStep('Activate revision '+receipt.revision,()=>cloudFetch('/rest/v1/rpc/pilotlog_activate_v16',{
    method:'POST',token:session.access_token,retries:0,
    body:{pointer_id:cloudActiveMetaId(session.user.id),expected_generation:receipt.meta.previousGeneration,new_meta:receipt.meta}}));
  checkAccount(session);acceptActivation(receipt);
}
function acceptActivation(receipt){
  localStorage.setItem(CLOUD_BASE_REV_KEY,String(receipt.revision));
  localStorage.setItem(SYNC_OWNER,receipt.user);
  if(localRevision()===receipt.local){
    localStorage.setItem(CLOUD_DIRTY_KEY,'0');localStorage.removeItem(CLOUD_PENDING_IMPORT_KEY);
  }
  localStorage.setItem(SYNC_READY_KEY,'1');localStorage.removeItem(SYNC_RECEIPT);
}
function reconstructSnapshot(meta,rows){
  validateSyncMeta(meta);
  if(rows.length!==meta.rowCount)throw Error('Generation '+meta.generation+': chunk count mismatch');
  const groups=Object.create(null);
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
    for(const chunk of chunks){
      if(!Array.isArray(chunk.items))throw Error('Integrity: '+section+' chunk '+chunk.index+' /items');
      if(meta.syncVersion===16&&chunk.items.length!==chunk.checks?.length){
        const missing=chunk.checks?.find(check=>check.id&&!chunk.items.some(item=>(item?.id||item?.key)===check.id));
        throw Error('Integrity: '+section+' chunk '+chunk.index+' ['+(missing?.id||'manifest')+'] /items');
      }
    }
    const items=chunks.flatMap(c=>Array.isArray(c.items)?c.items:[]),isArray=chunks[0]?.isArray!==false,value=isArray?items:(items[0]||{});
    const count=isArray?items.length:1;if(count!==Number(meta.counts?.[section]||0))throw new Error(`Central database count mismatch in ${section}. Local data was not replaced.`);
    const expected=meta.digests?.[section];
    if(meta.syncVersion===16&&sectionDigest(value)!==expected)diagnoseChunkFields(section,chunks);
    if(canonicalFormat){
      if(sectionDigest(value)!==expected)throw new Error(`Central database integrity check failed in ${section}. Local data was not replaced.`);
    }else if(legacyFormat){
      // db8 snapshots created before v8.6 hashed ordinary JSON.stringify output.
      // PostgreSQL jsonb is allowed to reorder object keys, so that old digest can change
      // even when the stored values are identical. Accept the legacy generation only
      // after the strict generation/chunk/count checks above. New publications always
      // use canonical-json-v1 and return to full content-digest verification.
      if(legacySectionDigest(value)!==expected)throw Error('Unverified legacy hash: '+section);
    }else{
      throw new Error(`Central database uses an unsupported integrity format in ${section}. Local data was not replaced.`);
    }
    out[section]=value;
  }
  if(out.databaseMeta?.schema!=='PilotLog Operational Database'||out.databaseMeta.schemaVersion!==1)throw Error('Incompatible databaseMeta.schemaVersion');
  if(!Array.isArray(out.databaseRecords)||!Array.isArray(out.databaseValues))throw Error('Invalid records or values section');
  const seen=new Set();
  for(const row of out.databaseRecords){
    if(!row?.id||seen.has(row.id))throw Error('databaseRecords ['+(row?.id||'missing')+'] /id');
    seen.add(row.id);
  }
  const keys=new Set();
  for(const entry of out.databaseValues){
    if(typeof entry?.key!=='string'||keys.has(entry.key))throw Error('databaseValues ['+(entry?.key||'missing')+'] /key');
    keys.add(entry.key);
  }
  return out;
}
async function fetchCentralSnapshot(session,meta){
  if(!meta?.generation)throw new Error('Central database metadata has no active generation.');
  validateSyncMeta(meta);
  const rows=[],prefix=cloudGenerationPrefix(session.user.id,meta.generation);
  for(const [section,total] of Object.entries(meta.chunkCounts)){
    for(let first=0;first<total;first+=3){
      const end=Math.min(first+3,total),ids=[];
      for(let i=first;i<end;i++)ids.push(prefix+section+':'+String(i).padStart(4,'0'));
      const filter=encodeURIComponent('in.('+ids.join(',')+')');
      const page=await syncStep('Read '+section+' '+(first+1)+'–'+end+'/'+total,()=>cloudFetch(
        `/rest/v1/${SUPABASE_TABLE}?select=id,data&id=${filter}&user_id=eq.${encodeURIComponent(session.user.id)}`,
        {token:session.access_token,headers:{Accept:'application/json'},timeoutMs:60000,retries:0}));
      if(!Array.isArray(page))throw Error('Invalid cloud response: '+section);
      const received=new Set(page.map(row=>row.id));
      for(const id of ids)if(!received.has(id))throw Error('Missing snapshot chunk '+id);
      rows.push(...page);
    }
  }
  return reconstructSnapshot(meta,rows);
}
function loadSyncLedger(){const rows=load(SYNC_LEDGER_KEY);return Array.isArray(rows)?rows:[]}
function saveSyncLedger(rows){save(SYNC_LEDGER_KEY,Array.isArray(rows)?rows:[])}
function ledgerTarget(kind,item,includeSource=true){
  const obj=item&&typeof item==='object'?item:null,recordId=obj?.id||String(item||''),sourceKey=includeSource&&obj?syncSourceKey(obj):'';return{collection:String(kind||''),recordId,sourceKey};
}
function appendSyncLedger(action,kind,item,options={}){
  if(!['delete','delete-collection'].includes(action)&&(!item||item==='*'||!effectiveCloudDeletion(kind,item)))return null;
  const target=ledgerTarget(kind,item,options.includeSource!==false),event={eventId:makeId(),action:['delete','delete-collection'].includes(action)?action:'restore162',...target,at:new Date().toISOString(),deviceId:syncDeviceId(),recordRev:item&&typeof item==='object'?recordRevision(item):0};
  if(action==='delete'&&kind==='trips'&&typeof item==='object'&&item)event.recordHash=contentHash(item);
  if(options.note)event.note=String(options.note);if(options.count!=null)event.count=Number(options.count)||0;
  const rows=loadSyncLedger();rows.push(event);saveSyncLedger(rows);return event;
}
function markCloudEdited(kind,item,action='edit',options={}){return appendSyncLedger(action,kind,item,options)}
function markCloudCollectionEdited(kind,action='edit-collection',options={}){return appendSyncLedger(action,kind,'*',{...options,includeSource:false})}
function markCloudDeleted(kind,item,options={}){if(kind==='activities'&&item?.activityStatus==='DRAFT')return null;if(options.manual!==true)throw new Error('PilotLog safety block: deletion requires an explicit manual user action.');return appendSyncLedger('delete',kind,item,options)}
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
  // Keep validated months from either device; an explicit unlock has its own later revision.
  const localMonths=local.values[PAY_MONTH_KEY]||{},remoteMonths=remote.values[PAY_MONTH_KEY]||{},months={...remoteMonths,...localMonths};
  for(const month of new Set([...Object.keys(localMonths),...Object.keys(remoteMonths)])){
    if(!/^\d{4}-\d{2}$/.test(month))continue;
    const l=localMonths[month]||{},r=remoteMonths[month]||{};
    const winner=String(l.validationUpdatedAt||'')>=String(r.validationUpdatedAt||'')?l:r;
    months[month]={...r,...l,...(winner.validationUpdatedAt?{validated:winner.validated??null,validationUpdatedAt:winner.validationUpdatedAt}:r.validated?{validated:r.validated,validationUpdatedAt:r.validationUpdatedAt||r.validated.validatedAt}:{})};
  }
  values[PAY_MONTH_KEY]=months;
  const localSettings=local.values[APP_SETTINGS_KEY]||{},remoteSettings=remote.values[APP_SETTINGS_KEY]||{};
  const localPhotoRevision=String(localSettings.profilePhotoUpdatedAt||''),remotePhotoRevision=String(remoteSettings.profilePhotoUpdatedAt||'');
  const photoWinner=localPhotoRevision||remotePhotoRevision
    ?(localPhotoRevision>=remotePhotoRevision?localSettings:remoteSettings)
    :(remoteSettings.profilePhotoData&&!localSettings.profilePhotoData?remoteSettings:localSettings);
  values[APP_SETTINGS_KEY]={...remoteSettings,...localSettings,profilePhotoData:photoWinner.profilePhotoData||'',profilePhotoUpdatedAt:photoWinner.profilePhotoUpdatedAt||''};
  values[TRIPS_KEY]=mergeSyncCollection('trips',local.values[TRIPS_KEY]||[],remote.values[TRIPS_KEY]||[],ledger);
  values[EXPIRY_KEY]=mergeSyncCollection('expiry',local.values[EXPIRY_KEY]||[],remote.values[EXPIRY_KEY]||[],ledger);
  return normalizeOperationalDatabase({...local,records:applyLedgerToUnifiedRecords([...map.values()],ledger),values,updatedAt:new Date().toISOString()});
}
function mergeSnapshotsForSync(local,remote){
  const localDb=migrateSnapshotToOperationalDatabase(local),remoteDb=migrateSnapshotToOperationalDatabase(remote);
  return{database:mergeUnifiedDatabases(localDb,remoteDb)};
}
// The acknowledged hashes, record revisions and download cursor share the local
// database transaction with the Core. A server tombstone has a null value.

function recordMap(db){
  const map=new Map(),put=(kind,id,value)=>{
    if(!id)throw Error('Missing record identity: '+kind);
    const key=JSON.stringify([kind,String(id)]);
    if(map.has(key))throw Error('Duplicate record identity: '+key);
    map.set(key,value);
  };
  for(const row of db.records)if(row.activityStatus!=='DRAFT')put('activity',row.id,row);
  for(const kind of [TRIPS_KEY,EXPIRY_KEY])for(const row of db.values[kind]||[])put(kind,row.id,row);
  for(const row of db.values[SYNC_LEDGER_KEY]||[])if(row.eventId&&['delete','delete-collection','restore162'].includes(row.action))put(SYNC_LEDGER_KEY,row.eventId,row);
  for(const kind of [FX_KEY,PAY_MONTH_KEY])for(const [id,value] of Object.entries(db.values[kind]||{}))if(id!=='_updatedAt')put(kind,id,value);
  for(const kind of [APP_SETTINGS_KEY,PAY_SETTINGS_KEY])if(db.values[kind])put(kind,'settings',db.values[kind]);
  return map;
}
function baseline(map){
  return Object.fromEntries([...map].map(([k,v])=>[k,{hash:storedHash(v),rev:0}]));
}
function changesSince(map,state){
  const keys=new Set([...map.keys(),...Object.keys(state.known)]);
  return [...keys].filter(k=>storedHash(map.get(k))!==(state.known[k]?.hash??null));
}
function setReceived(db,key,value){
  const [kind,id]=JSON.parse(key);
  if(['activity',TRIPS_KEY,EXPIRY_KEY,SYNC_LEDGER_KEY].includes(kind)){
    const rows=kind==='activity'?db.records:(db.values[kind]??=[]),field=kind===SYNC_LEDGER_KEY?'eventId':'id';
    if(value&&String(value[field])!==id)throw Error('Remote record identity mismatch: '+key);
    const i=rows.findIndex(r=>String(r[field])===id);
    if(kind==='activity')directory.replaceRow(rows,rows[i],value);
    if(i>=0){if(value==null)rows.splice(i,1);else rows[i]=value}
    else if(value!=null)rows.push(value);
  }else if([FX_KEY,PAY_MONTH_KEY].includes(kind)){
    const obj=db.values[kind]??={};if(value==null)delete obj[id];else obj[id]=value;
  }else if([APP_SETTINGS_KEY,PAY_SETTINGS_KEY].includes(kind)&&id==='settings'){
    if(value==null)delete db.values[kind];else db.values[kind]=value;
  }else throw Error('Unknown remote record: '+key);
}
let bootKnown=null,legacyDirty=false;
function syncDirty(){
  if(!operationalDatabase||!bootKnown||importStaging)return;
  const state=operationalDatabase.replica162;
  const dirty=(!state&&legacyDirty)||!!Object.keys(state?.sent||{}).length||!!Object.keys(state?.conflicts||{}).length||changesSince(recordMap(operationalDatabase),state||{known:bootKnown}).length>0;
  localStorage.setItem(CLOUD_DIRTY_KEY,dirty?'1':'0');
  if(syncDatabaseReady)drawSyncState();
}
async function persistReplica(){
  syncDirty();await queueFlightPersist();
}
async function attachReplica(session,meta){
  flushCrewTyping();
  let db=operationalDatabase;const existing=db.replica162;
  if(existing){
    if(existing.user!==session.user.id)throw Error('Account conflict: local data retained');
    if(existing.generation===meta.generation)return existing;
    if(existing.cursor||meta.revision<=Number(localStorage.getItem(CLOUD_BASE_REV_KEY))||changesSince(recordMap(db),existing).length||Object.keys(existing.sent).length||Object.keys(existing.conflicts||{}).length)
      throw Error('Conflict: central baseline changed. Local data retained.');
    bootKnown=existing.known;legacyDirty=false;
  }
  const base=Number(localStorage.getItem(CLOUD_BASE_REV_KEY)||0);
  if(base>meta.revision)
    throw Error('Conflict: local data has no matching verified base. Both copies retained.');
  // A previously verified 16.1 copy can adopt the record protocol without downloading the same bytes again.
  const sections=snapshotSections();
  if(!existing&&base===meta.revision&&meta.digestFormat===SNAPSHOT_DIGEST_FORMAT&&
     sectionDigest(sections.databaseRecords)===meta.digests.databaseRecords&&sectionDigest(sections.databaseValues)===meta.digests.databaseValues){
    db.replica162={user:session.user.id,generation:meta.generation,known:baseline(recordMap(db)),cursor:0,sent:{}};
    delete db.preSync162;localStorage.setItem(SYNC_OWNER,session.user.id);await persistReplica();return db.replica162;
  }
  await ensureWeeklyBackupBeforeSync();
  const snapshot=await fetchCentralSnapshot(session,meta);
  checkAccount(session);
  const remote={...snapshot.databaseMeta,records:snapshot.databaseRecords,values:Object.fromEntries(snapshot.databaseValues.map(x=>[x.key,x.value]))};
  flushCrewTyping();db=operationalDatabase;
  const remoteMap=recordMap(remote),localMap=recordMap(db),known=baseline(remoteMap);
  const changed=new Set(changesSince(localMap,{known:bootKnown||baseline(localMap)}));
  const conflicts={},remoteLedger=remote.values[SYNC_LEDGER_KEY]||[],localLedger=db.values[SYNC_LEDGER_KEY]||[];
  const uncertainBase=base!==meta.revision&&(legacyDirty||!base&&localHasMeaningfulData());
  for(const key of changesSince(localMap,{known})){
    const [kind,id]=JSON.parse(key),here=localMap.get(key),central=remoteMap.get(key);
    const collection=kind===TRIPS_KEY?'trips':kind==='activity'?'activities':kind===EXPIRY_KEY?'expiry':null;
    const hereDeleted=!here&&central&&collection&&effectiveCloudDeletion(collection,central,localLedger);
    const centralDeleted=!central&&here&&collection&&effectiveCloudDeletion(collection,here,remoteLedger);
    // Compare the content that was explicitly deleted. A timestamp alone cannot
    // distinguish an unchanged copy from an independent edit on another device.
    if(centralDeleted?.recordHash&&String(centralDeleted.recordId)===id&&centralDeleted.recordHash===storedHash(here)){changed.delete(key);continue}
    if(hereDeleted?.recordHash&&String(hereDeleted.recordId)===id&&hereDeleted.recordHash===storedHash(central)){changed.add(key);continue}
    if(kind===SYNC_LEDGER_KEY&&(!here||!central)){if(here)changed.add(key);else changed.delete(key);continue}
    // An untouched default profile on first bootstrap can receive the saved account settings.
    // A photo removal carries its own timestamp and consequently fails the defaults check.
    if(!base&&!existing&&!legacyDirty&&kind===APP_SETTINGS_KEY&&central&&here&&!changed.has(key)&&
       Object.entries(here).every(([field,value])=>field==='_updatedAt'||Object.hasOwn(APP_DEFAULTS,field)&&contentHash(value)===contentHash(APP_DEFAULTS[field])))continue;
    const ambiguous=uncertainBase&&!changed.has(key)&&!!here;
    if(legacyDirty&&(here||hereDeleted))changed.add(key);
    const diverged=base!==meta.revision&&changed.has(key)&&storedHash(central)!==(bootKnown?.[key]?.hash??null);
    if(ambiguous||diverged||(hereDeleted||centralDeleted)&&base!==meta.revision){
      conflicts[key]={key,rev:0,value:central??null,hash:storedHash(central)};
      changed.add(key);
    }
  }
  const incoming=[...new Set([...localMap.keys(),...remoteMap.keys()])].filter(key=>!changed.has(key)&&storedHash(localMap.get(key))!==storedHash(remoteMap.get(key)));
  for(const key of incoming){
    const [kind,id]=JSON.parse(key);
    if(kind==='activity'&&db.localForms?.[id])throw Error('Conflict: local entry draft '+id+' retained during upgrade.');
  }
  const openId=$('editId')?.value;
  for(const key of incoming)setReceived(db,key,remoteMap.get(key)??null);
  if(openId&&incoming.includes(JSON.stringify(['activity',openId]))){
    const row=db.records.find(r=>r.id===openId);
    if(row)loadEntryToForm(row,{rosterActivity:entryReturnContext?.view==='rosterView'});else resetEntry(false);
  }
  if(!base){
    const ids=new Set(db.records.map(row=>row.id));
    for(const row of remote.records)if(row.activityStatus==='DRAFT'&&!ids.has(row.id)){db.records.push(row);ids.add(row.id)}
  }
  const history=remote.values[SYNC_LEDGER_KEY];
  if(Array.isArray(history))db.values[SYNC_LEDGER_KEY]=mergeSyncLedgers(db.values[SYNC_LEDGER_KEY],history);
  // Legacy non-replicated archives/settings can seed an empty device once.
  for(const [k,v] of Object.entries(remote.values))if(db.values[k]===undefined&&![ENTRY_DRAFT_KEY,ENTRY_DRAFTS_KEY,TRIPS_KEY,EXPIRY_KEY,FX_KEY,PAY_MONTH_KEY,PAY_SETTINGS_KEY,APP_SETTINGS_KEY,SYNC_LEDGER_KEY].includes(k))db.values[k]=copyJson(v);
  delete db.preSync162;db.replica162={user:session.user.id,generation:meta.generation,known,cursor:0,sent:{},conflicts};
  localStorage.setItem(CLOUD_BASE_REV_KEY,String(meta.revision));localStorage.setItem(SYNC_OWNER,session.user.id);
  await persistReplica();return db.replica162;
}
async function reviewRecordConflict(kind,id,local,central){
  function describe(row){
    if(!row)return 'Absent';
    if(kind==='activity')return [row.date, row.flightNo||row.dutyType,row.dep,row.arr].filter(Boolean).join(' · ');
    if(kind===TRIPS_KEY)return [row.stations||'Trip',row.start,row.end].filter(Boolean).join(' · ');
    if(kind===EXPIRY_KEY)return [expiryTitle(row),row.expiry].filter(Boolean).join(' · ');
    if(kind===APP_SETTINGS_KEY)return 'Account settings';
    if(kind===PAY_SETTINGS_KEY)return 'Payroll settings';
    return [kind===FX_KEY?'Exchange rate':kind===PAY_MONTH_KEY?'Payroll month':'Record',id].join(' · ');
  }
  const heading=describe(local||central);
  const dialog=$('tripConflictDialog');
  const warning='Using this device will overwrite the cloud version.';
  if(!dialog?.showModal){
    const answer=window.prompt(heading+'\n'+warning+'\nType DEVICE or CLOUD. Cancel to decide later.','');
    return ({DEVICE:'local',CLOUD:'central'})[String(answer).trim().toUpperCase()]||'later';
  }
  $('tripConflictId').textContent=heading;
  const cells=$('tripConflictComparison');cells.replaceChildren();
  const keys=Object.keys({...central,...local}).filter(key=>!['id','_syncRev','_updatedAt'].includes(key)&&contentHash(local?.[key])!==contentHash(central?.[key]));
  for(const [label,row] of [['This device',local],['Cloud',central]]){
    const section=document.createElement('section'),title=document.createElement('b');
    title.textContent=label;section.append(title);
    const summary=document.createElement('p');summary.textContent=describe(row);section.append(summary);
    for(const key of keys){
      const line=document.createElement('div'),value=row?.[key];
      line.textContent=key+': '+(value==null?'—':/photoData/i.test(key)?'Attachment present':typeof value==='object'?JSON.stringify(value):String(value));
      section.append(line);
    }
    cells.append(section);
  }
  dialog.returnValue='later';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue||'later'),{once:true});
    dialog.showModal();
  });
}
async function syncRecordChanges(session,meta,manual){
  const state=await attachReplica(session,meta);
  state.conflicts??={};
  const priorConflicts=new Set(Object.keys(state.conflicts));
  let backedUp=false;
  const backup=async()=>{if(!backedUp){await ensureWeeklyBackupBeforeSync();backedUp=true}};
  const request=async(changes)=>{
    const response=await sendReplicaDelta(session,meta.generation,state.cursor,changes);
    checkAccount(session);
    if(state!==operationalDatabase.replica162||!Array.isArray(response?.page)||!Array.isArray(response?.acks)||response.acks.length!==changes.length)throw Error('Invalid sync acknowledgement');
    let previousSeq=state.cursor;
    for(const item of response.page){
      const pair=JSON.parse(item.key);
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[1]!=='string'||!pair[1]||
         !['activity',TRIPS_KEY,EXPIRY_KEY,SYNC_LEDGER_KEY,FX_KEY,PAY_MONTH_KEY,APP_SETTINGS_KEY,PAY_SETTINGS_KEY].includes(pair[0])||
         !Number.isSafeInteger(item.seq)||item.seq<=previousSeq||!Number.isSafeInteger(item.rev)||item.rev<1||
         !Object.prototype.hasOwnProperty.call(item,'value')||item.hash!==contentHash(item.value))throw Error('Integrity: invalid delta '+item.key);
      if(item.value&&['activity',TRIPS_KEY,EXPIRY_KEY,SYNC_LEDGER_KEY].includes(pair[0])&&String(item.value[pair[0]===SYNC_LEDGER_KEY?'eventId':'id'])!==pair[1])throw Error('Integrity: record ID '+item.key);
      previousSeq=item.seq;
    }
    if(response.page.length)await backup();
    checkAccount(session);
    flushCrewTyping();
    const local=recordMap(operationalDatabase);
    for(const [i,ack] of response.acks.entries()){
      const sent=changes[i];
      if(ack.key!==sent.key||ack.hash!==sent.hash||!Number.isSafeInteger(ack.rev)||ack.rev<sent.base)throw Error('Invalid record revision');
      state.known[ack.key]={hash:contentHash(sent.value),rev:ack.rev};delete state.sent[ack.key];
    }

    let refreshOpen=false;
    for(const item of response.page){
      const {key,value,rev,seq}=item,prev=state.known[key],hash=contentHash(value),current=contentHash(local.get(key));
      if(!Number.isSafeInteger(seq)||seq<=state.cursor||!Number.isSafeInteger(rev)||rev<1)throw Error('Invalid delta sequence');
      if(rev>(prev?.rev||0)){
        const [recordKind,recordId]=JSON.parse(key);
        if(recordKind===FX_KEY&&recordId.startsWith('payroll:')&&value?.rate>0&&local.get(key)?.rate>0){
          if(value.locked||!local.get(key).locked)setReceived(operationalDatabase,key,value);
          state.known[key]={hash,rev};delete state.sent[key];delete state.conflicts[key];state.cursor=seq;continue;
        }
        const own=state.sent[key]&&state.sent[key].hash===hash&&state.sent[key].base+1===rev;
        if(recordKind==='activity'&&operationalDatabase.localForms?.[recordId]&&!own&&current!==hash){
          state.conflicts[key]=item;state.cursor=seq;continue;
        }
        if(!own&&current!==hash&&(state.sent[key]||state.conflicts[key]||current!==(prev?.hash??null))){
          state.conflicts[key]=item;state.cursor=seq;continue;
        }
        delete state.conflicts[key];
        if(!own&&current!==hash){
          const [kind,id]=JSON.parse(key);
          if(kind==='activity'&&$('editId')?.value===id&&!$('addView')?.classList.contains('hidden')){
            refreshOpen=true;
          }
          setReceived(operationalDatabase,key,value);
        }
        state.known[key]={hash,rev};delete state.sent[key];
      }
      state.cursor=seq;
    }
    if(refreshOpen){
      const active=operationalDatabase.records.find(r=>r.id===$('editId').value);
      if(active)loadEntryToForm(active,{rosterActivity:entryReturnContext?.view==='rosterView'});
      else resetEntry(false);
    }
    if(changes.length||response.page.length)await persistReplica();

    return response.page.length===40;
  };
  while(await request([])){}
  for(const [key,item] of Object.entries(state.conflicts)){
    const hash=contentHash(item.value),current=storedHash(recordMap(operationalDatabase).get(key));
    if(current!==hash){
      if(!manual||!priorConflicts.has(key))continue;
      const [type,id]=JSON.parse(key);
      const choice=await reviewRecordConflict(type,id,recordMap(operationalDatabase).get(key),item.value);
      checkAccount(session);
      if(state!==operationalDatabase.replica162)throw Error('Local archive changed during review');
      if(storedHash(recordMap(operationalDatabase).get(key))!==current)continue;
      if(choice!=='central'&&choice!=='local')continue;
      if(choice==='central'){
        setReceived(operationalDatabase,key,item.value);
        const [kind,id]=JSON.parse(key);
        if(kind==='activity'){
          if(operationalDatabase.localForms)delete operationalDatabase.localForms[id];
          if($('editId')?.value===id){if(item.value)loadEntryToForm(item.value);else resetEntry(false)}
        }
      }
      if(type===TRIPS_KEY){
        const chosen=recordMap(operationalDatabase).get(key);
        if(chosen&&effectiveCloudDeletion('trips',chosen))markCloudEdited('trips',chosen,'restore162');
      }
    }
    state.known[key]={hash,rev:item.rev};delete state.sent[key];delete state.conflicts[key];await persistReplica();
  }
  const local=recordMap(operationalDatabase),keys=[...new Set([...changesSince(local,state),...Object.keys(state.sent)])].filter(k=>!state.conflicts[k]);
  for(let i=0;i<keys.length;i+=40){
    const now=recordMap(operationalDatabase),batch=[];
    for(const key of keys.slice(i,i+40)){
      const value=now.get(key)??null,hash=contentHash(value),base=state.known[key]?.rev||0;
      if(!state.sent[key]&&hash===(state.known[key]?.hash??null))continue;
      batch.push({key,value,base,hash});state.sent[key]={hash,base};
    }
    if(batch.length){await backup();await persistReplica();let more=await request(copyJson(batch));while(more)more=await request([])}
  }
  syncDirty();
  const unresolved=Object.keys(state.conflicts);
  if(unresolved.length)throw Object.assign(Error('Conflict: '+unresolved.join(', ')+' — both copies retained. Use Sync Now to review.'),{recordConflict:true});
  return keys.length;
}

function drawSyncState(){
  const signed=cloudStoredSession(),last=localStorage.getItem('pilotlog7_last_cloud_sync');
  const dirty=localStorage.getItem(CLOUD_DIRTY_KEY)==='1',failed=localStorage.getItem('pilotlog7_sync_failure_16');
  const unverified=legacyDirty&&!operationalDatabase?.replica162&&bootKnown&&!changesSince(recordMap(operationalDatabase),{known:bootKnown}).length;
  const review=failed?.includes('both copies retained. Use Sync Now to review.')&&Object.keys(operationalDatabase?.replica162?.conflicts||{}).length;
  const state=review?'pending':failed?'error':dirty&&!unverified?'pending':'ok';
  const title=review?'Sync now to review '+review+' unresolved record(s)':failed?'Sync failed — Local data protected':unverified?'Checking previous sync':dirty?'Local changes pending':last?'Database synchronized':'Awaiting first sync';
  for(const id of ['cloudStatus','syncState']){
    const el=$(id);if(!el)continue;
    el.dataset.state=state;el.textContent=[signed?'':'Not signed in',title,review?'':failed,last?'Last successful sync '+new Date(last).toLocaleString('en-GB'):''].filter(Boolean).join(' · ');
  }
  const log=$('syncLog');
  if(log)log.textContent=syncHistory().slice().reverse().map(entry=>new Date(entry.date).toLocaleString('en-GB')+' · '+entry.reason+' · '+(entry.ms/1000).toFixed(1)+' s · '+(entry.error||entry.result)).join('\n');
}
function syncHistory(){try{return JSON.parse(localStorage.getItem(SYNC_LOG)||'[]')}catch{return []}}
function logSync(start,reason,result,error){
  localStorage.setItem(SYNC_LOG,JSON.stringify([...syncHistory().slice(-99),{date:new Date(start).toISOString(),ms:Date.now()-start,reason,result,error}]));
}
async function updateCloudStatus(){
  const s=cloudStoredSession(),btn=$('cloudSignInBtn');
  if(btn){btn.classList.toggle('signed-in',!!s);btn.textContent=s?'Signed in':'Sign in'}
  if(s?.user?.email&&$('cloudEmail'))$('cloudEmail').value=s.user.email;
  drawSyncState();
}
async function cloudSignUp(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6)return alert('Enter an email and a password of at least 6 characters.');localStorage.setItem(LAST_EMAIL_KEY,email);$('cloudStatus').textContent='Creating account…';const data=await cloudFetch('/auth/v1/signup',{method:'POST',body:{email,password},headers:{'x-client-info':'pilotlog-web'}});if(data?.access_token){saveCloudSession(data);window.dispatchEvent(new Event('pilotlog-auth-change'));$('cloudPassword').value='';await updateCloudStatus();scheduleAutoSync('sign-in');alert('Account created and signed in.')}else{$('cloudStatus').textContent='Account created. Check your email to confirm it, then sign in.';alert('Account created. Check your email to confirm it, then sign in.')}}
async function cloudSignIn(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return alert('Enter email and password.');localStorage.setItem(LAST_EMAIL_KEY,email);$('cloudStatus').textContent='Signing in…';const data=await cloudFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},headers:{'x-client-info':'pilotlog-web'}});saveCloudSession(data);window.dispatchEvent(new Event('pilotlog-auth-change'));$('cloudPassword').value='';await updateCloudStatus();scheduleAutoSync('sign-in');alert('Signed in.')}
async function cloudSignOut(){const email=$('cloudEmail').value.trim()||localStorage.getItem(LAST_EMAIL_KEY)||'';if(email)localStorage.setItem(LAST_EMAIL_KEY,email);const s=await cloudSession();if(s?.access_token){try{await cloudFetch('/auth/v1/logout',{method:'POST',token:s.access_token})}catch{}}clearSyncTimers();saveCloudSession(null);window.dispatchEvent(new Event('pilotlog-auth-change'));$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';$('cloudPassword').value='';await updateCloudStatus()}
async function syncSupabase(options={}){
  if(navigator.locks?.request&&!options.hasDeviceLock){
    return navigator.locks.request('pilotlog-central-sync',{ifAvailable:true},lock=>{
      if(lock)return syncSupabase({...options,hasDeviceLock:true});
      if(!cloudSyncInProgress)armPeriodicSync();
      return false;
    });
  }
  const reason=options.reason||'manual',manual=reason==='manual';
  if(cloudSyncInProgress)return false;
  if(!syncDatabaseReady||!flightStoreReady){if(manual)alert('Local database is not ready for cloud sync');return false}
  if(!manual&&localStorage.getItem(SYNC_BLOCK))return false;
  clearSyncTimers();cloudSyncInProgress=true;
  const start=Date.now(),btn=$('syncCloudBtn');if(btn)btn.disabled=true;
  let result='Skipped',errorText='',retry=false;
  try{
    if(!cloudStoredSession()){if(manual)throw Error('Sign in first');return false}
    if(manual)localStorage.removeItem(SYNC_BLOCK);
    const session=await cloudSession();if(!session)throw Error('Sign in first');
    const owner=localStorage.getItem(SYNC_OWNER);
    if(owner&&owner!==session.user.id)throw Error('Account conflict: local data belongs to a different account');
    await flushFlightStore();
    const meta=await syncStep('Read revision',()=>fetchActiveMeta(session.access_token,session.user.id));
    checkAccount(session);
    const receipt=JSON.parse(localStorage.getItem(SYNC_RECEIPT)||'null');
    if(receipt?.user===session.user.id&&receipt.generation===meta?.generation)acceptActivation(receipt);
    let active=meta;
    if(!operationalDatabase.replica162&&(active||manual&&localHasMeaningfulData())){
      // Check that the server supports this client before installing or publishing its initial baseline.
      const probe=await cloudFetch('/rest/v1/rpc/pilotlog_delta162',{method:'POST',token:session.access_token,retries:0,body:{
        pointer_id:cloudActiveMetaId(session.user.id),generation_id:active?.generation||null,after_seq:0,changes:[],probe:true}});
      if(probe?.protocol!==162)throw Error('Install the PilotLog v16.2 Supabase migration before sync.');
    }
    if(!active&&receipt?.user===session.user.id&&receipt.meta?.previousGeneration===null&&receipt.revision===1){
      await activateVerifiedGeneration(session,receipt);active=await fetchActiveMeta(session.access_token,session.user.id);
    }
    if(!active){
      if(operationalDatabase.replica162||Number(localStorage.getItem(CLOUD_BASE_REV_KEY)))throw Error('Conflict: central baseline is missing');
      if(!manual||!localHasMeaningfulData()||!confirm('Publish the first central copy?'))return false;
      await ensureWeeklyBackupBeforeSync();await publishLocalSnapshot(session,null,false);
      active=await fetchActiveMeta(session.access_token,session.user.id);
      if(!active)throw Error('Missing initial server confirmation');
    }
    const count=await syncRecordChanges(session,active,manual);
    if(navigator.onLine!==false)recoverPendingFx();
    result=count+' changed record(s); central baseline '+active.revision;
    if($('appTitle'))updateAppHeader();
    await render();
    for(const [id,draw] of [['tripsView',renderTrips],['rosterView',renderRoster],['flightsView',renderEntriesSafe],['settingsView',renderSettings],['expiryView',renderExpiry],['payrollView',renderPayroll]])if($(id)&&!$(id).classList.contains('hidden'))await draw();
    localStorage.setItem(SYNC_OWNER,session.user.id);
    localStorage.setItem('pilotlog7_last_cloud_sync',new Date().toISOString());
    localStorage.removeItem('pilotlog7_sync_failure_16');localStorage.removeItem(SYNC_BLOCK);return true;
  }catch(error){
    errorText=error.message||String(error);localStorage.setItem('pilotlog7_sync_failure_16',errorText);
    const temporary=error.code==='57014'&&/statement timeout/i.test(errorText)||[408,429,502,503,504].includes(error.status)||/network request failed|request timed out|failed to fetch|canceling statement due to statement timeout/i.test(errorText);
    retry=temporary;
    if(!retry&&!error.recordConflict&&!(error.status===409&&/Conflict:/.test(errorText)))localStorage.setItem(SYNC_BLOCK,errorText);
    if(manual&&!error.recordConflict)alert('Sync failed — Local data protected. '+errorText);
    return false;
  }finally{
    cloudSyncInProgress=false;if(btn)btn.disabled=false;
    logSync(start,reason,result,errorText);drawSyncState();
    armPeriodicSync();
  }
}

function deleteIndexedDb(name){return new Promise(resolve=>{try{const r=indexedDB.deleteDatabase(name);r.onsuccess=()=>resolve(true);r.onerror=()=>resolve(false);r.onblocked=()=>resolve(false)}catch{resolve(false)}})}
async function wipeCurrentUserCloud(session){
  if(!session?.access_token||!session?.user?.id)throw new Error('Sign in first so PilotLog can identify which cloud data to erase.');
  await cloudFetch(`/rest/v1/${SUPABASE_TABLE}?user_id=eq.${encodeURIComponent(session.user.id)}`,{method:'DELETE',token:session.access_token,timeoutMs:60000,retries:2,headers:{Prefer:'return=minimal'}});
}
async function clearPilotLogLocalStorage(){
  try{await flushFlightStore()}catch{}
  if(window.PilotLogNative?.isNative)await window.PilotLogNative.clearDatabase();
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
// Only the current disclosure owns detail DOM. Editors keep their original nodes and handlers.
let selectedSummary=null, detailPanel=null, flightOwner='', addTrigger=null;
let tripRowsForView=new Map(), tripEntryLookup=null, tripChargeLabels=new Map();

function closeDetail(){
  selectedSummary?.setAttribute('aria-expanded','false');
  detailPanel?.remove();
  selectedSummary=null;
  detailPanel=null;
}
function closeFlightPanel(){
  if(formUserEdited)saveEntryDraft();
  $('addView').classList.add('hidden');
  if(flightOwner)document.querySelector('main').insertBefore($('addView'),$('flightsView'));
  addTrigger?.setAttribute('aria-expanded','false');
  addTrigger=null;
  flightOwner='';
  pendingActivityType='';
}
function placeFlightPanel(owner){
  const section=$(owner);
  if(!section)return;
  flightOwner=owner;
  closeDetail();
  if(owner==='flightsView')section.querySelector('.view-toolbar').after($('addView'));
  else section.append($('addView'));
  $('addView').classList.remove('hidden');
  $('addView').scrollIntoView({block:'nearest'});
}
function toggleAddFlight(button,owner,date){
  const wasOpen=button===addTrigger&&!$('addView').classList.contains('hidden');
  closeFlightPanel();
  closeDetail();
  if(wasOpen)return;
  setEntryReturnContext(owner);
  addTrigger=button;
  button.setAttribute('aria-expanded','true');
  placeFlightPanel(owner);
  $('date').value=date||today();
  $('entryTitle').textContent='Add Flight / Activity';
  $('flightForm').classList.add('hidden');
  $('completeEntryScreenshotWrap').classList.add('hidden');
  $('activityTypePicker').classList.remove('hidden');
}
function detailButton(action,id,label,style='secondary'){
  return `<button type="button" class="${style}" data-${action}="${esc(id)}">${label}</button>`;
}
function activityDetails(row,kind,id){
  const fields=[
    ['Activity',row.dutyType],['Status',row.locked?'Locked':''],['Instruction',row.instruction?'Yes':row.simInstructor?'Instructor':row.simExaminer?'Examiner':''],['Date',displayDate(row.date)],['Flight',row.flightNo],
    ['From',row.dep],['To',row.arr],['Registration',row.reg],['Type',row.type],
    ['Scheduled OUT',row.schedOut],['Scheduled IN',row.schedIn],['OUT',row.out],['OFF',row.off],
    ['ON',row.on],['IN',row.in],['Duty On',row.onDuty],['Duty Off',row.offDuty],
    ['Training',row.courseType],['Captain',row.picName],['First officer',row.sicName],
    ['Safety officer',row.soName],['Instructor',row.instructorName],['Examiner',row.examinerName],
    ['Purser',row.purserName],['Cabin crew 1',row.attendant1Name],['Cabin crew 2',row.attendant2Name],
    ['Cabin crew 3',row.attendant3Name],['Role',row.role],['Approach',row.approachType],
    ...TIME_GROUP_DEFS.filter(({key})=>entryHasTimeValue(row,key)&&numericTime(row[key])>0).map(({key,label})=>[label,fmt(numericTime(row[key]))]),
    ['Day takeoffs',row.dayTakeoffs],['Night takeoffs',row.nightTakeoffs],['Day landings',row.dayLandings],
    ['Night landings',row.nightLandings],['Go-arounds',row.goArounds],['Passengers',row.pax],
    ['Fuel aboard',row.fuelAboard],['Fuel burned',row.fuelBurned],['Minimum fuel',row.fuelMinimum],['Remarks',row.remarks]
  ];
  return fields.filter(([,value])=>value).map(([label,value])=>`<div class="stat-row"><span>${label}</span><b>${esc(value)}</b></div>`).join('')+
    '<div class="list-actions">'+detailButton(kind,id,row.locked?'View / edit':'Edit')+
    (kind==='edit-flight'&&!row.locked?detailButton('delete-flight',id,'Delete','danger'):'')+'</div>';
}
function toggleSummary(button){
  const same=button===selectedSummary;
  closeDetail();
  if(flightOwner)closeFlightPanel();
  $('tripFormWrap').classList.add('hidden');
  $('addTripButton').setAttribute('aria-expanded','false');
  $('expiryEditorWrap').classList.add('hidden');
  if(same)return;
  const {detailKind:kind,detailId:id}=button.dataset;
  let html;
  if(kind==='trip'){
    const trip=tripRowsForView.get(id);
    if(!trip)return;
    html=tripInspectorHtml(trip)+'<div class="list-actions">'+detailButton('edit-trip',id,'Edit')+detailButton('delete-trip',id,'Delete','danger')+'</div>';
  }else if(kind==='expiry'){
    const item=load(EXPIRY_KEY).find(x=>x.id===id);
    if(!item)return;
    html=expiryRowHtml(item);
  }else{
    const item=activityById(id);
    if(!item)return;
    html=activityDetails(item,kind,id);
  }
  selectedSummary=button;
  button.setAttribute('aria-expanded','true');
  detailPanel=document.createElement('div');
  detailPanel.className='record-detail';
  detailPanel.innerHTML=html;
  button.after(detailPanel);
}
function summaryAttrs(kind,id){
  return `data-detail-kind="${kind}" data-detail-id="${esc(id)}" aria-expanded="false" role="button" tabindex="0"`;
}

const viewVersions=new Map();
function viewVersion(){return [localRevision(),operationalDatabase?.updatedAt,today()].join('/')}
function show(id,options={}){
  if(id==='addView'&&(entryReturnContext?.view||flightOwner)){
    placeFlightPanel(entryReturnContext?.view||flightOwner);
    return;
  }
  closeDetail();
  if(flightOwner)closeFlightPanel();
  $('tripFormWrap').classList.add('hidden');
  $('addTripButton').setAttribute('aria-expanded','false');
  $('expiryEditorWrap').classList.add('hidden');

  if(!$('addView').classList.contains('hidden')&&id!=='addView'&&formUserEdited)saveEntryDraft();

  const dashboardMode=id==='dashboardView';
  document.querySelectorAll('main>section').forEach(s=>{
    const visible=s.id===id||(dashboardMode&&s.id==='totalsView');
    s.classList.toggle('hidden',!visible);
  });

  document.querySelectorAll('.nav button').forEach(b=>
    b.classList.toggle('active',b.dataset.view===id)
  );
  if(id!=='flightsView')cancelLogbookAutoLoad();

  const fresh=viewVersions.get(id)===viewVersion();
  viewVersions.set(id,viewVersion());
  if(id==='dashboardView'&&!fresh)renderTotals();
  if(id==='totalsView'&&!fresh)renderTotals();
  if(id==='tripsView'&&!fresh)renderTrips();
  if(id==='payrollView'&&!fresh)renderPayroll(true);
  if(id==='expiryView'&&!fresh)renderExpiry();
  if(id==='settingsView'&&!fresh)renderSettings();

  if(id==='flightsView'){
    if(options.logbookEntryId&&!document.querySelector('[data-logbook-entry-id="'+CSS.escape(String(options.logbookEntryId))+'"]')){
      const ordered=entryActivityRows().filter(isCompletedLogbookEntry).filter(f=>logbookMatchesQuery(f,logbookSearchQuery)).sort(compareLogbookEntries);
      const idx=ordered.findIndex(f=>f.id===options.logbookEntryId);if(idx>=0)logbookRenderLimit=Math.max(logbookRenderLimit,idx+1);
    }
    const anchor=options.logbookEntryId&&document.querySelector('[data-logbook-entry-id="'+CSS.escape(String(options.logbookEntryId))+'"]');
    if(!fresh||(options.logbookEntryId&&!anchor))renderEntriesSafe();
    if(options.logbookEntryId)scrollLogbookToEntry(options.logbookEntryId);
    else scrollEntriesToNextDuty();
    return;
  }

  if(id==='rosterView'){
    Promise.resolve(fresh?undefined:renderRoster()).then(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));
    return;
  }

  scrollTo({top:0,left:0,behavior:'smooth'});
}
// The original ISO month input remains the value consumed by existing handlers.
function displayMonthPicker(input){
  if(!input)return;
  let picker=input.nextElementSibling;
  if(!picker?.classList.contains('month-picker')){
    picker=document.createElement('details');
    picker.className='month-picker';
    picker.innerHTML='<summary></summary><div class="month-options"><label>Year<input type="number" min="1" max="9999"></label><div class="month-grid"></div></div>';
    const months=Array.from({length:12},(_,i)=>new Intl.DateTimeFormat('en-GB',{month:'long'}).format(new Date(2000,i,1)));
    picker.querySelector('.month-grid').innerHTML=months.map((name,i)=>`<button type="button" data-month="${String(i+1).padStart(2,'0')}">${name}</button>`).join('');
    picker.addEventListener('click',event=>{
      const month=event.target.closest('[data-month]');
      if(!month)return;
      const year=picker.querySelector('input');
      if(!year.value||!year.reportValidity())return;
      input.value=year.value.padStart(4,'0')+'-'+month.dataset.month;
      picker.open=false;
      displayMonthPicker(input);
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    input.after(picker);
    input.hidden=true;
  }
  const value=input.value||monthNow();
  const label=input.value?monthLabel(value):'Select month and year';
  picker.querySelector('summary').textContent=label;
  picker.querySelector('summary').setAttribute('aria-label',(input.getAttribute('aria-label')||'Payslip month')+' · '+label);
  picker.querySelector('input').value=value.slice(0,4);
}

function monthLabel(date){
  if(!date)return'';
  const d=new Date(`${String(date).slice(0,7)}-01T00:00:00Z`);
  try{return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}
  catch{return String(date).slice(0,7)}
}
function timeGroupAppliesToEntry(key,entry){
  if(isFlight(entry))return ['totalFlightTime','multiPilot','pic','picUS','sic','ifrTime','airTime','night','picNight','dualGiven','dualReceived','credit','totalDuty'].includes(key);
  if(isSim(entry))return ['simulatorTime','sfiSfe','credit','totalDuty'].includes(key);
  if(isGround(entry))return ['groundInstruction','credit','totalDuty'].includes(key);
  if(isStby(entry))return ['stbyTime','credit','totalDuty'].includes(key);
  if(isPositioning(entry))return ['credit','totalDuty'].includes(key);
  return false;
}
function entryTimeGroupCardHtml(entry,context=null){
  const settings=timeGroupSettings(),rows=TIME_GROUP_DEFS.filter(({key})=>settings[key].showCard===true&&timeGroupAppliesToEntry(key,entry));
  return rows.map(({key,label},i)=>`${i?'':'<b>'}${esc(label)} ${fmt(timeGroupFinalValue(entry,key,context))}${i?'':'</b>'}`).join('<br>');
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

    const d='';
    const startInfo=isGround(f)&&f.onDuty?`<div class="small">Start ${esc(f.onDuty)} Z</div>`:'';

    const openAttrs=full?` ${summaryAttrs('edit-flight',f.id)} aria-label="Open logbook entry ${esc(displayDate(f.date))} ${esc(f.flightNo||'')}"`:'';
    if(full){
      const flight=isFlight(f);
      const route=flight?[[f.dep,f.out].filter(Boolean).join(' '),[f.arr,f.in].filter(Boolean).join(' ')].join(' → '):[f.dep||f.location,f.dutyType||'Simulator'].filter(Boolean).join(' · ');
      const title=[route,f.flightNo,displayDate(f.date)].filter(Boolean).map(esc).join(' · ');
      const shownOnCard=new Set(TIME_GROUP_DEFS.filter(({key})=>timeGroupSettings()[key].showCard===true&&timeGroupAppliesToEntry(key,f)).map(({key})=>key));
      const times=flight?[['Block','block'],['Total Flight Time','totalFlightTime'],['Credit','credit']].filter(([,key])=>entryHasTimeValue(f,key)&&!shownOnCard.has(key)).map(([label,key])=>label+' '+fmt(numericTime(f[key]))):[];
      const session=isSim(f)&& (f.onDuty||f.offDuty)?`Session ${f.onDuty||'—'} – ${f.offDuty||'—'} Z`:'';
      const info=[f.reg,session,...times].filter(Boolean).map(esc).join(' · ');
      const status=(f.activityStatus==='DRAFT'?'<span class="pill">DRAFT</span>':'')+(f.callFromDayOff?'<span class="pill warning">Day OFF call</span>':'');
      html+=`<div class="flight logbook-entry-clickable${f.locked?' logbook-entry-locked':''}" data-logbook-entry-id="${esc(f.id)}"${openAttrs}><div><div class="route">${title}</div>${info?'<div class="small">'+info+'</div>':''}${status}</div><div class="meta">${entryTimeGroupCardHtml(f,creditContext?.get(String(f.date||''))||null)}</div></div>`;
      return;
    }
    const rolePill=f.instruction?'<span class="pill green">INSTRUCTION</span>':f.simInstructor?'<span class="pill green">INSTRUCTOR</span>':f.simExaminer?'<span class="pill green">EXAMINER</span>':'';
    html+=`<div class="flight${full?' logbook-entry-clickable':''}${f.locked?' logbook-entry-locked':''}" data-logbook-entry-id="${esc(f.id)}"${openAttrs}><div><div class="route">${esc(isSim(f)?(f.dep||'Simulator'):(f.dep||f.dutyType||'Entry'))}${!isSim(f)&&f.arr?` → ${esc(f.arr)}`:''}</div>${isFlight(f)?`<div class="small logbook-actuals"><span>Aircraft Registration: ${esc(f.reg||'—')}</span><span>Actual OUT: ${esc(f.out||'—')}${f.out?' Z':''}</span><span>Actual IN: ${esc(f.in||'—')}${f.in?' Z':''}</span></div>`:''}<div class="small">${esc(displayDate(f.date))} ${esc(f.flightNo||'')}</div>${startInfo}${f.locked?'<span class="pill green">LOCKED</span>':''}${f.activityStatus==='DRAFT'?'<span class="pill">DRAFT</span>':''}${rolePill}${f.callFromDayOff?'<span class="pill warning">Day OFF call</span>':''}${d}</div><div class="meta">${entryTimeGroupCardHtml(f,creditContext?.get(String(f.date||''))||null)}</div></div>`;
  });

  if(full&&!nextAnchorAdded)html+='<div id="entriesNextDutyAnchor" class="entries-next-duty-anchor" aria-hidden="true"></div>';
  return html;
}

function isoDateLocal(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function calculateDashboardDutyRows(startOffset,count){return statisticsProjection.calculateDashboardDutyRows(startOffset,count)}
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
let logbookSearchQuery='',logbookRenderLimit=400,logbookAutoLoadObserver=null,logbookAutoLoadGeneration=0;
const LOGBOOK_RENDER_STEP=400;
function cancelLogbookAutoLoad(){
  logbookAutoLoadGeneration++;
  if(logbookAutoLoadObserver){logbookAutoLoadObserver.disconnect();logbookAutoLoadObserver=null}
}
function observeLogbookAutoLoad(remaining){
  const generation=++logbookAutoLoadGeneration;
  if(logbookAutoLoadObserver){logbookAutoLoadObserver.disconnect();logbookAutoLoadObserver=null}
  const sentinel=$('logbookAutoLoadSentinel');
  if(!remaining||!sentinel||!('IntersectionObserver' in window))return;
  logbookAutoLoadObserver=new IntersectionObserver(entries=>{
    if(generation!==logbookAutoLoadGeneration)return;
    if(!entries.some(entry=>entry.isIntersecting))return;
    logbookAutoLoadObserver.disconnect();logbookAutoLoadObserver=null;
    setTimeout(()=>{
      if(generation!==logbookAutoLoadGeneration||$('flightsView').classList.contains('hidden'))return;
      logbookRenderLimit+=LOGBOOK_RENDER_STEP;renderEntriesSafe();
    },0);
  },{root:null,rootMargin:'0px 0px 800px 0px',threshold:0});
  logbookAutoLoadObserver.observe(sentinel);
}
const {logbookMatchesQuery}=createLogbookSearch({upper,getAirportIndex:()=>airportIndex});
function entriesByDate(rows){
  const map=new Map();
  for(const f of (rows||[])){
    const key=String(f?.date||'');
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(f);
  }
  return map;
}
function calculateLogbookStats(rows,total){return statisticsProjection.calculateLogbookStats(rows,total)}
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
  if(selectedSummary?.dataset.detailKind==='edit-flight')closeDetail();
  try{
    const all=displayActivityRows().filter(isCompletedLogbookEntry),creditContext=entriesByDate(all);
    const fs=all.filter(f=>logbookMatchesQuery(f,logbookSearchQuery)).sort(compareLogbookEntries);
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
  // SAFETY INVARIANT: never alter existing records automatically during startup/version migration.
  localStorage.setItem('pilotlog7_dedupe_semantic_v1','1');
  return 0;
}

let rosterCalendarMonth=monthNow(),rosterSelectedDate=today(),suppressRosterCalendarClickUntil=0;

async function render(){
  refreshEntrySuggestions();
  try{
    if($('dashboardTodayDuty'))$('dashboardTodayDuty').innerHTML=dashboardDutyRows(0,1);
    if($('dashboardNextDuties'))$('dashboardNextDuties').innerHTML=dashboardDutyRows(1,6);
  }catch(e){
    console.error('Dashboard 7-day view failed',e);
    if($('dashboardTodayDuty'))$('dashboardTodayDuty').innerHTML='<div class="empty">Today duty temporarily unavailable.</div>';
    if($('dashboardNextDuties'))$('dashboardNextDuties').innerHTML='<div class="empty">Next duties temporarily unavailable.</div>';
  }
  // FTL uses optional airport data; keep its lookup from blocking roster startup.
  renderFtl('dashboardFtl',true).catch(e=>console.error('FTL totals view failed',e));
}

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
function rosterGroupsByDate(groups){
  const by=new Map();
  for(const group of groups||[]){
    const list=by.get(group.date);
    if(list)list.push(group);else by.set(group.date,[group]);
  }
  for(const list of by.values())list.sort((a,b)=>String(a.sortTime||a.start||'99:99').localeCompare(String(b.sortTime||b.start||'99:99')));
  return by;
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
      for(const r of g.items||[])events.push({type:'flight',locked:!!r.locked,label:[upper(r.dep||''),upper(r.arr||'')].filter(Boolean).join('-')||rosterFlightLabel(r.flightNo||'FLIGHT')});
      continue;
    }
    const type=canonicalDutyType(g.activityType||'Duty','Duty'),u=upper(type),label=u==='DAY OFF'?'OFF':u==='SIMULATOR'?'SIM':u==='GROUND COURSE'?'GROUND':u;
    events.push({type:rosterCalendarEventType(g),label});
  }
  return events;
}
function rosterCalendarCells(month,groupsByDate,todayKey){
  return rosterCalendarDates(month).map(date=>{
    const dayGroups=groupsByDate.get(date)||[],events=rosterCalendarEvents(dayGroups),outside=date.slice(0,7)!==month,selected=date===rosterSelectedDate,isToday=date===todayKey,visible=events.slice(0,2),extra=Math.max(0,events.length-visible.length);
    return`<button type="button" class="roster-calendar-day${outside?' outside':''}${selected?' selected':''}${isToday?' today':''}${events.length?' has-events':''}" data-roster-date="${date}" aria-pressed="${selected?'true':'false'}"><span class="roster-day-number">${Number(date.slice(8,10))}</span><span class="roster-day-events">${visible.map(ev=>`<span class="roster-event roster-event-${ev.type}${ev.locked?' roster-event-locked':''}">${esc(ev.label)}</span>`).join('')}${extra?`<span class="roster-event-more">+${extra}</span>`:''}</span></button>`;
  }).join('');
}

function rosterMonthLabel(date){
  if(!date)return'';
  const d=new Date(`${String(date).slice(0,7)}-01T00:00:00Z`);
  try{return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}
  catch{return String(date).slice(0,7)}
}
function rosterMonthDutyMins(groups,rows){
  return (rows||[]).reduce((sum,row)=>sum+timeGroupFinalValue(row,'totalDuty',rows||[]),0);
}
function rosterMonthScheduledBlockMins(rows){
  return sum((rows||[]).filter(isFlight),entryScheduleTotalMins);
}
function rosterMonthActualBlockMins(rows){
  return sum((rows||[]).filter(isFlight),entryBlockMins);
}
let rosterRenderRevision=0,rosterStartupSplash=true;
function dismissRosterSplash(){if(!rosterStartupSplash)return;rosterStartupSplash=false;$('nexaBoot')?.remove()}
async function renderRoster(){
  const revision=++rosterRenderRevision;
  const box=$('rosterList');if(!box){dismissRosterSplash();return}
  cleanupRosterDuplicates();
  if($('aerolineImportStatus'))$('aerolineImportStatus').textContent=aerolineImportStatusText();
  
  const todayKey=isoDateLocal(new Date()),rows=displayActivityRows(),groups=rosterGroups(rows),groupsByDate=rosterGroupsByDate(groups),month=rosterCalendarMonth||monthNow();
  const panelMonths=[rosterShiftMonth(month,-1),month,rosterShiftMonth(month,1)],calendarPanels=panelMonths.map((panelMonth,i)=>`<div class="roster-calendar-panel${i===1?' current':''}" data-roster-panel-month="${panelMonth}"><div class="roster-calendar-grid">${rosterCalendarCells(panelMonth,groupsByDate,todayKey)}</div></div>`).join('');
  const monthRows=rows.filter(f=>String(f.date||'').slice(0,7)===month&&canonicalDutyType(f.dutyType||'')!=='Day OFF'),monthGroups=groups.filter(g=>String(g.date||'').slice(0,7)===month),monthSchedule=rosterMonthScheduledBlockMins(monthRows),monthActual=rosterMonthActualBlockMins(monthRows),monthDuty=rosterMonthDutyMins(monthGroups,monthRows),monthCredit=sum(monthRows,f=>creditMinsForEntry(f,monthRows));
  const selectedDate=rosterSelectedDate,selectedGroups=selectedDate?(groupsByDate.get(selectedDate)||[]):[];
  box.innerHTML=`
    <div class="roster-calendar-shell">
      <div class="roster-month-row"><label class="sr-only" for="rosterMonthSelect">Roster month</label><input id="rosterMonthSelect" type="month" value="${month}"><button type="button" class="secondary" data-roster-today>Today</button></div>
      <div class="roster-weekdays">${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="roster-calendar-viewport" data-roster-calendar-swipe><div class="roster-calendar-track">${calendarPanels}</div></div>
      <div class="roster-month-totals"><div><span>SCHEDULED BLOCK HOURS</span><b>${fmt(monthSchedule)}</b></div><div><span>ACTUAL BLOCK HOURS</span><b>${fmt(monthActual)}</b></div><div><span>TOT DUTY</span><b>${fmt(monthDuty)}</b></div><div><span>TOT CREDIT</span><b>${fmt(monthCredit)}</b></div></div>
    </div>
    <div id="rosterRestDetails"></div>
    <div class="roster-agenda" id="rosterAgenda">
      <div class="roster-agenda-title">${rosterSelectedDate?`<button type="button" class="secondary" aria-expanded="false" data-add-roster-entry="${esc(rosterSelectedDate)}">+ Add Flight</button>`:'Roster details'}<button type="button" class="secondary" data-roster-shot>📷 entry</button></div>
      <div class="roster-agenda-list" id="rosterAgendaDetails">Loading…</div>
    </div>`;
  displayMonthPicker($('rosterMonthSelect'));
  dismissRosterSplash();
  await Promise.allSettled([
    (async()=>{try{const html=selectedDate?await rosterGroupHtml(selectedGroups,true):'<div class="empty">Select a day to view its roster details.</div>';if(revision===rosterRenderRevision)$('rosterAgendaDetails').innerHTML=html}catch(error){console.error('Roster agenda failed',error);if(revision===rosterRenderRevision)$('rosterAgendaDetails').textContent='Unable to load details for this day.'}})(),
    (async()=>{try{const html=await weeklyRestRosterHtml(displayActivityRows(),selectedDate);if(revision===rosterRenderRevision)$('rosterRestDetails').innerHTML=html}catch(error){console.error('Roster rest details failed',error);if(revision===rosterRenderRevision)$('rosterRestDetails').textContent='Rest details unavailable.'}})()
  ]);
}

// User-configured MAC rest check. Read-only Core projection; no duty values inferred.
const weeklyRest=createWeeklyRest({canonicalDutyType,entryChrono,isFlight,isPositioning,upper});
function weeklyRestProjection(windows,asOf,ongoingRestConfirmed=false){return weeklyRest.weeklyRestProjection(windows,asOf,ongoingRestConfirmed)}
function weeklyDutyWindows(rows,asOf,zones){return weeklyRest.weeklyDutyWindows(rows,asOf,zones)}
async function weeklyRestRosterHtml(rows,selectedDate){
  const now=Date.now(),todayUtc=new Date(now).toISOString().slice(0,10),asOf=selectedDate&&selectedDate!==todayUtc?Date.parse(selectedDate+'T23:59:59Z'):now;
  // Roster navigation must not wait for the optional online airport database.
  // Use the built-in/cached index now; ensureAirportDb is already refreshed in the background.
  if(!airportDbLoaded)ensureAirportDb(false).catch(()=>{});
  const zones=new Map(Object.entries(airportIndex||{}).filter(([,a])=>a?.tz).map(([code,a])=>[code,a.tz]));
  const windows=weeklyDutyWindows(rows,asOf,zones);
  const ongoingRestConfirmed=true; // Rest follows recorded duty intervals, independent of day labels.
  const result=PilotLogEngine.weeklyRest(windows,asOf,ongoingRestConfirmed);
  const utc=ms=>new Date(ms).toISOString().slice(0,16).replace('T',' ')+' Z';
  const label=result.status==='unknown'?'Not verifiable':result.status==='overdue'?`OVERDUE by ${fmt(Math.floor(-result.remaining/60000))}`:`${fmt(Math.floor(result.remaining/60000))} remaining`;
  return `<section class="weekly-rest-card ${result.status}" aria-label="Weekly rest"><b>Weekly rest · 168h</b><div>${esc(label)}</div>${Number.isFinite(result.reset)?`<div class="small">${utc(result.reset)}</div>`:''}</section>`;
}

let entryReturnContext=null;
async function addRosterOff(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  const rows=coreActivityRows().filter(f=>f.date===date);
  const existing=rows.find(f=>canonicalDutyType(f.dutyType)==='Day OFF');
  if(existing){openRosterDutyModule(existing.id);return}
  if(rows.length&&!confirm(`There are already activities on ${displayDate(date)}. Add an OFF without changing those activities?`))return;
  const row=upsertCoreActivity(stamp({id:makeActivityId(),date,dutyType:'Day OFF',recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.COMPLETED,source:'manual',manualOverride:true,locked:false,remarks:'',completedAt:new Date().toISOString()}));
  markCloudEdited('activities',row,'create');await persistCoreActivities();
  await renderRoster();scheduleAutoSync('roster-add-off');
}
let entryRosterActivityContext=null;
let dutyRosterContext=null;
function setEntryReturnContext(view,entryId=''){
  entryReturnContext=view?{view,entryId}:null;
  const b=$('entryBackBtn');if(!b)return;
  b.classList.toggle('hidden',!entryReturnContext||view==='rosterView');
  if(entryReturnContext)b.textContent=view==='flightsView'?'← Back to Logbook':'← Back to Roster';
}
function clearEntryRosterActivityContext(){
  entryRosterActivityContext=null;
  if($('dutyTypeFlight'))$('dutyTypeFlight').disabled=false;
  if($('lockEntryBtn'))$('lockEntryBtn').classList.remove('hidden');
  if($('entryRosterDeleteBtn'))$('entryRosterDeleteBtn').classList.add('hidden');
  if($('returnFlight'))$('returnFlight').classList.remove('hidden');
  if($('clearForm'))$('clearForm').classList.remove('hidden');
}
function setRosterActivityEditorUI(type){
  if($('returnFlight'))$('returnFlight').classList.add('hidden');
  if($('clearForm'))$('clearForm').classList.add('hidden');
  if($('entryLockStatus')){
    $('entryLockStatus').textContent=`Roster ${type||'activity'} • editable directly from Roster.`;
    $('entryLockStatus').classList.remove('success');
  }
}
function openRosterEntryModule(id){
  const item=coreActivityRows().find(x=>x.id===id);if(!item)return false;
  const rule=activityRule(item);if(rule.editor!=='entry')return false;
  loadEntryToForm(item,{rosterActivity:true});setEntryReturnContext('rosterView',item.id);show('addView');return true;
}
function resetDutyEditor(){dutyRosterContext=null;}
function dutyEditorType(type){return canonicalDutyType(type||'Duty','Duty')}
function openRosterDutyModule(id){
  const item=coreActivityRows().find(x=>x.id===id);if(!item)return false;
  loadEntryToForm(item,{rosterActivity:true});setEntryReturnContext('rosterView',item.id);show('addView');return true;
}
async function deleteRosterDutyActivities(ids,options={}){
  const wanted=[...new Set((ids||[]).map(x=>String(x||'').trim()).filter(Boolean))];if(!wanted.length)return false;
  const idSet=new Set(wanted),targets=coreActivityRows().filter(x=>idSet.has(String(x.id||'')));if(!targets.length)return false;
  if(targets.some(x=>x.locked)){alert('Unlock the duty before deleting it.');return false}
  const completed=targets.filter(isCompletedLogbookEntry),flightCount=targets.filter(isFlight).length;
  const label=options.label||((flightCount>1||targets.length>1)?'this roster duty':'this roster activity');
  const warning=completed.length
    ?`Delete ${label}?\n\nPilotLog uses ONE Core database. ${completed.length} completed ${completed.length===1?'activity is':'activities are'} already part of the Logbook. Deleting ${label} will therefore also remove the same Core record${targets.length===1?'':'s'} from Logbook, Totals, Payroll and Trips.\n\nThe deletion is recorded as a tombstone so the removed duty does not return on sync. Continue?`
    :`Delete ${label}?\n\nPilotLog uses ONE Core database. This removes the same Core ${targets.length===1?'activity':'activities'} from the Roster and from Totals, Payroll and Trips where applicable. ${targets.some(isFlight)?'Any planned flight sectors in this duty will be removed together. ':''}There is no separate Logbook copy.\n\nThe deletion is recorded as a tombstone so the removed duty does not return on sync. Continue?`;
  if(!confirm(warning))return false;
  targets.forEach(x=>markCloudDeleted('activities',x,{manual:true}));removeCoreActivities(x=>idSet.has(String(x.id||'')),{manual:true});await persistCoreActivities();reconcileAllDuties();
  clearEntryRosterActivityContext();setEntryReturnContext(null);await render();await renderRoster();renderDuty();renderTrips();renderPayroll();show('rosterView');scheduleAutoSync('roster-delete');return true;
}
async function deleteRosterEntryActivity(){
  const ctx=entryRosterActivityContext;if(!ctx?.id)return false;
  return deleteRosterDutyActivities([ctx.id],{label:'this roster activity'});
}

async function clearImportedRosterData(){
  const activities=coreActivityRows(),removed=activities.filter(x=>x?.aerolineRosterPlanned&&!x.locked&&!Object.values(x.manualFields||{}).some(Boolean)&&!Object.values(x.timeOverrides||{}).some(Boolean)&&x.activityStatus!==ACTIVITY_STATUS.COMPLETED),removedFlights=removed.filter(isFlight).length,removedEntries=removed.filter(x=>!isFlight(x)&&!isDutyActivityRecord(x)).length,removedDuties=removed.filter(isDutyActivityRecord).length;
  removed.forEach(x=>{if(x.id)markCloudDeleted('activities',x,{includeSource:false,manual:true})});
  removeCoreActivities(x=>removed.some(r=>r.id===x.id),{manual:true});await persistCoreActivities();
  const currentSource=String($('entrySourceDisplay')?.dataset.source||'').toLowerCase();
  if(currentSource==='aeroline'||currentSource==='roster'){clearEntryDraft();resetEntry()}
  reconcileAllDuties();return{roster:removedFlights,entries:removedEntries,duties:removedDuties};
}



function renderDuty(){return true}
function aircraftIcaoType(entry){
  const raw=upper(entry?.type||entry?.aircraftType||'').replace(/A32O/g,'A320').trim(),compact=raw.replace(/[^A-Z0-9]/g,'');
  if(!raw)return'';
  if(/^(?:AIRBUS)?(?:A319|A320|A19N|A20N)/.test(compact))return'A320 Family';
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
  flying.filter(f=>isFlight(f)&&!isSim(f)&&!(/\bSIM\b|FSTD|FFS/i.test(String(f.type||'')))).forEach(f=>{const code=aircraftIcaoType(f);if(!code)return;const r=ensure(code),mins=totalFlightMins(f);r.variants.add(upper(f.type||f.aircraftType||code));r.flight+=mins;r.pic+=picMins(f);r.sic+=sicMins(f);r.instruction+=flightInstrMins(f)});
  return[...rows.values()].sort((a,b)=>b.flight-a.flight||a.code.localeCompare(b.code)).map(r=>({...r,variants:[...r.variants].filter(Boolean).sort()}));
}
const APPROACH_DISPLAY=[['CAT3','CAT III'],['ILS','CAT I'],['LOC','LOC'],['RNAV','RNAV'],['VOR','VOR'],['NDB','NDB'],['CRCL','CIRC'],['GOA','Go Around']];
function approachDisplayKey(type){
  const key=upper(type||'').trim();
  return ({'CAT III':'CAT3','CAT I':'ILS','CIRC':'CRCL','GO AROUND':'GOA','GO AROUNDS':'GOA','VISUAL':'VIS'})[key]||key;
}
function normalizedApproaches(entry){
  // Projection only: retain source records, including zero and null, untouched.
  let rows=Array.isArray(entry?.approaches)?entry.approaches.filter(a=>a?.quantity!==null&&a?.quantity!==''&&a?.quantity!==undefined&&Number.isFinite(Number(a.quantity))).map(a=>({type:approachDisplayKey(a.type),quantity:Number(a.quantity)})).filter(a=>a.type):[];
  if(!Array.isArray(entry?.approaches)&&entry?.source!=='logten'){const type=approachDisplayKey(entry?.approachType);if(type)rows=[{type,quantity:1}]}
  if(entry?.goArounds!==undefined&&entry.goArounds!==null&&entry.goArounds!==''&&Number.isFinite(Number(entry.goArounds))){rows=rows.filter(a=>a.type!=='GOA');const quantity=Number(entry.goArounds);if(quantity)rows.push({type:'GOA',quantity})}
  return rows;
}
const statisticsProjection=createStatistics({
  activityRule,isA320Entry,buildAircraftTypeBreakdown,sum,totalFlightMins,timeGroupFinalValue,
  picMins,sicMins,flightInstrMins,simInstrMins,startOfDays,dateOnly,normalizedApproaches,
  today:()=>new Date(),isoDateLocal,dutyActivityRows,rosterGroups,rosterGroupsByDate,rosterMonthAvailable,
  shiftTime,dutyEndTime,upper,appSettings,isPositioning,operationalEntriesForMonth,dayEntries,
  isLogbookEntry,isFlight,isSim,entriesByDate,creditMinsForEntry
});
const {buildTotalsProjection}=statisticsProjection;
// The UI consumes projections from this single calculation service; renderers only format its results.
const PilotLogEngine=Object.freeze({
  weeklyRest:(windows,asOf,ongoingRestConfirmed=false)=>weeklyRestProjection(windows,asOf,ongoingRestConfirmed),
  activity:(entry,context=null)=>calculateActivityMetrics(entry,context),
  credit:(entry,context=null)=>creditMinsForEntry(entry,context),
  dutySessions:(entries=null)=>buildDutySessions(entries||entryActivityRows()),
  operationalMonth:month=>operationalEntriesForMonth(month),
  operationalTrips:()=>operationalEntriesForTrips(),
  trip:(start,end,cashAmount=0,entries=null)=>calculateTripMetrics(start,end,cashAmount,entries),
  savedTrip:(trip,entries=null)=>calculateSavedTripProjection(trip,entries),
  savedTrips:(trips=null,entries=null)=>calculateSavedTripProjections(trips,entries),
  payroll:month=>calculatePayrollProjection(month),
  fdp:(localStartMins,sectors)=>fdpLimit(localStartMins,sectors),
  rollingFlight:(n,now=new Date())=>rollingFlight(n,now),
  rollingDuty:(n,now=new Date(),sessions=buildDutySessions())=>rollingDuty(n,now,sessions),
  totals:(entries,now=new Date())=>buildTotalsProjection(entries,now),
  logbookStats:(rows,total)=>calculateLogbookStats(rows,total),
  dashboard:(startOffset,count)=>calculateDashboardDutyRows(startOffset,count)
});
function annualLeaveByYear(rows,cutoff=isoDateLocal(new Date())){
  const dates=new Set((rows||[]).filter(r=>canonicalDutyType(r.dutyType)==='Annual Leave'&&!r.rosterHidden&&/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')&&r.date<cutoff).map(r=>r.date));
  const totals=new Map();
  for(const date of dates){const year=date.slice(0,4);totals.set(year,(totals.get(year)||0)+1)}
  return [...totals].sort((a,b)=>b[0].localeCompare(a[0]));
}
async function renderTotals(){
  await ensureAirportDb(false);
  const coreRows=coreActivityRows();
  // Totals include completed Core activities plus every LogTen record, regardless of LogTen locked/open state.
  const totalRows=coreRows.filter(activityIncludedInResults);
  const model=PilotLogEngine.totals(totalRows);
  const leave=annualLeaveByYear(coreRows);
  $('annualLeaveTotals').innerHTML=leave.length?leave.map(([year,days])=>`<div class="stat-row"><span>${esc(year)}</span><b>${days} ${days===1?'day':'days'}</b></div>`).join(''):'<div class="empty">0 days</div>';
  // LogTen locked/open state never excludes its approaches from Totals.
  const approachRows=coreRows.filter(f=>normalizedApproaches(f).length&&activityIncludedInResults(f));
  const approaches={};
  approachRows.forEach(f=>normalizedApproaches(f).forEach(a=>approaches[a.type]=(Number(approaches[a.type])||0)+a.quantity));
  const standardApproachTypes=['CAT3','ILS','LOC','RNAV','RNAV AR','VOR','VOR/DME','NDB','CRCL','VIS','GOA'];
  const recorded=Object.keys(approaches);
  model.approaches=approaches;
  model.approachTypes=[...standardApproachTypes.filter(x=>recorded.includes(x)),...recorded.filter(x=>!standardApproachTypes.includes(x)).sort()];
  model.approachCount=Object.values(approaches).reduce((n,v)=>n+(Number(v)||0),0);
  const settings=timeGroupSettings(),selected=TIME_GROUP_DEFS.filter(({key})=>settings[key].showTotal===true),totalBox=$('timeGroupTotals');
  if(totalBox)totalBox.innerHTML=selected.length?selected.map(({key,label})=>`<div class="stat-row"><span>${esc(label)}</span><b>${fmt(key==='totalDuty'?totalDutyMinsForRows(totalDutyRowsForTotals(coreRows)):sum(totalRows,f=>timeGroupFinalValue(f,key,totalRows)))}</b></div>`).join(''):'<div class="empty">No Time Group selected for Total.</div>';
  if(totalBox)totalBox.innerHTML+=`<div class="stat-row"><span>Total Instrument</span><b>${fmt(sum(totalRows,f=>timeGroupFinalValue(f,'totalInstrument')))}</b></div>`;
  $('fuelBurnedTotal').innerHTML=`<div class="stat-row"><span>Fuel Burned</span><b>${sum(totalRows,f=>Number(f.fuelBurned)||0).toLocaleString('en-US')} kg</b></div>`;
  $('periodTotals').innerHTML=model.periods.map(([n,v])=>`<div class="stat-row"><span>${n}</span><b>${fmt(v)}</b></div>`).join('');
  $('approachTotals').innerHTML=[
    `<div class="stat-row"><span>Day takeoffs</span><b>${model.dayTakeoffs}</b></div>`,
    `<div class="stat-row"><span>Night takeoffs</span><b>${model.nightTakeoffs}</b></div>`,
    `<div class="stat-row"><span>Day landings</span><b>${model.dayLandings}</b></div>`,
    `<div class="stat-row"><span>Night landings</span><b>${model.nightLandings}</b></div>`,
    ...APPROACH_DISPLAY.map(([key,label])=>`<div class="stat-row"><span>${label}</span><b>${model.approaches[key]??0}</b></div>`)
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
function tripInspectorHtml(t){
  const entries=tripIncludedEntries(t,[],tripEntryLookup),s=new Date(t.start),e=new Date(t.end);
  const payment=tripDisplayMoney(t);
  const rows=entries.map(f=>{
    const a=tripSequenceStart(f),b=tripSequenceEnd(f);
    const duty=numericTime(f.totalDuty);
    const charge=tripChargeLabels.get(f.id);
    return `<div class="rowitem">
      <div>
        <b>${esc(displayDate(f.date))} • ${esc(f.dutyType||'Flight')} ${esc(f.flightNo||'')}</b>
        <div class="small">${esc(f.dep||'')} ${f.arr?'→ '+esc(f.arr):''}</div>
        ${charge&&charge!=='Included in duty'?`<div class="small">${esc(charge)}</div>`:''}
      </div>
      <div class="meta">
        <b>${a?esc(a.toISOString().slice(11,16)):'--:--'}–${b?esc(b.toISOString().slice(11,16)):'--:--'} Z</b>
        ${duty>0?`<br><span class="small">Duty Time ${fmt(duty)}</span>`:''}
      </div>
    </div>`;
  }).join('');
  return (
    `<div class="stat-row"><span>Trip start</span><b>${esc(displayDateTime(s.toISOString().slice(0,16)))} Z</b></div>
     <div class="stat-row"><span>Trip end</span><b>${esc(displayDateTime(e.toISOString().slice(0,16)))} Z</b></div>
     <div class="stat-row"><span>Total trip time</span><b>${fmt(t.trip)}</b></div>
     <div class="stat-row"><span>Duty subtracted</span><b>${fmt(t.duty)}</b></div>
     <div class="stat-row"><span>Layover time</span><b>${fmt(t.layover)}</b></div>
     <div class="stat-row"><span>Layover pay</span><b>${esc(payment.allowanceText)}</b></div>
     ${payment.cashPart?`<div class="stat-row"><span>Cash received</span><b>${esc(payment.cashPart)}</b></div>`:''}
     <div class="section-title inner">Included entries</div>
     ${rows||'<div class="empty">No entries found for this trip.</div>'}`);
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
  const cur=appCurrency(),cash=Number(t.cashAmount||0),cashPart=(()=>{if(!(cash>0))return'';const base=`Cash ${money(cash)} ${upper(t.cashCurrency||'')}`;if(upper(t.cashFxTo||'')===cur&&Number(t.cashConverted)>=0&&Number(t.cashFxRate)>0)return `${base} ≈ ${moneyCurrency(t.cashConverted,cur)} • ${t.cashFxProvisional?'Provisional FX':'FX'} ${displayDate(t.cashFxDate||t.cashFxTripStartDate||'')}`;return `${base}${t.cashFxDate?` • FX frozen ${displayDate(t.cashFxDate)}`:''}`})();
  const allowance=cash>0?0:Number(t.allowance||0);
  const conversion=t.cashMonth&&cur!=='MAD'?monthRate(t.cashMonth,'MAD',cur,true):null;
  const allowanceText=cash>0?moneyCurrency(0,cur):moneyCurrency(allowance,'MAD')+(conversion?' ≈ '+moneyCurrency(allowance*conversion.rate,cur)+(conversion.provisional?' (provisional)':''):'');
  return{cashPart,allowanceText};
}
function renderTrips(){
  if(selectedSummary?.dataset.detailKind==='trip')closeDetail();
  updateCurrencyUI();
  const saved=load(TRIPS_KEY).sort((a,b)=>String(b.start).localeCompare(String(a.start))),sourceEntries=saved.length?PilotLogEngine.operationalTrips():[],ts=PilotLogEngine.savedTrips(saved,sourceEntries),sourceLookup=buildTripEntryLookup(sourceEntries);
  tripRowsForView=new Map(ts.map(t=>[t.id,t]));
  tripEntryLookup=sourceLookup;
  tripChargeLabels=new Map(sourceEntries.map(f=>[f.id,tripChargeLabel(f)]));
  $('tripList').innerHTML=ts.length?ts.map(t=>{const m=tripDisplayMoney(t);return `<div class="rowitem trip-summary" ${summaryAttrs('trip',t.id)}><div><b>${esc(tripDisplayName(t,sourceEntries,sourceLookup)||'TRIP')}</b><div class="small">${esc(displayDateTime(t.start))} → ${esc(displayDateTime(t.end))}${t.cashEligible&&!Number(t.cashAmount)?' • Positioning cash eligible':''}</div></div><div class="meta"><b>${fmt(t.layover)}</b><br><span class="small">${Number(t.cashAmount)>0?esc(Number(t.cashAmount).toLocaleString('en-US',{maximumFractionDigits:2})+' '+upper(t.cashCurrency||'')):esc(m.allowanceText)}</span></div></div>`}).join(''):'<div class="empty">No trips yet.</div>';
}
function renderReconciliationReview(){
  const box=$('reconciliationReview');if(!box)return;
  const rows=load(RECONCILIATION_REVIEW_KEY);
  if(!rows.length){box.innerHTML='No ambiguous flight links to review.';return}
  box.innerHTML=`<b>Flight links to review — ${rows.length}</b>`+rows.map(row=>`<div>${esc(displayDate(row.date))} • ${esc(row.flightNo||'Flight')} • ${esc(row.dep||'?')} → ${esc(row.arr||'?')} • ${esc(row.schedOut||'--:--')}–${esc(row.schedIn||'--:--')} Z</div>`).join('');
}
function renderTimeGroupSettings(){
  const body=$('timeGroupSettingsBody');if(!body)return;const settings=timeGroupSettings();
  body.innerHTML=TIME_GROUP_DEFS.map(({key,label})=>{const v=settings[key];return`<tr><th scope="row">${esc(label)}</th><td><input type="checkbox" data-time-setting="${key}" data-time-option="showTotal"${v.showTotal?' checked':''} aria-label="Show ${esc(label)} on Total"></td><td><input type="checkbox" data-time-setting="${key}" data-time-option="showCard"${v.showCard?' checked':''} aria-label="Show ${esc(label)} on Card"></td><td><input type="checkbox" data-time-setting="${key}" data-time-option="autoSync"${v.autoSync?' checked':''} aria-label="Auto Sync ${esc(label)}"></td></tr>`}).join('');
}
function saveTimeGroupSettingsFromForm(){
  const values=emptyTimeGroupSettings();document.querySelectorAll('[data-time-setting][data-time-option]').forEach(el=>{const key=el.dataset.timeSetting,option=el.dataset.timeOption;if(values[key]&&option in values[key])values[key][option]=!!el.checked});
  if(contentHash(values)!==contentHash(timeGroupSettings()))saveAppSettings({timeGroups:values});setEntryTypeUI();calcEntry();renderTotals();renderRoster();return values;
}
function renderSettings(){const st=appSettings();$('setHomeBase').value=st.homeBase||'CMN';$('setFlightPrefix').value=st.flightPrefix||'MAC';$('setAircraftPrefix').value=st.aircraftPrefix||'CN-NM';$('setProfileName').value=st.profileName||'';$('setProfileRole').value=st.profileRole||'Captain';$('setNightStart').value=st.nightStart||'18:00';$('setNightEnd').value=st.nightEnd||'05:00';$('setNightPremiumPct').value=st.nightPremiumPct??50;if($('setCurrency'))$('setCurrency').value=appCurrency();if($('setCurrency2'))$('setCurrency2').value=appSettings().currency2||'';if($('setPayrollRegime'))$('setPayrollRegime').value=payrollRegime();if($('setMacDependents'))$('setMacDependents').value=macDependents();$('macDependentsSetting')?.classList.toggle('hidden',payrollRegime()!=='MAC');$('autoSyncEnabled').value=autoSyncEnabled()?'yes':'no';$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||$('cloudEmail').value||'';if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();updatePrefixUI();updateAppHeader();updateProfilePhotoSettings();updateCurrencyUI();renderTimeGroupSettings();fillPaySettings();renderWeeklyBackupStatus();updateCloudStatus();renderReconciliationReview();ensureAirportDb(false)}
function setEntryLockedUI(locked){$('flightForm').querySelectorAll('input:not(#editId),select,textarea').forEach(el=>el.disabled=!!locked);$('lockEntryBtn').classList.remove('hidden');$('lockEntryBtn').disabled=false;$('lockEntryBtn').textContent=locked?'🔓 Unlock':'🔒 Lock';$('entryLockStatus').textContent=locked?'LOCKED • All entry data are protected from editing.':'Inputs autosave in Core. Lock the entry when all data are final.';$('entryLockStatus').classList.toggle('success',!!locked);if($('coreIdDisplay'))$('coreIdDisplay').textContent=$('editId').value||'';for(const id of ['entryDeleteBtn','entryRosterDeleteBtn'])if($(id))$(id).disabled=!!locked;document.querySelectorAll('[data-counter-shortcut]').forEach(b=>b.disabled=!!locked)}
async function toggleEntryLock(){
  let existing=activityById($('editId').value);if(!existing)return;
  if(existing.locked){
    if(!confirm('Unlock this entry and allow editing?'))return;
    const saved=upsertCoreActivity(stamp({...existing,locked:false}));markCloudEdited('activities',saved,'unlock');
    await persistCoreActivities();loadEntryToForm(saved,{rosterActivity:entryReturnContext?.view==='rosterView'});scheduleAutoSync('unlock-entry');return;
  }
  if(!confirm('Lock this entry? Its data will be protected from accidental editing.'))return;
  const suggested=carryCrewToRosterFlight(carryAircraftToAerolineReturn(existing));
  if(contentHash(suggested)!==contentHash(existing)&&!formUserEdited)upsertCoreActivity(stamp(suggested));
  saveEntryDraft();existing=coreActivityRows().find(x=>x.id===existing.id);
  // Locking existing records changes protection, not their operational/source values.
  const saved=existing.activityStatus===ACTIVITY_STATUS.DRAFT?persistEntry(true):upsertCoreActivity(stamp({...existing,locked:true}));
  if(!saved)return;markCloudEdited('activities',saved,'lock');await persistCoreActivities();
  loadEntryToForm(saved,{rosterActivity:entryReturnContext?.view==='rosterView'});show('addView');scheduleAutoSync('lock-entry');
}
const ENTRY_DRAFT_FIELDS=['approachCategory','variant','editId','rosterLinkId','entryDraftId','dutyTypeFlight','date','flightNo','reg','type','courseType','trainerTypeInput','dep','arr','schedOut','schedIn','onDuty','offDuty','dutyStartDate','dutyEndDate','out','off','on','in','blockDisplay','totalFlightTimeDisplay','multiPilotDisplay','picDisplay','picUSDisplay','sicDisplay','ifrTimeDisplay','airTimeDisplay','night','picNightDisplay','simulatorTimeDisplay','sfiSfeDisplay','dualGivenDisplay','dualReceivedDisplay','groundInstructionDisplay','stbyTimeDisplay','creditDisplay','totalDutyDisplay','rolePicCheck','pfCheck','instructionCheck','examinerCheck','simInstructorCheck','simExaminerCheck','rhsCheck','callFromDayOff','picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name','approachType','goArounds','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','pax','fuelAboard','fuelBurned','fuelMinimum','remarks'];
let entryDraftTimer=null;
function entryDraftPool(){return []}
function clearEntryDraft(){clearTimeout(entryDraftTimer);entryDraftTimer=null}
function clearAllEntryDrafts(){clearEntryDraft()}
function renderEntryDraftShelf(){}
let savingCoreInput=false,lastCoreInputSignature='',formUserEdited=false;
function coreFormSignature(){return JSON.stringify(ENTRY_DRAFT_FIELDS.map(id=>{const el=$(id);return el?.type==='checkbox'?!!el.checked:el?.value||''}))}
function saveEntryDraft(){
  clearTimeout(entryDraftTimer);entryDraftTimer=null;
  if(formLoading||savingCoreInput||!$('editId')?.value)return null;
  const existing=activityById($('editId').value);
  if(!existing)return existing;
  if(!formUserEdited||coreFormSignature()===lastCoreInputSignature)return existing;
  if(existing.locked){lastCoreInputSignature=coreFormSignature();formUserEdited=false;syncControlledDutyEdit();persistCoreActivities().catch(error=>console.error('Duty edit save failed',error));return coreActivityRows().find(r=>r.id===existing.id)}
  const signature=coreFormSignature();
  savingCoreInput=true;
  try{
    if(existing.activityStatus!=='DRAFT'&&!validEntryForSilentSave()){
      const forms=operationalDatabase.localForms??={};
      forms[existing.id]={input:Object.fromEntries(ENTRY_DRAFT_FIELDS.map(k=>[k,$(k)?.type==='checkbox'?$(k).checked:$(k)?.value])),time:{...formTimeOverrides},manual:{...formManualFields},sources:{...formFieldSources}};
      lastCoreInputSignature=signature;scheduleFlightPersist();return existing;
    }
    if(operationalDatabase.localForms)delete operationalDatabase.localForms[existing.id];
    const f=collectEntry();
    f.activityStatus=existing.activityStatus;f.completedAt=existing.completedAt||'';
    // Incomplete field text lives on the same activity, never in a second store.
    f.coreInput={};ENTRY_DRAFT_FIELDS.forEach(id=>{const el=$(id);if(el)f.coreInput[id]=el.type==='checkbox'?el.checked:el.value});
    const saved=upsertCoreActivity(f);rememberEquipment(saved);refreshEntrySuggestions();lastCoreInputSignature=coreFormSignature();formUserEdited=false;markCloudEdited('activities',saved,'edit');
    persistCoreActivities().catch(()=>{$('entryLockStatus').textContent='Saving failed. Keep this page open and try again.'});
    scheduleAutoSync('activity-input');return saved;
  }catch(error){$('entryLockStatus').textContent='Saving failed. Keep this page open and try again.';console.error('Core autosave failed',error);return null}finally{savingCoreInput=false}
}
function trainingCreditSetting(row){
  if(row.dutyType==='Simulator'&&userIsSimTrainer(row))return 'simCredit';
  const role=upper(row.trainerType??row.aerolineTrainerType);
  if(row.dutyType==='Ground Course'&&role!=='TNE'&&(role==='GI'||role==='SOD'||upper(row.courseType)==='SOD'))return 'groundCredit';
  return null;
}
function initialTrainingCreditSource(row){
  if(!['Simulator','Ground Course'].includes(row.dutyType)||entryHasTimeValue(row,'credit')||row.creditImported||entryManualField(row,'credit')||entryFieldIsSource(row,'credit'))return row;
  return applyNewTrainingCredit({...row,fieldSources:{...row.fieldSources,credit:'awaiting-role'}});
}
function applyNewTrainingCredit(row){
  if(row.fieldSources?.credit!=='awaiting-role'||entryManualField(row,'credit'))return row;
  const setting=trainingCreditSetting(row);
  if(!setting)return row;
  return {...row,credit:Math.round(paySettings()[setting]*60),fieldSources:{...row.fieldSources,credit:'entry-default'},timeOverrides:{...row.timeOverrides,credit:true}};
}
function beginCoreActivity(type,crewSource=null){
  const id=makeActivityId();$('editId').value=id;$('dutyTypeFlight').value=type;
  const open=null;
  const previous=open?(open.dutyControl.memberIds||[open.id]).map(id=>coreActivityRows().find(f=>f.id===id)).filter(f=>f&&isFlight(f)).at(-1):null;
  const crew=type==='Flight'?crewCarryData(crewSource||previous):null;
  const row={id,recordKind:'activity',activityStatus:'DRAFT',source:'manual',dutyType:type,date:$('date').value||today(),...(type==='Flight'?{manualDutyMode:true,type:upper(crewSource?.type||''),variant:upper(crewSource?.variant||''),rolePic:appSettings().profileRole==='Captain',role:appSettings().profileRole==='Captain'?'PIC':'SIC'}:{}),...(crew?{...crew,crewCarryApplied:true}:{})};
  const initial=initialTrainingCreditSource(row);
  if(initial.fieldSources?.credit)formFieldSources.credit=initial.fieldSources.credit;
  upsertCoreActivity(open?controlledDutyFields(initial,open,open.dutyControl):initial);
  if(open){const root=stamp({...open,dutyControl:{...open.dutyControl,memberIds:[...new Set([...(open.dutyControl.memberIds||[]),open.id,id])]}});upsertCoreActivity(root);markCloudEdited('activities',root,'duty-member');$('onDuty').value=hhmm(new Date(open.dutyControl.start))}
  if(type==='Flight'){$('offDuty').value='';$('totalDutyDisplay').value=''}
  if(crew)applyCrewToForm(crew);
  $('flightForm').classList.remove('hidden');$('activityTypePicker')?.classList.add('hidden');
  setEntryTypeUI();setEntryLockedUI(false);if(crewSource)formUserEdited=true;saveEntryDraft();return id;
}
let pendingActivityType='';
function startPendingActivity(){
  if(!pendingActivityType)return;
  const type=pendingActivityType;
  pendingActivityType='';
  beginCoreActivity(type);
}
function showActivityTypePicker(){
  if(formUserEdited)saveEntryDraft();
  resetEntry(false,true);show('addView');
  $('flightForm').classList.add('hidden');$('activityTypePicker').classList.remove('hidden');
}
function validEntryForSilentSave(){const dt=$('dutyTypeFlight').value;if(!$('date').value)return false;if((dt==='Flight'||dt==='DHD'||dt==='DHP')&&(!$('dep').value.trim()||!$('arr').value.trim()))return false;return true}
function flushCrewTyping(){
  if(entryDraftTimer===null)return;
  clearTimeout(entryDraftTimer);entryDraftTimer=null;
  saveEntryDraft();
}
function silentAutosaveExisting(event){
  if(formLoading)return;
  if(event?.type==='input'&&CREW_NAME_FIELDS.includes(event.target.id)){
    clearTimeout(entryDraftTimer);
    entryDraftTimer=setTimeout(flushCrewTyping,350);
    return;
  }
  queueMicrotask(()=>saveEntryDraft());
}
function scrollRosterAgendaIntoView(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{const agenda=$('rosterAgenda');if(agenda)window.scrollTo({top:Math.max(0,window.scrollY+agenda.getBoundingClientRect().top-window.innerHeight*.48),behavior:'smooth'})}));
}
function bindPilotLogSwipeGestures(){
  let addStart=null,calendarStart=null,expiryStart=null;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    const p=e.touches[0],stamp={x:p.clientX,y:p.clientY,at:Date.now()};
    if(!$('addView')?.classList.contains('hidden'))addStart=stamp;
    else if(!$('expiryEditorWrap')?.classList.contains('hidden'))expiryStart=stamp;
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
      if(dx>=70&&Math.abs(dx)>Math.abs(dy)*1.25&&elapsed<1200){saveEntryDraft();const ctx=entryReturnContext;setEntryReturnContext(null);if(ctx?.view==='rosterView')show('rosterView');else show('flightsView',{logbookEntryId:$('editId')?.value||''})}
      return;
    }
    if(expiryStart){
      const dx=p.clientX-expiryStart.x,dy=p.clientY-expiryStart.y,elapsed=Date.now()-expiryStart.at;expiryStart=null;
      if(dx>=70&&Math.abs(dx)>Math.abs(dy)*1.25&&elapsed<1200){
        // Form input autosaves continuously; this flushes a last keystroke before returning.
        if($('expiryEditId')?.value)saveExpiryFromForm({silent:true});
        $('expiryEditorWrap').classList.add('hidden');resetExpiryEditor();
      }
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
    expiryStart=null;
    if(!calendarStart)return;
    calendarStart.track.classList.remove('dragging');calendarStart.track.style.transform='translate3d(-100%,0,0)';calendarStart=null;
  },{passive:true});
}
function syncOffDutyFromScheduleIn(){const current=activityById($('editId')?.value)||{dutyType:$('dutyTypeFlight')?.value||'Flight',source:'manual'};if(controlledDuty(current))return;if(isManualFlight(current)){if(requiresManualDutyControl(current)){$('offDuty').value='';delete formFieldSources.offDuty}return}if(formTimeOverrides.offDuty||['aeroline','logten','calendar','screenshot','source','imported'].includes(String(formFieldSources.offDuty||'').toLowerCase()))return;const t=$('schedIn')?.value||'',positioning=isPositioning({dutyType:$('dutyTypeFlight')?.value||''});$('offDuty').value=t?(positioning?t:shiftTime(t,30)):'';formFieldSources.offDuty=t?'calculated':''}
function syncProfileNameWithRole(force=false){
  const st=appSettings(),name=upper(st.profileName||'');if(!name)return;
  const source=$('entrySourceDisplay')?.dataset.source||'manual';if(!force&&source!=='manual')return;
  if($('dutyTypeFlight')?.value!=='Flight')return;
  const target=$('rolePicCheck')?.checked?'picName':'sicName';
  ['picName','sicName'].forEach(id=>{if(id!==target&&aerolineSamePerson($(id)?.value||'',name))$(id).value=''});
  if($(target))$(target).value=name;
}
function profilePicDefault(entry){
  if(!isFlight(entry))return false;
  if(entry.rolePic===true||entry.role==='PIC')return true;
  if(entry.rolePic===false||entry.role==='SIC'||entry.locked||entryManualField(entry,'rolePic')||entryManualField(entry,'role'))return false;
  return appSettings().profileRole==='Captain';
}
function applyProfileDefaultsToEntry(){
  const st=appSettings(),name=upper(st.profileName||''),profileRole=st.profileRole||'Captain';
  if(profileRole==='Captain'){
    $('rolePicCheck').checked=true;$('role').value='PIC';
    if(name&&!$('picName').value)$('picName').value=name;
  }else if(profileRole==='First Officer'){
    $('rolePicCheck').checked=false;$('role').value='SIC';
    if(name&&!$('sicName').value)$('sicName').value=name;
  }
}
function applyAerolineFlightRoleRuleToForm(r){
  if(!r||r.source!=='aeroline')return false;
  const self=upper(appSettings().profileName||''),profileRole=appSettings().profileRole||'Captain',crew=(Array.isArray(r.aerolineCrew)?r.aerolineCrew:[]).map(upper).filter(Boolean);
  if(profileRole==='Captain'&&self){
    $('rolePicCheck').checked=true;$('role').value='PIC';$('picName').value=self;
    if(crew.length===1){$('sicName').value=crew[0];$('soName').value=''}
    else if(crew.length>1){$('sicName').value='';$('soName').value=''}
    if(aerolineSamePerson($('instructorName').value,self))$('instructorName').value='';
    if(r.aerolineLineTraining)$('instructionCheck').checked=true;
    return true;
  }
  if(profileRole==='First Officer'&&self){$('rolePicCheck').checked=false;$('role').value='SIC';$('sicName').value=self;return true}
  return false;
}
function applyRosterCarryToForm(r){
  const c=rosterCarryDefaultsForItem(r);
  if(!c)return false;
  $('reg').value=aircraftIdInput(c.reg||'');
  for(const key of ['type','variant'])if(!$(key).value&&!entryManualField(r,key))$(key).value=upper(c[key]||'');
  $('rolePicCheck').checked=(c.role||$('role').value)==='PIC';$('role').value=$('rolePicCheck').checked?'PIC':'SIC';
  applyCrewToForm(c);
  $('rhsCheck').checked=upper(c.seatPosition||'')==='RIGHT';
  $('pfCheck').checked=c.pf==='yes'||c.pf===true;
  return true;
}

function resetEntry(clearDraft=true,preview=false){
  pendingActivityType='';
  flushCrewTyping();
  formUserEdited=false;lastCoreInputSignature='';clearTimeout(entryDraftTimer);
  $('flightForm').classList.remove('hidden');$('activityTypePicker')?.classList.add('hidden');
  formLoading=true;formTimeOverrides={};formManualFields={};formFieldSources={};
  if(clearDraft)clearEntryDraft();clearEntryRosterActivityContext();
  $('approachType').dataset.loadedValue='';
  const f=$('flightForm');f.reset();$('editId').value='';$('entryDraftId').value=makeId();if($('rosterLinkId'))$('rosterLinkId').value='';
  if($('entrySourceDisplay'))$('entrySourceDisplay').dataset.source='manual';setEntrySourceDisplay('manual');updatePrefixUI();
  $('date').value=today();$('dutyTypeFlight').value='Flight';$('role').value='PIC';$('seatPosition').value='';$('callFromDayOff').checked=false;$('approachType').value='';$('simLocation').value='';
  ['rolePicCheck','pfCheck','instructionCheck','examinerCheck','simInstructorCheck','simExaminerCheck','rhsCheck'].forEach(id=>{if($(id))$(id).checked=false});
  ['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);TIME_GROUP_DEFS.forEach(({key})=>{const el=$(TIME_GROUP_INPUT_IDS[key]);if(el)el.value=''});$('blockDisplay').value='';
  applyProfileDefaultsToEntry();$('entryTitle').textContent='Add Duty / Activity';setEntryLockedUI(false);setEntryTypeUI();if(!preview){calcEntry();updateAirportInfo()}renderEntryDraftShelf();formLoading=false;
}
function loadEntryToForm(f,options={}){
  if(entryDraftTimer!==null){
    flushCrewTyping();
    f=activityById(f.id)||f;
  }
  f=carryAircraftToAerolineReturn(f);
  f=carryCrewToRosterFlight(f);
  resetEntry(false);formLoading=true;formTimeOverrides={...(f.timeOverrides||{})};formManualFields={...(f.manualFields||{})};formFieldSources={...(f.fieldSources||{})};const rosterActivity=!!options.rosterActivity,canonicalType=canonicalDutyType(f.dutyType||'Flight');
  $('editId').value=f.id;$('entryDraftId').value='';if($('rosterLinkId'))$('rosterLinkId').value=rosterActivity?(f.id||''):'';
  if($('entrySourceDisplay'))$('entrySourceDisplay').dataset.source=f.source||'manual';setEntrySourceDisplay(f.source||'manual');$('callFromDayOff').checked=!!f.callFromDayOff;
  $('dutyTypeFlight').value=canonicalType;$('date').value=f.date||'';$('type').value=upper(f.type||'');$('variant').value=upper(f.variant||'');if($('trainerTypeInput'))$('trainerTypeInput').value=upper(f.trainerType??f.aerolineTrainerType??'');$('dep').value=upper(isSim(f)?(f.dep||f.location||''):(f.dep||''));$('arr').value=upper(f.arr||'');$('schedOut').value=f.schedOut||'';$('schedIn').value=f.schedIn||'';$('onDuty').value=f.onDuty||'';$('offDuty').value=f.offDuty||'';$('out').value=f.out||'';$('off').value=f.off||'';$('on').value=f.on||'';$('in').value=f.in||'';$('approachType').value=f.approachType||f.approaches?.[0]?.type||'';$('approachCategory').value=f.approachCategory||f.approaches?.[0]?.category||'';$('remarks').value=f.remarks||'';$('courseType').value=f.courseType||'';
  $('flightNo').value=flightNoInput(f.flightNo||'');$('reg').value=isSim(f)?upper(f.reg||''):aircraftIdInput(f.reg||'');$('simLocation').value='';setDurationPicker($('blockDisplay'),entryHasTimeValue(f,'block')?numericTime(f.block):null);
  const loadedCrew=crewCarryData(f);CREW_NAME_FIELDS.forEach(id=>{if($(id))$(id).value=upper(loadedCrew[id]||'')});
  if($('goArounds'))$('goArounds').value=f.goArounds??'';$('pax').value=f.pax??'';$('fuelAboard').value=f.fuelAboard??'';$('fuelBurned').value=f.fuelBurned??'';$('fuelMinimum').value=f.fuelMinimum??'';
  $('rolePicCheck').checked=profilePicDefault(f);$('pfCheck').checked=f.pf===true||f.pf==='yes';$('instructionCheck').checked=f.instruction===true;$('examinerCheck').checked=f.examiner===true;$('simInstructorCheck').checked=f.simInstructor===true;$('simExaminerCheck').checked=f.simExaminer===true;$('rhsCheck').checked=f.rhs===true||upper(f.seatPosition||'')==='RIGHT';
  ['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=Number(f[id]||0));
  TIME_GROUP_DEFS.forEach(({key})=>{const el=$(TIME_GROUP_INPUT_IDS[key]);if(el)setDurationPicker(el,entryHasTimeValue(f,key)?numericTime(f[key]):null)});
  if(isSim(f)&&!entryManualField(f,'credit')&&!entryFieldIsSource(f,'credit')&&f.creditImported!==true&&!userIsSimTrainer(f))$('creditDisplay').value='';
  const duty=controlledDuty(f);if(duty){const fields=controlledDutyFields(f,duty.root,duty.control);$('onDuty').value=fields.onDuty;$('offDuty').value=fields.offDuty}
  if(f.coreInput&&f.activityStatus==='DRAFT')ENTRY_DRAFT_FIELDS.forEach(id=>{if(['editId','entryDraftId','rosterLinkId'].includes(id)||duty&&['onDuty','offDuty','totalDutyDisplay'].includes(id))return;const el=$(id);if(el&&f.coreInput[id]!==undefined){if(el.type==='checkbox')el.checked=!!f.coreInput[id];else el.value=f.coreInput[id]}});
  if(requiresManualDutyControl(f)&&!duty){$('offDuty').value='';$('totalDutyDisplay').value=''}
  const approachKey=approachDisplayKey(f.approachType||f.approaches?.[0]?.type||'');
  $('approachType').value=APPROACH_DISPLAY.some(([key])=>key===approachKey)?approachKey:'';
  $('approachType').dataset.loadedValue=$('approachType').value;
  const draft=operationalDatabase.localForms?.[f.id];
  if(draft){for(const [id,value] of Object.entries(draft.input)){const el=$(id);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value}}
    formTimeOverrides={...draft.time};formManualFields={...draft.manual};formFieldSources={...draft.sources};}
  setEntryTypeUI();calcEntry();formLoading=false;
  if(rosterActivity&&rosterCanEditLockedActivity({...f,dutyType:canonicalType})){
    entryRosterActivityContext={id:f.id,type:canonicalType,preserveLocked:!!f.locked};$('lockEntryBtn').classList.remove('hidden');$('entryRosterDeleteBtn').classList.remove('hidden');$('entryTitle').textContent=f.locked?'View locked activity':`Edit roster ${canonicalType}`;setRosterActivityEditorUI(canonicalType);setEntryLockedUI(!!f.locked);
  }else{$('entryTitle').textContent=f.locked?'View locked activity':'Edit activity';setEntryLockedUI(!!f.locked)}
  updateDutyControls();lastCoreInputSignature=coreFormSignature();updateAirportInfo();updateDelayUI();updateDutyControls();
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
  syncControlledDutyEdit();
  const c=calcEntry(),dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight'),id=$('editId').value||makeActivityId(),existing=activityById(id),delayMinutes=dutyType==='Flight'?formDelayMinutes():0;
  const sim=dutyType==='Simulator',flight=dutyType==='Flight',ground=dutyType==='Ground Course',standby=dutyType==='STBY';
  const timeValues={};TIME_GROUP_DEFS.forEach(({key})=>{const value=optionalDuration($(TIME_GROUP_INPUT_IDS[key])?.value);if(value!==null)timeValues[key]=value});
  for(const key of Object.keys(LOGTEN_TIME_COLUMNS)){
    if(existing&&Object.prototype.hasOwnProperty.call(existing,key)&&!formManualFields[key]&&!formTimeOverrides[key]&&(entryFieldSource(existing,key)==='logten'||existing.source==='logten'))timeValues[key]=existing[key];
  }
  const blockValue=optionalDuration($('blockDisplay')?.value),timeOverrides={...(existing?.timeOverrides||{}),...formTimeOverrides},manualFields={...(existing?.manualFields||{}),...formManualFields},fieldSources={...(existing?.fieldSources||{}),...formFieldSources};
  Object.keys(manualFields).forEach(k=>{if(manualFields[k]===true)fieldSources[k]='manual'});Object.keys(timeOverrides).forEach(k=>{if(timeOverrides[k]===true&&fieldSources[k]!=='entry-default')fieldSources[k]='manual'});
  if(!timeOverrides.onDuty&&$('onDuty').value)fieldSources.onDuty=existing?.fieldSources?.onDuty||(($('schedOut').value&&$('onDuty').value===shiftTime($('schedOut').value,-60))?'calculated':fieldSources.onDuty||'source');
  if(!timeOverrides.offDuty&&$('offDuty').value)fieldSources.offDuty=existing?.fieldSources?.offDuty||(($('schedIn').value&&$('offDuty').value===shiftTime($('schedIn').value,30))?'calculated':fieldSources.offDuty||'source');
  return stamp(applyDutyToEntry({
    ...existing,...timeValues,
    id,dutyType,date:$('date').value,flightNo:flight?composeFlightNo($('flightNo').value):existing?.flightNo||'',
    reg:sim?upper($('reg').value):composeAircraftId($('reg').value),type:upper($('type').value),variant:upper($('variant')?.value||''),location:flight?'':existing?.location||'',
    dep:upper($('dep').value),arr:sim?existing?.arr||'':upper($('arr').value),schedOut:$('schedOut').value,schedIn:$('schedIn').value,schedBlock:c.schedBlock,
    dutyActivityEnd:!flight&&$('offDuty').value?$('offDuty').value:existing?.dutyActivityEnd,onDuty:$('onDuty').value,offDuty:$('offDuty').value,out:flight?$('out').value:existing?.out||'',off:flight?$('off').value:existing?.off||'',on:flight?$('on').value:existing?.on||'',in:flight?$('in').value:existing?.in||'',
    block:(flight||ground||standby)&&blockValue!==null?blockValue:flight?c.block:existing?.block??null,airTime:flight?c.airTime:existing?.airTime??null,credit:optionalDuration($('creditDisplay')?.value),totalDuty:optionalDuration($('totalDutyDisplay')?.value),timeOverrides,manualFields,fieldSources,
    rolePic:flight&&!!$('rolePicCheck')?.checked,role:flight?formRoleValue(existing||{}):'',rhs:flight&&!!$('rhsCheck')?.checked,seatPosition:flight&&$('rhsCheck')?.checked?'Right':flight?'Left':'',callFromDayOff:!!$('callFromDayOff')?.checked,
    instruction:flight&&!!$('instructionCheck')?.checked,examiner:flight&&!!$('examinerCheck')?.checked,simInstructor:sim&&!!$('simInstructorCheck')?.checked,simExaminer:sim&&!!$('simExaminerCheck')?.checked,
    sim:sim?'yes':'no',ifr:'',
    dayTakeoffs:sim?0:Number($('dayTakeoffs').value||0),nightTakeoffs:sim?0:Number($('nightTakeoffs').value||0),dayLandings:sim?0:Number($('dayLandings').value||0),nightLandings:sim?0:Number($('nightLandings').value||0),
    courseType:upper($('courseType')?.value||''),trainerType:ground?upper($('trainerTypeInput')?$('trainerTypeInput').value:existing?.trainerType||existing?.aerolineTrainerType||''):(existing?.trainerType||''),aerolineTrainerType:existing?.aerolineTrainerType||'',picName:upper($('picName')?.value||''),sicName:upper($('sicName')?.value||''),soName:upper($('soName')?.value||''),instructorName:upper($('instructorName')?.value||''),examinerName:upper($('examinerName')?$('examinerName').value:existing?.examinerName||''),
    purserName:upper($('purserName')?.value||''),attendant1Name:upper($('attendant1Name')?.value||''),attendant2Name:upper($('attendant2Name')?.value||''),attendant3Name:upper($('attendant3Name')?.value||''),cabinCrew:[$('attendant1Name')?.value,$('attendant2Name')?.value,$('attendant3Name')?.value].map(upper),observerCrew:Array.isArray(existing?.observerCrew)?existing.observerCrew:[],studentName:existing?.studentName||'',
    pax:$('pax')?.value===''?null:Number($('pax').value),fuel:existing?.fuel??null,fuelAboard:$('fuelAboard')?.value===''?null:Number($('fuelAboard').value),fuelBurned:$('fuelBurned')?.value===''?null:Number($('fuelBurned').value),fuelMinimum:$('fuelMinimum')?.value===''?null:Number($('fuelMinimum').value),customNote:existing?.customNote,goArounds:$('goArounds')?($('goArounds').value===''?null:Math.max(0,Math.trunc(Number($('goArounds').value)||0))):existing?.goArounds??null,logtenCustom:existing?.logtenCustom,creditImported:existing?.creditImported===true,
    pf:flight&&$('pfCheck')?.checked?'yes':'no',approachCategory:sim?'':$('approachCategory')?.value||'',approachType:existing&&$('approachType').value===$('approachType').dataset.loadedValue?existing.approachType:upper($('approachType').value),approaches:existing&&$('approachType').value===$('approachType').dataset.loadedValue?existing.approaches:($('approachType').value?[{type:upper($('approachType').value),quantity:1}]:[]),delayMinutes,remarks:$('remarks').value.trim(),
    locked:lockedOverride===null?!!existing?.locked:!!lockedOverride,source:existing?.source||$('entrySourceDisplay')?.dataset.source||'manual',manualOverride:true,
    recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.COMPLETED,
    completedAt:existing?.completedAt||new Date().toISOString()
  }));
}
function persistEntry(lockIt=false){
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');if(!$('date').value){alert('Please enter the date.');return false}
  if((dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP')&&(!$('dep').value.trim()||!$('arr').value.trim())){alert('Please enter From and To.');return false}
  const id=$('editId').value,fs=entryActivityRows(),existing=id?fs.find(x=>x.id===id):null,rosterEdit=!!(existing&&entryRosterActivityContext?.id===existing.id&&rosterCanEditLockedActivity(existing));
  if(existing?.locked&&!lockIt&&!rosterEdit){alert('This entry is locked. Unlock it before editing.');return false}
  if(existing&&existing.activityStatus!=='DRAFT'&&!lockIt&&!formUserEdited)return existing;
  const f=collectEntry(lockIt?true:(rosterEdit?null:false)),saved=upsertCoreActivity(f);rememberEquipment(saved);$('editId').value=saved.id;markCloudEdited('activities',saved,lockIt?'lock':(existing?'edit':'create'));
  reconcileAllDuties();refreshEntrySuggestions();saveEntryDraft();scheduleAutoSync(lockIt?'lock-entry':'save-entry');return saved;
}



function distinctFlightKey(a,b){
  const identity=f=>[f.id,f.date,upper(f.flightNo),upper(f.dep),upper(f.arr)];
  return JSON.stringify([a,b].sort((x,y)=>String(x.id).localeCompare(String(y.id))).map(identity));
}
function runRosterLogbookIntegrityCheck(){
  const activities=coreActivityRows(),flights=activities.filter(isFlight),logbook=activities.filter(isCompletedLogbookEntry),ids=new Set(),duplicateIds=[],legacyFields=[],semanticDuplicates=[];
  for(const row of activities){
    if(ids.has(row.id))duplicateIds.push(row);else ids.add(row.id);
    const found=Object.values(LEGACY_ACTIVITY_FIELDS).filter(key=>Object.prototype.hasOwnProperty.call(row,key));if(found.length)legacyFields.push({row,fields:found});
  }
  const flightBuckets=new Map(),distinct=new Set(databaseValue(APP_SETTINGS_KEY,{}).distinctFlightPairs||[]);
  for(const row of flights){
    const digits=rawFlightDigits(row.flightNo),key=digits&&row.date&&row.dep&&row.arr?`${row.date}|${digits}|${upper(row.dep)}|${upper(row.arr)}`:`${row.date||''}|${upper(row.dep)}|${upper(row.arr)}`;
    const bucket=flightBuckets.get(key)||[];
    for(const candidate of bucket)if(unifiedFlightMatch(candidate,row)&&!distinct.has(distinctFlightKey(candidate,row)))semanticDuplicates.push([candidate,row]);
    bucket.push(row);flightBuckets.set(key,bucket);
  }
  const logbookIds=new Set(logbook.map(row=>row.id));
  const invalidLogbook=logbook.filter(x=>!activityIncludedInResults(x)&&x.activityStatus!=='DRAFT'),missingCompleted=flights.filter(x=>activityIncludedInResults(x)&&!logbookIds.has(x.id));
  const tripBuckets=new Map();
  for(const trip of load(TRIPS_KEY)||[]){
    if(!trip.start||!trip.end)continue;
    const key=JSON.stringify([trip.start,trip.end,upper(trip.stations||'').trim()]);
    if(!tripBuckets.has(key))tripBuckets.set(key,[]);
    tripBuckets.get(key).push(trip);
  }
  const duplicateTrips=[...tripBuckets.values()].filter(group=>group.length>1);
  const issues=duplicateTrips.length+duplicateIds.length+legacyFields.length+semanticDuplicates.length+invalidLogbook.length+missingCompleted.length;
  const result={checkedAt:new Date().toISOString(),activities:activities.length,flights:flights.length,logbook:logbook.length,duplicateTrips,duplicateIds,legacyFields,semanticDuplicates,invalidLogbook,missingCompleted};
  const status=$('integrityStatus'),out=$('integrityResults');
  if(status)status.textContent=`${activities.length} Core activities checked • ${flights.length} flight records • ${logbook.length} included Logbook records • ${issues} issue(s)`;
  if(out){
    if(!issues){out.innerHTML='<strong>PASS</strong> — Roster and Logbook are functional filters of the same Core activity records.'}
    else out.innerHTML=`<strong>REVIEW</strong> — duplicate IDs ${duplicateIds.length} • legacy view fields ${legacyFields.length} • duplicate flight records ${semanticDuplicates.length} • duplicate trip groups ${duplicateTrips.length} • invalid Logbook filters ${invalidLogbook.length+missingCompleted.length}`;
  }
  return result;
}

function showIntegrityRecord(row,trip){
  const list=$('integrityIssueList');list.replaceChildren();
  const heading=document.createElement('h4');heading.textContent=(trip?'Trip ':'Activity ')+row.id;
  const details=document.createElement('pre');details.textContent=JSON.stringify(row,null,2);
  list.append(heading,details);$('integrityDialog').showModal();
}
function reviewIntegrity(duplicatesOnly=false){
  const report=runRosterLogbookIntegrityCheck(),dialog=$('integrityDialog'),list=$('integrityIssueList');
  list.replaceChildren();
  function addGroup(title,rows,trip=false){
    if(!rows.length)return;
    const heading=document.createElement('h4');heading.textContent=title;list.append(heading);
    for(const row of rows){
      const button=document.createElement('button');
      button.type='button';button.className='secondary';
      button.textContent=trip?[row.start,row.end,row.stations].filter(Boolean).join(' · '):[row.date,row.flightNo||row.dutyType,row.dep,row.arr,row.out||row.schedOut,row.in||row.schedIn,row.reg].filter(Boolean).join(' · ');
      button.addEventListener('click',()=>{
        dialog.close();
        showIntegrityRecord(row,trip);
      });list.append(button);
    }
  }
  for(const pair of report.semanticDuplicates){
    addGroup('Possible duplicate flight',pair);
    if(pair[0].id===pair[1].id)continue;
    const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='Confirm distinct flights';
    button.onclick=()=>{
      const pairs=new Set(databaseValue(APP_SETTINGS_KEY,{}).distinctFlightPairs||[]);
      pairs.add(distinctFlightKey(...pair));saveAppSettings({distinctFlightPairs:[...pairs].sort()});
      reviewIntegrity(duplicatesOnly);
    };list.append(button);
  }
  report.duplicateTrips.forEach(group=>addGroup('Possible duplicate trip',group,true));
  addGroup('Duplicate ID',report.duplicateIds);
  if(!duplicatesOnly)addGroup('Legacy fields',report.legacyFields.map(x=>x.row));
  if(!duplicatesOnly)addGroup('Logbook inclusion',[...report.invalidLogbook,...report.missingCompleted]);
  if(!list.childElementCount)list.textContent='No issues found.';
  if(!dialog.open)dialog.showModal();
}

const CORE_105_RECOVERY_KEY='pilotlog10_5_recovery_bridge_v1';
async function repairCore105FromLegacySources(){
  if(localStorage.getItem(CORE_105_RECOVERY_KEY)==='done')return{changed:0,recovered:0,trips:0};
  let changed=0,recovered=0,tripRecovered=0;
  const current=coreActivityRows();
  const legacyEntries=[];
  try{
    const local=legacyLocalFlights();
    if(Array.isArray(local))legacyEntries.push(...local);
  }catch{}
  try{
    const idb=await readLegacyFlightStore();
    if(Array.isArray(idb))legacyEntries.push(...idb);
  }catch{}
  /* Every row in the legacy Entries store was a saved operational entry, not merely a roster plan. */
  const recoveredEntries=legacyEntries.filter(Boolean).map(raw=>{
    const r=normalizeCoreActivity({...raw,activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.COMPLETED},'entries');
    r.activityStatus=ACTIVITY_STATUS.COMPLETED;
    if(!r.completedAt)r.completedAt=r._updatedAt||new Date().toISOString();
    return r;
  });
  if(recoveredEntries.length){
    const before=JSON.stringify(normalizeCoreActivityRecords(current));
    const merged=normalizeCoreActivityRecords([...current,...recoveredEntries]);
    const after=JSON.stringify(merged);
    if(before!==after){commitCoreActivities(merged);changed++;recovered=recoveredEntries.length}
  }
  /* Repair already-migrated rows even when the legacy Entry snapshot is unavailable. */
  const repaired=coreActivityRows().map(row=>{
    const r={...row};
    if(r.activityStatus==='DRAFT')return r;
    const sourceName=String(r.source||'').toLowerCase();
    const type=rawCanonicalType(r.dutyType);
    const hasActualFlightTimes=type==='Flight'&&!!(r.out||r.off||r.on||r.in||Number(r.block)>0||Number(r.airTime)>0);
    const hasCompletedSim=type==='Simulator'&&(Number(r.simulatorTime)>0||r.out||r.in||r.onDuty||r.offDuty);
    const hasSavedNonFlight=['DHD','DHP','Ground Course','STBY'].includes(type)&&!!(r.manualOverride||r.completedAt||r.locked||r.onDuty||r.offDuty||r.dep||r.arr||r.location||r.courseType||Number(r.credit)>0||r.callFromDayOff);
    if(sourceName==='logten'){
      const wanted=r.locked?ACTIVITY_STATUS.COMPLETED:ACTIVITY_STATUS.OPEN;
      if(r.activityStatus!==wanted){r.activityStatus=wanted;changed++}
      if(!r.locked&&r.completedAt){delete r.completedAt;changed++}
      if(r.locked&&!r.completedAt)r.completedAt=r._updatedAt||new Date().toISOString();
      return r;
    }
    const savedOperational=!!r.manualOverride||!!r.completedAt||!!r.locked;
    if(r.activityStatus!==ACTIVITY_STATUS.COMPLETED&&(savedOperational||hasActualFlightTimes||hasCompletedSim||hasSavedNonFlight)){
      r.activityStatus=ACTIVITY_STATUS.COMPLETED;
      if(!r.completedAt)r.completedAt=r._updatedAt||new Date().toISOString();
      changed++;
    }
    return r;
  });
  if(changed||recovered)commitCoreActivities(repaired);
  /* Trips were stored separately in 10.0. If the new DB has none/fewer, merge the legacy values back in. */
  try{
    const legacyTrips=legacyLocalJson(TRIPS_KEY,[]),currentTrips=databaseValue(TRIPS_KEY,[]);
    if(Array.isArray(legacyTrips)&&legacyTrips.length){
      const byId=new Map((Array.isArray(currentTrips)?currentTrips:[]).filter(Boolean).map(t=>[t.id||`${t.start||''}|${t.end||''}|${t.stations||''}`,t]));
      for(const t of legacyTrips.filter(Boolean)){
        const k=t.id||`${t.start||''}|${t.end||''}|${t.stations||''}`;
        const prior=byId.get(k);
        if(!prior){byId.set(k,t);tripRecovered++}
        else byId.set(k,{...t,...prior});
      }
      if(tripRecovered){operationalDatabase.values[TRIPS_KEY]=[...byId.values()];changed++}
    }
  }catch{}
  if(changed)await persistCoreActivities();
  localStorage.setItem(CORE_105_RECOVERY_KEY,'done');
  return{changed,recovered,tripRecovered};
}


const CORE_107_SIM_CLASS_REPAIR_KEY='pilotlog10_7_sim_instruction_repair_v1';
async function repairLogTenSimulatorInstruction107(){
  localStorage.setItem(CORE_107_SIM_CLASS_REPAIR_KEY,'done');
  return{changed:0};
}



const CORE_107_SUPPLEMENTAL_REPAIR_KEY='pilotlog10_7_supplemental_repair_v1';
async function repairCore107SupplementalFromLegacy(){
  if(localStorage.getItem(CORE_107_SUPPLEMENTAL_REPAIR_KEY)==='done')return{changed:0};
  const legacy=[];
  try{const a=legacyLocalFlights();if(Array.isArray(a))legacy.push(...a)}catch{}
  try{const a=await readLegacyFlightStore();if(Array.isArray(a))legacy.push(...a)}catch{}
  if(!legacy.length){localStorage.setItem(CORE_107_SUPPLEMENTAL_REPAIR_KEY,'done');return{changed:0}}
  const supplemental=['approaches','approachType','pax','fuelAboard','fuelBurned','fuelMinimum','pic','sic','purserName','cabinCrew','observerCrew','studentName','customNote','goArounds','logtenCustom','sfiSfe','dualGiven','trainerType','aerolineTrainerType','courseType','location','delayMinutes'];
  const keyOf=r=>[String(r?.date||''),rawCanonicalType(r?.dutyType||'Flight'),rawFlightDigits(r?.flightNo||''),upper(r?.dep||''),upper(r?.arr||''),String(r?.schedOut||''),String(r?.schedIn||'')].join('|');
  const byUid=new Map(),byId=new Map(),byKey=new Map();
  for(const raw of legacy.filter(Boolean)){
    if(raw.logtenUniqueId)byUid.set(String(raw.logtenUniqueId),raw);
    if(raw.id)byId.set(String(raw.id),raw);
    const k=keyOf(raw);if(k&&!byKey.has(k))byKey.set(k,raw);
  }
  let changed=0;
  const repaired=coreActivityRows().map(row=>{
    const r={...row};
    const legacyRow=(r.logtenUniqueId&&byUid.get(String(r.logtenUniqueId)))||byId.get(String(r.id||''))||byKey.get(keyOf(r));
    if(!legacyRow)return r;
    for(const field of supplemental){
      const hasCurrent=Object.prototype.hasOwnProperty.call(r,field);
      const current=r[field],incoming=legacyRow[field];
      const incomingUseful=Array.isArray(incoming)?incoming.length>0:incoming!==undefined&&incoming!==null&&incoming!=='';
      if(!incomingUseful)continue;
      if((r.locked||entryManualField(r,field))&&hasCurrent)continue;
      const currentBlank=Array.isArray(current)?current.length===0:current===undefined||current===null||current==='';
      if(!hasCurrent||currentBlank){r[field]=incoming;changed++}
    }
    if(Array.isArray(r.approaches)&&r.approaches.length&&!r.approachType)r.approachType=upper(r.approaches[0]?.type||'');
    return r;
  });
  if(changed){commitCoreActivities(repaired);await persistCoreActivities()}
  localStorage.setItem(CORE_107_SUPPLEMENTAL_REPAIR_KEY,'done');
  return{changed};
}

document.addEventListener('DOMContentLoaded',async()=>{
  const startupTime=Date.now();
  try{await initFlightStore()}catch(error){
    document.body.textContent='PilotLog could not open the saved data. Reopen the app or restore a JSON backup. Your data has been preserved.';
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','Ripristina backup PilotLog');document.body.appendChild(input);
    input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;try{const restored=validateFullBackupPayload(JSON.parse(await file.text()));if(!confirm('Sostituire i dati locali con questo backup?'))return;await writeFlightStore(normalizeOperationalDatabase(restored.database));location.reload()}catch(e){alert('Ripristino non completato: '+e.message)}});
    return;
  }
  if(!localStorage.getItem(SYNC_OWNER)&&Number(localStorage.getItem(CLOUD_BASE_REV_KEY))>0&&cloudStoredSession()?.user?.id)localStorage.setItem(SYNC_OWNER,cloudStoredSession().user.id);
  if(localStorage.getItem('pilotlog7_sync_client_protocol')!=='162'){
    localStorage.removeItem(SYNC_BLOCK);localStorage.removeItem('pilotlog7_sync_failure_16');
    localStorage.setItem('pilotlog7_sync_client_protocol','162');
  }
  legacyDirty=localStorage.getItem(CLOUD_DIRTY_KEY)==='1';
  try{bootKnown=operationalDatabase.preSync162?.known||baseline(recordMap(operationalDatabase))}
  catch(error){localStorage.setItem(SYNC_BLOCK,error.message);localStorage.setItem('pilotlog7_sync_failure_16',error.message)}
  if(operationalDatabase.preSync162)legacyDirty=operationalDatabase.preSync162.legacyDirty;
  syncDirty();
  for(const group of document.querySelectorAll('details.settings-group')){
    group.addEventListener('toggle',()=>{
      if(group.open)for(const other of document.querySelectorAll('details.settings-group[open]')){
        if(other!==group)other.open=false;
      }
    });
  }
  bindPilotLogSwipeGestures();
  document.querySelector('.nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b){e.preventDefault();if(b.dataset.view==='addView')showActivityTypePicker();else show(b.dataset.view)}});
  document.addEventListener('change',e=>{
    if(e.target.id==='payslipDocumentMonth'){displayMonthPicker(e.target);return}
    if(e.target.id==='rosterMonthSelect'){
      if(/^\d{4}-\d{2}$/.test(e.target.value)){rosterCalendarMonth=e.target.value;rosterSelectedDate='';renderRoster()}return;
    }
    const el=e.target.closest('.pay-dayoff-remark');
    if(!el)return;
    const month=$('payrollMonth').value||monthNow();
    if(monthExtras(month).validated)return;
    saveDayOffRemark(month,el.dataset.dayoffDate,el.value);
    scheduleAutoSync('payroll-dayoff-remark');
  });
  $('runIntegrityCheckBtn')?.addEventListener('click',()=>reviewIntegrity());
  $('integrityClose').addEventListener('click',()=>$('integrityDialog').close());
  $('reviewDuplicates').addEventListener('click',()=>reviewIntegrity(true));
  $('deepResetBtn')?.addEventListener('click',deepFactoryResetPilotLog);
  $('deepLocalResetBtn')?.addEventListener('click',deepLocalResetPilotLog);
  $('logbookAddBtn').addEventListener('click',e=>toggleAddFlight(e.currentTarget,'flightsView'));
  $('addTripButton').addEventListener('click',e=>{
    const opening=$('tripFormWrap').classList.contains('hidden')||!!$('tripEditId').value;
    closeDetail();
    if(opening)resetTrip();
    $('tripFormWrap').classList.toggle('hidden',!opening);
    e.currentTarget.setAttribute('aria-expanded',String(opening));
  });
  $('activityTypePicker').addEventListener('click',e=>{const b=e.target.closest('[data-new-activity]');if(b){
    const date=$('date').value;
    resetEntry(false,true);
    $('date').value=date||today();
    pendingActivityType=b.dataset.newActivity;
    $('dutyTypeFlight').value=pendingActivityType;
    $('entryTitle').textContent='Add '+pendingActivityType;
    setEntryTypeUI();
    const eligible=dutyEligible({dutyType:pendingActivityType});
    $('dutyOnBtn').disabled=!eligible;
    $('dutyOffBtn').disabled=!eligible;
    lastCoreInputSignature=coreFormSignature();
  }});
  $('entryDeleteBtn').addEventListener('click',async()=>{const id=$('editId').value,f=coreActivityRows().find(x=>x.id===id);if(!f||f.locked)return;if(!confirm('Delete this activity?'))return;markCloudDeleted('activities',f,{manual:true});removeCoreActivities(x=>x.id===id,{manual:true});$('editId').value='';await persistCoreActivities();show('flightsView');scheduleAutoSync('delete-activity')});
  ['dutyStartDate','dutyEndDate'].forEach(id=>$(id).addEventListener('change',()=>{formTimeOverrides[id==='dutyStartDate'?'onDuty':'offDuty']=true;saveEntryDraft();calcEntry();updateDutyControls()}));$('dutyOnBtn').addEventListener('click',()=>{startPendingActivity();dutyOn()});$('dutyOffBtn').addEventListener('click',()=>{startPendingActivity();dutyOff()});
  document.addEventListener('keydown',e=>{if((e.key!=='Enter'&&e.key!==' ')||e.target.closest('button,input,select,textarea'))return;const row=e.target.closest('[data-detail-kind]');if(!row)return;e.preventDefault();row.click()});
  $('logbookSearch')?.addEventListener('input',e=>{logbookSearchQuery=e.target.value||'';logbookRenderLimit=LOGBOOK_RENDER_STEP;renderEntriesSafe();if(logbookSearchQuery.trim().length>=2&&!airportDbLoaded)ensureAirportDb(false).then(()=>renderEntriesSafe()).catch(()=>{})});
  $('clearLogbookSearch')?.addEventListener('click',()=>{logbookSearchQuery='';logbookRenderLimit=LOGBOOK_RENDER_STEP;if($('logbookSearch'))$('logbookSearch').value='';renderEntriesSafe();$('logbookSearch')?.focus()});
  $('lockAllEntriesBtn')?.addEventListener('click',()=>lockAllLogbookEntries().catch(err=>alert('Lock all entries failed: '+err.message)));
  $('entryBackBtn').addEventListener('click',()=>{
    if(formUserEdited)saveEntryDraft();
    const ctx=entryReturnContext;setEntryReturnContext(null);
    if(ctx?.view==='flightsView')show('flightsView',{logbookEntryId:ctx.entryId||$('editId').value});
    else if(ctx?.view==='rosterView')show('rosterView');
    else show('flightsView');
  });
  $('entryRosterDeleteBtn')?.addEventListener('click',deleteRosterEntryActivity);
  bindExpiryEvents();
  document.querySelectorAll('[data-upper]').forEach(el=>el.addEventListener('input',()=>{const p=el.selectionStart;el.value=CREW_NAME_FIELDS.includes(el.id)||el.id==='expiryEndorsedBy'?String(el.value||'').toUpperCase():upper(el.value);try{el.setSelectionRange(p,p)}catch{}}));
  $('flightForm').addEventListener('click',e=>{const button=e.target.closest('[data-counter-shortcut]');if(!button)return;const input=$(button.dataset.counterShortcut);if(!input||input.disabled)return;input.value=Number(input.value||0)>0?'0':'1';input.dispatchEvent(new Event('input',{bubbles:true}));calcEntry();});
  for(const event of ['input','change'])$('flightForm').addEventListener(event,event=>{if(formLoading)return;
    if(pendingActivityType){
      if(coreFormSignature()===lastCoreInputSignature)return;
      const input=event.target,checked=input.checked,value=input.value;
      startPendingActivity();
      if(input.type==='checkbox')input.checked=checked;else input.value=value;
    }
    formUserEdited=true},true);
  $('flightForm').addEventListener('input',silentAutosaveExisting);
  $('flightForm').addEventListener('change',silentAutosaveExisting);
  ['dep','arr'].forEach(id=>$(id).addEventListener('change',async()=>{await updateAirportInfo();calcEntry();await calcNightForForm();silentAutosaveExisting()}));
  $('date').addEventListener('change',async()=>{calcEntry();await calcNightForForm();silentAutosaveExisting()});
  const manualFieldMap={date:'date',flightNo:'flightNo',reg:'reg',type:'type',variant:'variant',courseType:'courseType',trainerTypeInput:'trainerType',dep:'dep',arr:'arr',schedOut:'schedOut',schedIn:'schedIn',onDuty:'onDuty',offDuty:'offDuty',out:'out',off:'off',on:'on',in:'in',approachType:'approachType',approachCategory:'approachCategory',remarks:'remarks',picName:'picName',sicName:'sicName',soName:'soName',instructorName:'instructorName',examinerName:'examinerName',purserName:'purserName',attendant1Name:'attendant1Name',attendant2Name:'attendant2Name',attendant3Name:'attendant3Name',pax:'pax',goArounds:'goArounds',fuelAboard:'fuelAboard',fuelBurned:'fuelBurned',fuelMinimum:'fuelMinimum',dayTakeoffs:'dayTakeoffs',nightTakeoffs:'nightTakeoffs',dayLandings:'dayLandings',nightLandings:'nightLandings'};
  $('flightForm')?.addEventListener('input',e=>{if(formLoading)return;const key=manualFieldMap[e.target?.id];if(key){formManualFields[key]=true;formFieldSources[key]='manual'}});
  $('flightForm')?.addEventListener('change',e=>{if(formLoading)return;const map={dutyTypeFlight:'dutyType',rolePicCheck:'rolePic',pfCheck:'pf',instructionCheck:'instruction',examinerCheck:'examiner',simInstructorCheck:'simInstructor',simExaminerCheck:'simExaminer',rhsCheck:'rhs',callFromDayOff:'callFromDayOff',...manualFieldMap},key=map[e.target?.id];if(key){formManualFields[key]=true;formFieldSources[key]='manual'}});
  ['out','off','on','in','schedOut','schedIn','onDuty','offDuty','approachType'].forEach(id=>$(id).addEventListener('input',async()=>{if(!formLoading&&(id==='onDuty'||id==='offDuty'))formTimeOverrides[id]=true;if(id==='schedOut')syncOnDutyFromScheduleOut();if(id==='schedIn')syncOffDutyFromScheduleIn();calcEntry();if(['out','off','on','in'].includes(id))await calcNightForForm();silentAutosaveExisting()}));
  $('out').addEventListener('change',()=>{silentAutosaveExisting()});
  $('reg')?.addEventListener('change',applyEquipment);
  $('equipmentPanel').addEventListener('toggle',()=>{if($('equipmentPanel').open)renderEquipment()});
  $('equipmentForm').addEventListener('submit',event=>{
    event.preventDefault();
    const reg=upper($('equipmentReg').value.trim()),type=upper($('equipmentType').value.trim());
    if(!reg||reg.includes('|'))return alert('Enter a valid aircraft registration or simulator ID.');
    const key=equipmentKey($('equipmentKind').value,reg),remove=event.submitter?.value==='remove';
    if(remove&&!equipmentDirectory().has(key))return;
    if(!remove&&!type)return alert('Enter the type.');
    setEquipment(key,remove?null:{type,variant:upper($('equipmentVariant').value.trim())});
    renderEquipment();
  });
  ['rolePicCheck','instructionCheck','examinerCheck','simInstructorCheck','simExaminerCheck','rhsCheck'].forEach(id=>$(id)?.addEventListener('change',()=>{if(id==='rolePicCheck')syncProfileNameWithRole(true);calcEntry();silentAutosaveExisting()}));
  $('simTrainerCheck')?.addEventListener('change',updateSimulatorTrainerFromForm);
  $('pfCheck')?.addEventListener('change',async()=>{calcEntry();await calcNightForForm();silentAutosaveExisting()});
  $('dutyTypeFlight').addEventListener('change',()=>{setEntryTypeUI();if(entryRosterActivityContext?.typeOnly){setEntryLockedUI(true);$('dutyTypeFlight').disabled=false;}if(canonicalDutyType($('dutyTypeFlight').value)==='Flight')syncProfileNameWithRole();calcEntry();silentAutosaveExisting()});
  $('trainerTypeInput')?.addEventListener('change',()=>{calcEntry();silentAutosaveExisting()});
  $('courseType').addEventListener('input',()=>calcEntry());
  $('blockDisplay')?.addEventListener('input',()=>{if(!formLoading)formTimeOverrides.block=true;calcEntry();silentAutosaveExisting()});
  $('blockDisplay')?.addEventListener('change',()=>{const value=optionalDuration($('blockDisplay').value);$('blockDisplay').value=value===null?'':fmt(value);calcEntry();silentAutosaveExisting()});
  TIME_GROUP_DEFS.forEach(({key})=>{const el=$(TIME_GROUP_INPUT_IDS[key]);if(!el)return;el.addEventListener('input',()=>{if(!formLoading){formTimeOverrides[key]=true;formManualFields[key]=true;formFieldSources[key]='manual'}calcEntry();silentAutosaveExisting()});el.addEventListener('change',()=>{const value=optionalDuration(el.value);setDurationPicker(el,value);calcEntry();silentAutosaveExisting()})});
  $('flightForm').addEventListener('submit',e=>e.preventDefault());
  $('returnFlight').addEventListener('click',createReturnFlight);
  $('clearForm')?.addEventListener('click',()=>{setEntryReturnContext(null);showActivityTypePicker()});
  $('lockEntryBtn').addEventListener('click',toggleEntryLock);
  $('tripCashConverted').addEventListener('change',()=>{const raw=$('tripCashConverted').value.replace(/,/g,'').replace(/[^0-9.]/g,'');tripFormOverrides.cashConverted=raw===''?null:{value:Number(raw),amount:Number($('tripCashAmount').value||0),from:upper($('tripCashCurrency').value),to:load(TRIPS_KEY).find(t=>t.id===$('tripEditId').value&&t.cashCurrency===upper($('tripCashCurrency').value))?.cashFxTo||appCurrency(),date:tripStartDateFromValue($('tripStart').value)};});
  $('tripLayover').addEventListener('change',()=>{tripFormOverrides.layover=optionalDuration($('tripLayover').value);tripCalc()});
  $('tripAllowance').addEventListener('change',()=>{const raw=$('tripAllowance').value.replace(/,/g,'').replace(/[^0-9.]/g,'');tripFormOverrides.allowance=raw===''?null:Number(raw);tripCalc()});
  ['tripStart','tripEnd'].forEach(id=>$(id).addEventListener('input',tripCalc));$('tripCashAmount')?.addEventListener('input',()=>{tripCalc();if(Number($('tripCashAmount').value||0)<=0)$('tripCashConverted').value=''});['tripCashAmount','tripCashCurrency','tripStart'].forEach(id=>$(id)?.addEventListener('change',()=>tripMoneyConversion()));$('calcTrip').addEventListener('click',()=>tripMoneyConversion());$('clearTrip').addEventListener('click',resetTrip);
  let tripSaveActive=false;
  $('tripForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(tripSaveActive)return;
    tripSaveActive=true;
    try{
      const editId=$('tripEditId').value;
      if(editId&&tripBaseline===tripContent()){resetTrip();return}
      const calculation=tripCalc();
      if(!calculation)return alert('Enter a valid Trip Start and Trip End.');
      const fx=tripMoneyConversion();
      if(fx?.error)return alert(fx.error);
      const rows=load(TRIPS_KEY),id=editId||makeId(),index=rows.findIndex(row=>row.id===id);
      const existing=rows[index],cashAmount=Number($('tripCashAmount').value||0);
      const cashCurrency=cashAmount>0?upper($('tripCashCurrency').value):'';
      const cashRates=cashAmount>0?{...existing?.cashFxRates}:{};
      if(cashAmount>0&&fx?.cashRate>0){
        cashRates[fx.cashTo]={from:cashCurrency,to:fx.cashTo,rate:fx.cashRate,date:fx.cashFxDate,
          tripStartDate:fx.tripStartDate,provisional:fx.cashFxProvisional,manual:fx.cashFxManual};
      }
      const trip=stamp({...existing,id,...(existing?{}:{createdDate:today(),cashMonth:monthNow()}),
        base:upper(appSettings().homeBase||'CMN'),stations:upper($('tripStations').value),
        start:$('tripStart').value,end:$('tripEnd').value,trip:calculation.trip,duty:calculation.duty,
        layover:calculation.layover,allowance:calculation.allowance,allowanceCurrency:'MAD',
        tripOverrides:{...tripFormOverrides},cashEligible:existing?.cashEligible||false,
        cashAmount,cashCurrency,cashConverted:cashAmount>0?fx?.cashConverted??null:0,
        cashFxPending:!!fx?.cashFxPending,cashFxProvisional:!!fx?.cashFxProvisional,
        cashFxManual:!!fx?.cashFxManual,cashEur:cashAmount>0&&fx?.cashTo==='EUR'?Number(fx.cashConverted||0):0,
        cashFxFrom:cashAmount>0?cashCurrency:'',cashFxTo:cashAmount>0?fx?.cashTo||'':'',
        cashFxRate:cashAmount>0?Number(fx?.cashRate||0):0,cashFxDate:cashAmount>0?String(fx?.cashFxDate||''):'',
        cashFxTripStartDate:cashAmount>0?String(fx?.tripStartDate||''):'',cashFxRates:cashRates,
        tripFxTo:'MAD',tripFxMadRate:1,tripFxDate:'',tripFxTripStartDate:String(fx?.tripStartDate||''),
        manualOverride:true,remarks:$('tripRemarks').value.trim()});
      $('tripEditId').value=id;
      const submittedForm=tripContent();
      if(index>=0)rows[index]=trip;else rows.push(trip);
      save(TRIPS_KEY,rows);
      markCloudEdited('trips',trip,existing?'edit':'create');
      await flushFlightStore();
      if($('tripEditId').value===id&&tripContent()===submittedForm){
        resetTrip();$('tripFormWrap').classList.add('hidden');$('addTripButton').setAttribute('aria-expanded','false');
      }
      renderTrips();renderPayroll();scheduleAutoSync('trip-save');alert('Trip saved.');
    }catch(error){alert('Trip save failed: '+error.message)}
    finally{tripSaveActive=false}
  });
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
  $('exportExperiencePdf').addEventListener('click',exportExperiencePdf);
  $('exportBackupJson').addEventListener('click',exportFullBackupJson);
  $('restoreBackupJsonFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await restoreFullBackupJsonFile(file)}catch(err){console.error('Full backup restore failed',err);alert('Restore failed: '+err.message)}finally{e.target.value=''}});
  $('exportCsv').addEventListener('click',()=>{const d=coreActivityRows().filter(isCompletedLogbookEntry);if(!d.length)return alert('No entries to export');const cols=['dutyType','date','flightNo','reg','type','variant','dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty','totalDuty','out','off','on','in','block','totalFlightTime','multiPilot','pic','picUS','sic','ifrTime','airTime','night','picNight','simulatorTime','sfiSfe','dualGiven','dualReceived','groundInstruction','stbyTime','credit','rolePic','pf','instruction','examiner','simInstructor','simExaminer','callFromDayOff','rhs','picName','sicName','soName','instructorName','examinerName','purserName','attendant1Name','attendant2Name','attendant3Name','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','goArounds','pax','fuelAboard','fuelBurned','fuelMinimum','approachType','remarks','locked'];download('pilotlog_logbook.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  $('exportLogTen').addEventListener('click',logTenExport);
  const updateEasaRangeUI=()=>{const period=$('easaExportMode').value==='period';$('easaFrom').disabled=!period;$('easaTo').disabled=!period};
  $('easaExportMode').addEventListener('change',updateEasaRangeUI);updateEasaRangeUI();
  $('aerolineRosterFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    
    try{
      const text=await file.text(),payload=JSON.parse(String(text||'').replace(/^\uFEFF/,''));
      const preview=parseAerolineRosterObject(payload);
      const firstPastFlight=preview.flights.some(row=>row.date<today()&&!operationalDatabase.records.some(old=>old.aerolineKey&&old.date?.slice(0,7)===row.date.slice(0,7)));
      const r=importAerolineRosterObject(payload);e.target.value='';
      if(firstPastFlight)alert('Please verify the scheduled times of past flights, as AeroLINE may have replaced them with actual times.');
      await render();await renderRoster();renderDuty();markLocalOnlyImport('AeroLINE JSON import');
      const imported=r.flightsAdded+r.activitiesAdded+r.offAdded,updated=r.flightsUpdated+r.activitiesUpdated+r.offUpdated,expiryText=r.expiryImport?` • Expiry ${r.expiryImport.added} added / ${r.expiryImport.updated} updated`:'';
      const extras=r.unsupported.length?` • Unsupported codes: ${r.unsupported.join(', ')}`:'';
      $('aerolineImportStatus').textContent=`${r.monthLabel||'AeroLINE'} • ${r.flights.length} flights • ${r.activities.length} activities • ${r.daysOff.length} OFF • ${imported} added • ${updated} updated${r.staleRemoved?` • ${r.staleRemoved} stale removed`:''}${expiryText}${extras}`;
      alert(`AeroLINE roster imported: ${r.monthLabel||''}\n${r.flights.length} flights • ${r.activities.length} activities • ${r.daysOff.length} OFF\n${imported} added • ${updated} updated${r.staleRemoved?` • ${r.staleRemoved} stale removed`:''}${expiryText}`);
    }catch(err){e.target.value='';console.error('AeroLINE import failed',err);alert('AeroLINE import failed: '+err.message)}
  });
  $('logTenFullFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    showImportProgress('Importing LogTen Pro');
    try{
      $('logTenImportStatus').textContent='Importing complete LogTen migration… progress is shown on screen.';
      const r=await importLogTenMigrationPackage(e.target.files);e.target.value='';
      setImportProgress(99,'Import complete • refreshing PilotLog…');await render();renderDuty();setImportProgress(100,'Complete');await yieldToUi();
      markLocalOnlyImport(`Complete LogTen migration — ${r.total.toLocaleString('en-US')} rows ready`);
      if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();
      const span=r.manifest?.dateFrom&&r.manifest?.dateTo?`\n${displayDate(r.manifest.dateFrom)} – ${displayDate(r.manifest.dateTo)}`:'';
      $('logTenImportStatus').textContent=`Complete LogTen migration • ${r.total.toLocaleString('en-US')} logbook rows • ${r.imported.toLocaleString('en-US')} added • ${r.updated.toLocaleString('en-US')} matched/updated • ${(r.expiryImport?.total||0)} licences/validities • ${(r.tripImport?.total||0)} trips. Credit H is calculated from Scheduled Block Hours. Original SQLite database archived locally • verified local rows ${r.verified.toLocaleString('en-US')}. Nothing has been sent to cloud.`;
      const ex=r.expiryImport||{imported:0,updated:0,total:0},tr=r.tripImport||{imported:0,updated:0,total:0};
      alert(`Complete LogTen migration imported.${span}\nLogbook: ${r.imported.toLocaleString('en-US')} new • ${r.updated.toLocaleString('en-US')} matched/updated\nLicences/validities: ${ex.imported} new • ${ex.updated} updated\nTrips: ${tr.imported} new • ${tr.updated} updated\nCredit H: calculated from Scheduled Block Hours.\nOriginal LogTen database archived byte-for-byte on this device.\n\nLOCAL VERIFY: ${r.verified.toLocaleString('en-US')} LogTen IDs present.\n${r.conflicts?`\nManual values preserved: ${r.conflicts} conflicting fields across ${r.protectedMerged} records.\n${r.conflictDetails.slice(0,20).join("\n")}`:""}\nNothing has been sent to cloud.`);
    }catch(err){e.target.value='';console.error('Complete LogTen import failed',err);if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();$('logTenImportStatus').textContent='Complete LogTen migration failed: '+err.message;alert('Complete LogTen migration failed: '+err.message)}
    finally{hideImportProgress()}
  });
  $('exportLogTenArchive').addEventListener('click',()=>exportArchivedLogTenDatabase().catch(err=>alert('LogTen archive export failed: '+err.message)));
  $('logTenFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const r=logTenImport(await file.text());e.target.value='';await render();markLocalOnlyImport('LogTen Tab import');$('logTenImportStatus').textContent=`Imported ${r.imported} new, repaired/updated ${r.updated}, simulators ${r.sims}, other duties ${r.other}${r.duplicatesRemoved?`, duplicates merged ${r.duplicatesRemoved}`:''}.`;alert(`LogTen import complete.${r.duplicatesRemoved?` ${r.duplicatesRemoved} duplicate${r.duplicatesRemoved===1?'':'s'} merged.`:''}`)}catch(err){alert('LogTen import failed: '+err.message)}});
  $('calendarFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const events=parseIcs(await file.text());if(!events.length)throw new Error('No calendar events found.');const r=importCalendar(events);e.target.value='';await render();markLocalOnlyImport('Calendar import');$('calendarImportStatus').textContent=`Imported ${r.sectors} flight sectors, ${r.duties} duties and ${r.other} other entries. ${r.skipped} skipped.`;alert(`Imported: ${r.sectors} flights • ${r.duties} duties • ${r.other} other entries`)}catch(err){alert('Calendar import failed: '+err.message)}});
  $('rosterFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const rows=parseCsv(await file.text());if(rows.length<2)return alert('CSV contains no data');const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''),aliases={date:['date','day'],flightNo:['flightno','flightnumber','flight','flt'],dep:['dep','departure','from','origin'],arr:['arr','arrival','to','destination'],std:['std','departuretime','scheduleddeparture','offblock'],sta:['sta','arrivaltime','scheduledarrival','onblock']},fieldFor=h=>Object.keys(aliases).find(k=>aliases[k].includes(norm(h)))||null,map=rows[0].map(fieldFor),imp=rows.slice(1).map(r=>{const o={recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',source:'roster'};map.forEach((k,i)=>{if(k)o[k]=r[i]||''});o.date=normalDate(o.date);o.schedOut=o.std||'';o.schedIn=o.sta||'';delete o.std;delete o.sta;['dep','arr','flightNo'].forEach(k=>o[k]=upper(o[k]));if(o.flightNo)o.flightNo=rosterFlightLabel(o.flightNo);return o}).filter(x=>x.date&&(x.dep||x.arr||x.flightNo));const csvKey=r=>JSON.stringify([r.date,r.flightNo,r.dep,r.arr,r.schedOut,r.schedIn]);const seen=new Set(coreActivityRows().filter(r=>r.source==='roster'||r.sourceRowKey?.startsWith('csv:')).flatMap(r=>[r.sourceRowKey,'csv:'+csvKey(r)]));
    const fresh=[];
    for(const row of imp){
      row.sourceRowKey='csv:'+csvKey(row);
      if(seen.has(row.sourceRowKey))continue;
      row.id=importCoreId(syncSourceKey(row));
      seen.add(row.sourceRowKey);
      fresh.push(row);
    }
    if(fresh.length)commitCoreActivities([...coreActivityRows(),...fresh]);e.target.value='';await render();markLocalOnlyImport('Roster CSV import');alert(`${imp.length} roster sectors imported`)});
  $('profilePhotoInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{const profilePhotoData=await profilePhotoDataFromFile(file);saveAppSettings({profilePhotoData,profilePhotoUpdatedAt:new Date().toISOString()});updateAppHeader();updateProfilePhotoSettings();scheduleAutoSync('profile-photo')}
    catch(err){alert(err.message||'PHOTO COULD NOT BE ADDED.')}
    finally{e.target.value=''}
  });
  $('removeProfilePhoto').addEventListener('click',async()=>{
    if(!confirm('REMOVE THE PERSONAL PHOTO AND RESTORE THE PILOTLOG LOGO?'))return;
    saveAppSettings({profilePhotoData:'',profilePhotoUpdatedAt:new Date().toISOString()});updateAppHeader();updateProfilePhotoSettings();scheduleAutoSync('profile-photo-remove');
  });
  $('setPayrollRegime')?.addEventListener('change',()=>{$('macDependentsSetting')?.classList.toggle('hidden',upper($('setPayrollRegime').value)!=='MAC')});
  $('appSettingsForm').addEventListener('submit',async e=>{e.preventDefault();saveAppSettings({flightPrefix:cleanPrefix($('setFlightPrefix').value)||'MAC',aircraftPrefix:cleanPrefix($('setAircraftPrefix').value)||'CN-NM',profileName:$('setProfileName').value.trim(),profileRole:$('setProfileRole').value||'Captain'});renderSettings();renderTrips();renderPayroll();if(!$('editId').value)applyProfileDefaultsToEntry();refreshEntrySuggestions();scheduleAutoSync('settings');alert('Settings saved.')});
  $('saveTimeGroupSettings')?.addEventListener('click',()=>{saveTimeGroupSettingsFromForm();scheduleAutoSync('time-group-settings');alert('Time Group settings saved. Past activities now use the selected Auto Sync rules.')});
  $('refreshAirportsBtn').addEventListener('click',()=>ensureAirportDb(true));
  $('cloudEmail').addEventListener('change',()=>localStorage.setItem(LAST_EMAIL_KEY,$('cloudEmail').value.trim()));
  $('cloudSignUpBtn').addEventListener('click',async()=>{try{await cloudSignUp()}catch(e){alert('Create account failed: '+e.message)}});
  $('cloudSignInBtn').addEventListener('click',async()=>{try{await cloudSignIn()}catch(e){alert('Sign in failed: '+e.message)}});
  $('cloudSignOutBtn').addEventListener('click',async()=>{try{await cloudSignOut()}catch(e){alert('Sign out failed: '+e.message)}});
  $('syncCloudBtn').addEventListener('click',()=>syncSupabase({silent:false,reason:'manual'}));
  $('backupNowBtn').addEventListener('click',async()=>{try{await createWeeklyBackup(true);alert('Weekly backup updated.')}catch(e){alert('Backup failed: '+e.message)}});
  $('restoreWeeklyBackupBtn').addEventListener('click',()=>restoreWeeklyBackup().catch(e=>alert('Restore failed: '+e.message)));
  $('autoSyncEnabled').addEventListener('change',()=>{setAutoSyncEnabled($('autoSyncEnabled').value==='yes');armPeriodicSync()});

  $('payBreakdown').addEventListener('keydown',e=>{if(e.target.id==='payArrears'&&e.key==='Enter'){e.preventDefault();e.target.blur()}});
  $('payrollMonth').addEventListener('change',renderPayroll);$('payBreakdown').addEventListener('change',event=>{if(event.target.id!=='payArrears'||!event.target.validity.valid)return;const month=$('payrollMonth').value||monthNow(),ex=monthExtras(month);if(ex.validated)return;const arrears=Number($('payArrears').value||0);if(arrears!==Number(ex.arrears||0))saveMonthExtras(month,{...ex,dayOffCount:0,arrears,regime:payrollRegime()});scheduleAutoSync('payroll-month');renderPayroll()});
  $('validatePayroll').addEventListener('click',async()=>{
    const month=$('payrollMonth').value||monthNow();if(monthExtras(month).validated)return;
    const result=await renderPayroll();if(!result||$('payrollMonth').value!==month)return alert('Complete the payroll calculation before validation.');
    const validatedAt=new Date().toISOString(),snapshot=JSON.parse(JSON.stringify({...result,projection:payrollSnapshotProjection(result.projection),validatedAt}));
    saveMonthExtras(month,{...monthExtras(month),validated:snapshot,validationUpdatedAt:validatedAt});
    await persistCoreActivities();scheduleAutoSync('payroll-validated');await renderPayroll();
  });
  $('unlockPayroll').addEventListener('click',async()=>{
    const month=$('payrollMonth').value||monthNow(),ex=monthExtras(month);
    if(!ex.validated||!confirm(`Unlock the validated payslip for ${month}? Its values will be calculated again from current entries and settings.`))return;
    saveMonthExtras(month,{...ex,validated:null,validationUpdatedAt:new Date().toISOString()});
    await persistCoreActivities();scheduleAutoSync('payroll-unlocked');await renderPayroll();
  });
  $('paySettingsForm').addEventListener('submit',e=>{e.preventDefault();if($('setNightStart').value===$('setNightEnd').value)return alert('Night start and end must differ.');if(!$('paySettingsForm').checkValidity())return $('paySettingsForm').reportValidity();const nextCurrency=upper($('setCurrency')?.value||'MAD');const currency2=upper($('setCurrency2')?.value||'');const fields={currency2:ISO_CURRENCIES.includes(currency2)?currency2:'',homeBase:upper($('setHomeBase').value)||'CMN',currency:ISO_CURRENCIES.includes(nextCurrency)?nextCurrency:'MAD',payrollRegime:upper($('setPayrollRegime')?.value||'IBC')==='MAC'?'MAC':'IBC',macDependents:Math.max(0,Math.min(6,Math.trunc(Number($('setMacDependents')?.value)||0)))};saveAppSettings({...fields,nightStart:$('setNightStart').value,nightEnd:$('setNightEnd').value,nightPremiumPct:Number($('setNightPremiumPct').value)});const rates=readPaySettings();if(Object.entries(rates).some(([k,v])=>paySettings()[k]!==v))saveObject(PAY_SETTINGS_KEY,{...paySettings(),...rates,_updatedAt:new Date().toISOString()});renderTrips();setEntryTypeUI();renderPayroll();scheduleAutoSync('payroll-settings');alert('Payroll settings saved.')});
  $('paySettingsForm').addEventListener('input',()=>{$('tier4Above').textContent=$('setT3Max').value;showFixedSalary(readPaySettings())});
  $('resetPaySettings').addEventListener('click',()=>{if(confirm('Restore default rates?')){if(Object.entries(PAY_DEFAULTS).some(([k,v])=>paySettings()[k]!==v))saveObject(PAY_SETTINGS_KEY,PAY_DEFAULTS);fillPaySettings();renderPayroll()}});
  $('deleteAll').addEventListener('click',async()=>{if(confirm('Delete ALL saved log entries? This cannot be undone.')){const targets=coreActivityRows().filter(isCompletedLogbookEntry),ids=new Set(targets.map(x=>x.id));targets.forEach(x=>markCloudDeleted('activities',x,{includeSource:false,manual:true}));removeCoreActivities(x=>ids.has(x.id),{manual:true});await persistCoreActivities();clearAllEntryDrafts();await render();scheduleAutoSync('delete-all-entries')}});
  $('clearRoster').addEventListener('click',async()=>{if(confirm('Clear the complete imported roster? Flights, OFF, DHD/DHP, standby and training roster activities will be removed. Locked Logbook entries are preserved.')){const r=await clearImportedRosterData();await render();renderDuty();renderTrips();scheduleAutoSync('clear-roster');alert(`Roster cleared: ${r.roster} sectors • ${r.entries} activities • ${r.duties} duties removed.`)}});
  $('exportRoster').addEventListener('click',()=>{const d=rosterFlightRows();if(!d.length)return alert('No roster to export');const cols=['date','flightNo','dep','arr','std','sta','status'];download('pilotlog_roster.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  document.addEventListener('click',async e=>{let b=e.target.closest('[data-roster-today]');if(b){rosterSelectedDate=today();rosterCalendarMonth=rosterSelectedDate.slice(0,7);await renderRoster();scrollRosterAgendaIntoView();return}
    b=e.target.closest('[data-add-roster-entry]');if(b){toggleAddFlight(b,'rosterView',b.dataset.addRosterEntry);return}
    b=e.target.closest('[data-roster-date]');if(b){if(Date.now()<suppressRosterCalendarClickUntil)return;const date=b.dataset.rosterDate;rosterSelectedDate=rosterSelectedDate===date?'':date;if(rosterSelectedDate)rosterCalendarMonth=date.slice(0,7);await renderRoster();if(rosterSelectedDate)scrollRosterAgendaIntoView();return}
    b=e.target.closest('[data-delete-flight]');if(b){if(!confirm('Confirm to delete this log entry?'))return;const victim=coreActivityRows().find(f=>f.id===b.dataset.deleteFlight);markCloudDeleted('activities',victim||b.dataset.deleteFlight,{manual:true});removeCoreActivities(f=>f.id===b.dataset.deleteFlight,{manual:true});reconcileAllDuties();await render();renderEntriesSafe();closeDetail();scheduleAutoSync('delete-flight');return}
    b=e.target.closest('[data-edit-flight]');if(b){const f=coreActivityRows().find(x=>x.id===b.dataset.editFlight);if(f){loadEntryToForm(f);setEntryReturnContext('flightsView',f.id);show('addView')}return}
    b=e.target.closest('[data-delete-roster-duty]');if(b){e.preventDefault();e.stopPropagation();const ids=String(b.dataset.deleteRosterDuty||'').split(',').filter(Boolean);await deleteRosterDutyActivities(ids,{label:ids.length>1?'this roster duty':'this roster activity'});return}
    b=e.target.closest('[data-edit-roster-entry]');if(b){openRosterEntryModule(b.dataset.editRosterEntry);return}
    b=e.target.closest('[data-edit-roster-duty]');if(b){openRosterDutyModule(b.dataset.editRosterDuty);return}
    b=e.target.closest('[data-delete-duty]');if(b){if(!confirm('Confirm to delete this duty?'))return;const victim=coreActivityRows().find(d=>d.id===b.dataset.deleteDuty);markCloudDeleted('activities',victim||b.dataset.deleteDuty,{manual:true});removeCoreActivities(d=>d.id===b.dataset.deleteDuty,{manual:true});reconcileAllDuties();renderDuty();await render();scheduleAutoSync('delete-duty');return}
    b=e.target.closest('[data-detail-kind]');if(b){toggleSummary(b);return}
    b=e.target.closest('[data-edit-trip]');if(b){closeDetail();$('tripFormWrap').classList.remove('hidden');const saved=load(TRIPS_KEY).find(x=>x.id===b.dataset.editTrip),t=tripRowsForView.get(b.dataset.editTrip);if(!t)return;tripFormOverrides={...saved.tripOverrides};$('tripEditId').value=t.id;$('tripStations').value=t.stations||'';$('tripStart').value=t.start||'';$('tripEnd').value=t.end||'';$('tripLayover').value=fmt(t.layover||0);$('tripAllowance').value=tripDisplayMoney(t).allowanceText;$('tripCashAmount').value=Number(t.cashAmount||0)||'';$('tripCashCurrency').value=upper(t.cashCurrency||'USD');$('tripCashConverted').value=upper(t.cashFxTo||'')===appCurrency()&&Number(t.cashFxRate)>0?moneyCurrency(Number(t.cashConverted||0),appCurrency()):'';$('tripRemarks').value=t.remarks||'';tripBaseline=tripContent();$('tripForm').scrollIntoView({behavior:'smooth',block:'start'});return}
    b=e.target.closest('[data-delete-trip]');if(b){if(!confirm('Confirm to delete this trip?'))return;const rows=load(TRIPS_KEY),victim=rows.find(t=>t.id===b.dataset.deleteTrip);markCloudDeleted('trips',victim||b.dataset.deleteTrip,{manual:true});save(TRIPS_KEY,rows.filter(t=>t.id!==b.dataset.deleteTrip));renderTrips();scheduleAutoSync('delete-trip');return}    b=e.target.closest('[data-roster-action]');if(b){
      const r=rosterFlightRows().find(x=>x.id===b.dataset.rosterAction);if(!r)return;
      loadEntryToForm(coreActivityRows().find(x=>x.id===r.id)||r,{rosterActivity:true});setEntryReturnContext('rosterView',r.id);
      show('addView');
      return;
    }
  });
  document.addEventListener('keydown',e=>{if(e.target.closest('button,input,select,textarea,a'))return;const row=e.target.closest('.roster-agenda-clickable');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click()}});

  window.addEventListener('beforeunload',()=>{try{if(!$('addView')?.classList.contains('hidden'))saveEntryDraft()}catch{}});
  window.addEventListener('pagehide',()=>{try{flushExpiryAutosave();saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'){try{flushExpiryAutosave();saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})}});

  populateCurrencySelect($('setCurrency'),['MAD','EUR','USD','TRY','AED','GBP']);populateCurrencySelect($('setCurrency2'),['EUR','MAD','USD','GBP']);$('setCurrency2').prepend(new Option('—',''));populateCurrencySelect($('tripCashCurrency'),QUICK_CASH_CURRENCIES);updateAppHeader();resetEntry(false);refreshEntrySuggestions();bindCrewDirectory();[...CREW_NAME_FIELDS,'expiryEndorsedBy'].forEach(id=>setupSmartAutocomplete(id,()=>entrySuggestionDb.crew,4));setupSmartAutocomplete('type',()=>entrySuggestionDb.types);resetTrip();resetDutyEditor();$('payrollMonth').value=monthNow();displayMonthPicker($('payrollMonth'));displayMonthPicker($('payslipDocumentMonth'));$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';fillPaySettings();renderDuty();renderSettings();await render();show('rosterView');syncDatabaseReady=true;drawSyncState();scheduleAutoSync('startup',startupTime);
  renderEntriesSafe();renderTrips();renderExpiry();renderPayroll(true);renderTotals();
  for(const id of ['flightsView','tripsView','expiryView','payrollView','dashboardView','totalsView','settingsView'])viewVersions.set(id,viewVersion());
  startPayslips().catch(error=>{
    $('payslipStatus').textContent='Payslip archive unavailable.';
    console.warn('Payslip initialization failed',error);
  });
  recoverPendingFx();
  window.addEventListener('online',recoverPendingFx);
  window.addEventListener('pilotlog-native-pause',()=>{try{flushExpiryAutosave();saveEntryDraft()}catch{};flushFlightStore().catch(e=>console.error('Save on pause failed',e))});

  if(!window.PilotLogNative?.isNative&&'serviceWorker' in navigator){navigator.serviceWorker.register('./sw-16.12.js').catch(err=>console.warn('Offline cache unavailable',err));}
  console.log('NexA '+APP_VERSION+' loaded');
});
/* Screenshot acquisition: ephemeral images/OCR, one Core write after review. */
const ROSTER_SHOT_CREW=['picName','sicName','purserName','attendant1Name','attendant2Name','attendant3Name'];
const ROSTER_SHOT_FIELDS={picName:'Captain',sicName:'First Officer',purserName:'Purser',attendant1Name:'Cabin crew 1',attendant2Name:'Cabin crew 2',attendant3Name:'Cabin crew 3',screenshotDutyStart:'Duty START',screenshotArrivalDate:'Arrival date',onDuty:'Duty On',date:'Date',flightNo:'Flight',dep:'From',arr:'To',schedOut:'Schedule OUT',schedIn:'Schedule IN',reg:'Registration',type:'Aircraft',schedBlock:'Flying Hrs (schedule)',instruction:'Instruction',remarks:'Training Program'};
let rosterShotFiles=[],rosterShotRows=[],rosterShotCrew=[],rosterShotPlan=[],rosterShotBusy=false;
function rosterShotDate(value){
 const m=String(value||'').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:[0-5]\d)/);if(!m)return '';
 const iso=`${m[3]}-${m[2]}-${m[1]}T${m[4]}:00Z`,d=new Date(iso);
 return Number.isFinite(+d)&&d.toISOString()===iso.replace(':00Z',':00.000Z')?iso:'';
}
function rosterShotFlightNo(value){return upper(value).replace(/^30(?=\d{2,4}$)/,'3O')}
function rosterShotParseFlight(text){
 const header=/\b([A-Z]{3})[ \t]*(?:[>→➜›»—–\-]+[ \t]*)?([A-Z]{3})[ \t]*[.·,:]?\s*((?:3[O0]|[A-Z]{2})\s*\d{2,4})\b/g;
 const hits=[...upper(text).matchAll(header)],rows=[];
 hits.forEach((h,i)=>{
  const chunk=text.slice(h.index,hits[i+1]?.index??text.length);
  const dates=tag=>{const part=chunk.split(new RegExp(tag,'i'))[1]||'';return rosterShotDate(part)};
  const start=dates('START'),depart=dates('DEPARTURE'),arrival=dates('ARRIVAL');
  const reg=upper(chunk.match(/\bCN\s*[-–]\s*[A-Z]{3}\b/i)?.[0]||'').replace(/\s/g,'').replace('–','-');
  const type=upper(chunk.match(/\bA(?:319|320|321)\b/i)?.[0]||'');
  const hours=(chunk.split(/Flying\s+Hrs\.?/i)[1]||'').match(/\b(\d{2}:[0-5]\d)\b/)?.[1]||'';
  const training=chunk.match(/Training\s+Program\s*\n\s*([^\n]+)/i)?.[1]?.trim()||'';
  rows.push({date:depart.slice(0,10),flightNo:rosterShotFlightNo(h[3].replace(/\s/g,'')),dep:h[1],arr:h[2],schedOut:depart.slice(11,16),schedIn:arrival.slice(11,16),screenshotArrivalDate:arrival.slice(0,10),screenshotDutyStart:start,reg,type,schedBlock:hours?timeSpanMins('00:00',hours):null,...(training?{remarks:training}:{}),...(/LINE\s+TRAINING/i.test(training)?{instruction:true}:{})});
 });return rows;
}
function rosterShotParseCrew(text){
 const lines=text.split(/\n/).map(s=>s.trim()).filter(Boolean),names=[];
 for(let i=0;i<lines.length;i++){
  if(!/\b\d{5,7}\b/.test(lines[i])&&!/Nationality/i.test(lines[i]))continue;
  let name=lines[i-1]||'';
  name=name.replace(/^(?:CP|FO|CS|CC)\s+/,'').replace(/\s+(?:Ra|[e©&])$/,'').trim();
  names.push(name&&!/\d|Nationality|FLIGHT INFO|Message all crew|^(TRI|TNE|CP|FO|CS|CC)$/i.test(name)&&name.split(/\s+/).length>=2?name:'');
 }return names.slice(0,ROSTER_SHOT_CREW.length);
}
function rosterShotIdentity(row){return `${row.date}|${rawFlightDigits(rosterShotFlightNo(row.flightNo))}|${upper(row.dep)}|${upper(row.arr)}`}
function rosterShotMerge(rows){
 const result=[];
 for(const row of rows){
  const previous=result.find(r=>rosterShotIdentity(r)===rosterShotIdentity(row));
  if(!previous){result.push({...row,_conflicts:{...(row._conflicts||{})}});continue}
  for(const [key,value] of Object.entries(row)){
   if(key==='_conflicts'){for(const [field,choices] of Object.entries(value||{}))previous._conflicts[field]=[...new Set([...(previous._conflicts[field]||[]),...choices])];continue}
   if(value===undefined||value===null||value==='')continue;
   if(previous[key]===undefined||previous[key]===null||previous[key]==='')previous[key]=value;
   else if(previous[key]!==value)previous._conflicts[key]=[...new Set([...(previous._conflicts[key]||[]),previous[key],value])];
  }
 }return result;
}
function rosterShotCandidates(row,records=coreActivityRows()){
 return records.filter(r=>isFlight(r)&&r.date===row.date&&((rawFlightDigits(r.flightNo)&&rawFlightDigits(r.flightNo)===rawFlightDigits(row.flightNo))||(upper(r.dep)===upper(row.dep)&&upper(r.arr)===upper(row.arr)&&(!r.schedOut||!row.schedOut||r.schedOut===row.schedOut))));
}
function rosterShotDiscard(){rosterShotFiles=[];rosterShotRows=[];rosterShotCrew=[];rosterShotPlan=[];$('rosterScreenshotFiles').value='';$('rosterScreenshotReview').replaceChildren();$('rosterScreenshotConfirm').classList.add('hidden')}
function rosterShotOpen(){if(rosterShotBusy)return;rosterShotDiscard();$('rosterScreenshotStatus').textContent='Add one or more screenshots from the same duty.';$('rosterScreenshotDialog').showModal()}
function rosterShotInput(container,label,value,change,type='text'){
 const wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';
 const input=document.createElement('input');input.type=type;input.value=value??'';input.addEventListener('change',()=>change(input.value));wrap.append(input);container.append(wrap);return input;
}
function rosterShotResolveView(){
 const host=$('rosterScreenshotReview');host.replaceChildren();$('rosterScreenshotConfirm').classList.add('hidden');
 const title=document.createElement('p');title.textContent='Review the entries and complete any truncated names before saving.';host.append(title);
 for(const row of rosterShotRows){
  const card=document.createElement('div');card.className='card spaced';host.append(card);
  for(const key of ['date','flightNo','dep','arr','schedOut','schedIn','reg','type'])rosterShotInput(card,ROSTER_SHOT_FIELDS[key],row[key],v=>{row[key]=['flightNo','dep','arr','reg','type'].includes(key)?upper(v):v;delete row._conflicts[key]},key==='date'?'date':['schedOut','schedIn'].includes(key)?'time':'text');
  rosterShotInput(card,'Duty START (Zulu)',row.screenshotDutyStart.slice(0,16),v=>{row.screenshotDutyStart=v?`${v}:00Z`:'';delete row._conflicts.screenshotDutyStart},'datetime-local');
  for(const key of Object.keys(row._conflicts||{})){
   const label=document.createElement('label');label.textContent=`Conflicting screenshots: ${ROSTER_SHOT_FIELDS[key]||key}`;
   const select=document.createElement('select');select.append(new Option('Choose a value',''));
   row._conflicts[key].forEach((v,i)=>select.append(new Option(String(v),String(i))));
   select.onchange=()=>{if(select.value!==''){row[key]=row._conflicts[key][Number(select.value)];delete row._conflicts[key]}};label.append(select);card.append(label);
  }
 }
 const starts=[...new Set(rosterShotRows.map(r=>r.screenshotDutyStart).filter(Boolean))];
 for(const crew of rosterShotCrew){
  const card=document.createElement('div');card.className='card spaced';host.append(card);
  const label=document.createElement('label');label.textContent='Crew for duty start';const select=document.createElement('select');select.append(new Option('Select duty',''));
  starts.forEach(v=>select.append(new Option(v.slice(0,16).replace('T',' '),v)));if(starts.length===1)crew.start=starts[0];select.value=crew.start||'';select.onchange=()=>crew.start=select.value;label.append(select);card.append(label);
  crew.names.forEach((name,i)=>rosterShotInput(card,ROSTER_SHOT_FIELDS[ROSTER_SHOT_CREW[i]],name,v=>crew.names[i]=v));
 }
 const b=document.createElement('button');b.className='secondary';b.textContent='Preview entries';b.onclick=()=>rosterShotPrepare();host.append(b);
}
function rosterShotSame(a,b){return String(a??'')===String(b??'')}
function rosterShotPrepare(){
 try{
  for(const row of rosterShotRows){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))||!rawFlightDigits(row.flightNo)||!/^([A-Z]{3}|[A-Z]{4})$/.test(row.dep)||!/^([A-Z]{3}|[A-Z]{4})$/.test(row.arr)||!row.schedOut||!row.schedIn||!rosterShotValidStart(row.screenshotDutyStart))throw new Error('Enter the date, flight number, route, times and duty start.');
   if(Object.keys(row._conflicts||{}).length)throw new Error('Choose a value for each conflicting field.');
  }
  for(const crew of rosterShotCrew)if(!crew.start||crew.names.some(n=>!n.trim()||/[.…]/.test(n)))throw new Error('Select the duty for this crew and complete any truncated names.');
  const starts=[...new Set(rosterShotRows.map(r=>r.screenshotDutyStart))];
  if(new Set(rosterShotCrew.map(c=>c.start)).size!==rosterShotCrew.length)throw new Error('Use one Crew screenshot per duty and check the names.');
  const rows=rosterShotMerge(rosterShotRows);if(rows.some(r=>Object.keys(r._conflicts).length))throw new Error('The edited entries contain conflicting values for the same flight.');
  const plans=rows.map(row=>({row,candidates:rosterShotCandidates(row),fields:[]}));
  // Reuse explicit imported duty groups; never infer membership from a date alone.
  for(const start of starts){
   const linked=plans.filter(p=>p.row.screenshotDutyStart===start).flatMap(p=>p.candidates);
   const blockIds=new Set(linked.map(r=>r.aerolineBlockId).filter(Boolean)),rootIds=new Set(linked.map(r=>r.dutyRootId||r.dutyControl&&r.id).filter(Boolean));
   const members=coreActivityRows().filter(r=>isFlight(r)&&(r.screenshotDutyStart===start||blockIds.has(r.aerolineBlockId)||rootIds.has(r.dutyRootId||r.dutyControl&&r.id)));
   for(const member of members)if(!plans.some(p=>p.candidates.some(c=>c.id===member.id)))plans.push({row:{date:member.date,flightNo:member.flightNo,dep:member.dep,arr:member.arr,screenshotDutyStart:start},candidates:[member],fields:[],crewOnly:true});
  }
  rosterShotPlan=plans;
  for(const p of plans){
   p.targetId=p.candidates.length===1?p.candidates[0].id:p.candidates.length?'':'NEW';
   const crew=rosterShotCrew.find(c=>c.start===p.row.screenshotDutyStart);
   const proposed={...p.row};delete proposed._conflicts;
   if(crew)crew.names.forEach((n,i)=>proposed[ROSTER_SHOT_CREW[i]]=n.trim());
   if(!p.crewOnly){
    const first=rows.filter(r=>r.screenshotDutyStart===p.row.screenshotDutyStart).sort((a,b)=>`${a.date}T${a.schedOut}`.localeCompare(`${b.date}T${b.schedOut}`))[0];
    if(first===p.row||rosterShotIdentity(first)===rosterShotIdentity(p.row))proposed.onDuty=p.row.screenshotDutyStart.slice(11,16);
   }
   p.proposed=proposed;rosterShotPlanFields(p);
  }
  rosterShotReviewPlan();
 }catch(error){$('rosterScreenshotStatus').textContent=error.message}
}
function rosterShotValidStart(v){return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:00Z$/.test(v||'')&&Number.isFinite(Date.parse(v))}
function rosterShotPlanFields(p){
 const target=coreActivityRows().find(r=>r.id===p.targetId);p.baseline=target?JSON.stringify(target):'';
 p.fields=Object.entries(p.proposed).filter(([k,v])=>k!=='_conflicts'&&v!==undefined&&v!==null&&v!=='').map(([key,value])=>{
  const before=target?.[key],manual=target&&(entryManualField(target,key)||entryTimeOverride(target,key)||entryFieldSource(target,key)==='manual'||target.manualOverride===true&&before!==undefined&&before!==null&&before!=='');
  return {key,value,before,manual:!!manual,apply:!target||!manual&&(before===undefined||before===null||before===''),same:rosterShotSame(before,value)};
 });
}
function rosterShotReviewPlan(){
 const host=$('rosterScreenshotReview');host.replaceChildren();
 for(const p of rosterShotPlan){
  const card=document.createElement('div');card.className='card spaced';host.append(card);
  const h=document.createElement('h3');h.textContent=`${p.row.date} · ${p.row.flightNo} · ${p.row.dep} → ${p.row.arr}`;card.append(h);
  const select=document.createElement('select');
  if(p.candidates.length>1)select.append(new Option('Select the matching flight',''));
  if(!p.candidates.length)select.append(new Option('Create roster entry','NEW'));
  p.candidates.forEach(r=>select.append(new Option(`${r.date} ${r.flightNo} ${r.dep}–${r.arr} ${r.schedOut||''}${r.locked?' · LOCKED':''}`,r.id)));
  select.value=p.targetId;select.onchange=()=>{p.targetId=select.value;rosterShotPlanFields(p);rosterShotReviewPlan()};card.append(select);
  const target=coreActivityRows().find(r=>r.id===p.targetId);
  if(target?.locked){const warning=document.createElement('p');warning.textContent='This entry is locked.';card.append(warning)}
  for(const field of p.fields){
   if(field.same)continue;
   const label=document.createElement('label');label.style.display='block';const check=document.createElement('input');check.type='checkbox';check.style.width='auto';check.checked=field.apply;check.disabled=field.manual||!!target?.locked||!p.targetId;check.onchange=()=>field.apply=check.checked;
   label.append(check,document.createTextNode(` ${ROSTER_SHOT_FIELDS[field.key]||field.key}: ${field.before??'—'} → ${field.value}${field.manual?' · manual value retained':''}`));card.append(label);
  }
 }
 const edit=document.createElement('button');edit.className='secondary';edit.textContent='Review entries';edit.onclick=()=>rosterShotResolveView();host.append(edit);
 $('rosterScreenshotStatus').textContent='The duty starts at the recorded start time and provisionally ends 30 minutes after the last IN. Select a changed field to use the screenshot value. Manual overrides are preserved.';
 $('rosterScreenshotConfirm').classList.remove('hidden');
}
async function rosterShotConfirm(){
 if(rosterShotBusy)return;
 if(!rosterShotPlan.length||rosterShotPlan.some(p=>!p.targetId))return alert('Match each flight before confirming.');
 const targetIds=rosterShotPlan.filter(p=>p.targetId!=='NEW').map(p=>p.targetId);
 if(new Set(targetIds).size!==targetIds.length)return alert('Two flights match the same activity. Review the selected entries.');
 rosterShotBusy=true;rosterShotButtons();const before=coreActivityRows().map(r=>({...r})),changed=[];
 try{
  // Validate the entire batch before the first mutation.
  for(const p of rosterShotPlan){
   const target=before.find(r=>r.id===p.targetId);
   if(p.targetId==='NEW'&&rosterShotCandidates(p.row,before).length)throw new Error('This flight now exists. Reopen the preview to select the matching entry.');
   if(p.targetId!=='NEW'&&(!target||JSON.stringify(target)!==p.baseline))throw new Error('The entry changed during review. Open a new preview.');
   if(target?.locked)continue;
   const row=target?{...target,fieldSources:{...target.fieldSources}}:{id:makeActivityId(),recordKind:'activity',activityCategory:'OPERATIONAL',activityStatus:ACTIVITY_STATUS.PLANNED,dutyType:'Flight',source:'screenshot',locked:false,totalDuty:null,fieldSources:{}};
   let touched=false;
   for(const field of p.fields)if(field.apply&&!field.manual&&!field.same){row[field.key]=field.value;row.fieldSources[field.key]='screenshot';touched=true}
   if(touched)changed.push(stamp(row));
  }
  const after=before.map(r=>changed.find(c=>c.id===r.id)||r).concat(changed.filter(c=>!before.some(r=>r.id===c.id)));
  const starts=[...new Set(rosterShotPlan.map(p=>p.row.screenshotDutyStart))],newDuties=[];
  for(const start of starts){
   const members=after.filter(r=>isFlight(r)&&r.screenshotDutyStart===start).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
   if(!members.length)continue;
   const roots=members.filter(r=>r.dutyControl||r.dutyRootId);
   if(roots.length){
    const rootIds=[...new Set(roots.map(r=>r.dutyRootId||r.id))];
    if(rootIds.length!==1)throw new Error('These screenshots match different duties. Review the selected entries.');
    const root=after.find(r=>r.id===rootIds[0]);
    if(root?.dutyControl?.provisional===true){
      const control=provisionalDutyControl(root,members,root.dutyControl);
      for(const member of members){const updated=stamp(controlledDutyFields(member,root,control));after[after.findIndex(r=>r.id===member.id)]=updated;const pos=changed.findIndex(r=>r.id===member.id);if(pos<0)changed.push(updated);else changed[pos]=updated}
    }
    continue;
   }
   if(members.some(r=>r.locked))throw new Error('Unlock the locked flight before opening this duty.');
   newDuties.push({start,members});
  }
  for(const {start,members} of newDuties){
   // A saved historical release/duration is an existing duty; never migrate it here.
   if(members.some(r=>r.offDuty||entryHasTimeValue(r,'totalDuty')&&numericTime(r.totalDuty)>0))continue;
   const root=members[0],resolvedStart=root.onDuty?dutyClockOnDate(root.onDuty,new Date(start))?.toISOString()||start:start;
   const manualStart=entryManualField(root,'onDuty')||entryFieldSource(root,'onDuty')==='manual'||root.manualOverride===true&&!!root.onDuty;
   const control=provisionalDutyControl(root,members,{id:makeActivityId(),state:'OPEN',provisional:true,start:resolvedStart,startBasis:manualStart?'manual':'screenshot',end:'',memberIds:members.map(r=>r.id),totalDutyAtLast:true});
   for(const member of members){const updated=stamp(controlledDutyFields(member,root,control));after[after.findIndex(r=>r.id===member.id)]=updated;const pos=changed.findIndex(r=>r.id===member.id);if(pos<0)changed.push(updated);else changed[pos]=updated}
  }
  commitCoreActivities(after);
  try{await persistCoreActivities()}catch(error){commitCoreActivities(before);await persistCoreActivities();throw error}
  changed.forEach(row=>markCloudEdited('activities',row,'screenshot-import'));await persistCoreActivities();
  rosterShotDiscard();$('rosterScreenshotDialog').close();
  if(entryReturnContext?.view==='rosterView'){
   const row=activityById($('editId')?.value);if(row)loadEntryToForm(row,{rosterActivity:true});
  }
  await render();scheduleAutoSync('screenshot-import');
  alert(`${changed.length} roster entries created or completed.`);
 }catch(error){$('rosterScreenshotStatus').textContent=`Import failed: ${error.message}`}
 finally{rosterShotBusy=false;rosterShotButtons()}
}
function rosterShotButtons(){for(const id of ['rosterScreenshotAnalyze','rosterScreenshotConfirm','rosterScreenshotCancel','rosterScreenshotFiles'])$(id).disabled=rosterShotBusy}
function rosterShotCardHeaders(blocks){
 const lines=screenshotWordLines(screenshotBlockWords(blocks)),headers=[];
 for(const line of lines){
  if(!/\b(?:3[O0]|[A-Z]{2})\s*\d{2,4}\b/i.test(line.text))continue;
  const route=rosterShotParseFlight(line.text);
  // Both airport codes and the flight number must be visible; never infer a route.
  if(route.length&&(!headers.length||line.y0-headers.at(-1).y0>40))headers.push(line);
 }
 return headers;
}
async function rosterShotReadCards(worker,file,result){
 const headers=rosterShotCardHeaders(result.data.blocks||[]);
 if(!headers.length)return {rows:[],count:0};
 const bitmap=await createImageBitmap(file),rows=[];
 try{
  for(let i=0;i<headers.length;i++){
   const header=headers[i],margin=Math.max(12,(header.y1-header.y0)*.5),top=Math.max(0,Math.floor(header.y0-margin));
   const bottom=i+1<headers.length?Math.floor(headers[i+1].y0-margin):bitmap.height;
   if(bottom<=top)continue;
   const height=bottom-top,scale=Math.min(2,Math.sqrt(12000000/(bitmap.width*height)));
   const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(height*scale);
   const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
   context.drawImage(bitmap,0,top,bitmap.width,height,0,0,canvas.width,canvas.height);
   $('rosterScreenshotStatus').textContent=`Reading flight card ${i+1}/${headers.length}…`;
   try{const scan=await worker.recognize(canvas);rows.push(...rosterShotParseFlight(scan.data.text||''))}finally{canvas.width=0;canvas.height=0}
  }
 }finally{bitmap.close()}
 return {rows,count:headers.length};
}
async function rosterShotAnalyze(){
 if(rosterShotBusy||!rosterShotFiles.length)return;
 rosterShotBusy=true;rosterShotButtons();let worker;
 try{
  const T=await loadTesseractBrowser();worker=await T.createWorker('eng',1,{logger:m=>{if(m.status)$('rosterScreenshotStatus').textContent=`${m.status} ${Math.round((m.progress||0)*100)}%`}});
  rosterShotRows=[];rosterShotCrew=[];rosterShotPlan=[];$('rosterScreenshotConfirm').classList.add('hidden');
  if(T.PSM?.AUTO)await worker.setParameters({tessedit_pageseg_mode:T.PSM.AUTO});
  for(const file of rosterShotFiles){
   const result=await worker.recognize(file,{}, {blocks:true});const text=result.data.text||'';
   const wholeRows=rosterShotParseFlight(text),cardScan=await rosterShotReadCards(worker,file,result);
   const rows=rosterShotMerge([...wholeRows,...cardScan.rows]);
   const visibleDepartures=(text.match(/\bDEPARTURE\b/gi)||[]).length,expected=Math.max(cardScan.count,visibleDepartures);
   if(rows.length&&expected>rows.length)throw new Error(`Detected at least ${expected} flights. Only ${rows.length} could be read. Add separate screenshots for the missing flights.`);
   rosterShotRows.push(...rows);
   if(!rows.length&&/Nationality/i.test(text)){
    // Crop to the name column: photos, roles and contact icons are not imported.
    const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*.55);canvas.height=bitmap.height;
    canvas.getContext('2d').drawImage(bitmap,bitmap.width*.30,0,bitmap.width*.55,bitmap.height,0,0,canvas.width,canvas.height);bitmap.close();
    const namesResult=await worker.recognize(canvas);const names=rosterShotParseCrew(namesResult.data.text||'');canvas.width=0;canvas.height=0;
    if(names.length)rosterShotCrew.push({names,start:''});else throw new Error('The crew names could not be read. Add a clearer screenshot showing the full names.');
   }else if(!rows.length)throw new Error('Use a Flight Info or Crew screenshot.');
  }
  rosterShotRows=rosterShotMerge(rosterShotRows);rosterShotFiles=[];$('rosterScreenshotFiles').value='';
  if(!rosterShotRows.length&&rosterShotCrew.length&&entryReturnContext?.view==='rosterView'){
   const current=activityById($('editId')?.value),duty=controlledDuty(current),start=current?.screenshotDutyStart||duty?.control.start;
   if(current&&isFlight(current)&&start){
    const members=duty?dutySequenceFor(current):coreActivityRows().filter(r=>r.screenshotDutyStart===start&&isFlight(r));
    rosterShotRows=members.map(r=>({date:r.date,flightNo:r.flightNo,dep:r.dep,arr:r.arr,schedOut:r.schedOut,schedIn:r.schedIn,screenshotDutyStart:start,_conflicts:{}}));
   }
  }
  if(!rosterShotRows.length)throw new Error('Add a Flight Info screenshot to identify the duty start and flights.');
  rosterShotResolveView();$('rosterScreenshotStatus').textContent=`${rosterShotRows.length} flights read. Review them before opening the preview.`;
 }catch(error){$('rosterScreenshotStatus').textContent=`Unable to read screenshot: ${error.message}`}
 finally{if(worker)await worker.terminate();rosterShotBusy=false;rosterShotButtons()}
}
document.addEventListener('DOMContentLoaded',()=>{
 $('rosterList').addEventListener('click',event=>{if(event.target.closest('[data-roster-shot]'))rosterShotOpen()});$('completeEntryScreenshot').onclick=rosterShotOpen;
 $('rosterScreenshotFiles').onchange=e=>{rosterShotFiles.push(...e.target.files);e.target.value='';rosterShotRows=[];rosterShotCrew=[];rosterShotPlan=[];$('rosterScreenshotReview').replaceChildren();$('rosterScreenshotConfirm').classList.add('hidden');$('rosterScreenshotStatus').textContent=`${rosterShotFiles.length} screenshots selected.`};
 $('rosterScreenshotAnalyze').onclick=rosterShotAnalyze;$('rosterScreenshotConfirm').onclick=rosterShotConfirm;
 $('rosterScreenshotCancel').onclick=()=>{if(!rosterShotBusy){rosterShotDiscard();$('rosterScreenshotDialog').close()}};
 $('rosterScreenshotDialog').addEventListener('cancel',e=>{if(rosterShotBusy)e.preventDefault();else rosterShotDiscard()});
 // Show the same acquisition command when editing an activity reached from Roster.
 const original=setEntryReturnContext;setEntryReturnContext=function(view,id=''){original(view,id);$('completeEntryScreenshotWrap').classList.toggle('hidden',view!=='rosterView')};
});

})();
