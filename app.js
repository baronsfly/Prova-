(() => {
  'use strict';

  const VERSION = '4.2';
  const FLIGHTS_KEY = 'pilotlog_flights_v1';
  const ROSTER_KEY = 'pilotlog_roster_v2';
  const DUTY_KEY = 'pilotlog_duties_v2';

  const $ = id => document.getElementById(id);
  const loadKey = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const saveKey = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const makeId = () => 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
  const mins = t => {
    if (!t) return null;
    const parts = String(t).split(':').map(Number);
    return parts[0] * 60 + parts[1];
  };
  const diff = (a,b) => {
    if (a == null || b == null) return 0;
    let d = b-a;
    if (d < 0) d += 1440;
    return d;
  };
  const fmt = m => `${Math.floor((m||0)/60)}:${String((m||0)%60).padStart(2,'0')}`;
  const creditMins = m => m > 0 ? Math.ceil(m/30)*30 : 0;
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function calc() {
    const block = diff(mins($('out').value), mins($('in').value));
    const flight = diff(mins($('off').value), mins($('on').value));
    const credit = creditMins(block);
    $('blockDisplay').value = fmt(block);
    $('creditDisplay').value = fmt(credit);
    $('calcPreview').textContent = `Block ${fmt(block)} • Flight ${fmt(flight)} • Credit ${fmt(credit)}`;
    return {block, flight, credit};
  }

  function show(viewId) {
    document.querySelectorAll('main > section').forEach(section => {
      section.classList.toggle('hidden', section.id !== viewId);
    });
    document.querySelectorAll('.nav button[data-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.view === viewId);
    });
    window.scrollTo({top:0, behavior:'auto'});
  }

  function startOfDaysAgo(n) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-n+1);
    return d;
  }

  function rolling(data,n) {
    const cut = startOfDaysAgo(n);
    return data.reduce((sum,f) => sum + (new Date(f.date+'T00:00:00') >= cut ? (Number(f.block)||0) : 0), 0);
  }

  function flightHtml(data, full=false) {
    if (!data.length) return '<div class="empty">No flights yet.</div>';
    return data.map(f => `<div class="flight"><div><div class="route">${escHtml(f.dep)} → ${escHtml(f.arr)}</div><div class="small">${escHtml(f.date)} ${escHtml(f.flightNo||'')}</div><span class="pill">${escHtml(f.dutyType||'Flight')}</span><span class="pill">${escHtml(f.type||'Aircraft')}</span><span class="pill">${escHtml(f.role||'')}</span>${f.instructionType?`<span class="pill green">${escHtml(f.instructionType)}</span>`:''}</div><div class="meta"><b>${fmt(f.block)}</b> block<br><span class="small">${fmt(f.credit ?? creditMins(Number(f.block)||0))} credit • ${fmt(f.flight)} flight • ${escHtml(f.reg||'')}</span></div>${full?`<button class="danger" data-delete-flight="${f.id}">Delete</button>`:''}</div>`).join('');
  }

  function rosterHtml(data, actions) {
    if (!data.length) return '<div class="empty">No roster imported.</div>';
    return data.map(r => `<div class="roster-row"><div><b>${escHtml(r.date)}</b><div class="small">${escHtml(r.report?`RPT ${r.report}`:'')}</div></div><div><b>${escHtml(r.flightNo||'Duty')}</b> ${escHtml(r.dep||'')} → ${escHtml(r.arr||'')}<div class="small">${escHtml(r.std||'')} ${r.sta?'– '+escHtml(r.sta):''} ${r.endDuty?'• END '+escHtml(r.endDuty):''}</div></div><div class="extra"><span class="pill">${escHtml(r.type||'Roster')}</span><span class="status ${r.status==='done'?'done':'planned'}">${r.status==='done'?'Logged':'Planned'}</span></div>${actions?`<button class="${r.status==='done'?'secondary':'primary'}" data-roster-action="${r.id}">${r.status==='done'?'Undo':'Log'}</button>`:'<div></div>'}</div>`).join('');
  }

  function renderRoster() {
    const all = loadKey(ROSTER_KEY).sort((a,b)=>(a.date+(a.std||'')).localeCompare(b.date+(b.std||'')));
    const today = todayLocal();
    $('upcomingRoster').innerHTML = rosterHtml(all.filter(r=>r.date>=today).slice(0,6), false);
    $('rosterList').innerHTML = rosterHtml(all, true);
  }

  function renderDuties() {
    const data = loadKey(DUTY_KEY).sort((a,b)=>b.date.localeCompare(a.date));
    $('dutyList').innerHTML = !data.length ? '<div class="empty">No duties yet.</div>' : data.map(x => `<div class="duty"><div><b>${escHtml(x.type)}</b><div class="small">${escHtml(x.date)} • ${escHtml(x.notes||'')}</div></div><div class="meta"><b>${fmt(x.minutes)}</b><div class="small">${escHtml(x.report||'')} ${x.end?'– '+escHtml(x.end):''}</div></div><button class="danger" data-delete-duty="${x.id}">Delete</button></div>`).join('');
  }

  function render() {
    const raw = loadKey(FLIGHTS_KEY);
    let changed = false;
    raw.forEach(f => {
      if (f.credit == null) { f.credit = creditMins(Number(f.block)||0); changed = true; }
      if (!f.dutyType) { f.dutyType = f.sim === 'yes' ? 'Simulator' : 'Flight'; changed = true; }
    });
    if (changed) saveKey(FLIGHTS_KEY, raw);
    const data = raw.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    let block=0,pic=0,tri=0;
    data.forEach(f => {
      block += Number(f.block)||0;
      if (f.role === 'PIC') pic += Number(f.block)||0;
      if (f.role === 'Instructor' || f.instructionType) tri += Number(f.block)||0;
    });
    $('mBlock').textContent = fmt(block);
    $('mPic').textContent = fmt(pic);
    $('mTri').textContent = fmt(tri);
    $('mFlights').textContent = data.length;
    $('p28').textContent = fmt(rolling(data,28));
    $('p90').textContent = fmt(rolling(data,90));
    $('p365').textContent = fmt(rolling(data,365));
    $('recentFlights').innerHTML = flightHtml(data.slice(0,5));
    $('allFlights').innerHTML = flightHtml(data,true);
    renderRoster();
    renderDuties();
  }

  function resetFlightForm() {
    $('flightForm').reset();
    $('date').value = todayLocal();
    $('landings').value = '1';
    $('night').value = '00:00';
    $('blockDisplay').value = '0:00';
    $('creditDisplay').value = '0:00';
    calc();
  }

  const csvEsc = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  function downloadCsv(name,csv) {
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }



  // ---- iCalendar (.ics) import -------------------------------------------------
  function unfoldIcs(text) {
    return String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  }

  function unescapeIcs(v) {
    return String(v || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  function parseIcsDateTime(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    // DATE values (all-day): YYYYMMDD
    let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return { date:`${m[1]}-${m[2]}-${m[3]}`, time:'', isAllDay:true };
    // DATE-TIME values: YYYYMMDDTHHMMSS[Z]
    m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!m) return null;
    return { date:`${m[1]}-${m[2]}-${m[3]}`, time:`${m[4]}:${m[5]}`, isUtc:!!m[7], isAllDay:false };
  }

  function parseIcs(text) {
    const src = unfoldIcs(text);
    const blocks = src.split(/BEGIN:VEVENT\r?\n/i).slice(1);
    return blocks.map(block => {
      block = block.split(/END:VEVENT/i)[0];
      const ev = {};
      block.split(/\r?\n/).forEach(line => {
        const idx = line.indexOf(':');
        if (idx < 0) return;
        const left = line.slice(0, idx);
        const value = unescapeIcs(line.slice(idx + 1));
        const key = left.split(';')[0].toUpperCase();
        if (['SUMMARY','DESCRIPTION','DTSTART','DTEND','UID','LOCATION'].includes(key)) ev[key] = value;
      });
      ev._start = parseIcsDateTime(ev.DTSTART);
      ev._end = parseIcsDateTime(ev.DTEND);
      return ev;
    }).filter(ev => ev.SUMMARY && ev._start);
  }

  function zuluTimesFromDescription(desc) {
    const t = String(desc || '');
    const dep = t.match(/Scheduled(?: take-off\/departure| departure| take[- ]?off)?\s+(\d{1,2}:\d{2})Z/i);
    const arr = t.match(/Scheduled arrival\s+(\d{1,2}:\d{2})Z/i);
    return { std: dep ? dep[1].padStart(5,'0') : '', sta: arr ? arr[1].padStart(5,'0') : '' };
  }

  function dutyTimesFromDescription(desc) {
    const t = String(desc || '');
    const rpt = t.match(/Reporting\s+(\d{1,2}:\d{2})Z/i);
    const rel = t.match(/Release\s+(\d{1,2}:\d{2})Z/i);
    return { report:rpt ? rpt[1].padStart(5,'0') : '', end:rel ? rel[1].padStart(5,'0') : '' };
  }

  function classifyCalendarEvent(ev) {
    const summary = String(ev.SUMMARY || '').trim();
    const upper = summary.toUpperCase();
    // Air Arabia-style sector title: 3O457 • CMN → BGY (also accepts -, >, / separators)
    const sector = summary.match(/^([A-Z0-9]{2,3}\s*\d{1,4}[A-Z]?)\s*[•\-:]?\s*([A-Z]{3,4})\s*(?:→|->|>|–|—|-)\s*([A-Z]{3,4})/i);
    if (sector) return { kind:'flight', flightNo:sector[1].replace(/\s+/g,''), dep:sector[2].toUpperCase(), arr:sector[3].toUpperCase(), dutyType:'Flight' };
    if (/^DUTY\b/i.test(summary)) return {kind:'duty', dutyType:'Flight Duty'};
    if (/\b(STBY|STANDBY|SBY)\b/i.test(upper)) return {kind:'duty', dutyType:'Standby'};
    if (/\b(DHD|DEADHEAD|DEAD HEADING|POSITIONING)\b/i.test(upper)) return {kind:'entry', dutyType:'DHD'};
    if (/\b(SIM|SIMULATOR|OPC|LPC)\b/i.test(upper)) return {kind:'entry', dutyType:'Simulator'};
    if (/\b(GROUND|COURSE|TRAINING|CRM|REFRESHER)\b/i.test(upper)) return {kind:'entry', dutyType:'Ground Course'};
    if (/^OFF\b/i.test(summary)) return {kind:'off'};
    return {kind:'other'};
  }

  function rosterSignature(r) {
    return [r.date,r.flightNo,r.dep,r.arr,r.std,r.sta].map(x=>String(x||'').toUpperCase()).join('|');
  }

  function dutySignature(d) {
    return [d.date,d.type,d.report,d.end,d.notes].map(x=>String(x||'').toUpperCase()).join('|');
  }

  function importCalendarEvents(events) {
    const roster = loadKey(ROSTER_KEY);
    const duties = loadKey(DUTY_KEY);
    const flights = loadKey(FLIGHTS_KEY);
    const rosterSeen = new Set(roster.map(rosterSignature));
    const dutySeen = new Set(duties.map(dutySignature));
    const flightSeen = new Set(flights.map(f => [f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.schedIn].map(x=>String(x||'').toUpperCase()).join('|')));
    let sectors=0, dutyCount=0, otherEntries=0, skipped=0;

    events.forEach(ev => {
      const c = classifyCalendarEvent(ev);
      const date = ev._start.date;
      if (c.kind === 'off' || c.kind === 'other') { skipped++; return; }

      if (c.kind === 'flight') {
        const z = zuluTimesFromDescription(ev.DESCRIPTION);
        const r = {
          id:makeId(), date, flightNo:c.flightNo, dep:c.dep, arr:c.arr,
          report:'', std:z.std || ev._start.time || '', sta:z.sta || (ev._end ? ev._end.time : ''), endDuty:'',
          type:'', reg:'', status:'planned', source:'calendar'
        };
        const sig = rosterSignature(r);
        if (!rosterSeen.has(sig)) { roster.push(r); rosterSeen.add(sig); sectors++; } else skipped++;
        return;
      }

      if (c.kind === 'duty') {
        const z = dutyTimesFromDescription(ev.DESCRIPTION);
        const d = {
          id:makeId(), date, type:c.dutyType,
          report:z.report || ev._start.time || '', end:z.end || (ev._end ? ev._end.time : ''),
          minutes:diff(mins(z.report || ev._start.time || ''), mins(z.end || (ev._end ? ev._end.time : ''))),
          notes:ev.SUMMARY || '', source:'calendar'
        };
        const sig=dutySignature(d);
        if (!dutySeen.has(sig)) { duties.push(d); dutySeen.add(sig); dutyCount++; } else skipped++;
        return;
      }

      if (c.kind === 'entry') {
        // Planned non-flight item. Save it in log entries so it appears immediately and can be edited/replaced later.
        const f = {
          id:makeId(), dutyType:c.dutyType, date, flightNo:'', dep:'', arr:'', type:'', reg:'',
          schedOut:ev._start.time || '', schedIn:ev._end ? ev._end.time : '', out:'', off:'', on:'', in:'',
          block:0, flight:0, credit:0, role:'PIC', instructionType:'', landings:0, night:'00:00', sim:c.dutyType==='Simulator'?'yes':'no', ifr:'no',
          remarks:`Imported from calendar: ${ev.SUMMARY || ''}`, source:'calendar'
        };
        const sig=[f.date,f.dutyType,f.flightNo,f.dep,f.arr,f.schedOut,f.schedIn].map(x=>String(x||'').toUpperCase()).join('|');
        if (!flightSeen.has(sig)) { flights.push(f); flightSeen.add(sig); otherEntries++; } else skipped++;
      }
    });

    saveKey(ROSTER_KEY, roster);
    saveKey(DUTY_KEY, duties);
    saveKey(FLIGHTS_KEY, flights);
    return {sectors,dutyCount,otherEntries,skipped};
  }

  function parseCsv(text) {
    const rows=[]; let row=[], cell='', quoted=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i], n=text[i+1];
      if (c==='"' && quoted && n==='"') { cell+='"'; i++; }
      else if (c==='"') quoted=!quoted;
      else if (c===',' && !quoted) { row.push(cell.trim()); cell=''; }
      else if ((c==='\n'||c==='\r') && !quoted) {
        if (c==='\r' && n==='\n') i++;
        row.push(cell.trim()); cell='';
        if (row.some(x=>x!=='')) rows.push(row);
        row=[];
      } else cell+=c;
    }
    row.push(cell.trim());
    if (row.some(x=>x!=='')) rows.push(row);
    return rows;
  }

  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const aliases = {date:['date','day'],flightNo:['flightno','flightnumber','flight','flt'],dep:['dep','departure','from','origin'],arr:['arr','arrival','to','destination'],report:['report','reporting','reporttime'],std:['std','departuretime','scheduleddeparture','offblock'],sta:['sta','arrivaltime','scheduledarrival','onblock'],endDuty:['endduty','dutyend','end','released'],type:['type','aircrafttype','acfttype'],reg:['reg','registration','aircraftregistration']};
  const fieldFor = h => { const x=norm(h); return Object.keys(aliases).find(k=>aliases[k].includes(x))||null; };
  function normalDate(v) {
    v=String(v||'').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) { const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
    return v;
  }

  async function clearOldPwaCaches() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) if (key.startsWith('pilotlog-')) await caches.delete(key);
      }
    } catch (e) { console.warn('Cache cleanup skipped', e); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    clearOldPwaCaches();

    // Robust navigation: one delegated handler for the whole bottom bar.
    document.querySelector('.nav').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      e.preventDefault();
      show(btn.dataset.view);
    });

    ['out','off','on','in'].forEach(id => $(id).addEventListener('input', calc));

    $('flightForm').addEventListener('submit', e => {
      e.preventDefault();
      const c=calc();
      const dutyType=$('dutyTypeFlight').value;
      if (!$('date').value) return alert('Please enter the date.');
      if ((dutyType==='Flight'||dutyType==='DHD') && (!$('dep').value.trim()||!$('arr').value.trim())) return alert('Please enter From and To.');
      const f={id:makeId(),dutyType,date:$('date').value,flightNo:$('flightNo').value.trim().toUpperCase(),dep:$('dep').value.trim().toUpperCase(),arr:$('arr').value.trim().toUpperCase(),type:$('type').value.trim().toUpperCase(),reg:$('reg').value.trim().toUpperCase(),schedOut:$('schedOut').value,schedIn:$('schedIn').value,out:$('out').value,off:$('off').value,on:$('on').value,in:$('in').value,block:c.block,flight:c.flight,credit:c.credit,role:$('role').value,instructionType:$('instructionType').value,landings:Number($('landings').value||0),night:$('night').value,sim:dutyType==='Simulator'?'yes':'no',ifr:$('ifr').value,remarks:$('remarks').value.trim()};
      const data=loadKey(FLIGHTS_KEY); data.push(f); saveKey(FLIGHTS_KEY,data);
      resetFlightForm(); render(); show('dashboardView'); alert('Entry saved successfully.');
    });

    $('clearForm').addEventListener('click', resetFlightForm);
    $('deleteAll').addEventListener('click', () => { if (confirm('Delete all saved flights?')) { localStorage.removeItem(FLIGHTS_KEY); render(); } });
    $('clearRoster').addEventListener('click', () => { if (confirm('Clear imported roster?')) { localStorage.removeItem(ROSTER_KEY); render(); } });

    $('exportCsv').addEventListener('click', () => {
      const d=loadKey(FLIGHTS_KEY); if(!d.length) return alert('No flights to export');
      const cols=['dutyType','date','flightNo','reg','type','dep','arr','schedOut','schedIn','out','off','on','in','block','credit','flight','role','instructionType','landings','night','sim','ifr','remarks'];
      downloadCsv('pilotlog_logbook.csv',[cols.join(','),...d.map(r=>cols.map(c=>csvEsc(r[c])).join(','))].join('\n'));
    });

    $('exportRoster').addEventListener('click', () => {
      const d=loadKey(ROSTER_KEY); if(!d.length) return alert('No roster to export');
      const cols=['date','flightNo','dep','arr','report','std','sta','endDuty','type','reg','status'];
      downloadCsv('pilotlog_roster.csv',[cols.join(','),...d.map(r=>cols.map(c=>csvEsc(r[c])).join(','))].join('\n'));
    });



    $('calendarFile').addEventListener('change', async e => {
      const file=e.target.files[0]; if(!file) return;
      try {
        const text=await file.text();
        const events=parseIcs(text);
        if(!events.length) throw new Error('No calendar events found in this .ics file.');
        const result=importCalendarEvents(events);
        e.target.value='';
        render();
        $('calendarImportStatus').textContent = `Imported ${result.sectors} flight sectors, ${result.dutyCount} duties and ${result.otherEntries} other roster entries. ${result.skipped} duplicates/unsupported events skipped.`;
        alert(`Calendar imported: ${result.sectors} sectors • ${result.dutyCount} duties • ${result.otherEntries} other entries`);
      } catch(err) {
        console.error(err);
        $('calendarImportStatus').textContent = 'Import failed: ' + (err.message || err);
        alert('Calendar import failed: ' + (err.message || err));
      }
    });

    $('rosterFile').addEventListener('change', async e => {
      const file=e.target.files[0]; if(!file) return;
      const rows=parseCsv(await file.text()); if(rows.length<2) return alert('CSV contains no data');
      const map=rows[0].map(fieldFor);
      const imported=rows.slice(1).map(r=>{const o={id:makeId(),status:'planned'};map.forEach((k,i)=>{if(k)o[k]=r[i]||''});o.date=normalDate(o.date);o.dep=(o.dep||'').toUpperCase();o.arr=(o.arr||'').toUpperCase();o.flightNo=(o.flightNo||'').toUpperCase();o.type=(o.type||'').toUpperCase();o.reg=(o.reg||'').toUpperCase();return o}).filter(x=>x.date&&(x.dep||x.arr||x.flightNo));
      saveKey(ROSTER_KEY,[...loadKey(ROSTER_KEY),...imported]); e.target.value=''; render(); alert(`${imported.length} roster sectors imported`);
    });

    $('dutyForm').addEventListener('submit', e => {
      e.preventDefault();
      const d=loadKey(DUTY_KEY); d.push({id:makeId(),date:$('dutyDate').value,type:$('dutyType').value,report:$('reportTime').value,end:$('endDuty').value,minutes:diff(mins($('reportTime').value),mins($('endDuty').value)),notes:$('dutyNotes').value.trim()});
      saveKey(DUTY_KEY,d); e.target.reset(); $('dutyDate').value=todayLocal(); render();
    });

    document.addEventListener('click', e => {
      const delFlight=e.target.closest('[data-delete-flight]');
      if(delFlight){saveKey(FLIGHTS_KEY,loadKey(FLIGHTS_KEY).filter(f=>f.id!==delFlight.dataset.deleteFlight));render();return;}
      const delDuty=e.target.closest('[data-delete-duty]');
      if(delDuty){saveKey(DUTY_KEY,loadKey(DUTY_KEY).filter(d=>d.id!==delDuty.dataset.deleteDuty));render();return;}
      const rosterBtn=e.target.closest('[data-roster-action]');
      if(rosterBtn){
        const roster=loadKey(ROSTER_KEY), r=roster.find(x=>x.id===rosterBtn.dataset.rosterAction); if(!r)return;
        if(r.status==='done'){r.status='planned';saveKey(ROSTER_KEY,roster);render();return;}
        $('date').value=r.date||''; $('flightNo').value=r.flightNo||''; $('dep').value=r.dep||''; $('arr').value=r.arr||''; $('type').value=r.type||''; $('reg').value=r.reg||''; $('schedOut').value=r.std||''; $('schedIn').value=r.sta||''; $('out').value=r.std||''; $('off').value=''; $('on').value=''; $('in').value=r.sta||''; $('remarks').value='Imported from roster'; calc();
        r.status='done'; saveKey(ROSTER_KEY,roster); render(); show('addView');
      }
    });

    $('date').value=todayLocal(); $('dutyDate').value=todayLocal();
    render(); calc(); show('dashboardView');
    console.log('PilotLog v'+VERSION+' loaded');
  });
})();
