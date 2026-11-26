export function createRosterGroups({
  cleanPrefix,appSettings,upper,recordRevision,isPositioning,isSim,isStby,isGround,isDhd,isDhp,
  rosterFlightRows,entryChrono,dutyActivityRows,dutyEndTime,shiftTime,canonicalDutyType,activityIncludedInResults
}){
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
      const preferred=/^3O/i.test(cleanPrefix(r.flightNo))&&!/^3O/i.test(cleanPrefix(cur.flightNo))?r:cur;
      // The roster badge reflects the same Core activity: a locked Logbook copy
      // therefore remains green even when a roster-labelled duplicate supplies
      // the display text for that physical sector.
      map.set(k,{...preferred,locked:!!(cur.locked||r.locked),status:cur.status==='done'||r.status==='done'?'done':preferred.status});
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
  function rosterGroups(rows){
    const home=upper(appSettings().homeBase||'CMN');
    const rs=rosterFlightRows(rows).sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
    const ds=dutyActivityRows(rows),by={},groups=[];
    // AeroLINE crewScheduleBlockId is the strongest duty-group signal. Fall back to date when absent.
    rs.forEach(r=>{const key=r.screenshotDutyStart?`screenshot:${r.screenshotDutyStart}`:r.aerolineBlockId?`${r.date}|${r.aerolineBlockId}`:r.date;(by[key]||(by[key]=[])).push(r)});
    Object.entries(by).forEach(([,rawItems])=>{
      const date=rawItems[0]?.screenshotDutyStart?.slice(0,10)||rawItems[0]?.date||'';
      const items=dedupeRosterItems(rawItems);
      items.sort((a,b)=>entryChrono(a).localeCompare(entryChrono(b)));
      if(!items.length)return;
      const duty=ds.find(d=>d.date===date&&/flight duty/i.test(d.type||''));
      const first=items[0],last=items[items.length-1];
      const outboundDest=(items.find(x=>upper(x.dep)===home&&upper(x.arr)!==home)?.arr)||first.arr||last.arr||'';
      const start=first.onDuty||first.screenshotDutyStart?.slice(11,16)||duty?.report||shiftTime(first.std,-60);
      const end=dutyEndTime(last,duty?.end||shiftTime(last.sta,30));
      groups.push({
        kind:'flight',date,items,start,end,
        dep:first.dep||home,arr:outboundDest,
        sectors:items.filter(x=>x.flightNo).length,
        status:items.every(x=>x.status==='done')?'done':'planned',
        sortTime:start||first.std||'99:99'
      });
    });
    // SIM, STBY, DHD, DHP and Ground Course are stored as Entries, not roster sectors.
    const activities=rows.filter(f=>
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
        status:activityIncludedInResults(f)?'done':'planned',
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
        dep:home,arr:home,sectors:0,status:activityIncludedInResults(d)?'done':'planned',
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
  return {rosterFlightDigits,rosterFlightLabel,rosterActivitySameIdentity,rosterSectorSameIdentity,mergeRosterSector,mergeRosterActivity,rosterGroups};
}
