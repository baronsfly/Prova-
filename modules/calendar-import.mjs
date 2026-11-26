function unfoldIcs(text){return text.replace(/\r?\n[ \t]/g,'')}
function icsVal(line){const i=line.indexOf(':');return i<0?'':line.slice(i+1).replace(/\\n/g,'\n').replace(/\\,/g,',').replace(/\\;/g,';')}
function parseIcsDate(v){v=String(v||'').trim();const m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?/);if(!m)return null;return{date:`${m[1]}-${m[2]}-${m[3]}`,time:m[4]?`${m[4]}:${m[5]}`:''}}
export function parseIcs(text){return unfoldIcs(text).split('BEGIN:VEVENT').slice(1).map(x=>x.split('END:VEVENT')[0]).map(b=>{const o={};b.split(/\r?\n/).forEach(line=>{const k=line.split(':')[0].split(';')[0];if(['SUMMARY','DESCRIPTION','DTSTART','DTEND','UID'].includes(k))o[k]=icsVal(line)});o._start=parseIcsDate(o.DTSTART);o._end=parseIcsDate(o.DTEND);return o}).filter(e=>e._start)}
export function classifyCalendarSummary(s){
  const fl=s.match(/\b([A-Z0-9]{2,3}\s?\d{2,4})\b.*?\b([A-Z]{3})\b\s*(?:→|->|–|-)\s*\b([A-Z]{3})\b/);
  if(fl)return{kind:'flight',flightNo:fl[1].replace(/\s+/g,''),dep:fl[2],arr:fl[3]};
  const ac=(s.match(/\bA(319|320|321)\b/)||[])[0]||'';
  if(/\bRT[ -]?A3(19|20|21)\b|RECURRENT TRAINING|\bSIM(?:ULATOR)?\b|\bOPC\b|\bLPC\b/.test(s))return{kind:'entry',dutyType:'Simulator',aircraftType:ac};
  if(/\bSTBY\b|STANDBY|\bHSBY\b/.test(s))return{kind:'entry',dutyType:'STBY',aircraftType:ac};
  if(/\bDHD\b|DEADHEAD|\bDHP\b/.test(s)){const r=s.match(/\b([A-Z]{3})\b\s*(?:→|->|–|-)\s*\b([A-Z]{3})\b/);return{kind:'entry',dutyType:'DHD',aircraftType:ac,dep:r?r[1]:'',arr:r?r[2]:''}};
  if(/^SOD$/.test(s))return{kind:'entry',dutyType:'Ground Course',aircraftType:ac};
  if(/\bGRT\b|GROUND|COURSE|TRAINING/.test(s))return{kind:'entry',dutyType:'Ground Course',aircraftType:ac};
  if(/^DUTY\b|\bDUTY\s*[•:-]/.test(s))return{kind:'duty',dutyType:'Flight Duty'};
  if(/^(?:OFF|DAY\s*OFF|DAYOFF)\b/.test(s))return{kind:'duty',dutyType:'Day OFF'};return{kind:'unknown'}
}
export function zuluTimes(desc){const d=String(desc||'');return{out:(d.match(/Scheduled (?:take-off\/)?departure\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',inn:(d.match(/Scheduled arrival\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',report:(d.match(/Reporting\s+(\d{1,2}:\d{2})Z/i)||[])[1]||'',end:(d.match(/(?:Release|End of duty)\s+(\d{1,2}:\d{2})Z/i)||[])[1]||''}}
