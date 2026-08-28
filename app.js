(() => {
'use strict';
const VERSION='5.0.6';
const FLIGHTS_KEY='pilotlog_flights_v1', ROSTER_KEY='pilotlog_roster_v2', DUTY_KEY='pilotlog_duties_v2', TRIPS_KEY='pilotlog_trips_v1', PAY_SETTINGS_KEY='pilotlog_pay_settings_v1', PAY_MONTH_KEY='pilotlog_pay_month_v1', FX_KEY='pilotlog_fx_v1', APP_SETTINGS_KEY='pilotlog_app_settings_v1', LAST_EMAIL_KEY='pilotlog_last_email_v1';
const $=id=>document.getElementById(id);
const load=k=>{try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return[]}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const loadObject=(k,def={})=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?v:def}catch{return def}};
const stamp=o=>({...o,_updatedAt:new Date().toISOString()});
const today=()=>new Date().toISOString().slice(0,10);
const makeId=()=>`id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const mins=t=>{if(!t)return null;const [h,m]=String(t).split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null};
const diff=(a,b)=>{if(a==null||b==null)return 0;let d=b-a;if(d<0)d+=1440;return d};
const fmt=m=>`${Math.floor(Math.max(0,Number(m)||0)/60)}:${String(Math.round(Math.max(0,Number(m)||0))%60).padStart(2,'0')}`;
const credit=m=>m>0?Math.ceil(m/30)*30:0;
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
function paidFlightCreditMins(f){
  const base=credit(scheduleBlockMins(f));
  return qualifiesMoroccoNightCredit(f)?Math.round(base*1.5):base;
}
const shiftTime=(t,delta)=>{const m=mins(t);if(m==null)return'';let x=(m+delta)%1440;if(x<0)x+=1440;return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const csv=s=>`"${String(s??'').replace(/"/g,'""')}"`;
const dateOnly=d=>new Date(`${d}T00:00:00Z`);
const sum=(a,f)=>a.reduce((x,y)=>x+(Number(f(y))||0),0);
const upper=s=>String(s||'').trim().toUpperCase();
const durMins=v=>{v=String(v||'').trim();const m=v.match(/^(\d+):(\d{1,2})$/);return m?Number(m[1])*60+Number(m[2]):0};
const scheduleBlockMins=f=>Number(f.schedBlock)||diff(mins(f.schedOut),mins(f.schedIn));
function isFlight(f){return (f.dutyType||'Flight')==='Flight'}
function isSim(f){return (f.dutyType||'')==='Simulator'||f.sim==='yes'}
function isGround(f){return f.dutyType==='Ground Course'}
function isDhd(f){return f.dutyType==='DHD'}
function isStby(f){return f.dutyType==='STBY'}
function picMins(f){return isFlight(f)&&(f.role==='PIC'||f.role==='Instructor'||f.role==='Examiner')?Number(f.block)||0:0}
function sicMins(f){return isFlight(f)&&f.role==='SIC'?Number(f.block)||0:0}
function flightInstrMins(f){return isFlight(f)&&f.instructionType==='Flight Instruction'?(Number(f.block)||0):0}
function simInstrMins(f){return isSim(f)&&f.instructionType==='SFI/SFE Instruction Sim'?(Number(f.simulatorTime)||Number(f.block)||0):0}
function simTrainerMins(f){return isSim(f)&&f.instructionType==='SFI/SFE Instruction Sim'?(Number(f.simulatorTime)||0):0}
function simTraineeMins(f){return isSim(f)&&f.instructionType!=='SFI/SFE Instruction Sim'?(Number(f.simulatorTime)||0):0}

const APP_DEFAULTS={homeBase:'CMN',flightPrefix:'MAC',aircraftPrefix:'CN-NM'};
function appSettings(){return {...APP_DEFAULTS,...loadObject(APP_SETTINGS_KEY,{})}}
function saveAppSettings(v){localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify({...appSettings(),...v,_updatedAt:new Date().toISOString()}))}
function cleanPrefix(v){return upper(v).replace(/\s+/g,'')}
function composeFlightNo(raw){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^3O\d/i.test(s))return prefix+s.slice(2);if(/^\d+$/.test(s))return prefix+s;return s}
function flightNoInput(full){const prefix=cleanPrefix(appSettings().flightPrefix||'MAC'),s=cleanPrefix(full);if(prefix&&s.startsWith(prefix))return s.slice(prefix.length);if(/^3O\d/i.test(s))return s.slice(2);return s}
function composeAircraftId(raw){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(raw);if(!s)return'';if(prefix&&s.startsWith(prefix))return s;if(/^[A-Z]{1,3}-[A-Z0-9-]+$/.test(s))return s;return prefix+s}
function aircraftIdInput(full){const prefix=cleanPrefix(appSettings().aircraftPrefix||'CN-NM'),s=cleanPrefix(full);return prefix&&s.startsWith(prefix)?s.slice(prefix.length):s}
function updatePrefixUI(){const st=appSettings();$('flightPrefixLabel').textContent=cleanPrefix(st.flightPrefix||'MAC');$('aircraftPrefixLabel').textContent=cleanPrefix(st.aircraftPrefix||'CN-NM')}

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
function openAirportDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pilotlog-airports',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('cache'))db.createObjectStore('cache')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idbGet(key){const db=await openAirportDb();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly'),q=tx.objectStore('cache').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function idbSet(key,val){const db=await openAirportDb();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(val,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
function buildAirportIndex(raw){const idx={...AIRPORT_FALLBACK};Object.values(raw||{}).forEach(a=>{if(!a)return;const rec={iata:upper(a.iata),icao:upper(a.icao),name:a.name||'',city:a.city||'',country:a.country||'',lat:Number(a.lat),lon:Number(a.lon),tz:a.tz||'UTC'};if(rec.iata)idx[rec.iata]=rec;if(rec.icao)idx[rec.icao]=rec});return idx}
async function ensureAirportDb(force=false){if(airportDbLoaded&&!force)return airportIndex;const status=$('airportDbStatus');try{if(!force){const cached=await idbGet('iata-index-v1');if(cached&&Object.keys(cached).length>1000){airportIndex={...AIRPORT_FALLBACK,...cached};airportDbLoaded=true;if(status)status.textContent=`Airport database: ${Object.keys(cached).length} codes cached offline.`;return airportIndex}}if(status)status.textContent='Airport database: downloading and building offline cache…';const r=await fetch(AIRPORT_SOURCE,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const raw=await r.json();const idx=buildAirportIndex(raw);airportIndex=idx;airportDbLoaded=true;await idbSet('iata-index-v1',idx);if(status)status.textContent=`Airport database: ${Object.keys(idx).length} IATA/ICAO codes cached offline.`;return airportIndex}catch(e){airportDbLoaded=true;if(status)status.textContent='Airport database: using built-in fallback; full database will retry when online.';return airportIndex}}
async function airport(code){await ensureAirportDb(false);return airportIndex[upper(code)]||null}
async function updateAirportInfo(){for(const [field,info] of [['dep','depInfo'],['arr','arrInfo']]){const code=upper($(field).value);$(field).value=code;if(!code){$(info).textContent='';continue}const a=await airport(code);$(info).textContent=a?`${a.iata||a.icao} • ${a.name} • ${a.city} • ${a.tz}`:'Airport not found in current cache.'}}

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
async function calcNightForForm(){
  const date=$('date').value, off=$('off').value, on=$('on').value, dep=await airport($('dep').value), arr=await airport($('arr').value);
  if(!date||!off||!on||!dep||!arr){$('night').value='00:00';$('nightStatus').textContent='Night auto: enter valid From/To plus OFF and ON times.';return 0}
  const s=zuluDate(date,off),e=endZuluDate(date,off,on);if(!s||!e||e<=s)return 0;
  const total=Math.round((e-s)/60000),step=5;let night=0;
  for(let m=0;m<total;m+=step){const chunk=Math.min(step,total-m),f=(m+chunk/2)/total,p=gcPoint(dep,arr,f),t=new Date(s.getTime()+(m+chunk/2)*60000);if(sunAltitude(t,p.lat,p.lon)<-6)night+=chunk}
  $('night').value=fmt(night);
  const depNight=sunAltitude(s,dep.lat,dep.lon)<-6, arrNight=sunAltitude(e,arr.lat,arr.lon)<-6;
  $('dayTakeoffs').value=depNight?0:1;$('nightTakeoffs').value=depNight?1:0;$('dayLandings').value=arrNight?0:1;$('nightLandings').value=arrNight?1:0;
  $('nightStatus').textContent=`Night auto estimate: ${fmt(night)} • take-off ${depNight?'night':'day'} • landing ${arrNight?'night':'day'} (civil twilight, great-circle estimate).`;
  return night
}

/* Credit rules */
const PAY_DEFAULTS={joinDate:'2014-04-01',base:46500,allowance:8000,transport:2500,pos:4000,telephone:500,uniform:300,meal:520,deduction:-3000,seniority2:10,seniority12:15,t1Max:25,t1Rate:170,t2Max:50,t2Rate:370,t3Max:75,t3Rate:665,t4Rate:1400,trainingRate:500,layoverRate:25,simAllowance:1000,simCredit:5,groundCredit:5,dayOffRate:1000};
function paySettings(){return {...PAY_DEFAULTS,...loadObject(PAY_SETTINGS_KEY,{})}}
function entryCreditMins(f){
  if(isFlight(f))return paidFlightCreditMins(f);
  if(isSim(f))return Math.round(Number(paySettings().simCredit||0)*60);
  if(isGround(f))return Math.round(Number(paySettings().groundCredit||0)*60);
  if(isDhd(f))return Number(f.credit)||0;
  return Number(f.credit)||0;
}
function formCredit(dutyType,schedBlock){
  if(dutyType==='Flight'){
    const temp={dutyType:'Flight',date:$('date')?.value||'',dep:upper($('dep')?.value||''),schedOut:$('schedOut')?.value||'',schedIn:$('schedIn')?.value||'',schedBlock};
    return paidFlightCreditMins(temp);
  }
  if(dutyType==='Simulator')return Math.round(Number(paySettings().simCredit||0)*60);
  if(dutyType==='Ground Course')return Math.round(Number(paySettings().groundCredit||0)*60);
  if(dutyType==='DHD')return durMins($('creditDisplay').value);
  return 0;
}
function setEntryTypeUI(){
  const dt=$('dutyTypeFlight').value, sim=dt==='Simulator', flight=dt==='Flight', dhd=dt==='DHD', ground=dt==='Ground Course';

  // Restore all normal entry fields first.
  document.querySelectorAll('[data-entry-field]').forEach(el=>el.classList.remove('hidden'));
  $('courseType')?.closest('[data-entry-field]')?.classList.add('hidden');
  ['breakdownTitle','breakdownGrid','remarksWrap','calcPreview','nightStatus'].forEach(id=>$(id)?.classList.remove('hidden'));

  if(dhd){
    // DHD is intentionally minimal: Date, From, To, start/end time and editable Credit Hours.
    const keep=new Set(['dep','arr','schedOut','schedIn','credit']);
    document.querySelectorAll('[data-entry-field]').forEach(el=>{
      if(!keep.has(el.dataset.entryField))el.classList.add('hidden');
    });
    ['breakdownTitle','breakdownGrid','remarksWrap','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    if($('schedOutLabel'))$('schedOutLabel').textContent='Start time (Z)';
    if($('schedInLabel'))$('schedInLabel').textContent='End time (Z)';
    ['out','off','on','in','onDuty','offDuty'].forEach(id=>$(id).value='');
    $('creditDisplay').readOnly=false;
    $('calcPreview').classList.remove('hidden');
    $('calcPreview').textContent=`DHD • ${$('dep').value||'—'} → ${$('arr').value||'—'} • ${$('schedOut').value||'--:--'}–${$('schedIn').value||'--:--'} • Credit ${$('creditDisplay').value||'0:00'}`;
    return;
  }


  if(ground){
    // Ground Course is intentionally minimal: Date, Location IATA, Course type and Credit Hours.
    const keep=new Set(['dep','courseType','credit']);
    document.querySelectorAll('[data-entry-field]').forEach(el=>{
      if(!keep.has(el.dataset.entryField))el.classList.add('hidden');
    });
    $('courseType')?.closest('[data-entry-field]')?.classList.remove('hidden');
    ['breakdownTitle','breakdownGrid','remarksWrap','nightStatus'].forEach(id=>$(id)?.classList.add('hidden'));
    $('depInfo').textContent=$('depInfo').textContent||'Enter the course location IATA code.';
    $('arr').value='';
    ['schedOut','schedIn','out','off','on','in','onDuty','offDuty'].forEach(id=>$(id).value='');
    $('creditDisplay').readOnly=false;
    if(!durMins($('creditDisplay').value))$('creditDisplay').value=fmt(Math.round(Number(paySettings().groundCredit||0)*60));
    $('calcPreview').classList.remove('hidden');
    $('calcPreview').textContent=`Ground Course • ${$('dep').value||'—'} • ${$('courseType').value||'Course'} • Credit ${$('creditDisplay').value||'0:00'}`;
    return;
  }

  if($('schedOutLabel'))$('schedOutLabel').textContent='Schedule OUT (Z)';
  if($('schedInLabel'))$('schedInLabel').textContent='Schedule IN (Z)';

  ['schedOut','schedIn','out','off','on','in'].forEach(id=>$(id).disabled=sim||ground||dt==='STBY');
  if(sim){$('schedOut').value='';$('schedIn').value='';$('out').value='';$('off').value='';$('on').value='';$('in').value=''}
  $('creditDisplay').readOnly=!dhd;
  if(!dhd)$('creditDisplay').value=fmt(formCredit(dt,diff(mins($('schedOut').value),mins($('schedIn').value))));
  if(!flight){$('dayTakeoffs').value=0;$('nightTakeoffs').value=0;$('dayLandings').value=0;$('nightLandings').value=0;if(!sim)$('night').value='00:00'}
}
function calcEntry(){
  const dutyType=$('dutyTypeFlight').value;
  if(dutyType==='DHD'){
    const schedBlock=diff(mins($('schedOut').value),mins($('schedIn').value));
    $('schedBlockDisplay').value=fmt(schedBlock);
    $('blockDisplay').value='0:00';
    $('totalTimeDisplay').value='0:00';
    $('picDisplay').value='0:00';
    $('sicDisplay').value='0:00';
    $('flightInstructionDisplay').value='0:00';
    $('simInstructionDisplay').value='0:00';
    $('calcPreview').textContent=`DHD • ${$('dep').value||'—'} → ${$('arr').value||'—'} • ${$('schedOut').value||'--:--'}–${$('schedIn').value||'--:--'} • Credit ${$('creditDisplay').value||'0:00'}`;
    return{schedBlock,block:0,flight:0,credit:durMins($('creditDisplay').value)};
  }
  const schedBlock=(dutyType==='Flight'||dutyType==='DHD')?diff(mins($('schedOut').value),mins($('schedIn').value)):0;
  const block=dutyType==='Flight'?diff(mins($('out').value),mins($('in').value)):0;
  const flight=dutyType==='Flight'?diff(mins($('off').value),mins($('on').value)):0;
  const cr=formCredit(dutyType,schedBlock);
  $('schedBlockDisplay').value=fmt(schedBlock);$('blockDisplay').value=fmt(block);if(dutyType!=='DHD')$('creditDisplay').value=fmt(cr);
  const role=$('role').value, inst=$('instructionType').value;
  const simActual=dutyType==='Simulator'?diff(mins($('onDuty').value),mins($('offDuty').value)):0;
  $('totalTimeDisplay').value=fmt(dutyType==='Simulator'?simActual:block);
  $('picDisplay').value=fmt(dutyType==='Flight'&&['PIC','Instructor','Examiner'].includes(role)?block:0);
  $('sicDisplay').value=fmt(dutyType==='Flight'&&role==='SIC'?block:0);
  $('flightInstructionDisplay').value=fmt(dutyType==='Flight'&&inst==='Flight Instruction'?block:0);
  $('simInstructionDisplay').value=fmt(dutyType==='Simulator'&&inst==='SFI/SFE Instruction Sim'?simActual:0);
  const premium=(dutyType==='Flight'&&qualifiesMoroccoNightCredit({dutyType:'Flight',date:$('date').value,dep:$('dep').value,schedOut:$('schedOut').value,schedIn:$('schedIn').value,schedBlock}))?' • Morocco Night +50%':'';
  $('calcPreview').textContent=dutyType==='Simulator'?`Simulator actual ${fmt(simActual)} • Credit ${fmt(cr)} (Settings)`:`Schedule Block ${fmt(schedBlock)} • Actual Block ${fmt(block)} • Flight ${fmt(flight)} • Credit ${fmt(cr)}${premium}`;
  return{schedBlock,block,flight,credit:cr}
}

/* Duty grouping */
function dtFromZulu(date,time){return zuluDate(date,time)}
function dutyDateEnd(date,start,end){const s=dtFromZulu(date,start),e=dtFromZulu(date,end);if(s&&e&&e<s)e.setUTCDate(e.getUTCDate()+1);return[s,e]}
function entryChrono(f){const t=f.onDuty||f.schedOut||f.out||'00:00';return `${f.date}T${t}`}
function dayEntries(date,fs=load(FLIGHTS_KEY)){return fs.filter(f=>f.date===date).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)))}
function externalDutyForDate(date){return load(DUTY_KEY).filter(d=>d.date===date).sort((a,b)=>(a.report||'').localeCompare(b.report||''))[0]||null}
function recalcDutyDay(date,fs){
  const arr=dayEntries(date,fs);if(!arr.length)return;
  const d=externalDutyForDate(date), flights=arr.filter(isFlight), sectors=flights.length;
  let report=d&&d.report?d.report:'', end=d&&d.end?d.end:'';
  if(!report){const first=arr[0];report=first.onDuty||shiftTime(first.schedOut||first.out,-60)}
  if(!end){const last=arr[arr.length-1];end=last.offDuty||shiftTime(last.schedIn||last.in,30)}
  if(arr.length===1&&isGround(arr[0])){report=arr[0].onDuty||report;end=arr[0].offDuty||end}
  const duty=report&&end?diff(mins(report),mins(end)):0;
  arr.forEach((f,i)=>{f.onDuty=i===0?report:'';f.offDuty=i===arr.length-1?end:'';f.totalDuty=i===arr.length-1?duty:0;f.sectors=sectors;f._updatedAt=new Date().toISOString()});
}
function reconcileAllDuties(){
  const fs=load(FLIGHTS_KEY), dates=[...new Set(fs.map(f=>f.date).filter(Boolean))];
  dates.forEach(d=>recalcDutyDay(d,fs));save(FLIGHTS_KEY,fs)
}
function dutySummary(date){
  const arr=dayEntries(date);if(!arr.length)return null;const first=arr[0],last=arr[arr.length-1];
  const report=first.onDuty||externalDutyForDate(date)?.report||'',end=last.offDuty||externalDutyForDate(date)?.end||'';
  return{date,entries:arr,report,end,minutes:report&&end?diff(mins(report),mins(end)):0,sectors:arr.filter(isFlight).length,dep:arr.find(x=>x.dep)?.dep||'',arr:[...arr].reverse().find(x=>x.arr)?.arr||''}
}
function mergedDutyMinutes(start=null,end=null){
  const dates=[...new Set(load(FLIGHTS_KEY).map(f=>f.date).filter(Boolean))];let total=0;
  for(const date of dates){const d=dutySummary(date);if(!d||!d.report||!d.end)continue;let [s,e]=dutyDateEnd(date,d.report,d.end);if(start&&end){const a=Math.max(s.getTime(),start.getTime()),b=Math.min(e.getTime(),end.getTime());if(b>a)total+=Math.round((b-a)/60000)}else total+=d.minutes}
  const standalone=load(DUTY_KEY).filter(d=>!dates.includes(d.date));standalone.forEach(d=>{if(d.minutes)total+=Number(d.minutes)||0});
  return total
}

/* EASA FTL — basic maximum daily FDP, acclimatised, no extension. */
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
async function dailyFtl(date){
  const d=dutySummary(date);if(!d||!d.report)return null;const firstFlight=d.entries.find(isFlight);if(!firstFlight)return{...d,limit:null,status:'N/A',margin:null};
  const a=await airport(firstFlight.dep), start=zuluDate(date,d.report), localM=tzParts(start,a?.tz||'UTC'), limit=fdpLimit(localM,d.sectors), margin=limit-d.minutes;
  return{...d,limit,margin,status:margin<0?'VIOLATION':margin<60?'CAUTION':'OK',localStart:localM,tz:a?.tz||'UTC'}
}
function startOfDays(n){const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-n+1);return d}
function rollingFlight(n){const c=startOfDays(n);return sum(load(FLIGHTS_KEY).filter(isFlight),f=>dateOnly(f.date)>=c?Number(f.block)||0:0)}
function rollingDuty(n){const c=startOfDays(n);const dates=[...new Set(load(FLIGHTS_KEY).map(f=>f.date).filter(Boolean))];return sum(dates,d=>dateOnly(d)>=c?(dutySummary(d)?.minutes||0):0)}
function calendarYearFlight(){const y=new Date().getUTCFullYear();return sum(load(FLIGHTS_KEY).filter(isFlight),f=>dateOnly(f.date).getUTCFullYear()===y?Number(f.block)||0:0)}
function rollingCalendar12Flight(){const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1));return sum(load(FLIGHTS_KEY).filter(isFlight),f=>dateOnly(f.date)>=start?Number(f.block)||0:0)}
function limitRow(name,value,limit){const pct=limit?value/limit:0,cls=pct>1?'danger-text':pct>.9?'warning':'';return `<div class="stat-row"><span>${esc(name)}</span><b class="${cls}">${fmt(value)} / ${fmt(limit)}</b></div>`}
async function renderFtl(containerId,compact=false){
  const d7=rollingDuty(7),d14=rollingDuty(14),d28=rollingDuty(28),f28=rollingFlight(28),fy=calendarYearFlight(),f12=rollingCalendar12Flight();
  const dates=[...new Set(load(FLIGHTS_KEY).map(f=>f.date).filter(Boolean))].sort().reverse().slice(0,10),daily=[];
  for(const d of dates){const x=await dailyFtl(d);if(x&&x.limit)daily.push(x)}
  const violations=daily.filter(x=>x.margin<0);
  const rows=limitRow('Duty — 7 consecutive days',d7,3600)+limitRow('Duty — 14 consecutive days',d14,6600)+limitRow('Duty — 28 consecutive days',d28,11400)+limitRow('Flight time — 28 consecutive days',f28,6000)+limitRow('Flight time — calendar year',fy,54000)+limitRow('Flight time — 12 calendar months',f12,60000);
  const dailyHtml=compact?'':daily.map(x=>`<div class="stat-row"><span>${esc(x.date)} • ${x.sectors} sector${x.sectors===1?'':'s'} • start ${fmt(x.localStart)} ${esc(x.tz)}</span><b class="${x.status==='VIOLATION'?'danger-text':x.status==='CAUTION'?'warning':'success'}">${fmt(x.minutes)} / ${fmt(x.limit)} • ${x.status}</b></div>`).join('');
  $(containerId).innerHTML=rows+(dailyHtml||'');
  return violations.length===0&&d7<=3600&&d14<=6600&&d28<=11400&&f28<=6000&&fy<=54000&&f12<=60000
}

/* Roster local display and grouping */
function parseUtcForRoster(date,time){return zuluDate(date,time)}
async function localTime(date,time,code){if(!time)return'';const a=await airport(code),d=parseUtcForRoster(date,time);if(!d)return time;try{return new Intl.DateTimeFormat('en-GB',{timeZone:a?.tz||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}catch{return time}}
function rosterGroups(){
  const rs=load(ROSTER_KEY).sort((a,b)=>`${a.date}${a.std||''}`.localeCompare(`${b.date}${b.std||''}`)), by={};
  rs.forEach(r=>(by[r.date]||(by[r.date]=[])).push(r));
  const ds=load(DUTY_KEY);
  return Object.entries(by).map(([date,items])=>{items.sort((a,b)=>(a.std||'').localeCompare(b.std||''));const duty=ds.find(d=>d.date===date&&/flight duty/i.test(d.type||''));const first=items[0],last=items[items.length-1];return{date,items,start:duty?.report||shiftTime(first.std,-60),end:duty?.end||shiftTime(last.sta,30),dep:first.dep||'',arr:last.arr||'',sectors:items.filter(x=>x.flightNo).length,status:items.every(x=>x.status==='done')?'done':'planned'}}).sort((a,b)=>a.date.localeCompare(b.date))
}
async function rosterGroupHtml(groups,interactive=false){
  if(!groups.length)return'<div class="empty">No upcoming roster.</div>';let html='';
  for(const g of groups){const start=await localTime(g.date,g.start,g.dep),end=await localTime(g.date,g.end,g.arr);html+=`<div class="rowitem"><div><b>${esc(g.date)} • ${g.sectors} flight${g.sectors===1?'':'s'}</b><div class="small">${esc(g.dep)} → ${esc(g.arr)}</div></div><div class="meta"><b>${esc(start)} – ${esc(end)}</b><br><span class="small">local time</span>${interactive?`<div class="list-actions">${g.items.map(r=>`<button class="secondary" data-roster-action="${r.id}">${esc(r.flightNo||'Open')}</button>`).join('')}</div>`:''}</div></div>`}
  return html
}

/* Trips */
function entryInterval(f){const t=f.onDuty||f.out||f.schedOut,u=f.offDuty||f.in||f.schedIn;if(!f.date||!t||!u)return null;return dutyDateEnd(f.date,t,u)}
function overlapMins(a,b,s,e){const x=Math.max(a.getTime(),s.getTime()),y=Math.min(b.getTime(),e.getTime());return Math.max(0,Math.round((y-x)/60000))}
function tripChargeableDuty(s,e){
  let total=0;
  const fs=load(FLIGHTS_KEY).filter(f=>f.date);
  const dates=[...new Set(fs.map(f=>f.date).filter(Boolean))];

  dates.forEach(date=>{
    const entries=dayEntries(date,fs);
    const groundEntries=entries.filter(isGround);
    if(groundEntries.length){
      // Ground Course is always charged as fixed 5:00 duty for layover purposes.
      for(const g of groundEntries){
        const marker=entryStart(g)||zuluDate(date,g.onDuty||'00:00');
        if(marker && marker>=s && marker<=e) total+=300;
      }
    }

    // DHD must never reduce paid layover.
    const dutyEntries=entries.filter(x=>!isDhd(x)&&!isGround(x)&&!isStby(x));
    if(!dutyEntries.length) return;

    // Build the chargeable operational duty only from non-DHD/non-ground entries.
    const first=dutyEntries[0], last=dutyEntries[dutyEntries.length-1];
    const startTime=first.onDuty||shiftTime(first.schedOut||first.out,-60);
    const endTime=last.offDuty||shiftTime(last.schedIn||last.in,30);
    if(!startTime||!endTime) return;

    const [a,b]=dutyDateEnd(date,startTime,endTime);
    total+=overlapMins(a,b,s,e);
  });

  return total;
}
function tripCalc(){
  const s=new Date($('tripStart').value),e=new Date($('tripEnd').value);if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||e<=s){$('tripLayover').value='0:00';$('tripAllowance').value='0.00';return null}
  const trip=Math.round((e-s)/60000),duty=tripChargeableDuty(s,e),lay=Math.max(0,trip-duty),allowance=(lay/60)*Number(paySettings().layoverRate||0);
  $('tripLayover').value=fmt(lay);$('tripAllowance').value=allowance.toFixed(2);return{trip,duty,layover:lay,allowance}
}
function resetTrip(){$('tripForm').reset();$('tripEditId').value='';$('tripLayover').value='0:00';$('tripAllowance').value='0.00'}
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
function entryEnd(f){if(!f.date)return null;const t=f.offDuty||f.schedIn||f.in||f.onDuty||'00:00';return endZuluDate(f.date,f.onDuty||f.schedOut||f.out||'00:00',t)}
function autoDetectTrips(showAlert=true){
  const base=upper(appSettings().homeBase||'CMN');
  const fs=load(FLIGHTS_KEY)
    .filter(f=>f.date)
    .sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));

  let ts=load(TRIPS_KEY),created=0,updated=0;

  for(let i=0;i<fs.length;i++){
    const f=fs[i];

    // Opening logic: a DHD or any activity leaving home base and ending away from base.
    if(upper(f.dep)!==base || !f.arr || upper(f.arr)===base) continue;

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
      includedEntryIds:includedIds
    });

    if(k>=0){ts[k]={...ts[k],...obj};updated++}
    else{ts.push(obj);created++}

    i=last;
  }

  save(TRIPS_KEY,ts);
  renderTrips();
  renderPayroll();
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
  if(/^OFF\b/.test(s))return{kind:'ignore'};return{kind:'unknown'}
}
function zuluTimes(desc){const d=String(desc||'');return{out:(d.match(/Scheduled (?:take-off\/)?departure\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',inn:(d.match(/Scheduled arrival\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',report:(d.match(/Reporting\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',end:(d.match(/(?:Release|End of duty)\s+(\d{1,2}:\d{2})Z/i)||[])[1]||''}}
function entrySig(f){return [f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.schedIn,f.onDuty,f.offDuty].map(x=>upper(x)).join('|')}
function dutySig(d){return [d.date,d.type,d.report,d.end,d.notes].map(x=>upper(x)).join('|')}
function importCalendar(events){
  let fs=load(FLIGHTS_KEY),rs=load(ROSTER_KEY),ds=load(DUTY_KEY),seenF=new Set(fs.map(entrySig)),seenR=new Set(rs.map(r=>[r.date,r.flightNo,r.dep,r.arr,r.std,r.sta].map(x=>upper(x)).join('|'))),seenD=new Set(ds.map(dutySig));let sectors=0,duties=0,other=0,skipped=0;
  events.forEach(ev=>{const c=classify(ev.SUMMARY),z=zuluTimes(ev.DESCRIPTION),date=ev._start.date;if(['ignore','unknown'].includes(c.kind)){skipped++;return}
    if(c.kind==='flight'){const std=z.out||ev._start.time||'',sta=z.inn||(ev._end?.time||''),r={id:makeId(),date,flightNo:composeFlightNo(c.flightNo),dep:c.dep,arr:c.arr,std,sta,status:'planned',source:'calendar'};const sr=[r.date,r.flightNo,r.dep,r.arr,r.std,r.sta].map(x=>upper(x)).join('|');if(!seenR.has(sr)){rs.push(r);seenR.add(sr)}
      const f=stamp({id:makeId(),dutyType:'Flight',date,flightNo:composeFlightNo(c.flightNo),dep:c.dep,arr:c.arr,type:'',reg:'',schedOut:std,schedIn:sta,schedBlock:diff(mins(std),mins(sta)),onDuty:'',offDuty:'',out:'',off:'',on:'',in:'',block:0,flight:0,credit:paidFlightCreditMins({dutyType:'Flight',date,dep:c.dep,schedOut:std,schedIn:sta,schedBlock:diff(mins(std),mins(sta))}),role:'PIC',instructionType:'',night:'00:00',sim:'no',ifr:'yes',dayTakeoffs:1,nightTakeoffs:0,dayLandings:1,nightLandings:0,remarks:'Imported from calendar',source:'calendar'});const sf=entrySig(f);if(!seenF.has(sf)){fs.push(f);seenF.add(sf);sectors++}else skipped++;return}
    if(c.kind==='duty'){const rep=z.report||ev._start.time||'',end=z.end||(ev._end?.time||''),d=stamp({id:makeId(),date,type:c.dutyType,report:rep,end,minutes:diff(mins(rep),mins(end)),notes:ev.SUMMARY||'',source:'calendar'}),sd=dutySig(d);if(!seenD.has(sd)){ds.push(d);seenD.add(sd);duties++}else skipped++;return}
    if(c.kind==='entry'){const start=ev._start.time||'',end=ev._end?.time||'',sim=c.dutyType==='Simulator',ground=c.dutyType==='Ground Course',f=stamp({id:makeId(),dutyType:c.dutyType,date,flightNo:'',dep:c.dep||'',arr:c.arr||'',type:c.aircraftType||'',reg:'',schedOut:'',schedIn:'',schedBlock:0,onDuty:start,offDuty:end,out:'',off:'',on:'',in:'',block:0,flight:0,simulatorTime:sim?diff(mins(start),mins(end)):0,credit:sim?Math.round(paySettings().simCredit*60):ground?Math.round(paySettings().groundCredit*60):0,role:'PIC',instructionType:sim?'SFI/SFE Instruction Sim':'',night:'00:00',sim:sim?'yes':'no',ifr:'no',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,courseType:ground?upper(ev.SUMMARY||''):'',remarks:`Imported from calendar: ${ev.SUMMARY||''}`,source:'calendar'});const sf=entrySig(f);if(!seenF.has(sf)){fs.push(f);seenF.add(sf);other++}else skipped++}
  });save(FLIGHTS_KEY,fs);save(ROSTER_KEY,rs);save(DUTY_KEY,ds);reconcileAllDuties();return{sectors,duties,other,skipped}
}
function parseCsv(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&q&&n==='"'){cell+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());cell='';if(row.some(x=>x!==''))rows.push(row);row=[]}else cell+=c}row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);return rows}
function parseTab(text){return String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim()!=='').map(line=>line.split('\t'))}
function normalDate(v){v=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`}return v}
function logTenImport(text){
  const rows=parseTab(text);if(rows.length<2)throw new Error('No LogTen rows found.');const headers=rows[0].map(x=>String(x||'').trim()),ix={};headers.forEach((h,i)=>ix[h]=i);if(!('flight_flightDate'in ix))throw new Error('This does not look like a LogTen Export Flights (Tab) file.');const g=(r,k)=>ix[k]===undefined?'':String(r[ix[k]]||'').trim();
  let fs=load(FLIGHTS_KEY),imported=0,updated=0,sims=0,other=0;rows.slice(1).forEach(r=>{const date=normalDate(g(r,'flight_flightDate'));if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    const category=upper(g(r,'aircraftType_selectedCategory')),remarks=g(r,'flight_remarks'),flightNoRaw=g(r,'flight_flightNumber'),simDur=durMins(g(r,'flight_simulator')),groundDur=durMins(g(r,'flight_ground')),deadheadText=[g(r,'flight_deadhead'),g(r,'flight_deadHead'),remarks,flightNoRaw].join(' ').toUpperCase(),stby=/STBY|STANDBY|HSBY/.test(deadheadText),dhd=/\bDHD\b|\bDHP\b|DEADHEAD/.test(deadheadText),isSimulator=category==='SIMULATOR'||simDur>0||g(r,'flight_type')==='3',isGround=!isSimulator&&groundDur>0,dutyType=isSimulator?'Simulator':isGround?'Ground Course':stby?'STBY':dhd?'DHD':'Flight';
    const out=g(r,'flight_actualDepartureTime'),inn=g(r,'flight_actualArrivalTime'),off=g(r,'flight_takeoffTime'),on=g(r,'flight_landingTime'),schedOut=isSimulator?'':g(r,'flight_scheduledDepartureTime'),schedIn=isSimulator?'':g(r,'flight_scheduledArrivalTime'),schedBlock=diff(mins(schedOut),mins(schedIn)),total=durMins(g(r,'flight_totalTime')),block=dutyType==='Flight'?(total||diff(mins(out),mins(inn))):0,dual=durMins(g(r,'flight_dualGiven')),dayLd=Number(g(r,'flight_dayLandings')||0),nightLd=Number(g(r,'flight_nightLandings')||0),dayTo=Number(g(r,'flight_dayTakeoffs')||0),nightTo=Number(g(r,'flight_nightTakeoffs')||0),onDuty=g(r,'flight_onDutyTime'),offDuty=g(r,'flight_offDutyTime');
    const f=stamp({dutyType,date,flightNo:dutyType==='Flight'||dutyType==='DHD'?composeFlightNo(flightNoRaw):'',dep:upper(g(r,'flight_from')),arr:upper(g(r,'flight_to')),reg:upper(g(r,'aircraft_aircraftID')),type:upper(g(r,'aircraftType_type')),schedOut,schedIn,schedBlock,onDuty,offDuty,out:dutyType==='Flight'?out:'',off:dutyType==='Flight'?off:'',on:dutyType==='Flight'?on:'',in:dutyType==='Flight'?inn:'',block,flight:off&&on?diff(mins(off),mins(on)):0,simulatorTime:isSimulator?simDur:0,credit:dutyType==='DHD'?durMins(g(r,'flight_credit')):dutyType==='Flight'?paidFlightCreditMins({dutyType:'Flight',date,dep:upper(g(r,'flight_from')),schedOut,schedIn,schedBlock}):dutyType==='Simulator'?Math.round(paySettings().simCredit*60):dutyType==='Ground Course'?Math.round(paySettings().groundCredit*60):0,role:durMins(g(r,'flight_sic'))>0?'SIC':'PIC',instructionType:isSimulator&&dual>0?'SFI/SFE Instruction Sim':dutyType==='Flight'&&dual>0?'Flight Instruction':'',night:g(r,'flight_night')||'00:00',sim:isSimulator?'yes':'no',ifr:g(r,'flight_ifr')?'yes':'no',dayTakeoffs:dayTo,nightTakeoffs:nightTo,dayLandings:dayLd,nightLandings:nightLd,courseType:isGround?upper(remarks):'',remarks,source:'logten'});
    let match=dutyType==='Flight'?fs.findIndex(x=>x.date===date&&upper(x.flightNo)===upper(f.flightNo)&&upper(x.dep)===f.dep&&upper(x.arr)===f.arr):fs.findIndex(x=>x.date===date&&x.dutyType===dutyType&&upper(x.dep)===f.dep&&upper(x.arr)===f.arr);
    if(match>=0){f.id=fs[match].id;fs[match]={...fs[match],...f};updated++}else{f.id=makeId();fs.push(f);imported++}if(isSimulator)sims++;if(!['Flight','Simulator'].includes(dutyType))other++;
  });save(FLIGHTS_KEY,fs);reconcileAllDuties();return{imported,updated,sims,other}
}

/* Export */
function download(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function logTenExport(){const fs=load(FLIGHTS_KEY);if(!fs.length)return alert('No entries to export');const h=['flight_flightDate','flight_type','flight_flightNumber','flight_from','flight_to','flight_scheduledDepartureTime','flight_actualDepartureTime','flight_takeoffTime','flight_landingTime','flight_scheduledArrivalTime','flight_actualArrivalTime','flight_totalTime','flight_pic','flight_sic','flight_dualGiven','flight_simulator','flight_ground','flight_night','flight_dayTakeoffs','flight_nightTakeoffs','flight_dayLandings','flight_nightLandings','flight_onDutyTime','flight_offDutyTime','flight_remarks','aircraft_aircraftID','aircraftType_type'];const rows=fs.map(f=>{const total=isFlight(f)?fmt(f.block):'',sim=isSim(f)?fmt(f.simulatorTime||0):'',ground=isGround(f)?fmt(300):'',dual=f.instructionType?fmt(isSim(f)?f.simulatorTime:f.block):'';return[f.date,'',f.flightNo||'',f.dep||'',f.arr||'',f.schedOut||'',f.out||'',f.off||'',f.on||'',f.schedIn||'',f.in||'',total,picMins(f)?total:'',sicMins(f)?total:'',dual,sim,ground,f.night||'00:00',f.dayTakeoffs||0,f.nightTakeoffs||0,f.dayLandings||0,f.nightLandings||0,f.onDuty||'',f.offDuty||'',f.remarks||'',f.reg||'',f.type||'']});download(`PilotLog_LogTen_${today()}.txt`,[h.join('\t'),...rows.map(r=>r.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t'))].join('\n'),'text/tab-separated-values')}

/* Payroll */
function monthNow(){return new Date().toISOString().slice(0,7)}
function inMonth(date,month){return String(date||'').slice(0,7)===month}
function money(v){return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}
function trainingSector(f){return isFlight(f)&&f.instructionType==='Flight Instruction'}
function payrollCreditMins(f){return entryCreditMins(f)}
function tierPay(hours,st){hours=Math.max(0,Number(hours)||0);const a=Number(st.t1Max)||0,b=Math.max(a,Number(st.t2Max)||a),c=Math.max(b,Number(st.t3Max)||b);let left=hours,total=0,h=Math.min(left,a);total+=h*Number(st.t1Rate||0);left-=h;h=Math.min(Math.max(0,left),b-a);total+=h*Number(st.t2Rate||0);left-=h;h=Math.min(Math.max(0,left),c-b);total+=h*Number(st.t3Rate||0);left-=h;if(left>0)total+=left*Number(st.t4Rate||0);return total}
function seniorityPct(st,month){if(!st.joinDate)return 0;const start=new Date(`${st.joinDate}T00:00:00Z`),[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0,23,59,59));const years=(end-start)/(365.2425*86400000);return years>12?Number(st.seniority12||0):years>2?Number(st.seniority2||0):0}
function monthExtras(month){const all=loadObject(PAY_MONTH_KEY,{});return {...(all[month]||{dayOffCount:0,arrears:0})}}
function saveMonthExtras(month,x){const all=loadObject(PAY_MONTH_KEY,{});all[month]=x;all._updatedAt=new Date().toISOString();localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(all))}
function payrollData(month){const st=paySettings(),fs=load(FLIGHTS_KEY).filter(f=>inMonth(f.date,month)),trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month),extras=monthExtras(month),creditMins=sum(fs,payrollCreditMins),training=fs.filter(trainingSector).length,sims=fs.filter(isSim).length,layMins=sum(trips,t=>t.layover),layHours=layMins/60,seniorPct=seniorityPct(st,month),seniority=Number(st.base||0)*seniorPct/100,fixed=Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0),flightPay=tierPay(creditMins/60,st),trainingPay=training*Number(st.trainingRate||0),layoverPay=layHours*Number(st.layoverRate||0),simPay=sims*Number(st.simAllowance||0),dayOffPay=Number(extras.dayOffCount||0)*Number(st.dayOffRate||0),arrears=Number(extras.arrears||0),total=fixed+flightPay+trainingPay+layoverPay+simPay+dayOffPay+arrears;return{st,extras,creditMins,training,sims,layMins,layHours,seniorPct,seniority,fixed,flightPay,trainingPay,layoverPay,simPay,dayOffPay,arrears,total}}
function fxStore(){return loadObject(FX_KEY,{})}
function dateKey(d){return d.toISOString().slice(0,10)}
async function fetchFxForDate(dateStr){for(let back=0;back<8;back++){const d=new Date(`${dateStr}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-back);const key=dateKey(d);try{const r=await fetch(`https://${key}.currency-api.pages.dev/v1/currencies/eur.json`,{cache:'no-store'});if(!r.ok)continue;const j=await r.json(),rate=Number(j?.eur?.mad);if(rate>0)return{rate,date:j.date||key}}catch{}}throw new Error('FX unavailable')}
async function fetchLatestFx(){const r=await fetch('https://latest.currency-api.pages.dev/v1/currencies/eur.json',{cache:'no-store'});if(!r.ok)throw new Error('FX unavailable');const j=await r.json(),rate=Number(j?.eur?.mad);if(!(rate>0))throw new Error('MAD rate unavailable');return{rate,date:j.date||today()}}
async function getMonthFx(month){const store=fxStore();if(store[month]?.locked)return store[month];const [y,m]=month.split('-').map(Number),target=`${y}-${String(m).padStart(2,'0')}-30`,now=new Date(),targetDate=new Date(`${target}T23:59:59Z`),monthStart=new Date(Date.UTC(y,m-1,1)),nextMonth=new Date(Date.UTC(y,m,1));if(monthStart>now)return{rate:null,locked:false};if(now>=targetDate||now>=nextMonth){const got=await fetchFxForDate(target),locked={...got,locked:true};store[month]=locked;localStorage.setItem(FX_KEY,JSON.stringify(store));return locked}return{...(await fetchLatestFx()),locked:false}}
const PAY_MAP={setJoinDate:'joinDate',setBase:'base',setAllowance:'allowance',setTransport:'transport',setPos:'pos',setTelephone:'telephone',setUniform:'uniform',setMeal:'meal',setDeduction:'deduction',setSeniority2:'seniority2',setSeniority12:'seniority12',setT1Max:'t1Max',setT1Rate:'t1Rate',setT2Max:'t2Max',setT2Rate:'t2Rate',setT3Max:'t3Max',setT3Rate:'t3Rate',setT4Rate:'t4Rate',setTrainingRate:'trainingRate',setLayoverRate:'layoverRate',setSimAllowance:'simAllowance',setSimCredit:'simCredit',setGroundCredit:'groundCredit',setDayOffRate:'dayOffRate'};
function fillPaySettings(){const st=paySettings();Object.entries(PAY_MAP).forEach(([id,k])=>{if($(id))$(id).value=st[k]})}
function readPaySettings(){const st={};Object.entries(PAY_MAP).forEach(([id,k])=>st[k]=k==='joinDate'?$(id).value:Number($(id).value||0));return st}
let payrollRenderToken=0;
async function renderPayroll(){const token=++payrollRenderToken,month=$('payrollMonth').value||monthNow();$('payrollMonth').value=month;const ex=monthExtras(month);$('payDayOffCount').value=ex.dayOffCount||0;$('payArrears').value=ex.arrears||0;const p=payrollData(month);$('payCredits').textContent=fmt(p.creditMins);$('payLayover').textContent=fmt(p.layMins);$('payTrainingSectors').textContent=p.training;$('paySimCount').textContent=p.sims;$('payTotalDhm').textContent=`${money(p.total)} DHM`;$('payTotalEur').textContent='…';$('payBreakdown').innerHTML=[['Fixed salary',p.fixed],['Seniority ('+money(p.seniorPct)+'%)',p.seniority],['Credit hours pay',p.flightPay],['Training sectors ('+p.training+')',p.trainingPay],['Layover ('+p.layHours.toFixed(2)+' h)',p.layoverPay],['Simulator allowance ('+p.sims+')',p.simPay],['Day OFF premium ('+(p.extras.dayOffCount||0)+')',p.dayOffPay],['Arrears / adjustments',p.arrears]].map(([n,v])=>`<div class="stat-row"><span>${esc(n)}</span><b class="money">${money(v)} DHM</b></div>`).join('');$('payFxStatus').textContent='Loading EUR/MAD…';try{const fx=await getMonthFx(month);if(token!==payrollRenderToken)return;if(!fx.rate){$('payTotalEur').textContent='—';$('payFxStatus').textContent='FX not available for a future month.';return}$('payTotalEur').textContent=`≈ €${money(p.total/fx.rate)}`;$('payFxStatus').innerHTML=`EUR/MAD ${money(fx.rate)} • ${esc(fx.date)} ${fx.locked?'<span class="fx-lock">LOCKED</span>':'<span class="fx-live">LIVE</span>'}`}catch{$('payTotalEur').textContent='—';$('payFxStatus').textContent='FX unavailable. Payroll in DHM is unaffected.'}}

/* Cloud */
const SUPABASE_URL='https://ytlfygmojojipdjeppic.supabase.co',SUPABASE_PUBLISHABLE_KEY='sb_publishable_a3P-hh1BBqsQ0zRiY1uquA_YgiFcIg0',SUPABASE_TABLE='pilotlog_entries';
const SYNC_KINDS=[[FLIGHTS_KEY,'flights'],[ROSTER_KEY,'roster'],[DUTY_KEY,'duties'],[TRIPS_KEY,'trips']],SYNC_SINGLETONS=[[PAY_SETTINGS_KEY,'paySettings'],[PAY_MONTH_KEY,'payMonth'],[FX_KEY,'fx'],[APP_SETTINGS_KEY,'appSettings']];
let supabaseClient=null;
async function getSupabase(){if(supabaseClient)return supabaseClient;const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');supabaseClient=mod.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'pilotlog-supabase-auth'}});supabaseClient.auth.onAuthStateChange(()=>updateCloudStatus().catch(()=>{}));return supabaseClient}
function recordKey(kind,id){return `${kind}:${id}`}
function collectCloudRecords(){const now=new Date().toISOString(),rows=[];SYNC_KINDS.forEach(([key,kind])=>{const arr=load(key);arr.forEach(o=>{if(!o.id)o.id=makeId();if(!o._updatedAt)o._updatedAt=now;rows.push({id:recordKey(kind,o.id),data:{kind,itemId:o.id,payload:o,_updatedAt:o._updatedAt}})});save(key,arr)});SYNC_SINGLETONS.forEach(([key,kind])=>{const raw=localStorage.getItem(key);if(!raw)return;const o=loadObject(key,{});if(!o._updatedAt){o._updatedAt=now;localStorage.setItem(key,JSON.stringify(o))}rows.push({id:recordKey(kind,'singleton'),data:{kind,itemId:'singleton',payload:o,_updatedAt:o._updatedAt}})});return rows}
function applyCloudRows(rows){const by={};rows.forEach(r=>{const d=r.data||{};if(d.kind&&d.payload)(by[d.kind]||(by[d.kind]=[])).push(d)});SYNC_KINDS.forEach(([key,kind])=>{const map=new Map(load(key).map(o=>[o.id,o]));for(const d of by[kind]||[]){const cur=map.get(d.itemId);if(!cur||String(d._updatedAt||'')>String(cur._updatedAt||''))map.set(d.itemId,d.payload)}save(key,[...map.values()])});SYNC_SINGLETONS.forEach(([key,kind])=>{const d=(by[kind]||[]).sort((a,b)=>String(b._updatedAt||'').localeCompare(String(a._updatedAt||'')))[0];if(d){const cur=loadObject(key,{});if(!cur._updatedAt||String(d._updatedAt||'')>String(cur._updatedAt||''))localStorage.setItem(key,JSON.stringify(d.payload))}})}
async function cloudSession(){const sb=await getSupabase();const {data:{session}}=await sb.auth.getSession();return session}
async function updateCloudStatus(){const el=$('cloudStatus');try{const s=await cloudSession(),last=localStorage.getItem('pilotlog_last_cloud_sync');if(!s){el.textContent='Not signed in';el.dataset.state='';return}localStorage.setItem(LAST_EMAIL_KEY,s.user.email||$('cloudEmail').value||'');$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';el.textContent=`Signed in as ${s.user.email}${last?' • Last sync '+new Date(last).toLocaleString():''}`;el.dataset.state='ok'}catch(e){el.textContent='Cloud unavailable: '+e.message;el.dataset.state='error'}}
async function cloudSignUp(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6)return alert('Enter an email and a password of at least 6 characters.');localStorage.setItem(LAST_EMAIL_KEY,email);const sb=await getSupabase(),{data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:'https://baronsfly.github.io/Prova-/'}});if(error)throw error;alert(data.session?'Account created and signed in.':'Account created. Check your email to confirm it, then sign in.');await updateCloudStatus()}
async function cloudSignIn(){const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return alert('Enter email and password.');localStorage.setItem(LAST_EMAIL_KEY,email);const sb=await getSupabase(),{error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;$('cloudPassword').value='';await updateCloudStatus();alert('Signed in.')}
async function cloudSignOut(){const email=$('cloudEmail').value.trim()||localStorage.getItem(LAST_EMAIL_KEY)||'';if(email)localStorage.setItem(LAST_EMAIL_KEY,email);const sb=await getSupabase();await sb.auth.signOut();$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';$('cloudPassword').value='';await updateCloudStatus()}
async function syncSupabase(){const btn=$('syncCloudBtn');btn.disabled=true;$('cloudStatus').textContent='Syncing…';try{const sb=await getSupabase(),session=await cloudSession();if(!session)throw new Error('Sign in first.');const {data:cloud,error}=await sb.from(SUPABASE_TABLE).select('id,data,updated_at');if(error)throw error;applyCloudRows(cloud||[]);reconcileAllDuties();const merged=collectCloudRecords().map(r=>({...r,user_id:session.user.id,updated_at:r.data._updatedAt||new Date().toISOString()}));if(merged.length){const {error:e}=await sb.from(SUPABASE_TABLE).upsert(merged,{onConflict:'id'});if(e)throw e}localStorage.setItem('pilotlog_last_cloud_sync',new Date().toISOString());await render();renderTrips();renderPayroll();renderSettings();await updateCloudStatus();alert(`Cloud sync complete. ${merged.length} records synced.`)}catch(e){$('cloudStatus').textContent='Sync failed: '+e.message;$('cloudStatus').dataset.state='error';alert('Cloud Sync failed: '+e.message)}finally{btn.disabled=false}}

/* UI render */
function show(id){document.querySelectorAll('main>section').forEach(s=>s.classList.toggle('hidden',s.id!==id));document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='totalsView')renderTotals();if(id==='tripsView')renderTrips();if(id==='payrollView')renderPayroll();if(id==='settingsView')renderSettings();if(id==='rosterView')renderRoster();scrollTo(0,0)}
function flightHtml(fs,full=false){if(!fs.length)return'<div class="empty">No entries yet.</div>';return fs.map(f=>{const d=f.totalDuty?`<div class="small">Duty ${fmt(f.totalDuty)} • ${f.sectors||0} sectors</div>`:'';return`<div class="flight"><div><div class="route">${esc(f.dep||f.dutyType||'Entry')}${f.arr?` → ${esc(f.arr)}`:''}</div><div class="small">${esc(f.date)} ${esc(f.flightNo||'')}</div><span class="pill">${esc(f.dutyType||'Flight')}</span>${f.type?`<span class="pill">${esc(f.type)}</span>`:''}${f.instructionType?`<span class="pill green">${esc(f.instructionType)}</span>`:''}${f.locked?'<span class="pill green">🔒 Locked</span>':''}${d}</div><div class="meta"><b>${fmt(isFlight(f)?f.block:isSim(f)?(Number(f.simulatorTime)||0):isGround(f)?300:isDhd(f)?scheduleBlockMins(f):0)}</b><br><span class="small">Credit ${fmt(entryCreditMins(f))}</span>${full?`<div class="list-actions"><button class="secondary" data-edit-flight="${f.id}">${f.locked?'View':'Edit'}</button>${f.locked?'':`<button class="danger" data-delete-flight="${f.id}">Delete</button>`}</div>`:''}</div></div>`}).join('')}
async function render(){
  reconcileAllDuties();const fs=load(FLIGHTS_KEY).sort((a,b)=>`${b.date}${b.onDuty||b.schedOut||''}`.localeCompare(`${a.date}${a.onDuty||a.schedOut||''}`));
  $('mPic').textContent=fmt(sum(fs,picMins));$('mTri').textContent=fmt(sum(fs,flightInstrMins));$('mDuty').textContent=fmt(mergedDutyMinutes());$('recentFlights').innerHTML=flightHtml(fs.slice(0,6));$('allFlights').innerHTML=flightHtml(fs,true);
  const ok=await renderFtl('dashboardFtl',true);$('mFtl').textContent=ok?'OK':'CHECK';$('mFtl').className=ok?'success':'danger-text';
  await renderRoster()
}
async function renderRoster(){const groups=rosterGroups(),now=today(),up=groups.filter(g=>g.date>=now).slice(0,6);$('upcomingRoster').innerHTML=await rosterGroupHtml(up,false);$('rosterList').innerHTML=await rosterGroupHtml(groups,true)}
function renderDuty(){const ds=load(DUTY_KEY).sort((a,b)=>String(b.date).localeCompare(String(a.date)));$('dutyList').innerHTML=ds.length?ds.map(d=>`<div class="rowitem"><div><b>${esc(d.type)}</b><div class="small">${esc(d.date)} • ${esc(d.notes||'')}</div></div><div class="meta"><b>${fmt(d.minutes)}</b><br>${esc(d.report||'')}–${esc(d.end||'')}<div class="list-actions"><button class="danger" data-delete-duty="${d.id}">Delete</button></div></div></div>`).join(''):'<div class="empty">No duties yet.</div>'}
async function renderTotals(){const fs=load(FLIGHTS_KEY),flying=fs.filter(isFlight);$('tDuty').textContent=fmt(mergedDutyMinutes());$('tPic').textContent=fmt(sum(fs,picMins));$('tInstruction').textContent=fmt(sum(fs,flightInstrMins));$('tSimInstruction').textContent=fmt(sum(fs,simInstrMins));$('tNight').textContent=fmt(sum(fs,f=>durMins(f.night)));$('tSim').textContent=fmt(sum(fs,f=>isSim(f)?Number(f.simulatorTime)||0:0));$('tSimTrainer').textContent=fmt(sum(fs,simTrainerMins));$('tSimTrainee').textContent=fmt(sum(fs,simTraineeMins));await renderFtl('ftlTotals',false);
  const now=new Date(),y=now.getUTCFullYear(),m=now.getUTCMonth(),month=sum(flying,f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d.getUTCMonth()===m?f.block:0}),year=calendarYearFlight();$('periodTotals').innerHTML=[['This Month — Flight',month],['This Year — Flight',year],['Last 28 days — Flight',rollingFlight(28)],['Last 90 days — Flight',rollingFlight(90)],['Last 365 days — Flight',rollingFlight(365)]].map(([n,v])=>`<div class="stat-row"><span>${n}</span><b>${fmt(v)}</b></div>`).join('');
  const ac={};fs.forEach(f=>{const t=upper(f.type||'Unspecified');if(!ac[t])ac[t]={f:0,s:0};if(isSim(f))ac[t].s+=Number(f.simulatorTime)||0;else if(isFlight(f))ac[t].f+=Number(f.block)||0});$('aircraftBreakdown').innerHTML=Object.entries(ac).map(([t,v])=>`<div class="stat-row"><span><b>${esc(t)}</b><div class="small">Flying ${fmt(v.f)} • Simulator ${fmt(v.s)}</div></span><b>${fmt(v.f+v.s)}</b></div>`).join('')||'<div class="empty">No aircraft data.</div>';
  const by={};[...new Set(fs.map(f=>f.date))].forEach(d=>{const x=dutySummary(d);if(!x)return;const type=x.entries.some(isSim)?'Simulator':x.entries.some(isGround)?'Ground Course':x.entries.some(isStby)?'Standby':'Flight Duty';by[type]=(by[type]||0)+x.minutes});$('dutyBreakdown').innerHTML=Object.entries(by).map(([n,v])=>`<div class="stat-row"><span>${esc(n)}</span><b>${fmt(v)}</b></div>`).join('')||'<div class="empty">No duty data.</div>'
}

function tripIncludedEntries(t){
  const fs=load(FLIGHTS_KEY);
  if(Array.isArray(t.includedEntryIds)&&t.includedEntryIds.length){
    const set=new Set(t.includedEntryIds);
    return fs.filter(f=>set.has(f.id)).sort((a,b)=>(tripSequenceStart(a)?.getTime()||0)-(tripSequenceStart(b)?.getTime()||0));
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
    const charge=isDhd(f)?'Excluded from duty':isGround(f)?'5:00 fixed duty':isStby(f)?'Not deducted':'Included in duty';
    return `<div class="rowitem">
      <div>
        <b>${esc(f.date)} • ${esc(f.dutyType||'Flight')} ${esc(f.flightNo||'')}</b>
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
    `<div class="stat-row"><span>Trip start</span><b>${esc(s.toISOString().replace('T',' ').slice(0,16))} Z</b></div>
     <div class="stat-row"><span>Trip end</span><b>${esc(e.toISOString().replace('T',' ').slice(0,16))} Z</b></div>
     <div class="stat-row"><span>Total trip time</span><b>${fmt(t.trip)}</b></div>
     <div class="stat-row"><span>Duty subtracted</span><b>${fmt(t.duty)}</b></div>
     <div class="stat-row"><span>Paid layover</span><b>${fmt(t.layover)}</b></div>
     <div class="section-title inner">Included entries</div>
     ${rows||'<div class="empty">No entries found for this trip.</div>'}`;
  wrap.classList.remove('hidden');
  wrap.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderTrips(){const ts=load(TRIPS_KEY).sort((a,b)=>String(b.start).localeCompare(String(a.start)));$('tripList').innerHTML=ts.length?ts.map(t=>`<div class="rowitem"><div><b>${esc(t.base||'Trip')} ${t.stations?'• '+esc(t.stations):''}</b><div class="small">${esc(String(t.start).replace('T',' '))} → ${esc(String(t.end).replace('T',' '))}</div></div><div class="meta"><b>${fmt(t.layover)}</b><br><span class="small">${money(t.allowance??(t.layover/60*paySettings().layoverRate))} DHM allowance</span><div class="list-actions"><button class="secondary" data-view-trip="${t.id}">View duties</button><button class="danger" data-delete-trip="${t.id}">Delete</button></div></div></div>`).join(''):'<div class="empty">No trips yet.</div>'}
function renderSettings(){const st=appSettings();$('setHomeBase').value=st.homeBase||'CMN';$('setFlightPrefix').value=st.flightPrefix||'MAC';$('setAircraftPrefix').value=st.aircraftPrefix||'CN-NM';$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||$('cloudEmail').value||'';updatePrefixUI();fillPaySettings();updateCloudStatus();ensureAirportDb(false)}
function setEntryLockedUI(locked){$('flightForm').querySelectorAll('input:not(#editId),select,textarea').forEach(el=>{if(['blockDisplay','schedBlockDisplay','totalTimeDisplay','picDisplay','sicDisplay','flightInstructionDisplay','simInstructionDisplay','sectorDisplay','totalDutyDisplay','night'].includes(el.id))return;el.disabled=!!locked});$('creditDisplay').disabled=!!locked;$('saveEntryBtn').disabled=!!locked;$('lockEntryBtn').textContent=locked?'Unlock entry':'Save & Lock';$('entryLockStatus').textContent=locked?'LOCKED • All entry data are protected from editing.':'Unlocked. Lock the entry when all data are final.';$('entryLockStatus').classList.toggle('success',!!locked)}
function resetEntry(){const f=$('flightForm');f.reset();$('editId').value='';updatePrefixUI();$('date').value=today();$('dutyTypeFlight').value='Flight';$('role').value='PIC';$('night').value='00:00';$('ifr').value='yes';['dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>$(id).value=0);$('entryTitle').textContent='Add log entry';$('saveEntryBtn').textContent='Save entry';setEntryLockedUI(false);setEntryTypeUI();calcEntry();$('sectorDisplay').value='';$('totalDutyDisplay').value='';updateAirportInfo()}
function loadEntryToForm(f){resetEntry();$('editId').value=f.id;const map={dutyTypeFlight:'dutyType'};['dutyTypeFlight','date','type','dep','arr','schedOut','schedIn','onDuty','offDuty','out','off','on','in','role','instructionType','night','ifr','remarks','courseType','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings'].forEach(id=>{$(id).value=f[map[id]||id]??''});$('flightNo').value=flightNoInput(f.flightNo||'');$('reg').value=aircraftIdInput(f.reg||'');$('creditDisplay').value=fmt(entryCreditMins(f));$('sectorDisplay').value=String(f.sectors||'');$('totalDutyDisplay').value=f.totalDuty?fmt(f.totalDuty):'';setEntryTypeUI();if(isDhd(f))$('creditDisplay').value=fmt(Number(f.credit)||0);calcEntry();$('entryTitle').textContent=f.locked?'View locked entry':'Edit log entry';$('saveEntryBtn').textContent='Update entry';setEntryLockedUI(!!f.locked);updateAirportInfo()}

function collectEntry(lockedOverride=null){const c=calcEntry(),dutyType=$('dutyTypeFlight').value,id=$('editId').value||makeId(),existing=load(FLIGHTS_KEY).find(x=>x.id===id),simTime=dutyType==='Simulator'?diff(mins($('onDuty').value),mins($('offDuty').value)):0;return stamp({id,dutyType,date:$('date').value,flightNo:(dutyType==='Flight'||dutyType==='DHD')?composeFlightNo($('flightNo').value):'',reg:composeAircraftId($('reg').value),type:upper($('type').value),dep:upper($('dep').value),arr:upper($('arr').value),schedOut:$('schedOut').value,schedIn:$('schedIn').value,schedBlock:c.schedBlock,onDuty:$('onDuty').value,offDuty:$('offDuty').value,out:$('out').value,off:$('off').value,on:$('on').value,in:$('in').value,block:c.block,flight:c.flight,simulatorTime:simTime,credit:(dutyType==='DHD'||dutyType==='Ground Course')?durMins($('creditDisplay').value):c.credit,role:$('role').value,instructionType:$('instructionType').value,night:$('night').value,sim:dutyType==='Simulator'?'yes':'no',ifr:$('ifr').value,dayTakeoffs:Number($('dayTakeoffs').value||0),nightTakeoffs:Number($('nightTakeoffs').value||0),dayLandings:Number($('dayLandings').value||0),nightLandings:Number($('nightLandings').value||0),courseType:upper($('courseType')?.value||''),remarks:$('remarks').value.trim(),locked:lockedOverride===null?!!existing?.locked:!!lockedOverride,source:existing?.source||'manual'})}
function persistEntry(lockIt=false){const dutyType=$('dutyTypeFlight').value;if(!$('date').value){alert('Please enter the date.');return false}if((dutyType==='Flight'||dutyType==='DHD')&&(!$('dep').value.trim()||!$('arr').value.trim())){alert('Please enter From and To.');return false}const id=$('editId').value,fs=load(FLIGHTS_KEY),existing=id?fs.find(x=>x.id===id):null;if(existing?.locked&&!lockIt){alert('This entry is locked. Unlock it before editing.');return false}const f=collectEntry(lockIt),i=fs.findIndex(x=>x.id===f.id);if(i>=0)fs[i]={...fs[i],...f};else fs.push(f);save(FLIGHTS_KEY,fs);reconcileAllDuties();return true}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('.nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b){e.preventDefault();show(b.dataset.view)}});
  document.querySelectorAll('[data-upper]').forEach(el=>el.addEventListener('input',()=>{const p=el.selectionStart;el.value=upper(el.value);try{el.setSelectionRange(p,p)}catch{}}));
  ['dep','arr'].forEach(id=>$(id).addEventListener('change',async()=>{await updateAirportInfo();calcEntry();await calcNightForForm()}));
  $('date').addEventListener('change',()=>calcEntry());
  ['out','off','on','in','schedOut','schedIn','onDuty','offDuty','role','instructionType'].forEach(id=>$(id).addEventListener('input',()=>{calcEntry();if(['off','on'].includes(id))calcNightForForm()}));
  $('dutyTypeFlight').addEventListener('change',()=>{setEntryTypeUI();calcEntry()});
  $('courseType').addEventListener('input',()=>calcEntry());
  $('creditDisplay').addEventListener('change',()=>{if(isDhd({dutyType:$('dutyTypeFlight').value}))$('creditDisplay').value=fmt(durMins($('creditDisplay').value))});
  $('flightForm').addEventListener('submit',async e=>{e.preventDefault();if($('dutyTypeFlight').value==='Flight')await calcNightForForm();const editing=!!$('editId').value;if(!persistEntry(false))return;resetEntry();await render();show('dashboardView');alert(editing?'Entry updated.':'Entry saved.')});
  $('clearForm').addEventListener('click',resetEntry);
  $('lockEntryBtn').addEventListener('click',()=>{const id=$('editId').value,fs=load(FLIGHTS_KEY),existing=id?fs.find(x=>x.id===id):null;if(existing?.locked){if(!confirm('Unlock this entry and allow editing?'))return;existing.locked=false;existing._updatedAt=new Date().toISOString();save(FLIGHTS_KEY,fs);setEntryLockedUI(false);return}if(!confirm('Lock this entry? Its data will be protected from accidental editing.'))return;if(!persistEntry(true))return;setEntryLockedUI(true);render()});
  $('dutyForm').addEventListener('submit',e=>{e.preventDefault();const ds=load(DUTY_KEY),rep=$('reportTime').value,end=$('endDuty').value;ds.push(stamp({id:makeId(),date:$('dutyDate').value,type:$('dutyType').value,report:rep,end,minutes:diff(mins(rep),mins(end)),notes:$('dutyNotes').value.trim()}));save(DUTY_KEY,ds);reconcileAllDuties();e.target.reset();$('dutyDate').value=today();render();renderDuty()});
  ['tripStart','tripEnd'].forEach(id=>$(id).addEventListener('input',tripCalc));$('calcTrip').addEventListener('click',tripCalc);$('clearTrip').addEventListener('click',resetTrip);
  $('tripForm').addEventListener('submit',e=>{e.preventDefault();const c=tripCalc();if(!c)return alert('Enter a valid Trip Start and Trip End.');const ts=load(TRIPS_KEY),id=$('tripEditId').value||makeId(),t=stamp({id,base:upper(appSettings().homeBase||'CMN'),stations:upper($('tripStations').value),start:$('tripStart').value,end:$('tripEnd').value,trip:c.trip,duty:c.duty,layover:c.layover,allowance:c.allowance,remarks:$('tripRemarks').value.trim()}),i=ts.findIndex(x=>x.id===id);if(i>=0)ts[i]=t;else ts.push(t);save(TRIPS_KEY,ts);resetTrip();renderTrips();alert('Trip saved.')});
  $('exportCsv').addEventListener('click',()=>{const d=load(FLIGHTS_KEY);if(!d.length)return alert('No entries to export');const cols=['dutyType','date','flightNo','reg','type','dep','arr','schedOut','schedIn','schedBlock','onDuty','offDuty','totalDuty','sectors','out','off','on','in','block','flight','simulatorTime','credit','role','instructionType','night','dayTakeoffs','nightTakeoffs','dayLandings','nightLandings','ifr','remarks','locked'];download('pilotlog_logbook.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  $('exportLogTen').addEventListener('click',logTenExport);
  $('logTenFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const r=logTenImport(await file.text());e.target.value='';autoDetectTrips(false);await render();$('logTenImportStatus').textContent=`Imported ${r.imported} new, updated ${r.updated}, simulators ${r.sims}, other duties ${r.other}.`;alert('LogTen import complete.')}catch(err){alert('LogTen import failed: '+err.message)}});
  $('calendarFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const events=parseIcs(await file.text());if(!events.length)throw new Error('No calendar events found.');const r=importCalendar(events);e.target.value='';autoDetectTrips(false);await render();$('calendarImportStatus').textContent=`Imported ${r.sectors} flight sectors, ${r.duties} duties and ${r.other} other entries. ${r.skipped} skipped.`;alert(`Imported: ${r.sectors} flights • ${r.duties} duties • ${r.other} other entries`)}catch(err){alert('Calendar import failed: '+err.message)}});
  $('rosterFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const rows=parseCsv(await file.text());if(rows.length<2)return alert('CSV contains no data');const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''),aliases={date:['date','day'],flightNo:['flightno','flightnumber','flight','flt'],dep:['dep','departure','from','origin'],arr:['arr','arrival','to','destination'],std:['std','departuretime','scheduleddeparture','offblock'],sta:['sta','arrivaltime','scheduledarrival','onblock']},fieldFor=h=>Object.keys(aliases).find(k=>aliases[k].includes(norm(h)))||null,map=rows[0].map(fieldFor),imp=rows.slice(1).map(r=>{const o={id:makeId(),status:'planned'};map.forEach((k,i)=>{if(k)o[k]=r[i]||''});o.date=normalDate(o.date);['dep','arr','flightNo'].forEach(k=>o[k]=upper(o[k]));return o}).filter(x=>x.date&&(x.dep||x.arr||x.flightNo));save(ROSTER_KEY,[...load(ROSTER_KEY),...imp]);e.target.value='';await render();alert(`${imp.length} roster sectors imported`)});
  $('detectTripsBtn').addEventListener('click',()=>autoDetectTrips(true));
  $('appSettingsForm').addEventListener('submit',e=>{e.preventDefault();saveAppSettings({homeBase:upper($('setHomeBase').value)||'CMN',flightPrefix:cleanPrefix($('setFlightPrefix').value)||'MAC',aircraftPrefix:cleanPrefix($('setAircraftPrefix').value)||'CN-NM'});renderSettings();alert('Settings saved.')});
  $('refreshAirportsBtn').addEventListener('click',()=>ensureAirportDb(true));
  $('cloudEmail').addEventListener('change',()=>localStorage.setItem(LAST_EMAIL_KEY,$('cloudEmail').value.trim()));
  $('cloudSignUpBtn').addEventListener('click',async()=>{try{await cloudSignUp()}catch(e){alert('Create account failed: '+e.message)}});
  $('cloudSignInBtn').addEventListener('click',async()=>{try{await cloudSignIn()}catch(e){alert('Sign in failed: '+e.message)}});
  $('cloudSignOutBtn').addEventListener('click',async()=>{try{await cloudSignOut()}catch(e){alert('Sign out failed: '+e.message)}});
  $('syncCloudBtn').addEventListener('click',syncSupabase);
  $('payrollMonth').addEventListener('change',renderPayroll);$('recalcPayroll').addEventListener('click',()=>{const month=$('payrollMonth').value||monthNow();saveMonthExtras(month,{dayOffCount:Number($('payDayOffCount').value||0),arrears:Number($('payArrears').value||0)});renderPayroll()});
  $('paySettingsForm').addEventListener('submit',e=>{e.preventDefault();localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify({...readPaySettings(),_updatedAt:new Date().toISOString()}));setEntryTypeUI();renderPayroll();alert('Payroll settings saved.')});
  $('resetPaySettings').addEventListener('click',()=>{if(confirm('Restore default rates?')){localStorage.setItem(PAY_SETTINGS_KEY,JSON.stringify(PAY_DEFAULTS));fillPaySettings();renderPayroll()}});
  $('deleteAll').addEventListener('click',()=>{if(confirm('Delete ALL saved log entries? This cannot be undone.')){localStorage.removeItem(FLIGHTS_KEY);render()}});
  $('clearRoster').addEventListener('click',()=>{if(confirm('Clear imported roster?')){localStorage.removeItem(ROSTER_KEY);render()}});
  $('exportRoster').addEventListener('click',()=>{const d=load(ROSTER_KEY);if(!d.length)return alert('No roster to export');const cols=['date','flightNo','dep','arr','std','sta','status'];download('pilotlog_roster.csv',[cols.join(','),...d.map(r=>cols.map(c=>csv(r[c])).join(','))].join('\n'),'text/csv')});
  document.addEventListener('click',async e=>{let b=e.target.closest('[data-delete-flight]');if(b){if(!confirm('Confirm to delete this log entry?'))return;save(FLIGHTS_KEY,load(FLIGHTS_KEY).filter(f=>f.id!==b.dataset.deleteFlight));reconcileAllDuties();await render();return}
    b=e.target.closest('[data-edit-flight]');if(b){const f=load(FLIGHTS_KEY).find(x=>x.id===b.dataset.editFlight);if(f){loadEntryToForm(f);show('addView')}return}
    b=e.target.closest('[data-delete-duty]');if(b){if(!confirm('Confirm to delete this duty?'))return;save(DUTY_KEY,load(DUTY_KEY).filter(d=>d.id!==b.dataset.deleteDuty));reconcileAllDuties();renderDuty();await render();return}
    b=e.target.closest('[data-view-trip]');if(b){renderTripInspector(b.dataset.viewTrip);return}
    b=e.target.closest('[data-delete-trip]');if(b){if(!confirm('Confirm to delete this trip?'))return;save(TRIPS_KEY,load(TRIPS_KEY).filter(t=>t.id!==b.dataset.deleteTrip));renderTrips();$('tripInspectorWrap')?.classList.add('hidden');return}
    b=e.target.closest('[data-roster-action]');if(b){const rs=load(ROSTER_KEY),r=rs.find(x=>x.id===b.dataset.rosterAction);if(!r)return;const existing=load(FLIGHTS_KEY).find(f=>f.date===r.date&&upper(f.flightNo)===upper(r.flightNo)&&upper(f.dep)===upper(r.dep)&&upper(f.arr)===upper(r.arr));if(existing)loadEntryToForm(existing);else{resetEntry();$('date').value=r.date;$('flightNo').value=flightNoInput(composeFlightNo(r.flightNo));$('dep').value=r.dep;$('arr').value=r.arr;$('schedOut').value=r.std;$('schedIn').value=r.sta;calcEntry();$('remarks').value='Imported from roster';await updateAirportInfo()}r.status='done';save(ROSTER_KEY,rs);show('addView');await render()}
  });
  resetEntry();resetTrip();$('dutyDate').value=today();$('payrollMonth').value=monthNow();$('cloudEmail').value=localStorage.getItem(LAST_EMAIL_KEY)||'';fillPaySettings();renderDuty();renderSettings();render();show('dashboardView');console.log('PilotLog v'+VERSION+' loaded');
});
})();