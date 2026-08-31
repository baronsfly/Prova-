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
const VERSION='8.6';
const FLIGHTS_KEY='pilotlog7_flights_v1', ROSTER_KEY='pilotlog7_roster_v1', DUTY_KEY='pilotlog7_duties_v1', TRIPS_KEY='pilotlog7_trips_v1', PAY_SETTINGS_KEY='pilotlog7_pay_settings_v1', PAY_MONTH_KEY='pilotlog7_pay_month_v1', FX_KEY='pilotlog7_fx_v1', APP_SETTINGS_KEY='pilotlog7_app_settings_v1', LAST_EMAIL_KEY='pilotlog7_last_email_v1', ENTRY_DRAFT_KEY='pilotlog7_entry_draft_v1', ENTRY_DRAFTS_KEY='pilotlog8_entry_drafts_v1', CLOUD_TOMBSTONES_KEY='pilotlog7_local_delete_queue_v1', SYNC_LEDGER_KEY='pilotlog8_sync_ledger_v1', EXPIRY_KEY='pilotlog7_expiry_v1', LOGTEN_ARCHIVE_META_KEY='pilotlog7_logten_archive_meta_v1', AEROLINE_CONFIG_KEY='pilotlog7_aeroline_config_v1', SYNC_DEVICE_KEY='pilotlog7_device_v1';
const SYNC_PROTOCOL='db8', SYNC_READY_KEY='pilotlog7_database_initialized', CLOUD_DIRTY_KEY='pilotlog7_cloud_dirty_v1', CLOUD_BASE_REV_KEY='pilotlog7_cloud_base_revision_v1', CLOUD_PENDING_IMPORT_KEY='pilotlog7_cloud_pending_import_v1';
const $=id=>document.getElementById(id);
const LEGACY_FLIGHT_BACKUP_KEY='pilotlog7_flights_backup_v1';
const FLIGHT_DB_NAME='pilotlog7-core-data',FLIGHT_DB_STORE='records',FLIGHT_DB_RECORD='flights-v1',FLIGHT_DB_META_KEY='pilotlog7_flights_idb_meta_v1';
let flightCache=null,flightStoreReady=false,flightPersistActive=false,flightPersistDirty=false,flightPersistTimer=null,flightPersistPromise=Promise.resolve();
function legacyLocalFlights(){try{const v=JSON.parse(localStorage.getItem(FLIGHTS_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
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
async function writeFlightStore(rows){
  const data=Array.isArray(rows)?rows:[];
  const db=await openFlightStoreDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(FLIGHT_DB_STORE,'readwrite');tx.objectStore(FLIGHT_DB_STORE).put(data,FLIGHT_DB_RECORD);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('PilotLog data write aborted'))})}
  finally{db.close()}
  try{localStorage.setItem(FLIGHT_DB_META_KEY,JSON.stringify({count:data.length,updatedAt:new Date().toISOString()}))}catch{}
  return true;
}
async function initFlightStore(){
  const localRows=legacyLocalFlights(),hasMeta=!!localStorage.getItem(FLIGHT_DB_META_KEY);
  try{
    const dbRows=await readFlightStore();
    if(hasMeta&&Array.isArray(dbRows))flightCache=dbRows;
    else if(localRows.length){flightCache=localRows;await writeFlightStore(flightCache)}
    else if(Array.isArray(dbRows))flightCache=dbRows;
    else{flightCache=[];await writeFlightStore(flightCache)}
    flightStoreReady=true;
    try{localStorage.removeItem(FLIGHTS_KEY);localStorage.removeItem(LEGACY_FLIGHT_BACKUP_KEY)}catch{}
    try{if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{})}catch{}
  }catch(e){
    console.warn('IndexedDB logbook unavailable; using legacy localStorage mode',e);
    flightCache=localRows;flightStoreReady=false;
  }
  return flightCache;
}
function queueFlightPersist(){
  flightPersistDirty=true;
  if(!flightStoreReady)return Promise.resolve(false);
  if(flightPersistTimer){clearTimeout(flightPersistTimer);flightPersistTimer=null}
  if(flightPersistActive)return flightPersistPromise;
  flightPersistActive=true;
  flightPersistPromise=(async()=>{
    try{while(flightPersistDirty){flightPersistDirty=false;await writeFlightStore(flightCache)}}
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
async function saveFlightsDurable(rows){
  flightCache=Array.isArray(rows)?rows:[];
  if(!flightStoreReady){setLocalJson(FLIGHTS_KEY,flightCache);return true}
  await flushFlightStore();return true;
}
const load=k=>{if(k===FLIGHTS_KEY)return Array.isArray(flightCache)?flightCache:legacyLocalFlights();try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return[]}};
function setLocalJson(k,v){
  const text=JSON.stringify(v);
  try{localStorage.setItem(k,text);return true}
  catch(e){
    const quota=e?.name==='QuotaExceededError'||e?.name==='NS_ERROR_DOM_QUOTA_REACHED'||e?.code===22||e?.code===1014;
    if(quota&&k!==LEGACY_FLIGHT_BACKUP_KEY){try{localStorage.removeItem(LEGACY_FLIGHT_BACKUP_KEY);localStorage.setItem(k,text);return true}catch{}}
    throw e;
  }
}
const save=(k,v)=>{
  if(k===FLIGHTS_KEY){
    flightCache=Array.isArray(v)?v:[];
    if(flightStoreReady)scheduleFlightPersist();
    else setLocalJson(k,flightCache);
    return true;
  }
  return setLocalJson(k,v);
};
const loadObject=(k,def={})=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?v:def}catch{return def}};
const recordRevision=o=>Math.max(0,Number(o?._syncRev)||0);
const stamp=o=>({...o,_syncRev:recordRevision(o)+1,_updatedAt:new Date().toISOString()});
const today=()=>new Date().toISOString().slice(0,10);
function makeId(){
  if(globalThis.crypto?.randomUUID)return `pl-${crypto.randomUUID()}`;
  const a=new Uint32Array(4);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(a);else for(let i=0;i<4;i++)a[i]=(Math.random()*0xffffffff)>>>0;
  return `pl-${[...a].map(v=>v.toString(16).padStart(8,'0')).join('-')}`;
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
function canonicalRecordId(kind,o){const sk=syncSourceKey(o);return sk?stableSourceId(kind,sk):(o?.id||makeId())}
function normalizeRecordIdentity(kind,o){if(!o||typeof o!=='object')return o;const id=canonicalRecordId(kind,o);return o.id===id?o:{...o,id,_legacyId:o.id||''}}
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
    'Simulator':Object.freeze({editor:'entry',credit:'sim-settings',trip:'duty',totals:'simulator',rosterEditLocked:true}),
    'Ground Course':Object.freeze({editor:'entry',credit:'ground-settings',trip:'fixed-ground',totals:'other',rosterEditLocked:true}),
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
function syncSimulatorDutySchedule(){if($('dutyTypeFlight')?.value!=='Simulator')return;const start=$('onDuty')?.value||'',end=$('offDuty')?.value||'';$('schedOut').value=start?shiftTime(start,-90):'';$('schedIn').value=end?shiftTime(end,30):'';if($('simulatorTimeDisplay'))$('simulatorTimeDisplay').value=fmt(start&&end?timeSpanMins(start,end):0)}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const csv=s=>`"${String(s??'').replace(/"/g,'""')}"`;
const dateOnly=d=>new Date(`${d}T00:00:00Z`);


const entrySuggestionDb={crew:[],types:[]};
function refreshEntrySuggestions(){
  const fs=load(FLIGHTS_KEY),names=new Set(),types=new Set();
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
  merged.id=primary.id||secondary.id||makeId();
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
  if(isFlight(f))return true;
  if(isSim(f))return simulatorCompleted(f,now);
  return false;
}
function isGround(f){return canonicalDutyType(f?.dutyType||'')==='Ground Course'}
function isDhd(f){return canonicalDutyType(f?.dutyType||'')==='DHD'}
function isDhp(f){return canonicalDutyType(f?.dutyType||'')==='DHP'}
function isPositioning(f){return isDhd(f)||isDhp(f)}
function isStby(f){return canonicalDutyType(f?.dutyType||'')==='STBY'}
function picMins(f){return isFlight(f)&&f.role==='PIC'?Number(f.block)||0:0}
function sicMins(f){return isFlight(f)&&f.role==='SIC'?Number(f.block)||0:0}
function flightInstrMins(f){return isFlight(f)&&f.instructionType==='Flight Instruction'?(Number(f.block)||0):0}
function simInstrMins(f){return isSim(f)&&f.instructionType==='SFI/SFE Instruction Sim'?(Number(f.simulatorTime)||Number(f.block)||0):0}

function isA320Entry(f){
  const raw=upper([f.type,f.aircraftType,f.category,f.remarks].filter(Boolean).join(' '));
  const norm=raw.replace(/A32O/g,'A320').replace(/[^A-Z0-9]/g,'');
  return norm.includes('A320');
}
function totalFlightMins(f){return isFlight(f)?Number(f.block)||Number(f.flight)||0:0}

const APP_DEFAULTS={homeBase:'CMN',flightPrefix:'MAC',aircraftPrefix:'CN-NM',profileName:'',profileRole:'Captain'};
function appSettings(){return {...APP_DEFAULTS,...loadObject(APP_SETTINGS_KEY,{})}}
function saveAppSettings(v){localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify({...appSettings(),...v,_updatedAt:new Date().toISOString()}))}
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
  if(rule.credit==='sim-settings')return Math.round(Number(paySettings().simCredit||0)*60);
  if(rule.credit==='ground-settings')return Math.round(Number(paySettings().groundCredit||0)*60);
  if(rule.credit==='zero')return 0;
  return Math.max(0,Number(f?.credit)||0);
}
function calculateActivityMetrics(f,allEntries=null){
  const dutyType=canonicalDutyType(f?.dutyType||'Flight'),flight=dutyType==='Flight',sim=dutyType==='Simulator',positioning=dutyType==='DHD'||dutyType==='DHP';
  const schedBlock=(flight||positioning)?timeSpanMins(f?.schedOut||'',f?.schedIn||''):0;
  const block=flight?timeSpanMins(f?.out||'',f?.in||''):0;
  const flightMins=flight?timeSpanMins(f?.off||'',f?.on||''):0;
  const simulatorTime=sim?timeSpanMins(f?.onDuty||'',f?.offDuty||''):0;
  const credit=creditMinsForEntry({...f,dutyType,schedBlock,simulatorTime},allEntries);
  return{dutyType,schedBlock,block,flight:flightMins,simulatorTime,credit};
}
function formActivityInput(){
  const dutyType=canonicalDutyType($('dutyTypeFlight')?.value||'Flight');
  return{id:$('editId')?.value||'',dutyType,date:$('date')?.value||'',flightNo:composeFlightNo($('flightNo')?.value||''),dep:upper($('dep')?.value||''),arr:upper($('arr')?.value||''),schedOut:$('schedOut')?.value||'',schedIn:$('schedIn')?.value||'',onDuty:$('onDuty')?.value||'',offDuty:$('offDuty')?.value||'',out:$('out')?.value||'',off:$('off')?.value||'',on:$('on')?.value||'',in:$('in')?.value||'',credit:dutyType==='DHP'?durMins($('creditDisplay')?.value||'0:00'):Number(load(FLIGHTS_KEY).find(x=>x.id===$('editId')?.value)?.credit)||0};
}
function formCredit(dutyType){return calculateActivityMetrics({...formActivityInput(),dutyType:canonicalDutyType(dutyType)}).credit}


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
  return load(FLIGHTS_KEY).filter(isFlight).sort((a,b)=>
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
    $('creditDisplay').readOnly=true;$('creditDisplay').value=fmt(formCredit(dt));
    $('calcPreview').classList.remove('hidden');renderEntryDraftShelf();return;
  }

  if(sim){
    const hide=['flightNo','dep','arr','schedBlock','out','off','on','in','block','role','seatPosition','night','ifr','pf','approachType','delayReason'];
    hide.forEach(id=>$(id)?.closest('[data-entry-field]')?.classList.add('hidden'));
    $('simLocation')?.closest('[data-entry-field]')?.classList.remove('hidden');
    $('simulatorTimeDisplay')?.closest('[data-entry-field]')?.classList.remove('hidden');
    if($('regLabel'))$('regLabel').textContent='Sim registration';
    if($('aircraftPrefixLabel'))$('aircraftPrefixLabel').style.display='none';
    $('reg').placeholder='SIM-01';
    if($('onDutyLabel'))$('onDutyLabel').textContent='Simulator start (Z)';
    if($('offDutyLabel'))$('offDutyLabel').textContent='Simulator end (Z)';
    if($('schedOutLabel'))$('schedOutLabel').textContent='Schedule OUT / report (auto)';
    if($('schedInLabel'))$('schedInLabel').textContent='Schedule IN / end duty (auto)';
    $('schedOut').readOnly=true;$('schedIn').readOnly=true;
    ['out','off','on','in'].forEach(id=>$(id).value='');
    $('night').value='00:00';$('ifr').value='no';$('seatPosition').value='';
    ['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);
    ['breakdownTitle','breakdownGrid','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    $('creditDisplay').readOnly=true;syncSimulatorDutySchedule();$('creditDisplay').value=fmt(formCredit(dt));
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
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');if(dutyType==='Simulator')syncSimulatorDutySchedule();
  const c=calculateActivityMetrics({...formActivityInput(),dutyType});
  $('schedBlockDisplay').value=fmt(c.schedBlock);$('blockDisplay').value=fmt(c.block);$('creditDisplay').value=dutyType==='DHP'?$('creditDisplay').value:fmt(c.credit);
  const role=$('role').value,inst=$('instructionType').value;
  $('totalTimeDisplay').value=fmt(dutyType==='Flight'?c.block:0);if($('simulatorTimeDisplay'))$('simulatorTimeDisplay').value=fmt(c.simulatorTime);
  $('picDisplay').value=fmt(dutyType==='Flight'&&role==='PIC'?c.block:0);$('sicDisplay').value=fmt(dutyType==='Flight'&&role==='SIC'?c.block:0);
  $('flightInstructionDisplay').value=fmt(dutyType==='Flight'&&inst==='Flight Instruction'?c.block:0);$('simInstructionDisplay').value=fmt(dutyType==='Simulator'&&inst==='SFI/SFE Instruction Sim'?c.simulatorTime:0);
  if(dutyType==='DHD'||dutyType==='DHP')$('calcPreview').textContent=`${dutyType} • ${$('dep').value||'—'} → ${$('arr').value||'—'} • ${$('schedOut').value||'--:--'}–${$('schedIn').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Ground Course')$('calcPreview').textContent=`Ground Course • ${$('dep').value||'—'} • ${$('courseType').value||'Course'}${$('onDuty').value?' • Start '+$('onDuty').value+' Z':''} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='STBY')$('calcPreview').textContent=`STBY • ${$('dep').value||'—'} • ${$('onDuty').value||'--:--'}–${$('offDuty').value||'--:--'} • Credit ${fmt(c.credit)}`;
  else if(dutyType==='Simulator')$('calcPreview').textContent=`Simulator ${fmt(c.simulatorTime)} • Credit ${fmt(c.credit)} (Settings) • report ${$('schedOut').value||'--:--'} / end duty ${$('schedIn').value||'--:--'}`;
  else{const premium=dutyGetsMoroccoNightPremium({...formActivityInput(),dutyType:'Flight'})?' • Morocco Night +50%':'';$('calcPreview').textContent=`Schedule Block ${fmt(c.schedBlock)} • Actual Block ${fmt(c.block)} • Flight ${fmt(c.flight)} • Credit ${fmt(c.credit)}${premium}`}
  updateDelayUI();return c;
}

/* Duty + EASA FTL — one deterministic operational-duty engine. */
function dtFromZulu(date,time){return zuluDate(date,time)}
function dutyDateEnd(date,start,end){const s=dtFromZulu(date,start),e=dtFromZulu(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return[s,e]}
function entryChrono(f){const t=f.schedOut||f.out||f.onDuty||'00:00';return `${f.date}T${t}`}
function dayEntries(date,fs=load(FLIGHTS_KEY)){return fs.filter(f=>f.date===date).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)))}
function externalDutyForDate(date){return load(DUTY_KEY).filter(d=>d.date===date).sort((a,b)=>(a.report||'').localeCompare(b.report||''))[0]||null}

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
function buildDutySessions(fs=load(FLIGHTS_KEY)){
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
  const fs=load(FLIGHTS_KEY),before=new Map(fs.map(f=>[f.id,`${f.onDuty||''}|${f.offDuty||''}|${Number(f.totalDuty)||0}|${Number(f.sectors)||0}`]));
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
  if(changed)save(FLIGHTS_KEY,fs);
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
  return sum(load(FLIGHTS_KEY).filter(isFlight),f=>{const d=dateOnly(f.date);return d>=c&&d<=now?(Number(f.block)||0):0});
}
function rollingDuty(n,now=new Date(),sessions=buildDutySessions()){
  const start=startOfDays(n,now);
  return sessions.reduce((total,s)=>{
    const a=new Date(Math.max(s.startDateTime.getTime(),start.getTime())),b=new Date(Math.min(s.endDateTime.getTime(),now.getTime()));
    return total+(b>a?Math.round((b-a)/60000):0);
  },0);
}
function calendarYearFlight(now=new Date()){const y=now.getUTCFullYear();return sum(load(FLIGHTS_KEY).filter(isFlight),f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d<=now?Number(f.block)||0:0})}
function rollingCalendar12Flight(now=new Date()){const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1));return sum(load(FLIGHTS_KEY).filter(isFlight),f=>{const d=dateOnly(f.date);return d>=start&&d<=now?Number(f.block)||0:0})}
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
  let removedRoster=0,removedEntries=0;
  let rs=[...load(ROSTER_KEY)];
  for(let i=0;i<rs.length;i++){
    for(let j=i+1;j<rs.length;){
      if(!rosterSectorSameIdentity(rs[i],rs[j])){j++;continue}
      const keep=mergeRosterSector(rs[i],rs[j]);
      const removedId=keep.id===rs[i].id?rs[j].id:rs[i].id;
      if(removedId)markCloudDeleted('roster',removedId,{includeSource:false});
      keep.id=keep.id||rs[i].id||rs[j].id||makeId();
      rs[i]=keep;rs.splice(j,1);removedRoster++;
    }
  }
  if(removedRoster)save(ROSTER_KEY,rs);

  let fs=[...load(FLIGHTS_KEY)];
  let changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<fs.length;i++)for(let j=i+1;j<fs.length;j++){
      if(!rosterActivitySameIdentity(fs[i],fs[j]))continue;
      const merged=mergeRosterActivity(fs[i],fs[j]);
      const keepId=merged.id||fs[i].id||fs[j].id||makeId();
      const removedId=keepId===fs[i].id?fs[j].id:fs[i].id;
      if(removedId)markCloudDeleted('flights',removedId,{includeSource:false});
      merged.id=keepId;fs[i]=merged;fs.splice(j,1);removedEntries++;changed=true;break outer;
    }
  }
  if(removedEntries){
    snapshotFlights('before-roster-dedupe');
    save(FLIGHTS_KEY,fs);
    reconcileAllDuties();
  }
  if(removedRoster||removedEntries)scheduleAutoSync('roster-dedupe',900);
  return removedRoster+removedEntries;
}

function rosterGroups(){
  const home=upper(appSettings().homeBase||'CMN');
  const rs=load(ROSTER_KEY).sort((a,b)=>`${a.date}${a.std||''}`.localeCompare(`${b.date}${b.std||''}`));
  const ds=load(DUTY_KEY),by={},groups=[];

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
  const activities=load(FLIGHTS_KEY).filter(f=>
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
      status:f.locked?'done':'planned',
      sortTime:start||'99:99',
      courseType:f.courseType||'',
      aircraftType:f.type||'',
      flightNo:f.flightNo||'',
      remarks:f.remarks||''
    });
  });

  // A few calendar duties can exist only in DUTY_KEY. Surface them if an
  // equivalent non-flight Entry is not already present.
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
      dep:home,arr:home,sectors:0,status:'planned',
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
  if(!r)return null;
  const fs=load(FLIGHTS_KEY).filter(isFlight);
  const linked=fs.find(f=>f.rosterItemId===r.id)||(r.aerolineKey?fs.find(f=>f.rosterAerolineKey===r.aerolineKey):null);
  if(linked)return linked;
  const digits=rosterFlightDigits(r.flightNo||'');
  return fs.find(f=>
    f.date===r.date&&
    rosterFlightDigits(f.flightNo||'')===digits&&
    upper(f.dep||'')===upper(r.dep||'')&&upper(f.arr||'')===upper(r.arr||'')
  )||null;
}
function rosterSectorCompleted(r){return !!savedEntryForRosterSector(r)}
function markRosterSectorCompleted(rosterId,entry){
  if(!rosterId||!entry)return false;
  const rs=load(ROSTER_KEY),i=rs.findIndex(r=>r.id===rosterId);if(i<0)return false;
  rs[i]=stamp({...rs[i],status:'done',completedEntryId:entry.id,completedAt:new Date().toISOString()});
  save(ROSTER_KEY,rs);markCloudEdited('roster',rs[i],'complete');return true;
}
function markRosterSectorIncompleteForEntry(entry){
  if(!entry)return false;
  const rs=load(ROSTER_KEY);let changed=false;
  rs.forEach((r,i)=>{
    const linked=(entry.rosterItemId&&r.id===entry.rosterItemId)||(entry.rosterAerolineKey&&r.aerolineKey===entry.rosterAerolineKey)||
      (r.date===entry.date&&rosterFlightDigits(r.flightNo||'')===rosterFlightDigits(entry.flightNo||'')&&upper(r.dep||'')===upper(entry.dep||'')&&upper(r.arr||'')===upper(entry.arr||''));
    if(linked){rs[i]=stamp({...r,status:'planned',completedEntryId:'',completedAt:''});markCloudEdited('roster',rs[i],'incomplete');changed=true}
  });
  if(changed)save(ROSTER_KEY,rs);return changed;
}
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
  if(!groups.length)return'<div class="empty">No upcoming roster.</div>';
  let html='';

  for(const g of groups){
    const type=canonicalDutyType(g.activityType||'Duty','Duty'),u=upper(type);

    if(u==='DAY OFF'||u==='OFF'){
      html+=`<div class="rowitem roster-day-off"><div><b>${esc(displayDate(g.date))} • Day OFF</b>${g.remarks?`<div class="small">${esc(g.remarks)}</div>`:''}</div><div class="meta"><span class="small">OFF</span>${interactive&&g.dutyId?`<div class="list-actions"><button class="secondary" data-edit-roster-duty="${g.dutyId}">Edit</button></div>`:''}</div></div>`;
      continue;
    }

    const start=g.start?await localTime(g.date,g.start,g.dep):'--:--';
    const end=g.end?await localTime(g.date,g.end,g.arr||g.dep):'--:--';

    if(g.kind==='flight'){
      const info=[...new Set(g.items.map(r=>r.aerolineTrainingLabel||r.aerolineTrainingDesc||'').filter(Boolean))];
      const completed=g.items.filter(rosterSectorCompleted).length,allCompleted=completed===g.items.length;
      html+=`<div class="rowitem ${allCompleted?'roster-all-completed':''}"><div><b>${esc(displayDate(g.date))} • ${g.sectors} flight${g.sectors===1?'':'s'}</b><div class="small">${esc(g.dep)} → ${esc(g.arr)}${info.length?` • ${info.map(esc).join(' / ')}`:''}${completed?` • ${completed}/${g.items.length} completed`:''}</div></div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time</span>${interactive?`<div class="list-actions">${g.items.map(r=>{const done=rosterSectorCompleted(r);return `<button class="${done?'roster-sector-completed':'secondary'}" data-roster-action="${r.id}">${done?'✓ ':''}${esc(r.flightNo?rosterFlightLabel(r.flightNo):'Open')}${r.aerolineTrainingLabel?` • ${esc(r.aerolineTrainingLabel)}`:''}</button>`}).join('')}</div>`:''}</div></div>`;
      continue;
    }

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
    if(interactive&&g.entryId)action=`<div class="list-actions"><button class="secondary" data-edit-roster-entry="${g.entryId}">Edit</button></div>`;
    else if(interactive&&g.dutyId)action=`<div class="list-actions"><button class="secondary" data-edit-roster-duty="${g.dutyId}">Edit</button></div>`;

    html+=`<div class="rowitem"><div><b>${esc(displayDate(g.date))} • ${esc(type)}</b>${detail?`<div class="small">${detail}</div>`:''}</div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time</span>${action}</div></div>`;
  }

  return html;
}

/* Roster is the primary planning source. Logbook remains the record of completed flights/simulator work. */
function rosterMonthAvailable(month){
  if(!month)return false;
  return load(ROSTER_KEY).some(r=>inMonth(r.date,month)) ||
    load(FLIGHTS_KEY).some(f=>inMonth(f.date,month)&&f.aerolineRosterPlanned) ||
    load(DUTY_KEY).some(d=>inMonth(d.date,month)&&d.aerolineRosterPlanned);
}
function rosterSyntheticFlight(r){
  if(!r)return null;
  const linked=savedEntryForRosterSector(r);
  // Payroll remains Roster-primary, but a completed/linked sector must use the
  // preserved Scheduled OUT/IN from its Logbook entry. AeroLINE roster values
  // can later reflect revised/operational times and must never replace the
  // original scheduled times used for Credit H.
  const schedOut=linked?.schedOut||r.std||'',schedIn=linked?.schedIn||r.sta||'';
  return {
    id:`roster-plan:${r.id}`,
    dutyType:'Flight',date:r.date,flightNo:composeFlightNo(r.flightNo||''),
    dep:upper(r.dep||''),arr:upper(r.arr||''),type:upper(r.type||''),reg:upper(r.reg||''),
    schedOut,schedIn,schedBlock:timeSpanMins(schedOut,schedIn),
    out:'',off:'',on:'',in:'',block:0,flight:0,
    role:linked?.role||'PIC',seatPosition:linked?.seatPosition||'',
    callFromDayOff:!!linked?.callFromDayOff,
    instructionType:r.instructionType||linked?.instructionType||'',night:'00:00',sim:'no',ifr:'yes',
    pf:linked?.pf||'no',approachType:linked?.approachType||'',
    picName:linked?.picName||upper(appSettings().profileName||''),sicName:r.sicName||linked?.sicName||'',
    soName:linked?.soName||'',instructorName:r.instructorName||linked?.instructorName||'',
    remarks:r.remarks||r.aerolineTrainingLabel||'',source:'roster',
    rosterItemId:r.id,rosterAerolineKey:r.aerolineKey||'',_payrollRosterSynthetic:true
  };
}
function rosterPlanningEntriesForMonth(month){
  const plannedFlights=dedupeRosterItems(load(ROSTER_KEY).filter(r=>inMonth(r.date,month))).map(rosterSyntheticFlight).filter(Boolean);
  const activities=load(FLIGHTS_KEY).filter(f=>inMonth(f.date,month)&&!isFlight(f)&&String(f.source||'').toLowerCase()!=='logten');
  return [...plannedFlights,...activities].sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
}
function operationalEntriesForMonth(month){
  if(rosterMonthAvailable(month))return rosterPlanningEntriesForMonth(month);
  const logten=load(FLIGHTS_KEY).filter(f=>inMonth(f.date,month)&&String(f.source||'').toLowerCase()==='logten');
  if(logten.length)return logten;
  return load(FLIGHTS_KEY).filter(f=>inMonth(f.date,month)&&!f.aerolineRosterPlanned);
}
function operationalEntriesForTrips(){
  const fs=load(FLIGHTS_KEY),months=new Set();
  [...load(ROSTER_KEY),...fs,...load(DUTY_KEY)].forEach(x=>{const m=String(x?.date||'').slice(0,7);if(m)months.add(m)});
  const out=[];
  [...months].sort().forEach(month=>{
    if(rosterMonthAvailable(month)){
      out.push(...rosterPlanningEntriesForMonth(month));
      // Manual non-flight adjustments are allowed; LogTen rows are not mixed into a roster month.
      out.push(...fs.filter(f=>inMonth(f.date,month)&&!isFlight(f)&&!f.aerolineRosterPlanned&&String(f.source||'').toLowerCase()!=='logten'));
    }else out.push(...operationalEntriesForMonth(month));
  });
  const seen=new Set();
  return out.filter(f=>{
    const k=f.id||[f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.onDuty].join('|');
    if(seen.has(k))return false;seen.add(k);return true;
  }).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
}

/* Trips */
function overlapMins(a,b,s,e){const x=Math.max(a.getTime(),s.getTime()),y=Math.min(b.getTime(),e.getTime());return Math.max(0,Math.round((y-x)/60000))}
function tripChargeableDutyFromEntries(s,e,sourceEntries){
  let total=0;const fs=(sourceEntries||[]).filter(f=>f.date),dates=[...new Set(fs.map(f=>f.date).filter(Boolean))];
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
  const rule=activityRule(f);if(rule.trip==='zero')return isStby(f)?'Not deducted':'Excluded from duty';if(rule.trip==='credit')return`Credit ${fmt(creditMinsForEntry(f))} deducted`;if(rule.trip==='fixed-ground')return`${fmt(PILOTLOG_RULES.fixed.groundTripDutyMins)} fixed duty`;return'Included in duty';
}

function tripChargeableDuty(s,e){return tripChargeableDutyFromEntries(s,e,operationalEntriesForTrips())}
function tripCalc(){
  const s=new Date($('tripStart').value),e=new Date($('tripEnd').value);if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||e<=s){$('tripLayover').value='0:00';$('tripAllowance').value='0.00';return null}
  const trip=Math.round((e-s)/60000),duty=tripChargeableDuty(s,e),lay=Math.max(0,trip-duty),allowance=(lay/60)*Number(paySettings().layoverRate||0);
  $('tripLayover').value=fmt(lay);$('tripAllowance').value=allowance.toFixed(2);return{trip,duty,layover:lay,allowance}
}
async function tripCashConversion(){
  const amount=Number($('tripCashAmount')?.value||0),currency=upper($('tripCashCurrency')?.value||'');
  if(!$('tripCashEur'))return null;
  if(!(amount>0)||!currency){$('tripCashEur').value='';return null}
  if(currency==='EUR'){$('tripCashEur').value=amount.toFixed(2);return{rate:1,eur:amount,date:''}}
  const date=String($('tripStart')?.value||'').slice(0,10)||today();
  try{
    const r=await fetch(`https://${date}.currency-api.pages.dev/v1/currencies/eur.json`,{cache:'no-store'});
    if(!r.ok)throw new Error('FX unavailable');
    const j=await r.json(),rate=Number(j?.eur?.[currency.toLowerCase()]);
    if(!(rate>0))throw new Error('Currency unavailable');
    const eur=amount/rate;$('tripCashEur').value=eur.toFixed(2);return{rate,eur,date:j.date||date};
  }catch{$('tripCashEur').value='';return null}
}
function resetTrip(){$('tripForm').reset();$('tripEditId').value='';$('tripLayover').value='0:00';$('tripAllowance').value='0.00';if($('tripCashEur'))$('tripCashEur').value=''}
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

    const trip=Math.round((end-start)/60000);
    const duty=tripChargeableDuty(start,end);
    const layover=Math.max(0,trip-duty);
    const allowance=(layover/60)*Number(paySettings().layoverRate||0);
    const startStr=localDateTimeValue(start),endStr=localDateTimeValue(end);
    const sig=`AUTO|${startStr}|${endStr}|${base}`;

    const k=ts.findIndex(t=>t.autoSig===sig||t.autoSourceId===f.id);
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
      cashEur:k>=0?Number(ts[k].cashEur||0):0,
      cashFxRate:k>=0?Number(ts[k].cashFxRate||0):0,
      cashFxDate:k>=0?String(ts[k].cashFxDate||''):''
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
  let fs=load(FLIGHTS_KEY),rs=load(ROSTER_KEY),ds=load(DUTY_KEY),seenF=new Set(fs.map(entrySig)),seenR=new Set(rs.map(r=>[r.date,r.flightNo,r.dep,r.arr,r.std,r.sta].map(x=>upper(x)).join('|'))),seenD=new Set(ds.map(dutySig));let sectors=0,duties=0,other=0,skipped=0;
  events.forEach(ev=>{const c=classify(ev.SUMMARY),z=zuluTimes(ev.DESCRIPTION),date=ev._start.date;if(['ignore','unknown'].includes(c.kind)){skipped++;return}
    if(c.kind==='flight'){const std=z.out||ev._start.time||'',sta=z.inn||(ev._end?.time||''),r={id:makeId(),date,flightNo:rosterFlightLabel(c.flightNo),dep:c.dep,arr:c.arr,std,sta,status:'planned',source:'calendar'};const sr=[r.date,r.flightNo,r.dep,r.arr,r.std,r.sta].map(x=>upper(x)).join('|');if(!seenR.has(sr)){rs.push(r);seenR.add(sr)}
      const f=stamp({id:makeId(),dutyType:'Flight',date,flightNo:composeFlightNo(c.flightNo),dep:c.dep,arr:c.arr,type:'',reg:'',schedOut:std,schedIn:sta,schedBlock:timeSpanMins(std,sta),onDuty:'',offDuty:'',out:'',off:'',on:'',in:'',block:0,flight:0,credit:creditMinsForEntry({dutyType:'Flight',date,dep:c.dep,schedOut:std,schedIn:sta,schedBlock:timeSpanMins(std,sta)}),role:'PIC',instructionType:'',night:'00:00',sim:'no',ifr:'yes',pf:'yes',approachType:'',dayTakeoffs:1,nightTakeoffs:0,dayLandings:1,nightLandings:0,remarks:'Imported from calendar',source:'calendar'});const sf=entrySig(f);if(!seenF.has(sf)){fs.push(f);seenF.add(sf);sectors++}else skipped++;return}
    if(c.kind==='duty'){const rep=z.report||ev._start.time||'',end=z.end||(ev._end?.time||''),d=stamp({id:makeId(),date,type:c.dutyType,report:rep,end,minutes:timeSpanMins(rep,end),notes:ev.SUMMARY||'',source:'calendar'}),sd=dutySig(d);if(!seenD.has(sd)){ds.push(d);seenD.add(sd);duties++}else skipped++;return}
    if(c.kind==='entry'){const start=ev._start.time||'',end=ev._end?.time||'',sim=c.dutyType==='Simulator',ground=c.dutyType==='Ground Course',f=stamp({id:makeId(),dutyType:c.dutyType,date,flightNo:'',dep:c.dep||'',arr:c.arr||'',type:c.aircraftType||'',reg:'',schedOut:'',schedIn:'',schedBlock:0,onDuty:start,offDuty:end,out:'',off:'',on:'',in:'',block:0,flight:0,simulatorTime:sim?timeSpanMins(start,end):0,credit:creditMinsForEntry({dutyType:c.dutyType,credit:0}),role:'PIC',instructionType:sim?'SFI/SFE Instruction Sim':'',night:'00:00',sim:sim?'yes':'no',ifr:'no',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,courseType:ground?upper(ev.SUMMARY||''):'',remarks:`Imported from calendar: ${ev.SUMMARY||''}`,source:'calendar'});const sf=entrySig(f);if(!seenF.has(sf)){fs.push(f);seenF.add(sf);other++}else skipped++}
  });save(FLIGHTS_KEY,fs);save(ROSTER_KEY,rs);save(DUTY_KEY,ds);reconcileAllDuties();return{sectors,duties,other,skipped}
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
  localStorage.setItem(AEROLINE_CONFIG_KEY,JSON.stringify(value));
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
  const rows=[...load(EXPIRY_KEY)],validations=parseAerolineValidations(root);let added=0,updated=0,kept=0,emptySkipped=0;
  for(const v of validations){
    const match=rows.find(x=>upper(x.aerolineValidationCode||'')===v.code)||rows.find(x=>upper(x.name||'')===v.code&&x.source==='aeroline');
    if(!v.expiry){if(match)kept++;else emptySkipped++;continue}
    if(!match){
      const category=aerolineValidationCategory(v.code);
      rows.push(stamp({id:stableSourceId('expiry',`aeroline-validation:${v.code}`),category,name:category==='english'?'LPC ENGLISH':v.code,authority:'',number:'',lastCheck:'',courseDate:'',medicalClass:'',englishLevel:'',aircraftType:'',endorsedBy:'',expiry:v.expiry,issuer:'',remarks:`AEROLINE • ${upper(v.description)}`,photoData:'',locked:false,source:'aeroline',aerolineValidationCode:v.code,aerolineValidationDesc:v.description}));
      added++;continue;
    }
    if(!match.expiry){match.expiry=v.expiry;match.aerolineValidationCode=v.code;match.aerolineValidationDesc=v.description;match._updatedAt=new Date().toISOString();updated++;continue}
    if(match.expiry===v.expiry){kept++;continue}
    const ok=confirm(`AeroLINE shows a different expiry date for ${v.code}.\n\nCurrent PilotLog expiry: ${displayDate(match.expiry)}\nNew AeroLINE expiry: ${displayDate(v.expiry)}\n\nDo you want to update it?`);
    if(ok){match.expiry=v.expiry;match.aerolineValidationCode=v.code;match.aerolineValidationDesc=v.description;match._updatedAt=new Date().toISOString();updated++}else kept++;
  }
  save(EXPIRY_KEY,rows);return{added,updated,kept,emptySkipped,total:validations.length};
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
          const tm=aerolineTrainingForActivity(root,r,start),sim=aerolineIsSimulatorTraining(r,tm),dutyType=sim?'Simulator':'Ground Course',crew=aerolineTrainingCrewFields(root,tm,sim);
          const fullName=upper(r.trainingSlotName||r.trainingProgramDesc||tm?.trainingTypeDesc||r.trainingProgramCode||'AEROLINE TRAINING');
          const desc=upper(r.trainingProgramDesc||tm?.trainingTypeDesc||'');
          activities.push({
            aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType,date:start.date,flightNo:'',location:upper(r.trainingLocation||tm?.trainLocOrFlight||''),dep:sim?'':upper(r.trainingLocation||tm?.trainLocOrFlight||''),arr:'',type:upper(r.fleetType||''),reg:aerolineRegistration(r),
            schedOut:sim?shiftTime(start.time,-90):'',schedIn:sim?shiftTime(end.time,30):'',schedBlock:0,onDuty:start.time,offDuty:end.time,out:'',off:'',on:'',in:'',block:0,flight:0,
            simulatorTime:sim?timeSpanMins(start.time,end.time):0,credit:creditMinsForEntry({dutyType}),
            role:'PIC',instructionType:sim&&crew.instructorName?'SFI/SFE Instruction Sim':'',night:'00:00',sim:sim?'yes':'no',ifr:'no',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,
            courseType:upper(r.trainingProgramCode||tm?.trainingType||r.trainingSlotName||''),remarks:desc&&desc!==fullName?`${fullName} • ${desc}`:fullName,source:'aeroline',aerolineRosterPlanned:true,rosterHidden:false,locked:false,
            picName:crew.picName,sicName:crew.sicName,soName:'',instructorName:crew.instructorName,aerolineTrainerType:crew.trainerType,
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
function aerolineStableImportId(kind,item){return stableSourceId(kind,syncSourceKey(item)||item.aerolineKey||`${item.date||''}|${item.flightNo||''}|${item.dep||''}|${item.arr||''}`)}
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
  let rs=[...load(ROSTER_KEY)],fs=[...load(FLIGHTS_KEY)],ds=[...load(DUTY_KEY)];
  const priorOffDates=new Set(ds.filter(x=>x.aerolineRosterPlanned&&/^(DAY OFF|OFF)$/i.test(x.type||'')).map(x=>x.date));
  const thanksDates=aerolineThanksDates(parsed.root);
  const incomingRosterKeys=new Set(),incomingActivityKeys=new Set(),incomingDutyKeys=new Set();
  let flightsAdded=0,flightsUpdated=0,activitiesAdded=0,activitiesUpdated=0,offAdded=0,offUpdated=0,staleRemoved=0;

  parsed.flights.forEach(r=>{
    incomingRosterKeys.add(r.aerolineKey);
    const hadPriorOff=priorOffDates.has(r.date),hasThanks=thanksDates.has(r.date);
    if(hasThanks){
      r.aerolinePossibleDayOffPaid=true;
      r.aerolineDayOffPaidSignal=hadPriorOff?'OFF replaced by flight + Thanks memo':'Thanks memo on flight day';
    }
    const stableId=aerolineStableImportId('roster',r),candidate={id:stableId,...r};
    if(importSuppressedByDeletion('roster',candidate))return;
    const match=aerolineRosterMatch(rs,r)||rs.find(x=>x.id===stableId);
    if(match){
      const i=rs.indexOf(match),manual=!!match.manualOverride;
      rs[i]=stamp(manual?{...r,...match,aerolineKey:r.aerolineKey,aerolineFlightLegId:r.aerolineFlightLegId,aerolineBlockId:r.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...r,id:match.id,status:match.status||'planned'});
      flightsUpdated++;
    }else{rs.push(stamp(candidate));flightsAdded++}
  });

  parsed.activities.forEach(a=>{
    incomingActivityKeys.add(a.aerolineKey);
    const stableId=aerolineStableImportId('flights',a),candidate={id:stableId,...a};
    if(importSuppressedByDeletion('flights',candidate))return;
    const match=aerolineActivityMatch(fs,a)||fs.find(x=>x.id===stableId);
    if(match){
      const i=fs.indexOf(match),manual=!!match.manualOverride;
      fs[i]=stamp(manual?{...a,...match,aerolineKey:a.aerolineKey,aerolineBlockId:a.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...a,id:match.id,locked:!!match.locked});
      activitiesUpdated++;
    }else{fs.push(stamp(candidate));activitiesAdded++}
  });

  parsed.daysOff.forEach(d=>{
    incomingDutyKeys.add(d.aerolineKey);
    const stableId=aerolineStableImportId('duties',d),candidate={id:stableId,...d};
    if(importSuppressedByDeletion('duties',candidate))return;
    let match=ds.find(x=>x.aerolineKey===d.aerolineKey)||ds.find(x=>x.id===stableId)||ds.find(x=>x.date===d.date&&/^(DAY OFF|OFF)$/i.test(x.type||''));
    if(match){
      const i=ds.indexOf(match),manual=!!match.manualOverride;
      ds[i]=stamp(manual?{...d,...match,aerolineKey:d.aerolineKey,aerolineBlockId:d.aerolineBlockId,aerolineRosterPlanned:true}:{...match,...d,id:match.id});offUpdated++;
    }else{ds.push(stamp(candidate));offAdded++}
  });

  // The JSON is a full-period roster. Remove only stale records that were themselves imported from AeroLINE.
  rs=rs.filter(x=>{
    if(!x.aerolineRosterPlanned||x.manualOverride||!aerolineWithinRange(x.date,start,end))return true;
    const keep=incomingRosterKeys.has(x.aerolineKey);if(!keep){if(x.id)markCloudDeleted('roster',x.id,{includeSource:false});staleRemoved++}return keep;
  });
  fs=fs.filter(x=>{
    if(!x.aerolineRosterPlanned||x.manualOverride||x.locked||!aerolineWithinRange(x.date,start,end))return true;
    const keep=incomingActivityKeys.has(x.aerolineKey);if(!keep){if(x.id)markCloudDeleted('flights',x.id,{includeSource:false});staleRemoved++}return keep;
  });
  ds=ds.filter(x=>{
    if(!x.aerolineRosterPlanned||x.manualOverride||!aerolineWithinRange(x.date,start,end))return true;
    const keep=incomingDutyKeys.has(x.aerolineKey);if(!keep){if(x.id)markCloudDeleted('duties',x.id,{includeSource:false});staleRemoved++}return keep;
  });

  snapshotFlights('before-aeroline-import');
  save(ROSTER_KEY,rs);save(FLIGHTS_KEY,fs);save(DUTY_KEY,ds);
  cleanupRosterDuplicates();reconcileAllDuties();refreshEntrySuggestions();
  return{...parsed,flightsAdded,flightsUpdated,activitiesAdded,activitiesUpdated,offAdded,offUpdated,staleRemoved,expiryImport};
}
function aerolineImportStatusText(){
  const months=[];
  [...load(ROSTER_KEY),...load(FLIGHTS_KEY),...load(DUTY_KEY)].filter(x=>x.aerolineRosterPlanned&&x.date).forEach(x=>months.push(x.date.slice(0,7)));
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
  let fs=load(FLIGHTS_KEY),imported=0,updated=0,sims=0,other=0;rows.slice(1).forEach(r=>{const date=normalDate(g(r,'flight_flightDate'));if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
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
    if(importSuppressedByDeletion('flights',f))return;
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
      f.id=makeId();
      fs.push(f);
      imported++;
    }
    if(isSimulator)sims++;
    if(!['Flight','Simulator'].includes(dutyType))other++;
  });

  const deduped=dedupeFlightEntriesSemantic(fs);
  if(deduped.removed){snapshotFlights('before-logten-dedupe');deduped.removedIds.forEach(id=>markCloudDeleted('flights',id,{includeSource:false}))}
  fs=deduped.entries;
  save(FLIGHTS_KEY,fs);
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
  localStorage.setItem(LOGTEN_ARCHIVE_META_KEY,JSON.stringify({
    storedAt:record.storedAt,sourceFileName:record.sourceFileName,sourceBytes:record.sourceBytes,sourceSha256:record.sourceSha256,
    flightRows:record.flightRows,sqliteTables:record.sqliteTables,dateFrom:record.dateFrom,dateTo:record.dateTo
  }));
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
  f.source='logten';f.logtenUniqueId=uid;f.id=stableSourceId('flights',`logten:${uid}`);
  f.dutyType=canonicalDutyType(f.dutyType||'Flight');f.date=String(f.date||'').slice(0,10);
  if(isFlight(f))f.schedBlock=scheduleBlockMins(f);
  ['flightNo','dep','arr','reg','type','courseType','picName','sicName','soName','instructorName','approachType'].forEach(k=>{if(f[k]!=null)f[k]=upper(f[k])});
  if(isSim(f))f.sim='yes';else delete f.sim;
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
    merged={...incoming};
    Object.entries(existing).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')merged[k]=v});
  }else if(existing.source==='logten'){
    merged={...existing,...incoming};
  }else{
    merged=mergeDuplicateEntries(existing,incoming);
  }
  merged.id=existing.id||incoming.id;merged.logtenUniqueId=incoming.logtenUniqueId;
  if(existing.source!=='manual')merged.source='logten';
  if(existing.source==='logten'&&!protectedExisting)merged.dutyType=incoming.dutyType;
  merged.locked=!!(existing.locked||incoming.locked);
  merged._updatedAt=new Date().toISOString();
  delete merged._logtenImportType;delete merged._logtenLegacyKey;
  return merged;
}

function mergeLogTenSupplementalRows(key,kind,rawRows){
  const rows=load(key), now=new Date().toISOString();
  let imported=0,updated=0;
  for(const raw of (Array.isArray(rawRows)?rawRows:[])){
    const uid=String(raw?.logtenUniqueId||'').trim();
    if(!uid)continue;
    const stableId=stableSourceId(kind,`logten:${uid}`);
    const incoming={...raw,id:stableId,source:'logten',logtenUniqueId:uid,_updatedAt:now};
    if(importSuppressedByDeletion(kind,incoming))continue;
    const idx=rows.findIndex(x=>String(x?.logtenUniqueId||'')===uid||x?.id===stableId);
    if(idx>=0){
      if(kind==='expiry'&&rows[idx]?.locked){
        const preserved={...incoming};
        Object.entries(rows[idx]).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')preserved[k]=v});
        preserved.id=rows[idx].id||stableId;
        preserved.logtenUniqueId=uid;
        preserved.source=rows[idx].source==='manual'?'manual':'logten';
        preserved._updatedAt=now;
        rows[idx]=preserved;
      }else rows[idx]={...rows[idx],...incoming,id:rows[idx].id||stableId};
      updated++;
    }else{rows.push(incoming);imported++}
  }
  save(key,rows);
  return{imported,updated,total:Array.isArray(rawRows)?rawRows.length:0};
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
  let fs=load(FLIGHTS_KEY),imported=0,updated=0,protectedMerged=0;
  const uidIndex=new Map(),dateIndex=new Map();
  fs.forEach((x,i)=>{
    if(x?.logtenUniqueId)uidIndex.set(String(x.logtenUniqueId),i);
    const d=String(x?.date||'');if(d){if(!dateIndex.has(d))dateIndex.set(d,[]);dateIndex.get(d).push(i)}
  });
  for(let importIndex=0;importIndex<rawEntries.length;importIndex++){
    const raw=rawEntries[importIndex];
    if(importIndex===0||importIndex%100===0){const pct=10+Math.round((importIndex/Math.max(1,rawEntries.length))*70);setImportProgress(pct,`Processing LogTen rows • ${importIndex.toLocaleString('en-US')} / ${rawEntries.length.toLocaleString('en-US')}`);await yieldToUi()}
    const incoming=logTenMigrationEntry(raw);if(!/^\d{4}-\d{2}-\d{2}$/.test(incoming.date))continue;
    if(importSuppressedByDeletion('flights',incoming))continue;
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
  try{await saveFlightsDurable(fs)}catch(err){
    const mb=(JSON.stringify(fs).length/(1024*1024)).toFixed(1);
    throw new Error(`The original LogTen database was archived safely, but the ${mb} MB normalized logbook could not be written to IndexedDB (${err?.name||'storage error'}).`);
  }
  setImportProgress(88,'Importing licences, validities and trips…');await yieldToUi();
  const expiryImport=mergeLogTenSupplementalRows(EXPIRY_KEY,'expiry',parsed.payload.expiry);
  const tripImport=mergeLogTenSupplementalRows(TRIPS_KEY,'trips',parsed.payload.trips);
  reconcileAllDuties();await flushFlightStore();
  setImportProgress(94,'Verifying imported LogTen identities…');await yieldToUi();
  const persisted=load(FLIGHTS_KEY),wanted=new Set(rawEntries.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean)),present=new Set(persisted.map(x=>String(x?.logtenUniqueId||'')).filter(Boolean));
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
  return load(FLIGHTS_KEY).filter(isFlight).sort((a,b)=>`${a.date||''}${a.off||a.out||a.schedOut||''}`.localeCompare(`${b.date||''}${b.off||b.out||b.schedOut||''}`));
}
function experienceSims(){
  return load(FLIGHTS_KEY).filter(f=>isSim(f)&&simulatorCompleted(f)).sort((a,b)=>`${a.date||''}${a.onDuty||''}`.localeCompare(`${b.date||''}${b.onDuty||''}`));
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
  const d=load(FLIGHTS_KEY).filter(f=>isFlight(f)||isSim(f));if(!d.length)return alert('No professional experience to export');
  const cols=['dutyType','date','flightNo','reg','type','location','dep','arr','off','on','block','role','seatPosition','callFromDayOff','picName','sicName','soName','instructorName','instructionType','night','ifr','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','simulatorTime','approachType','remarks'];
  download('pilotlog_professional_experience.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')
}
function exportFullBackupJson(){
  const payload={schema:'PilotLog Backup',version:VERSION,exportedAt:new Date().toISOString(),flights:load(FLIGHTS_KEY),roster:load(ROSTER_KEY),duties:load(DUTY_KEY),trips:load(TRIPS_KEY),expiry:load(EXPIRY_KEY),syncLedger:loadSyncLedger(),appSettings:appSettings(),paySettings:paySettings(),payrollExtras:loadObject(PAY_MONTH_KEY,{}),fx:loadObject(FX_KEY,{}),logTenArchiveMeta:loadObject(LOGTEN_ARCHIVE_META_KEY,{}),drafts:entryDraftPool(),activeDraft:loadObject(ENTRY_DRAFT_KEY,null)};
  download(`pilotlog_backup_${today()}.json`,JSON.stringify(payload,null,2),'application/json')
}
function validateFullBackupPayload(payload){
  if(!payload||typeof payload!=='object'||payload.schema!=='PilotLog Backup')throw new Error('This is not a PilotLog Full Backup JSON.');
  for(const k of ['flights','roster','duties','trips','expiry','syncLedger'])if(payload[k]!=null&&!Array.isArray(payload[k]))throw new Error(`Invalid backup section: ${k}.`);
  return{flights:Array.isArray(payload.flights)?payload.flights:[],roster:Array.isArray(payload.roster)?payload.roster:[],duties:Array.isArray(payload.duties)?payload.duties:[],trips:Array.isArray(payload.trips)?payload.trips:[],expiry:Array.isArray(payload.expiry)?payload.expiry:[],syncLedger:Array.isArray(payload.syncLedger)?payload.syncLedger:loadSyncLedger(),drafts:Array.isArray(payload.drafts)?payload.drafts:[]};
}
async function restoreFullBackupJsonFile(file){
  const text=await file.text();let payload;try{payload=JSON.parse(String(text||'').replace(/^\uFEFF/,''))}catch{throw new Error('The selected JSON file cannot be read.')}
  const counts=validateFullBackupPayload(payload);
  const ok=confirm(`Restore this PilotLog backup?\n\nVersion: ${payload.version||'unknown'}\nExported: ${payload.exportedAt?displayDateTime(payload.exportedAt):'unknown'}\nFlights / entries: ${counts.flights.length}\nRoster: ${counts.roster.length}\nDuties: ${counts.duties.length}\nTrips: ${counts.trips.length}\nExpiry: ${counts.expiry.length}\n\nCurrent local PilotLog data on this device will be replaced. Nothing will be uploaded automatically.`);
  if(!ok)return false;
  await saveFlightsDurable(counts.flights);save(ROSTER_KEY,counts.roster);save(DUTY_KEY,counts.duties);save(TRIPS_KEY,counts.trips);save(EXPIRY_KEY,counts.expiry);saveSyncLedger(counts.syncLedger);
  localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify(payload.appSettings||{}));localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify(payload.paySettings||{}));localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(payload.payrollExtras||{}));localStorage.setItem(FX_KEY,JSON.stringify(payload.fx||{}));localStorage.setItem(LOGTEN_ARCHIVE_META_KEY,JSON.stringify(payload.logTenArchiveMeta||{}));
  writeEntryDraftPool(counts.drafts);if(payload.activeDraft)localStorage.setItem(ENTRY_DRAFT_KEY,JSON.stringify(payload.activeDraft));else localStorage.removeItem(ENTRY_DRAFT_KEY);
  reconcileAllDuties();markLocalOnlyImport(`Full backup restored locally — ${counts.flights.length} entries`);await render();await renderRoster();renderDuty();renderTrips();renderPayroll();renderSettings();resetEntry(false);restoreEntryDraft();
  alert(`Full Backup restored locally.\n\n${counts.flights.length} entries • ${counts.roster.length} roster • ${counts.trips.length} trips • ${counts.expiry.length} expiry records.\n\nAuto Sync is OFF. Review this device before pressing Sync now.`);return true;
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
  const candidates=[
    ...load(FLIGHTS_KEY).filter(isFlight),
    ...load(ROSTER_KEY)
  ].filter(x=>rosterFlightDigits(x.flightNo||'')===digits&&x.dep&&x.arr)
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

  const fs=load(FLIGHTS_KEY),roster=load(ROSTER_KEY),duties=load(DUTY_KEY);
  let entryCount=0,rosterCount=0,dutyCount=0,duplicates=0;

  for(const r of selected){
    const date=normalizeScreenshotDate(r.date);
    if(!date){continue}

    if(r.target==='duty' || r.dutyType==='Duty' || r.dutyType==='Day OFF'){
      const type=r.dutyType==='Day OFF'?'Day OFF':'Flight Duty';
      const exists=duties.find(x=>x.date===date&&upper(x.type||'')===upper(type)&&String(x.report||'')===String(r.start||'')&&String(x.end||'')===String(r.end||''));
      if(exists){duplicates++;continue}
      duties.push(stamp({id:makeId(),date,type,report:r.start||'',end:r.end||'',minutes:r.start&&r.end?timeSpanMins(r.start,r.end):0,notes:r.remarks||'Imported from screenshot'}));
      dutyCount++;continue;
    }

    if(r.target==='roster'){
      const flightNo=r.flightNo?rosterFlightLabel(r.flightNo):'';
      const exists=roster.find(x=>x.date===date&&upper(x.flightNo)===upper(flightNo)&&upper(x.dep)===upper(r.dep)&&upper(x.arr)===upper(r.arr));
      if(exists){duplicates++;continue}
      roster.push(stamp({id:makeId(),date,flightNo,dep:upper(r.dep),arr:upper(r.arr),std:r.start||'',sta:r.end||'',status:'planned',source:'screenshot'}));
      rosterCount++;continue;
    }

    const dutyType=r.dutyType||'Flight';
    const flightNo=(dutyType==='Flight')?(r.flightNo?composeFlightNo(r.flightNo):''):'';
    const exists=fs.find(x=>x.source==='screenshot'&&x.date===date&&x.dutyType===dutyType&&upper(x.flightNo)===upper(flightNo)&&upper(x.dep)===upper(r.dep)&&upper(x.arr)===upper(r.arr)&&String(x.schedOut||x.onDuty||'')===String(r.start||''));
    if(exists){duplicates++;continue}

    const obj=stamp({
      id:makeId(),source:'screenshot',dutyType,date,flightNo,reg:'',type:dutyType==='Simulator'?'A320':'',
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
    fs.push(obj);entryCount++;
  }

  save(FLIGHTS_KEY,fs);
  save(ROSTER_KEY,dedupeRosterItems(roster));
  save(DUTY_KEY,duties);
  reconcileAllDuties();
  autoDetectTrips(false);
  await render();
  renderTrips();
  $('screenshotImportStatus').textContent=`Imported ${entryCount} entries, ${rosterCount} roster sectors, ${dutyCount} duties. ${duplicates} duplicates skipped.`;
  alert(`Screenshot import complete: ${entryCount} entries • ${rosterCount} roster • ${dutyCount} duties • ${duplicates} duplicates skipped`);
}

function download(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function logTenExport(){const fs=load(FLIGHTS_KEY);if(!fs.length)return alert('No entries to export');const h=['flight_flightDate','flight_type','flight_flightNumber','flight_from','flight_to','flight_scheduledDepartureTime','flight_actualDepartureTime','flight_takeoffTime','flight_landingTime','flight_scheduledArrivalTime','flight_actualArrivalTime','flight_totalTime','flight_pic','flight_sic','flight_dualGiven','flight_simulator','flight_ground','flight_night','flight_dayTakeoffs','flight_nightTakeoffs','flight_dayLandings','flight_nightLandings','flight_onDutyTime','flight_offDutyTime','flight_remarks','aircraft_aircraftID','aircraftType_type'];const rows=fs.map(f=>{const total=isFlight(f)?fmt(f.block):'',sim=isSim(f)?fmt(f.simulatorTime||0):'',ground=isGround(f)?fmt(PILOTLOG_RULES.fixed.groundTripDutyMins):'',dual=f.instructionType?fmt(isSim(f)?f.simulatorTime:f.block):'';return[f.date,'',f.flightNo||'',f.dep||'',f.arr||'',f.schedOut||'',f.out||'',f.off||'',f.on||'',f.schedIn||'',f.in||'',total,picMins(f)?total:'',sicMins(f)?total:'',dual,sim,ground,f.night||'00:00',f.dayTakeoffs||0,f.nightTakeoffs||0,f.dayLandings||0,f.nightLandings||0,f.onDuty||'',f.offDuty||'',f.remarks||'',f.reg||'',f.type||'']});download(`PilotLog_LogTen_${today()}.txt`,[h.join('\t'),...rows.map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t'))].join('\n'),'text/tab-separated-values')}

/* Payroll */
function monthNow(){return new Date().toISOString().slice(0,7)}
function inMonth(date,month){return String(date||'').slice(0,7)===month}
function money(v){return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}
function trainingSector(f){return isFlight(f)&&f.instructionType==='Flight Instruction'}
function tierPay(hours,st){hours=Math.max(0,Number(hours)||0);const a=Number(st.t1Max)||0,b=Math.max(a,Number(st.t2Max)||a),c=Math.max(b,Number(st.t3Max)||b);let left=hours,total=0,h=Math.min(left,a);total+=h*Number(st.t1Rate||0);left-=h;h=Math.min(Math.max(0,left),b-a);total+=h*Number(st.t2Rate||0);left-=h;h=Math.min(Math.max(0,left),c-b);total+=h*Number(st.t3Rate||0);left-=h;if(left>0)total+=left*Number(st.t4Rate||0);return total}
function seniorityPct(st,month){if(!st.joinDate)return 0;const start=new Date(`${st.joinDate}T00:00:00Z`),[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0,23,59,59));const years=(end-start)/(365.2425*86400000);return years>12?Number(st.seniority12||0):years>2?Number(st.seniority2||0):0}
function monthExtras(month){const all=loadObject(PAY_MONTH_KEY,{});return {dayOffCount:0,arrears:0,dayOffRemarks:{},...(all[month]||{})}}
function saveMonthExtras(month,x){const all=loadObject(PAY_MONTH_KEY,{});all[month]=x;all._updatedAt=new Date().toISOString();localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(all))}

function dayOffEventsForMonth(month,sourceEntries=null){
  const flagged=(sourceEntries||load(FLIGHTS_KEY))
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

function payrollData(month){
  const st=paySettings(),
    rosterPrimary=rosterMonthAvailable(month),
    fs=operationalEntriesForMonth(month),
    sourceName=rosterPrimary?'Roster':(fs.some(f=>String(f.source||'').toLowerCase()==='logten')?'LogTen Pro':'Logbook'),
    trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month),
    extras=monthExtras(month),
    dayOffEvents=dayOffEventsForMonth(month,fs),
    dayOffCount=dayOffEvents.length,
    calculatedCreditMins=fs.reduce((n,f)=>n+creditMinsForEntry(f,fs),0),
    creditMins=calculatedCreditMins,
    training=fs.filter(trainingSector).length,
    sims=fs.filter(isSim).length,
    layMins=trips.reduce((n,t)=>{
      if(!rosterPrimary)return n+(Number(t.layover)||0);
      const s=new Date(t.start),e=new Date(t.end);if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||e<=s)return n;
      const trip=Math.round((e-s)/60000),duty=tripChargeableDutyFromEntries(s,e,fs);return n+Math.max(0,trip-duty);
    },0),
    layHours=layMins/60,
    seniorPct=seniorityPct(st,month),
    seniority=Number(st.base||0)*seniorPct/100,
    fixed=Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0),
    flightPay=tierPay(creditMins/60,st),
    trainingPay=training*Number(st.trainingRate||0),
    layoverPay=layHours*Number(st.layoverRate||0),
    simPay=sims*Number(st.simAllowance||0),
    dayOffPay=dayOffCount*Number(st.dayOffRate||0),
    arrears=Number(extras.arrears||0),
    total=fixed+flightPay+trainingPay+layoverPay+simPay+dayOffPay+arrears;

  return{st,extras,sourceName,rosterPrimary,dayOffEvents,dayOffCount,creditMins,training,sims,layMins,layHours,seniorPct,seniority,fixed,flightPay,trainingPay,layoverPay,simPay,dayOffPay,arrears,total};
}
function fxStore(){return loadObject(FX_KEY,{})}
function dateKey(d){return d.toISOString().slice(0,10)}
async function fetchFxForDate(dateStr){for(let back=0;back<8;back++){const d=new Date(`${dateStr}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-back);const key=dateKey(d);try{const r=await fetch(`https://${key}.currency-api.pages.dev/v1/currencies/eur.json`,{cache:'no-store'});if(!r.ok)continue;const j=await r.json(),rate=Number(j?.eur?.mad);if(rate>0)return{rate,date:j.date||key}}catch{}}throw new Error('FX unavailable')}
async function fetchLatestFx(){const r=await fetch('https://latest.currency-api.pages.dev/v1/currencies/eur.json',{cache:'no-store'});if(!r.ok)throw new Error('FX unavailable');const j=await r.json(),rate=Number(j?.eur?.mad);if(!(rate>0))throw new Error('MAD rate unavailable');return{rate,date:j.date||today()}}
async function getMonthFx(month){
  const store=fxStore();if(store[month]?.locked)return store[month];
  const [y,m]=month.split('-').map(Number),
    target=`${y}-${String(m).padStart(2,'0')}-30`,
    now=new Date(),
    targetDate=new Date(`${target}T23:59:59Z`),
    nextMonth=new Date(Date.UTC(y,m,1));

  // Until the month satisfies the locking rule, including future payroll months,
  // always show the most recent available EUR/MAD rate as a provisional LIVE rate.
  if(now<targetDate&&now<nextMonth)return{...(await fetchLatestFx()),locked:false,provisional:true};

  const got=await fetchFxForDate(target),locked={...got,locked:true};
  store[month]=locked;localStorage.setItem(FX_KEY,JSON.stringify(store));return locked;
}
const PAY_MAP={setJoinDate:'joinDate',setBase:'base',setAllowance:'allowance',setTransport:'transport',setPos:'pos',setTelephone:'telephone',setUniform:'uniform',setMeal:'meal',setDeduction:'deduction',setSeniority2:'seniority2',setSeniority12:'seniority12',setT1Max:'t1Max',setT1Rate:'t1Rate',setT2Max:'t2Max',setT2Rate:'t2Rate',setT3Max:'t3Max',setT3Rate:'t3Rate',setT4Rate:'t4Rate',setTrainingRate:'trainingRate',setLayoverRate:'layoverRate',setSimAllowance:'simAllowance',setSimCredit:'simCredit',setGroundCredit:'groundCredit',setDayOffRate:'dayOffRate'};
function fillPaySettings(){const st=paySettings();Object.entries(PAY_MAP).forEach(([id,k])=>{if($(id))$(id).value=st[k]})}
function readPaySettings(){const st={};Object.entries(PAY_MAP).forEach(([id,k])=>st[k]=k==='joinDate'?$(id).value:Number($(id).value||0));return st}
let payrollRenderToken=0;
async function renderPayroll(){
  const token=++payrollRenderToken,month=$('payrollMonth').value||monthNow();
  $('payrollMonth').value=month;
  const ex=monthExtras(month),p=payrollData(month);

  $('payArrears').value=ex.arrears||0;
  $('payTotalDhm').textContent=`${money(p.total)} DHM`;
  $('payTotalEur').textContent='…';

  $('payBreakdown').innerHTML=[
    ['Data source',p.sourceName,0],
    ['Fixed salary','',p.fixed],
    ['Seniority',money(p.seniorPct)+'%',p.seniority],
    ['Credit H',fmt(p.creditMins),p.flightPay],
    ['Training sectors',String(p.training),p.trainingPay],
    ['Layover',fmt(p.layMins),p.layoverPay],
    ['Simulator allowance',String(p.sims),p.simPay],
    ['Call from Day OFF',String(p.dayOffCount),p.dayOffPay],
    ['Arrears / adjustments','',p.arrears]
  ].map(([n,q,v],i)=>`<div class="pay-breakdown-row ${i%2?'pay-breakdown-alt':''}">
    <span class="pay-breakdown-label">${esc(n)}</span>
    <span class="pay-breakdown-qty">${esc(q)}</span>
    <b class="money pay-breakdown-amount">${n==='Data source'?'—':money(v)+' DHM'}</b>
  </div>`).join('');

  const remarks=p.extras.dayOffRemarks||{};
  $('payDayOffDetails').innerHTML=p.dayOffEvents.length?p.dayOffEvents.map(ev=>{
    const remark=remarks[ev.date]||'';
    return `<div class="pay-dayoff-row">
      <div class="pay-dayoff-main">
        <b>${esc(displayDate(ev.date))}</b>
        <div class="small">${esc(dayOffEventLabel(ev))}</div>
        <div class="small">${money(p.st.dayOffRate||0)} DHM premium</div>
      </div>
      <div class="pay-dayoff-remark-wrap">
        <label>Remark</label>
        <input class="pay-dayoff-remark" data-dayoff-date="${esc(ev.date)}" value="${esc(remark)}" placeholder="e.g. Not paid / email sent">
      </div>
    </div>`;
  }).join(''):'<div class="empty">No Day OFF calls in this payroll month.</div>';

  $('payFxStatus').textContent='Loading EUR/MAD…';
  try{
    const fx=await getMonthFx(month);
    if(token!==payrollRenderToken)return;
    if(!fx.rate){
      $('payTotalEur').textContent='—';
      $('payFxStatus').textContent='FX not available for a future month.';
      return
    }
    $('payTotalEur').textContent=`≈ €${money(p.total/fx.rate)}`;
    $('payFxStatus').innerHTML=`EUR/MAD ${money(fx.rate)} • ${esc(displayDate(fx.date))} ${fx.locked?'<span class="fx-lock">LOCKED</span>':'<span class="fx-live">LIVE</span>'}${fx.provisional?' • provisional until lock rule':''}`;
  }catch{
    $('payTotalEur').textContent='—';
    $('payFxStatus').textContent='FX unavailable. Payroll in DHM is unaffected.';
  }
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
    source:existing?.source||'manual'
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

const SYNC_KINDS=[[FLIGHTS_KEY,'flights'],[ROSTER_KEY,'roster'],[DUTY_KEY,'duties'],[TRIPS_KEY,'trips'],[EXPIRY_KEY,'expiry']];
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
  return{version:VERSION,createdAt:new Date().toISOString(),data:{flights:load(FLIGHTS_KEY),roster:load(ROSTER_KEY),duties:load(DUTY_KEY),trips:load(TRIPS_KEY),expiry:load(EXPIRY_KEY),syncLedger:loadSyncLedger(),paySettings:loadObject(PAY_SETTINGS_KEY,{}),payMonth:loadObject(PAY_MONTH_KEY,{}),fx:loadObject(FX_KEY,{}),appSettings:loadObject(APP_SETTINGS_KEY,{}),logTenArchiveMeta:loadObject(LOGTEN_ARCHIVE_META_KEY,{}),drafts:entryDraftPool(),activeDraft:loadObject(ENTRY_DRAFT_KEY,null)}};
}
async function createWeeklyBackup(force=false){const current=await weeklyBackup();if(!force&&!backupDue(current?.createdAt))return current;const snapshot=backupPayload();await storeWeeklyBackup(snapshot);await renderWeeklyBackupStatus();return snapshot}
async function renderWeeklyBackupStatus(){const el=$('weeklyBackupStatus');if(!el)return;try{const b=await weeklyBackup();el.value=b?.createdAt?`${displayDateTime(b.createdAt)} • ${b.version||'unknown version'}`:'No backup yet'}catch(e){el.value='Backup unavailable';console.warn('Backup status unavailable',e)}}
async function restoreWeeklyBackup(){
  const b=await weeklyBackup();if(!b?.data)return alert('No weekly backup available.');
  if(!confirm(`Restore weekly backup from ${displayDateTime(b.createdAt)}? Current local PilotLog data will be replaced.`))return false;
  await saveFlightsDurable(Array.isArray(b.data.flights)?b.data.flights:[]);save(ROSTER_KEY,Array.isArray(b.data.roster)?b.data.roster:[]);save(DUTY_KEY,Array.isArray(b.data.duties)?b.data.duties:[]);save(TRIPS_KEY,Array.isArray(b.data.trips)?b.data.trips:[]);save(EXPIRY_KEY,Array.isArray(b.data.expiry)?b.data.expiry:[]);saveSyncLedger(Array.isArray(b.data.syncLedger)?b.data.syncLedger:loadSyncLedger());
  localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify(b.data.paySettings||{}));localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(b.data.payMonth||{}));localStorage.setItem(FX_KEY,JSON.stringify(b.data.fx||{}));localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify(b.data.appSettings||{}));
  writeEntryDraftPool(Array.isArray(b.data.drafts)?b.data.drafts:[]);if(b.data.activeDraft)localStorage.setItem(ENTRY_DRAFT_KEY,JSON.stringify(b.data.activeDraft));else localStorage.removeItem(ENTRY_DRAFT_KEY);reconcileAllDuties();localStorage.setItem(CLOUD_DIRTY_KEY,'1');localStorage.setItem(CLOUD_PENDING_IMPORT_KEY,'Weekly backup restored locally');
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
function snapshotSections(){return{flights:load(FLIGHTS_KEY),roster:load(ROSTER_KEY),duties:load(DUTY_KEY),trips:load(TRIPS_KEY),expiry:load(EXPIRY_KEY),syncLedger:loadSyncLedger(),paySettings:loadObject(PAY_SETTINGS_KEY,{}),payMonth:loadObject(PAY_MONTH_KEY,{}),fx:loadObject(FX_KEY,{}),appSettings:loadObject(APP_SETTINGS_KEY,{})}}
function localHasMeaningfulData(){const s=snapshotSections();return ['flights','roster','duties','trips','expiry'].some(k=>Array.isArray(s[k])&&s[k].length>0)}
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
function loadSyncLedger(){try{const rows=JSON.parse(localStorage.getItem(SYNC_LEDGER_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return[]}}
function saveSyncLedger(rows){setLocalJson(SYNC_LEDGER_KEY,Array.isArray(rows)?rows:[])}
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
function importSuppressedByDeletion(kind,item){return !!effectiveCloudDeletion(kind,item)}
function deletedByCloudState(kind,item){return !!effectiveCloudDeletion(kind,item)}
function mergeSyncLedgers(a,b){const out=[],seen=new Set();for(const e of [...(a||[]),...(b||[])]){if(!e||!e.eventId||seen.has(e.eventId))continue;seen.add(e.eventId);out.push(e)}return out.sort((x,y)=>ledgerEventTime(x).localeCompare(ledgerEventTime(y)))}
function syncRecordKey(kind,row){const sk=syncSourceKey(row);return sk?`${kind}|source|${sk}`:`${kind}|id|${row?.id||''}`}
function newerSyncRecord(a,b){
  if(!a)return b;if(!b)return a;const ta=String(a._updatedAt||''),tb=String(b._updatedAt||'');if(ta!==tb)return ta>tb?a:b;const ra=recordRevision(a),rb=recordRevision(b);return ra>=rb?a:b;
}
function mergeSyncCollection(kind,localRows,remoteRows,ledger){
  const map=new Map();for(const row of [...(remoteRows||[]),...(localRows||[])]){if(!row)continue;const k=syncRecordKey(kind,row);map.set(k,newerSyncRecord(map.get(k),row))}
  return [...map.values()].filter(row=>!effectiveCloudDeletion(kind,row,ledger));
}
function mergeSnapshotsForSync(local,remote){
  const ledger=mergeSyncLedgers(local?.syncLedger||loadSyncLedger(),remote?.syncLedger||[]),out={...remote,...local,syncLedger:ledger};
  for(const kind of ['flights','roster','duties','trips','expiry'])out[kind]=mergeSyncCollection(kind,local?.[kind]||[],remote?.[kind]||[],ledger);
  return out;
}
async function applySnapshotToLocal(snapshot,revision,{dirty=false}={}){
  const ledger=mergeSyncLedgers(loadSyncLedger(),snapshot?.syncLedger||[]);snapshot={...snapshot,syncLedger:ledger};
  for(const kind of ['flights','roster','duties','trips','expiry'])snapshot[kind]=(snapshot[kind]||[]).filter(x=>!effectiveCloudDeletion(kind,x,ledger));
  await saveFlightsDurable(Array.isArray(snapshot.flights)?snapshot.flights:[]);save(ROSTER_KEY,Array.isArray(snapshot.roster)?snapshot.roster:[]);save(DUTY_KEY,Array.isArray(snapshot.duties)?snapshot.duties:[]);save(TRIPS_KEY,Array.isArray(snapshot.trips)?snapshot.trips:[]);save(EXPIRY_KEY,Array.isArray(snapshot.expiry)?snapshot.expiry:[]);saveSyncLedger(ledger);
  localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify(snapshot.paySettings||{}));localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(snapshot.payMonth||{}));localStorage.setItem(FX_KEY,JSON.stringify(snapshot.fx||{}));localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify(snapshot.appSettings||{}));
  clearEntryDraft();reconcileAllDuties();localStorage.setItem(CLOUD_BASE_REV_KEY,String(revision||0));localStorage.setItem(CLOUD_DIRTY_KEY,dirty?'1':'0');if(!dirty)localStorage.removeItem(CLOUD_PENDING_IMPORT_KEY);localStorage.setItem(SYNC_READY_KEY,'1');return snapshot;
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
      if(!localHasMeaningfulData()){if(!silent)alert('No verified v8.2 central database exists yet. Import/restore your complete data locally first, review it, then press Sync now.');return false}
      if(silent)return false;
      if(!dirty)localStorage.setItem(CLOUD_DIRTY_KEY,'1');
      if(!confirm('No verified v8.2 central database exists yet. Publish THIS complete local database as the first central copy?'))return false;
      const meta=await publishLocalSnapshot(session,null,false);localStorage.setItem('pilotlog7_last_cloud_sync',new Date().toISOString());await updateCloudStatus();alert(`Verified central database created • revision ${meta.revision} • ${Number(meta.counts?.flights||0).toLocaleString('en-US')} logbook/activity records.`);return true;
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
  flightCache=[];flightStoreReady=false;
  for(const k of Object.keys(localStorage))if(k.startsWith('pilotlog_')||k.startsWith('pilotlog7_')||k.startsWith('pilotlog8_'))localStorage.removeItem(k);
  for(const k of Object.keys(sessionStorage))if(k.startsWith('pilotlog_')||k.startsWith('pilotlog7_')||k.startsWith('pilotlog8_'))sessionStorage.removeItem(k);
  await Promise.all([FLIGHT_DB_NAME,LOGTEN_ARCHIVE_DB,BACKUP_DB_NAME,'pilotlog7-airports','pilotlog-core-data','pilotlog-logten-archive','pilotlog-weekly-backup','pilotlog-airports'].map(deleteIndexedDb));
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
    const row=[...document.querySelectorAll('[data-logbook-entry-id]')].find(el=>el.dataset.logbookEntryId===entryId);
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
    renderEntriesSafe();
    if(options.logbookEntryId)scrollLogbookToEntry(options.logbookEntryId);
    else scrollEntriesToNextDuty();
    return;
  }

  if(id==='rosterView'){
    renderRoster();
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
function flightHtml(fs,full=false){
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

    html+=`<div class="flight" data-logbook-entry-id="${esc(f.id)}"><div><div class="route">${esc(isSim(f)?(f.location||f.dep||'Simulator'):(f.dep||f.dutyType||'Entry'))}${!isSim(f)&&f.arr?` → ${esc(f.arr)}`:''}</div><div class="small">${esc(displayDate(f.date))} ${esc(f.flightNo||'')}</div>${startInfo}<span class="pill">${esc(f.dutyType||'Flight')}</span>${f.type?`<span class="pill">${esc(f.type)}</span>`:''}${f.instructionType?`<span class="pill green">${esc(f.instructionType)}</span>`:''}${f.callFromDayOff?'<span class="pill warning">Day OFF call</span>':''}${f.locked?'<span class="pill green" title="Locked">🔒</span>':'<span class="pill" title="Unlocked">🔓</span>'}${d}</div><div class="meta"><b>${fmt(isFlight(f)?f.block:isSim(f)?(Number(f.simulatorTime)||0):isGround(f)?PILOTLOG_RULES.fixed.groundTripDutyMins:isPositioning(f)?scheduleBlockMins(f):0)}</b><br><span class="small">Credit ${fmt(creditMinsForEntry(f))}</span>${full?`<div class="list-actions"><button class="secondary" data-edit-flight="${f.id}">${f.locked?'View':'Edit'}</button>${f.locked?'':`<button class="danger" data-delete-flight="${f.id}">Delete</button>`}</div>`:''}</div></div>`;
  });

  if(full&&!nextAnchorAdded)html+='<div id="entriesNextDutyAnchor" class="entries-next-duty-anchor" aria-hidden="true"></div>';
  return html;
}

function isoDateLocal(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dashboardDutyRows(startOffset,count){
  const today=new Date(), roster=load(ROSTER_KEY), duties=load(DUTY_KEY), flights=load(FLIGHTS_KEY), groups=rosterGroups();
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

    rows.push(`<div class="duty-week-row${i===0?' today-duty-row':''}">
      <div class="duty-week-date"><b>${esc(dayLabel)}</b><span>${esc(displayDate(date))}</span></div>
      <div class="duty-week-main"><b>${esc(type)}</b>${route?`<div class="small">${esc(route)}</div>`:''}${detail?`<div class="small">${esc(detail)}</div>`:''}</div>
      <div class="duty-week-time">${report||end?`<b>${esc(report||'--:--')} – ${esc(end||'--:--')}</b><div class="small">${sectors?`${sectors} sector${sectors===1?'':'s'}`:'Duty'}</div>`:'<span class="small">—</span>'}</div>
    </div>`);
  }
  return rows.join('');
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
    const parsed=load(FLIGHTS_KEY);if(!Array.isArray(parsed)||!parsed.length)return;
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
let logbookSearchQuery='';
function logbookAirportText(code){
  const c=upper(code||''),a=airportIndex?.[c];return [c,a?.iata,a?.icao,a?.name,a?.city,a?.country].filter(Boolean).join(' ');
}
function logbookSearchText(f){
  return [f.flightNo,f.dep,f.arr,f.reg,f.type,f.location,f.picName,f.sicName,f.soName,f.instructorName,f.role,f.instructionType,f.remarks,logbookAirportText(f.dep),logbookAirportText(f.arr),logbookAirportText(f.location)].filter(Boolean).join(' ').toUpperCase();
}
function logbookMatchesQuery(f,q){
  const terms=String(q||'').trim().toUpperCase().split(/\s+/).filter(Boolean);if(!terms.length)return true;const hay=logbookSearchText(f);return terms.every(t=>hay.includes(t));
}
function renderLogbookSearchStats(rows,total){
  const el=$('logbookSearchStats');if(!el)return;const flights=rows.filter(isFlight),sims=rows.filter(isSim),block=flights.reduce((n,f)=>n+(Number(f.block)||0),0),credits=rows.reduce((n,f)=>n+creditMinsForEntry(f),0);
  const q=String(logbookSearchQuery||'').trim();el.innerHTML=`<b>${rows.length.toLocaleString('en-US')}</b> ${q?'matching':'logbook'} entr${rows.length===1?'y':'ies'} • <b>${flights.length.toLocaleString('en-US')}</b> sectors • Block <b>${fmt(block)}</b> • Credit <b>${fmt(credits)}</b>${sims.length?` • Simulator <b>${sims.length}</b>`:''}${q?` • from ${total.toLocaleString('en-US')} total`:''}`;
}
async function lockAllLogbookEntries(){
  const rows=load(FLIGHTS_KEY),targets=rows.filter(f=>isCompletedLogbookEntry(f)&&!f.locked),count=targets.length;if(!count){alert('All Logbook entries are already locked.');return}
  if(!confirm(`Lock all Logbook entries?\n\n${count.toLocaleString('en-US')} unlocked entr${count===1?'y':'ies'} will be locked.\nOnly the lock state will change; flight data will not be modified.`))return;
  const ids=new Set(targets.map(x=>x.id)),now=new Date().toISOString(),updated=rows.map(x=>ids.has(x.id)?{...x,locked:true,_syncRev:recordRevision(x)+1,_updatedAt:now}:x);await saveFlightsDurable(updated);await flushFlightStore();markCloudCollectionEdited('flights','lock-all',{count});scheduleAutoSync('lock-all-entries');renderEntriesSafe();alert(`${count.toLocaleString('en-US')} Logbook entr${count===1?'y':'ies'} locked.`);
}

function renderEntriesSafe(){
  try{
    const all=load(FLIGHTS_KEY).filter(isCompletedLogbookEntry);
    const fs=all.filter(f=>logbookMatchesQuery(f,logbookSearchQuery)).sort((a,b)=>{
      const kb=`${b.date}${b.onDuty||b.schedOut||b.out||''}`;
      const ka=`${a.date}${a.onDuty||a.schedOut||a.out||''}`;
      return kb.localeCompare(ka);
    });
    const target=$('allFlights');
    if(target)target.innerHTML=flightHtml(fs,true);
    renderLogbookSearchStats(fs,all.length);
    return fs;
  }catch(e){
    console.error('Entries render failed',e);
    const target=$('allFlights');
    if(target)target.innerHTML='<div class="empty">Entries could not be displayed. Stored data has not been deleted.</div>';
    try{return load(FLIGHTS_KEY)||[]}catch{return[]}
  }
}


function cleanupExistingDuplicatesOnce(){
  const key='pilotlog7_dedupe_semantic_v1';
  if(localStorage.getItem(key)==='1')return 0;
  // Previous releases already ran the same semantic dedupe. Do not re-scan a large
  // LogTen archive just because the app version changed.
  const alreadyDone=Object.keys(localStorage).some(k=>k.startsWith('pilotlog7_dedupe_')&&localStorage.getItem(k)==='1');
  if(alreadyDone){localStorage.setItem(key,'1');return 0}
  const current=load(FLIGHTS_KEY);
  const stableLogTen=current.filter(x=>x?.logtenUniqueId).length;
  if(current.length>2500&&stableLogTen>current.length*0.7){localStorage.setItem(key,'1');return 0}
  const result=dedupeFlightEntriesSemantic(current);
  if(result.removed){
    snapshotFlights('before-version-dedupe');
    save(FLIGHTS_KEY,result.entries);
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


function rosterViewMonths(todayKey=isoDateLocal(new Date())){
  const current=todayKey.slice(0,7);
  const d=new Date(`${current}-01T00:00:00`);
  d.setMonth(d.getMonth()+1);
  const next=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return[current,next];
}
function rosterGroupsForView(groups,todayKey=isoDateLocal(new Date())){
  const months=new Set(rosterViewMonths(todayKey));
  return(groups||[]).filter(g=>months.has(String(g.date||'').slice(0,7)));
}

function rosterCalendarDates(todayKey=isoDateLocal(new Date())){
  const [current,next]=rosterViewMonths(todayKey);
  const start=new Date(`${current}-01T00:00:00`);
  const nextStart=new Date(`${next}-01T00:00:00`);
  const end=new Date(nextStart.getFullYear(),nextStart.getMonth()+1,0);
  const out=[];
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1))out.push(isoDateLocal(d));
  return out;
}
function rosterDayGroups(groups,date){
  return(groups||[]).filter(g=>g.date===date).sort((a,b)=>
    String(a.sortTime||a.start||'99:99').localeCompare(String(b.sortTime||b.start||'99:99'))
  );
}

function scrollRosterToToday(){
  const anchor=$('rosterTodayAnchor');
  if(!anchor)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const top=anchor.getBoundingClientRect().top+window.scrollY-18;
    window.scrollTo({top:Math.max(0,top),left:0,behavior:'auto'});
  }));
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
  const todayKey=isoDateLocal(new Date());
  const months=rosterViewMonths(todayKey);
  const groups=rosterGroupsForView(rosterGroups(),todayKey);
  const allDates=rosterCalendarDates(todayKey);
  const parts=[];
  let lastMonth='';

  for(const date of allDates){
    const month=date.slice(0,7);
    if(month!==lastMonth){
      parts.push(`<div class="roster-month-separator"><span>${esc(rosterMonthLabel(date))}</span></div>`);
      lastMonth=month;
    }

    if(date===todayKey){
      parts.push('<div id="rosterTodayAnchor" class="roster-today-anchor" aria-hidden="true"></div>');
    }

    const dayGroups=rosterDayGroups(groups,date);
    if(dayGroups.length){
      parts.push(await rosterGroupHtml(dayGroups,true));
    }
  }

  box.innerHTML=parts.join('');
  if(!$('rosterView').classList.contains('hidden'))scrollRosterToToday();
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
}
function openRosterEntryModule(id){
  const item=load(FLIGHTS_KEY).find(x=>x.id===id);if(!item)return false;
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
  const item=load(DUTY_KEY).find(x=>x.id===id);if(!item)return false;
  dutyRosterContext={id:item.id};$('dutyEditId').value=item.id;$('dutyDate').value=item.date||today();$('dutyType').value=dutyEditorType(item.type||'Duty');
  $('reportTime').value=item.report||'';$('endDuty').value=item.end||'';$('dutyNotes').value=item.notes||'';
  $('dutyEditorTitle').textContent=`Edit roster ${canonicalDutyType(item.type||'Duty','Duty')}`;$('dutySaveBtn').textContent='Save changes';$('dutyBackBtn').classList.remove('hidden');$('dutyDeleteRosterBtn').classList.remove('hidden');
  show('dutyView');return true;
}
function deleteRosterEntryActivity(){
  const ctx=entryRosterActivityContext;if(!ctx?.id)return false;const rows=load(FLIGHTS_KEY),victim=rows.find(x=>x.id===ctx.id);if(!victim)return false;
  if(victim.locked){alert('This locked activity can be edited from Roster, but deletion still requires unlocking it in Logbook.');return false}
  if(!confirm('Delete this roster activity? It will disappear completely.'))return false;
  markCloudDeleted('flights',victim);save(FLIGHTS_KEY,rows.filter(x=>x.id!==ctx.id));reconcileAllDuties();clearEntryRosterActivityContext();setEntryReturnContext(null);renderRoster();renderDuty();show('rosterView');scheduleAutoSync('roster-delete');return true;
}
function deleteRosterDutyActivity(){
  const id=dutyRosterContext?.id;if(!id)return false;if(!confirm('Delete this roster activity? It will disappear completely.'))return false;
  const rows=load(DUTY_KEY),victim=rows.find(x=>x.id===id);markCloudDeleted('duties',victim||id);save(DUTY_KEY,rows.filter(x=>x.id!==id));reconcileAllDuties();resetDutyEditor();renderDuty();show('rosterView');scheduleAutoSync('roster-delete');return true;
}


async function clearImportedRosterData(){
  const roster=load(ROSTER_KEY),entries=load(FLIGHTS_KEY),duties=load(DUTY_KEY);
  roster.forEach(x=>{if(x?.id)markCloudDeleted('roster',x,{includeSource:false})});
  const keepEntries=[];
  for(const x of entries){
    if(x?.aerolineRosterPlanned&&!x.locked){if(x.id)markCloudDeleted('flights',x,{includeSource:false});continue}
    if(x?.aerolineRosterPlanned&&x.locked)keepEntries.push(stamp({...x,aerolineRosterPlanned:false,rosterHidden:true}));
    else keepEntries.push(x);
  }
  const keepDuties=[];
  for(const x of duties){
    if(x?.aerolineRosterPlanned){if(x.id)markCloudDeleted('duties',x,{includeSource:false});continue}
    keepDuties.push(x);
  }
  save(ROSTER_KEY,[]);await saveFlightsDurable(keepEntries);save(DUTY_KEY,keepDuties);
  const currentSource=String($('entrySourceDisplay')?.dataset.source||'').toLowerCase();
  if(currentSource==='aeroline'||currentSource==='roster'){clearEntryDraft();resetEntry()}
  reconcileAllDuties();return{roster:roster.length,entries:entries.length-keepEntries.length,duties:duties.length-keepDuties.length};
}



function renderDuty(){const ds=load(DUTY_KEY).sort((a,b)=>String(b.date).localeCompare(String(a.date)));$('dutyList').innerHTML=ds.length?ds.map(d=>`<div class="rowitem"><div><b>${esc(d.type)}</b><div class="small">${esc(displayDate(d.date))} • ${esc(d.notes||'')}</div></div><div class="meta"><b>${fmt(d.minutes)}</b><br>${esc(d.report||'')}–${esc(d.end||'')}<div class="list-actions"><button class="danger" data-delete-duty="${d.id}">Delete</button></div></div></div>`).join(''):'<div class="empty">No duties yet.</div>'}
function buildTotalsModel(entries,now=new Date()){
  const all=entries||[],flying=all.filter(f=>activityRule(f).totals==='flight'),simulators=all.filter(f=>activityRule(f).totals==='simulator'&&simulatorCompleted(f,now));
  const a320Flights=flying.filter(isA320Entry),a320Sims=simulators.filter(isA320Entry);
  return{
    flying,simulators,a320Flights,a320Sims,
    totalFlight:sum(flying,totalFlightMins),totalSimulator:sum(simulators,f=>Number(f.simulatorTime)||0),a320Flight:sum(a320Flights,totalFlightMins),a320Pic:sum(a320Flights,picMins),a320Sic:sum(a320Flights,sicMins),
    a320FlightInstruction:sum(a320Flights,flightInstrMins),a320SimInstruction:sum(a320Sims,simInstrMins),a320SimulatorTime:sum(a320Sims,f=>Number(f.simulatorTime)||0),
    rightSeat:sum(flying,f=>upper(f.seatPosition||'')==='RIGHT'?totalFlightMins(f):0)
  };
}
async function renderTotals(){
  const fs=load(FLIGHTS_KEY),model=buildTotalsModel(fs),flying=model.flying;
  $('tTotalFlight').textContent=fmt(model.totalFlight);if($('tTotalSimulator'))$('tTotalSimulator').textContent=fmt(model.totalSimulator);$('tA320Total').textContent=fmt(model.a320Flight);if($('tA320Simulator'))$('tA320Simulator').textContent=fmt(model.a320SimulatorTime);$('tA320Pic').textContent=fmt(model.a320Pic);$('tA320Sic').textContent=fmt(model.a320Sic);$('tA320FlightInstruction').textContent=fmt(model.a320FlightInstruction);$('tA320SimInstruction').textContent=fmt(model.a320SimInstruction);$('tRightSeat').textContent=fmt(model.rightSeat);
  const now=new Date(),y=now.getUTCFullYear(),m=now.getUTCMonth(),month=sum(flying,f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d.getUTCMonth()===m?totalFlightMins(f):0}),year=calendarYearFlight();
  const sixMonthsAgo=new Date();sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth()-6);sixMonthsAgo.setUTCHours(0,0,0,0);const last6m=sum(flying,f=>dateOnly(f.date)>=sixMonthsAgo?totalFlightMins(f):0);
  $('periodTotals').innerHTML=[['This Month — Flight',month],['This Year — Flight',year],['Last 28 days — Flight',rollingFlight(28)],['Last 90 days — Flight',rollingFlight(90)],['Last 6 months — Flight',last6m],['Last 365 days — Flight',rollingFlight(365)]].map(([n,v])=>`<div class="stat-row"><span>${n}</span><b>${fmt(v)}</b></div>`).join('');
  const approachTypes=['CAT3','ILS','LOC','RNAV','RNAV AR','VOR','NDB','CRCL','VIS','GOA'],counts=Object.fromEntries(approachTypes.map(x=>[x,0]));flying.forEach(f=>{const a=upper(f.approachType||'');if(counts[a]!==undefined)counts[a]++});$('approachTotals').innerHTML=approachTypes.map(a=>`<div class="stat-row"><span>${esc(a)}</span><b>${counts[a]}</b></div>`).join('');
  $('aircraftBreakdown').innerHTML=`<div class="stat-row"><span><b>A320</b><div class="small">Flying ${fmt(model.a320Flight)} • Simulator ${fmt(model.a320SimulatorTime)} (kept separate)</div></span><b>${fmt(model.a320Flight)}</b></div>`;
}


function tripIncludedEntries(t){
  const fs=operationalEntriesForTrips();
  if(Array.isArray(t.includedEntryIds)&&t.includedEntryIds.length){
    const set=new Set(t.includedEntryIds),selected=fs.filter(f=>set.has(f.id)).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
    if(selected.length)return selected;
  }
  const s=new Date(t.start),e=new Date(t.end);
  return fs.filter(f=>{
    const a=tripSequenceStart(f),b=tripSequenceEnd(f);
    return a&&b&&a<e&&b>s;
  }).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
}
function renderTripInspector(tripId){
  const wrap=$('tripInspectorWrap'),box=$('tripInspector');
  const t=load(TRIPS_KEY).find(x=>x.id===tripId);
  if(!t){wrap.classList.add('hidden');box.innerHTML='';return}
  const entries=tripIncludedEntries(t),s=new Date(t.start),e=new Date(t.end);
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
     <div class="stat-row"><span>Paid layover</span><b>${fmt(t.layover)}</b></div>
     <div class="section-title inner">Included entries</div>
     ${rows||'<div class="empty">No entries found for this trip.</div>'}`;
  wrap.classList.remove('hidden');
  wrap.scrollIntoView({behavior:'smooth',block:'start'});
}
function tripFirstDhdDestination(t){
  const entries=tripIncludedEntries(t);
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
function tripDisplayName(t){
  const dest=tripFirstDhdDestination(t);
  const ref=tripReferenceLabel(t);
  return [dest,ref].filter(Boolean).join(' ');
}
function renderTrips(){const ts=load(TRIPS_KEY).sort((a,b)=>String(b.start).localeCompare(String(a.start)));$('tripList').innerHTML=ts.length?ts.map(t=>`<div class="rowitem"><div><b>${esc(tripDisplayName(t)||'TRIP')}</b><div class="small">${esc(displayDateTime(t.start))} → ${esc(displayDateTime(t.end))}${t.cashEligible?' • Positioning cash eligible':''}${Number(t.cashAmount||0)>0?` • Cash ${money(t.cashAmount)} ${esc(upper(t.cashCurrency||''))}${Number(t.cashEur||0)>0?` ≈ €${money(t.cashEur)}`:''}`:''}</div></div><div class="meta"><b>${fmt(t.layover)}</b><br><span class="small">${money(t.allowance??(t.layover/60*paySettings().layoverRate))} DHM allowance</span><div class="list-actions"><button class="secondary" data-view-trip="${t.id}">View duties</button><button class="secondary" data-edit-trip="${t.id}">Edit</button><button class="danger" data-delete-trip="${t.id}">Delete</button></div></div></div>`).join(''):'<div class="empty">No trips yet.</div>'}
function renderSettings(){const st=appSettings();$('setHomeBase').value=st.homeBase||'CMN';$('setFlightPrefix').value=st.flightPrefix||'MAC';$('setAircraftPrefix').value=st.aircraftPrefix||'CN-NM';$('setProfileName').value=st.profileName||'';$('setProfileRole').value=st.profileRole||'Captain';$('autoSyncEnabled').value=autoSyncEnabled()?'yes':'no';$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||$('cloudEmail').value||'';if($('logTenArchiveStatus'))$('logTenArchiveStatus').textContent=logTenArchiveStatusText();updatePrefixUI();updateAppHeader();fillPaySettings();renderWeeklyBackupStatus();updateCloudStatus();ensureAirportDb(false)}
function setEntryLockedUI(locked){$('flightForm').querySelectorAll('input:not(#editId),select,textarea').forEach(el=>{if(['blockDisplay','schedBlockDisplay','totalTimeDisplay','picDisplay','sicDisplay','flightInstructionDisplay','simInstructionDisplay','sectorDisplay','totalDutyDisplay','night'].includes(el.id))return;el.disabled=!!locked});$('creditDisplay').disabled=!!locked;if($('saveEntryBtn'))$('saveEntryBtn').disabled=!!locked;$('lockEntryBtn').disabled=false;$('lockEntryBtn').textContent=locked?'🔓 Unlock':'🔒 Lock';$('entryLockStatus').textContent=locked?'LOCKED • All entry data are protected from editing.':'Draft autosaves on this device. Lock the entry when all data are final.';$('entryLockStatus').classList.toggle('success',!!locked)}
const ENTRY_DRAFT_FIELDS=['editId','rosterLinkId','entryDraftId','dutyTypeFlight','date','flightNo','reg','type','simLocation','courseType','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','creditDisplay','role','seatPosition','callFromDayOff','picName','sicName','soName','instructorName','instructionType','night','ifr','pf','approachType','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','delayReason','remarks'];
let entryDraftTimer=null;
function entryDraftPool(){try{const v=JSON.parse(localStorage.getItem(ENTRY_DRAFTS_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
function writeEntryDraftPool(rows){try{localStorage.setItem(ENTRY_DRAFTS_KEY,JSON.stringify((rows||[]).slice(-20)));return true}catch(e){console.warn('Draft shelf unavailable',e);return false}}
function captureEntryDraft(){
  const data={};ENTRY_DRAFT_FIELDS.forEach(id=>{const el=$(id);if(el)data[id]=el.type==='checkbox'?el.checked:el.value});
  data.savedAt=new Date().toISOString();data.source=$('entrySourceDisplay')?.dataset.source||'manual';
  if(!data.editId&&!data.entryDraftId){data.entryDraftId=makeId();$('entryDraftId').value=data.entryDraftId}
  return data;
}
function draftMeaningful(d){return !!(d&&(d.editId||d.rosterLinkId||d.flightNo||d.reg||d.dep||d.arr||d.simLocation||d.schedOut||d.schedIn||d.onDuty||d.offDuty||d.out||d.off||d.on||d.in||d.courseType||d.delayReason||d.remarks))}
function saveEntryDraft(){
  const d=captureEntryDraft();
  try{localStorage.setItem(ENTRY_DRAFT_KEY,JSON.stringify(d))}catch(e){console.warn('Active draft save unavailable',e)}
  if(!d.editId&&d.source==='manual'&&draftMeaningful(d)){
    const rows=entryDraftPool(),i=rows.findIndex(x=>x.entryDraftId===d.entryDraftId);if(i>=0)rows[i]=d;else rows.push(d);writeEntryDraftPool(rows);
  }
  renderEntryDraftShelf();return d;
}
function removeDraftFromPool(id){if(!id)return;writeEntryDraftPool(entryDraftPool().filter(x=>x.entryDraftId!==id))}
function clearEntryDraft(){const id=$('entryDraftId')?.value||loadObject(ENTRY_DRAFT_KEY,null)?.entryDraftId||'';try{localStorage.removeItem(ENTRY_DRAFT_KEY)}catch{};removeDraftFromPool(id);renderEntryDraftShelf()}
function clearAllEntryDrafts(){try{localStorage.removeItem(ENTRY_DRAFT_KEY);localStorage.removeItem(ENTRY_DRAFTS_KEY)}catch{};renderEntryDraftShelf()}
function restoreEntryDraftObject(d){
  if(!d)return false;
  ENTRY_DRAFT_FIELDS.forEach(id=>{const el=$(id);if(el&&d[id]!==undefined){if(el.type==='checkbox')el.checked=!!d[id];else el.value=d[id]}});
  if($('entrySourceDisplay')){$('entrySourceDisplay').dataset.source=d.source||'manual';setEntrySourceDisplay(d.source||'manual')}
  if(!$('entryDraftId').value&&!$('editId').value)$('entryDraftId').value=d.entryDraftId||makeId();
  setEntryTypeUI();setEntryLockedUI(false);if($('dutyTypeFlight').value==='Simulator')syncSimulatorDutySchedule();else if($('dutyTypeFlight').value==='Flight'&&$('schedOut').value&&!$('onDuty').value)syncOnDutyFromScheduleOut();calcEntry();updateAirportInfo();updateExaminerRemarkReminder();updateDelayUI();renderEntryDraftShelf();return true;
}
function restoreEntryDraft(){
  let d=loadObject(ENTRY_DRAFT_KEY,null);
  if(!d){const rows=entryDraftPool().sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||'')));d=rows[0]||null}
  return restoreEntryDraftObject(d);
}
function openEntryDraft(id){const d=entryDraftPool().find(x=>x.entryDraftId===id);if(!d)return false;try{localStorage.setItem(ENTRY_DRAFT_KEY,JSON.stringify(d))}catch{};resetEntry(false);restoreEntryDraftObject(d);show('addView');return true}
function deleteEntryDraft(id){if(!id)return;const active=loadObject(ENTRY_DRAFT_KEY,null);removeDraftFromPool(id);if(active?.entryDraftId===id)localStorage.removeItem(ENTRY_DRAFT_KEY);if($('entryDraftId')?.value===id)resetEntry(false);renderEntryDraftShelf()}
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
  $('editId').value=f.id;$('entryDraftId').value='';if($('rosterLinkId'))$('rosterLinkId').value=f.rosterItemId||'';
  if($('entrySourceDisplay'))$('entrySourceDisplay').dataset.source=f.source||'manual';setEntrySourceDisplay(f.source||'manual');$('callFromDayOff').checked=!!f.callFromDayOff;
  const map={dutyTypeFlight:'dutyType'};
  ['dutyTypeFlight','date','type','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','role','seatPosition','instructionType','night','ifr','pf','approachType','remarks','courseType','picName','sicName','soName','instructorName','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','delayReason'].forEach(id=>{let v=id==='dutyTypeFlight'?canonicalType:f[map[id]||id];if(id==='pf'&&v==null)v=(Number(f.dayTakeoffs||0)+Number(f.nightTakeoffs||0)+Number(f.dayLandings||0)+Number(f.nightLandings||0))>0?'yes':'no';$(id).value=v??''});
  $('flightNo').value=flightNoInput(f.flightNo||'');$('reg').value=isSim(f)?upper(f.reg||''):aircraftIdInput(f.reg||'');$('simLocation').value=upper(f.location||(isSim(f)?f.dep:'')||'');$('creditDisplay').value=fmt(creditMinsForEntry({...f,dutyType:canonicalType}));$('sectorDisplay').value=String(f.sectors||'');$('totalDutyDisplay').value=f.totalDuty?fmt(f.totalDuty):'';
  setEntryTypeUI();if(isDhp(f))$('creditDisplay').value=fmt(Number(f.credit)||0);calcEntry();
  if(rosterActivity&&rosterCanEditLockedActivity({...f,dutyType:canonicalType})){
    entryRosterActivityContext={id:f.id,type:canonicalType,preserveLocked:!!f.locked};setEntryLockedUI(false);$('dutyTypeFlight').disabled=true;$('lockEntryBtn').classList.add('hidden');$('entryRosterDeleteBtn').classList.remove('hidden');$('entryTitle').textContent=`Edit roster ${canonicalType}`;
  }else{$('entryTitle').textContent=f.locked?'View locked entry':'Edit log entry';setEntryLockedUI(!!f.locked)}
  updateAirportInfo();updateDelayUI();saveEntryDraft();
}


function confirmPossibleDayOffPaid(){
  const rid=$('rosterLinkId')?.value||'';if(!rid||$('callFromDayOff')?.checked)return true;
  const rows=load(ROSTER_KEY),r=rows.find(x=>x.id===rid);if(!r?.aerolinePossibleDayOffPaid||r.dayOffPaidPromptDismissed)return true;
  const reason=r.aerolineDayOffPaidSignal||'AeroLINE roster change';
  const yes=confirm(`Possible Day Off Paid detected for ${displayDate(r.date)}.\n\nSignal: ${reason}.\n\nMark “Called to work from a scheduled day off”?`);
  if(yes){$('callFromDayOff').checked=true;r.dayOffPaidPromptConfirmed=true;r._syncRev=recordRevision(r)+1;r._updatedAt=new Date().toISOString();save(ROSTER_KEY,rows);markCloudEdited('roster',r,'edit');return true}
  r.dayOffPaidPromptDismissed=true;r._syncRev=recordRevision(r)+1;r._updatedAt=new Date().toISOString();save(ROSTER_KEY,rows);markCloudEdited('roster',r,'edit');return true;
}
function collectEntry(lockedOverride=null){
  const c=calcEntry(),dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight'),id=$('editId').value||makeId(),existing=load(FLIGHTS_KEY).find(x=>x.id===id),delayMinutes=dutyType==='Flight'?formDelayMinutes():0;
  const sim=dutyType==='Simulator',flight=dutyType==='Flight';
  return stamp({
    id,dutyType,date:$('date').value,flightNo:flight?composeFlightNo($('flightNo').value):'',
    reg:sim?upper($('reg').value):composeAircraftId($('reg').value),type:upper($('type').value),location:sim?upper($('simLocation').value):'',
    dep:sim?'':upper($('dep').value),arr:sim?'':upper($('arr').value),schedOut:$('schedOut').value,schedIn:$('schedIn').value,schedBlock:c.schedBlock,
    onDuty:$('onDuty').value,offDuty:$('offDuty').value,out:flight?$('out').value:'',off:flight?$('off').value:'',on:flight?$('on').value:'',in:flight?$('in').value:'',
    block:flight?c.block:0,flight:flight?c.flight:0,simulatorTime:sim?c.simulatorTime:0,credit:c.credit,
    role:sim?'':$('role').value,seatPosition:sim?'':($('seatPosition')?.value||''),callFromDayOff:!!$('callFromDayOff')?.checked,instructionType:$('instructionType').value,
    night:sim?'00:00':$('night').value,sim:sim?'yes':'no',ifr:sim?'no':$('ifr').value,
    dayTakeoffs:sim?0:Number($('dayTakeoffs').value||0),nightTakeoffs:sim?0:Number($('nightTakeoffs').value||0),dayLandings:sim?0:Number($('dayLandings').value||0),nightLandings:sim?0:Number($('nightLandings').value||0),
    courseType:upper($('courseType')?.value||''),picName:upper($('picName')?.value||''),sicName:upper($('sicName')?.value||''),soName:upper($('soName')?.value||''),instructorName:upper($('instructorName')?.value||''),
    pf:sim?'no':($('pf')?.value||'no'),approachType:sim?'':upper($('approachType')?.value||''),delayMinutes,delayReason:delayMinutes?upper($('delayReason')?.value||''):'',remarks:$('remarks').value.trim(),
    locked:lockedOverride===null?!!existing?.locked:!!lockedOverride,source:existing?.source||$('entrySourceDisplay')?.dataset.source||'manual',rosterItemId:$('rosterLinkId')?.value||existing?.rosterItemId||'',
    rosterAerolineKey:(()=>{const rid=$('rosterLinkId')?.value||existing?.rosterItemId||'';return rid?(load(ROSTER_KEY).find(r=>r.id===rid)?.aerolineKey||existing?.rosterAerolineKey||''):(existing?.rosterAerolineKey||'')})()
  });
}
function persistEntry(lockIt=false){
  const dutyType=canonicalDutyType($('dutyTypeFlight').value||'Flight');if(!$('date').value){alert('Please enter the date.');return false}
  if((dutyType==='Flight'||dutyType==='DHD'||dutyType==='DHP')&&(!$('dep').value.trim()||!$('arr').value.trim())){alert('Please enter From and To.');return false}
  if(dutyType==='Flight'&&!promptDelayReasonIfNeeded())return false;
  const id=$('editId').value,fs=load(FLIGHTS_KEY),existing=id?fs.find(x=>x.id===id):null,rosterEdit=!!(existing&&entryRosterActivityContext?.id===existing.id&&rosterCanEditLockedActivity(existing));
  if(existing?.locked&&!lockIt&&!rosterEdit){alert('This entry is locked. Unlock it before editing.');return false}
  const f=collectEntry(lockIt?true:(rosterEdit?null:false)),i=fs.findIndex(x=>x.id===f.id);if(i>=0)fs[i]={...fs[i],...f};else fs.push(f);save(FLIGHTS_KEY,fs);$('editId').value=f.id;markCloudEdited('flights',f,lockIt?'lock':(existing?'edit':'create'));
  if(isFlight(f)&&f.rosterItemId)markRosterSectorCompleted(f.rosterItemId,f);reconcileAllDuties();refreshEntrySuggestions();saveEntryDraft();scheduleAutoSync(lockIt?'lock-entry':'save-entry');return f;
}



function runRosterLogbookIntegrityCheck(){
  const roster=load(ROSTER_KEY).filter(r=>r&&r.source==='aeroline'&&r.date&&r.flightNo&&r.dep&&r.arr);
  const flights=load(FLIGHTS_KEY).filter(f=>f&&isFlight(f)&&f.date&&f.flightNo);
  const missing=[],mismatch=[],ok=[];
  for(const r of roster){
    const key=normalizedFlightKey(r.flightNo);
    const same=flights.filter(f=>f.date===r.date&&normalizedFlightKey(f.flightNo)===key);
    if(!same.length){missing.push(r);continue}
    const exact=same.find(f=>upper(f.dep)===upper(r.dep)&&upper(f.arr)===upper(r.arr));
    if(exact){ok.push({roster:r,logbook:exact});continue}
    mismatch.push({roster:r,logbook:same[0],candidates:same});
  }
  const result={checkedAt:new Date().toISOString(),rosterSectors:roster.length,ok,missing,mismatch};
  const status=$('integrityStatus'),out=$('integrityResults');
  if(status)status.textContent=`${roster.length} AeroLINE sector(s) checked • ${ok.length} matched • ${missing.length} missing • ${mismatch.length} mismatch`;
  if(out){
    if(!missing.length&&!mismatch.length){out.innerHTML='<strong>PASS</strong> — No Roster ↔ Logbook discrepancies found for AeroLINE flight sectors.'}
    else{
      const rows=[];
      mismatch.forEach(x=>rows.push(`<div><strong>MISMATCH</strong> ${esc(x.roster.date)} ${esc(x.roster.flightNo)} — Roster ${esc(x.roster.dep)}→${esc(x.roster.arr)} / Logbook ${esc(x.logbook.dep||'—')}→${esc(x.logbook.arr||'—')}</div>`));
      missing.forEach(r=>rows.push(`<div><strong>MISSING</strong> ${esc(r.date)} ${esc(r.flightNo)} — ${esc(r.dep)}→${esc(r.arr)} is in AeroLINE roster but has no matching Logbook entry.</div>`));
      out.innerHTML=rows.join('');
    }
  }
  return result;
}

document.addEventListener('DOMContentLoaded',async()=>{
  await initFlightStore();
  document.querySelector('.nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b){e.preventDefault();show(b.dataset.view)}});
  document.addEventListener('change',e=>{
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
  $('logbookSearch')?.addEventListener('input',e=>{logbookSearchQuery=e.target.value||'';renderEntriesSafe();if(logbookSearchQuery.trim().length>=2&&!airportDbLoaded)ensureAirportDb(false).then(()=>renderEntriesSafe()).catch(()=>{})});
  $('clearLogbookSearch')?.addEventListener('click',()=>{logbookSearchQuery='';if($('logbookSearch'))$('logbookSearch').value='';renderEntriesSafe();$('logbookSearch')?.focus()});
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
  ['out','off','on','in','schedOut','schedIn','onDuty','offDuty','role','instructionType','pf','approachType'].forEach(id=>$(id).addEventListener('input',async()=>{if(id==='schedOut')syncOnDutyFromScheduleOut();if(id==='in')syncOffDutyFromActualIn();if((id==='onDuty'||id==='offDuty')&&$('dutyTypeFlight').value==='Simulator')syncSimulatorDutySchedule();if(id==='role')syncProfileNameWithRole();calcEntry();if(['out','off','on','in','pf'].includes(id))await calcNightForForm();silentAutosaveExisting()}));
  $('out').addEventListener('change',()=>{updateDelayUI();if(formDelayMinutes()>0&&!$('delayReason').value)promptDelayReasonIfNeeded();silentAutosaveExisting()});
  $('role').addEventListener('input',updateExaminerRemarkReminder);
  $('dutyTypeFlight').addEventListener('change',()=>{setEntryTypeUI();if($('dutyTypeFlight').value==='Flight')syncProfileNameWithRole();if($('dutyTypeFlight').value==='Simulator')syncSimulatorDutySchedule();calcEntry();silentAutosaveExisting()});
  $('courseType').addEventListener('input',()=>calcEntry());
  $('onDuty').addEventListener('input',()=>calcEntry());
  $('creditDisplay').addEventListener('change',()=>{const dt=$('dutyTypeFlight').value;if(dt==='DHP')$('creditDisplay').value=fmt(durMins($('creditDisplay').value));if(dt==='DHD')$('creditDisplay').value='0:00'});
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
  $('lockEntryBtn').addEventListener('click',async()=>{const id=$('editId').value,fs=load(FLIGHTS_KEY),existing=id?fs.find(x=>x.id===id):null;if(existing?.locked){if(!confirm('Unlock this entry and allow editing?'))return;existing.locked=false;existing._updatedAt=new Date().toISOString();existing._syncRev=recordRevision(existing)+1;save(FLIGHTS_KEY,fs);markCloudEdited('flights',existing,'unlock');setEntryLockedUI(false);saveEntryDraft();scheduleAutoSync('unlock-entry');return}if(canonicalDutyType($('dutyTypeFlight').value)==='Flight')await calcNightForForm();if(!confirmPossibleDayOffPaid())return;if(!confirm('Lock this entry? Its data will be protected from accidental editing.'))return;const saved=persistEntry(true);if(!saved)return;setEntryLockedUI(true);saveEntryDraft();await render();const latest=load(FLIGHTS_KEY).find(x=>x.id===saved.id);if(latest)loadEntryToForm(latest);show('addView')});
  $('dutyForm').addEventListener('submit',e=>{e.preventDefault();const ds=load(DUTY_KEY),id=$('dutyEditId')?.value||makeId(),i=ds.findIndex(x=>x.id===id),existing=i>=0?ds[i]:null,rep=$('reportTime').value,end=$('endDuty').value,d=stamp({...existing,id,date:$('dutyDate').value,type:$('dutyType').value,report:rep,end,minutes:timeSpanMins(rep,end),notes:$('dutyNotes').value.trim()});if(i>=0)ds[i]=d;else ds.push(d);save(DUTY_KEY,ds);markCloudEdited('duties',d,existing?'edit':'create');reconcileAllDuties();const returnToRoster=!!dutyRosterContext;resetDutyEditor();renderDuty();render();scheduleAutoSync('duty-save');if(returnToRoster)show('rosterView')});
  ['tripStart','tripEnd'].forEach(id=>$(id).addEventListener('input',tripCalc));['tripCashAmount','tripCashCurrency'].forEach(id=>$(id)?.addEventListener('change',()=>tripCashConversion()));$('calcTrip').addEventListener('click',()=>{tripCalc();tripCashConversion()});$('clearTrip').addEventListener('click',resetTrip);
  $('tripForm').addEventListener('submit',async e=>{e.preventDefault();const c=tripCalc();if(!c)return alert('Enter a valid Trip Start and Trip End.');const fx=await tripCashConversion();const ts=load(TRIPS_KEY),id=$('tripEditId').value||makeId(),existing=ts.find(x=>x.id===id),cashAmount=Number($('tripCashAmount')?.value||0),cashCurrency=upper($('tripCashCurrency')?.value||''),t=stamp({...existing,id,base:upper(appSettings().homeBase||'CMN'),stations:upper($('tripStations').value),start:$('tripStart').value,end:$('tripEnd').value,trip:c.trip,duty:c.duty,layover:c.layover,allowance:c.allowance,cashEligible:existing?.cashEligible||false,cashAmount,cashCurrency,cashEur:fx?.eur||Number($('tripCashEur')?.value||0),cashFxRate:fx?.rate||0,cashFxDate:fx?.date||'',remarks:$('tripRemarks').value.trim()}),i=ts.findIndex(x=>x.id===id);if(i>=0)ts[i]=t;else ts.push(t);save(TRIPS_KEY,ts);markCloudEdited('trips',t,existing?'edit':'create');resetTrip();renderTrips();scheduleAutoSync('trip-save');alert('Trip saved.')});
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
  $('exportCsv').addEventListener('click',()=>{const d=load(FLIGHTS_KEY);if(!d.length)return alert('No entries to export');const cols=['dutyType','date','flightNo','reg','type','location','dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty','totalDuty','sectors','out','off','on','in','block','flight','simulatorTime','credit','role','seatPosition','callFromDayOff','instructionType','night','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','ifr','pf','approachType','remarks','locked'];download('pilotlog_logbook.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
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
  $('rosterFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;markLocalOnlyImport('Roster CSV import in progress');const rows=parseCsv(await file.text());if(rows.length<2)return alert('CSV contains no data');const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''),aliases={date:['date','day'],flightNo:['flightno','flightnumber','flight','flt'],dep:['dep','departure','from','origin'],arr:['arr','arrival','to','destination'],std:['std','departuretime','scheduleddeparture','offblock'],sta:['sta','arrivaltime','scheduledarrival','onblock']},fieldFor=h=>Object.keys(aliases).find(k=>aliases[k].includes(norm(h)))||null,map=rows[0].map(fieldFor),imp=rows.slice(1).map(r=>{const o={id:makeId(),status:'planned'};map.forEach((k,i)=>{if(k)o[k]=r[i]||''});o.date=normalDate(o.date);['dep','arr','flightNo'].forEach(k=>o[k]=upper(o[k]));if(o.flightNo)o.flightNo=rosterFlightLabel(o.flightNo);return o}).filter(x=>x.date&&(x.dep||x.arr||x.flightNo));const merged=dedupeRosterItems([...load(ROSTER_KEY),...imp]);save(ROSTER_KEY,merged);e.target.value='';await render();markLocalOnlyImport('Roster CSV import');alert(`${imp.length} roster sectors imported`)});
  $('detectTripsBtn').addEventListener('click',()=>autoDetectTrips(true));
  $('appSettingsForm').addEventListener('submit',e=>{e.preventDefault();saveAppSettings({homeBase:upper($('setHomeBase').value)||'CMN',flightPrefix:cleanPrefix($('setFlightPrefix').value)||'MAC',aircraftPrefix:cleanPrefix($('setAircraftPrefix').value)||'CN-NM',profileName:$('setProfileName').value.trim(),profileRole:$('setProfileRole').value||'Captain'});setAutoSyncEnabled($('autoSyncEnabled').value==='yes');renderSettings();if(!$('editId').value)applyProfileDefaultsToEntry();refreshEntrySuggestions();scheduleAutoSync('settings');alert('Settings saved.')});
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
  $('paySettingsForm').addEventListener('submit',e=>{e.preventDefault();localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify({...readPaySettings(),_updatedAt:new Date().toISOString()}));setEntryTypeUI();renderPayroll();scheduleAutoSync('payroll-settings');alert('Payroll settings saved.')});
  $('resetPaySettings').addEventListener('click',()=>{if(confirm('Restore default rates?')){localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify(PAY_DEFAULTS));fillPaySettings();renderPayroll()}});
  $('deleteAll').addEventListener('click',async()=>{if(confirm('Delete ALL saved log entries? This cannot be undone.')){load(FLIGHTS_KEY).filter(isFlight).forEach(markRosterSectorIncompleteForEntry);markCloudCollectionDeleted('flights');await saveFlightsDurable([]);clearAllEntryDrafts();await render();scheduleAutoSync('delete-all-entries')}});
  $('clearRoster').addEventListener('click',async()=>{if(confirm('Clear the complete imported roster? Flights, OFF, DHD/DHP, standby and training roster activities will be removed. Locked Logbook entries are preserved.')){const r=await clearImportedRosterData();await render();renderDuty();renderTrips();scheduleAutoSync('clear-roster');alert(`Roster cleared: ${r.roster} sectors • ${r.entries} activities • ${r.duties} duties removed.`)}});
  $('exportRoster').addEventListener('click',()=>{const d=load(ROSTER_KEY);if(!d.length)return alert('No roster to export');const cols=['date','flightNo','dep','arr','std','sta','status'];download('pilotlog_roster.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  document.addEventListener('click',async e=>{let b=e.target.closest('[data-delete-flight]');if(b){if(!confirm('Confirm to delete this log entry?'))return;const rows=load(FLIGHTS_KEY),victim=rows.find(f=>f.id===b.dataset.deleteFlight);markCloudDeleted('flights',victim||b.dataset.deleteFlight);if(victim)markRosterSectorIncompleteForEntry(victim);save(FLIGHTS_KEY,rows.filter(f=>f.id!==b.dataset.deleteFlight));reconcileAllDuties();await render();scheduleAutoSync('delete-flight');return}
    b=e.target.closest('[data-edit-flight]');if(b){const f=load(FLIGHTS_KEY).find(x=>x.id===b.dataset.editFlight);if(f){loadEntryToForm(f);setEntryReturnContext('flightsView',f.id);show('addView')}return}
    b=e.target.closest('[data-edit-roster-entry]');if(b){openRosterEntryModule(b.dataset.editRosterEntry);return}
    b=e.target.closest('[data-edit-roster-duty]');if(b){openRosterDutyModule(b.dataset.editRosterDuty);return}
    b=e.target.closest('[data-delete-duty]');if(b){if(!confirm('Confirm to delete this duty?'))return;const rows=load(DUTY_KEY),victim=rows.find(d=>d.id===b.dataset.deleteDuty);markCloudDeleted('duties',victim||b.dataset.deleteDuty);save(DUTY_KEY,rows.filter(d=>d.id!==b.dataset.deleteDuty));reconcileAllDuties();renderDuty();await render();scheduleAutoSync('delete-duty');return}
    b=e.target.closest('[data-view-trip]');if(b){renderTripInspector(b.dataset.viewTrip);return}
    b=e.target.closest('[data-edit-trip]');if(b){const t=load(TRIPS_KEY).find(x=>x.id===b.dataset.editTrip);if(!t)return;$('tripEditId').value=t.id;$('tripStations').value=t.stations||'';$('tripStart').value=t.start||'';$('tripEnd').value=t.end||'';$('tripLayover').value=fmt(t.layover||0);$('tripAllowance').value=Number(t.allowance||0).toFixed(2);$('tripCashAmount').value=Number(t.cashAmount||0)||'';$('tripCashCurrency').value=upper(t.cashCurrency||'');$('tripCashEur').value=Number(t.cashEur||0)>0?Number(t.cashEur).toFixed(2):'';$('tripRemarks').value=t.remarks||'';$('tripForm').scrollIntoView({behavior:'smooth',block:'start'});return}
    b=e.target.closest('[data-delete-trip]');if(b){if(!confirm('Confirm to delete this trip?'))return;const rows=load(TRIPS_KEY),victim=rows.find(t=>t.id===b.dataset.deleteTrip);markCloudDeleted('trips',victim||b.dataset.deleteTrip);save(TRIPS_KEY,rows.filter(t=>t.id!==b.dataset.deleteTrip));renderTrips();$('tripInspectorWrap')?.classList.add('hidden');scheduleAutoSync('delete-trip');return}    b=e.target.closest('[data-roster-action]');if(b){
      const r=load(ROSTER_KEY).find(x=>x.id===b.dataset.rosterAction);if(!r)return;
      const existing=savedEntryForRosterSector(r);
      if(existing){
        loadEntryToForm(existing);if($('rosterLinkId'))$('rosterLinkId').value=r.id;setEntryReturnContext('rosterView',existing.id);
      }else{
        setEntryReturnContext('rosterView','');saveEntryDraft();resetEntry(false);if($('rosterLinkId'))$('rosterLinkId').value=r.id;
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
  window.addEventListener('online',()=>scheduleAutoSync('online',300));
  window.addEventListener('pagehide',()=>{try{saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleAutoSync('visible',500);else{try{saveEntryDraft()}catch{};flushFlightStore().catch(()=>{})}});
  setInterval(()=>scheduleAutoSync('periodic',300),10*60*1000);
  updateAppHeader();resetEntry(false);refreshEntrySuggestions();['picName','sicName','soName','instructorName','expiryEndorsedBy'].forEach(id=>setupSmartAutocomplete(id,()=>entrySuggestionDb.crew));setupSmartAutocomplete('type',()=>entrySuggestionDb.types);restoreEntryDraft();resetTrip();resetDutyEditor();$('payrollMonth').value=monthNow();if($('aerolineSyncMonth'))$('aerolineSyncMonth').value=monthNow();$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';fillPaySettings();renderDuty();renderSettings();renderAerolineConnect();migrateLegacyFlightSnapshots().catch(e=>console.warn('Legacy recovery migration deferred',e));const tripPlanKey='pilotlog8_1_roster_trip_recalc_v1';if(localStorage.getItem(tripPlanKey)!=='1'){try{autoDetectTrips(false,false);localStorage.setItem(tripPlanKey,'1')}catch(e){console.warn('Roster trip recalculation deferred',e)}}await render();show('dashboardView');scheduleAutoSync('startup',1500);if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw-8.6.js').catch(e=>console.warn('Offline cache unavailable',e));console.log('PilotLog v'+VERSION+' loaded');
});
})();
