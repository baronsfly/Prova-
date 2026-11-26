export function createCrewDirectory({
  upper,isEntryActivityRecord,CREW_NAME_FIELDS
}){
  const entrySuggestionDb={crew:[],types:[]};
  const crewNameCounts=new Map(),aircraftTypeCounts=new Map();
  let directoryRecords=null,directoryPreferences=null,directoryProfile='',directoryChanged=true;
  function crewName(value){return upper(value||'').trim().replace(/\s+/g,' ')}
  function countDirectoryValue(counts,value,delta){
    if(!value)return;
    const count=(counts.get(value)||0)+delta;
    if(count>0)counts.set(value,count);else counts.delete(value);
    if(count===0||count===1&&delta===1)directoryChanged=true;
  }
  function countDirectoryRow(row,delta){
    if(!isEntryActivityRecord(row))return;
    const type=upper(row.type||'').trim();
    if(type!=='UNSPECIFIED')countDirectoryValue(aircraftTypeCounts,type,delta);
    if(row.activityStatus==='DRAFT')return;
    for(const key of CREW_NAME_FIELDS)countDirectoryValue(crewNameCounts,crewName(row[key]),delta);
    for(const names of [row.cabinCrew,row.observerCrew]){
      if(Array.isArray(names))for(const name of names)countDirectoryValue(crewNameCounts,crewName(name),delta);
    }
    countDirectoryValue(crewNameCounts,crewName(row.studentName),delta);
  }
  function refresh(rows,prefs,profile){
    if(directoryRecords!==rows){
      crewNameCounts.clear();aircraftTypeCounts.clear();
      for(const row of rows||[])countDirectoryRow(row,1);
      directoryRecords=rows;directoryChanged=true;
    }
    if(!directoryChanged&&directoryPreferences===prefs&&directoryProfile===profile)return false;
    const names=new Set(crewNameCounts.keys());
    if(profile)names.add(profile);
    for(const name of prefs?.added||[])names.add(name);
    for(const name of prefs?.removed||[])names.delete(name);
    entrySuggestionDb.crew=[...names].sort();entrySuggestionDb.types=[...aircraftTypeCounts.keys()].sort();
    directoryPreferences=prefs;directoryProfile=profile;directoryChanged=false;
    return true;
  }
  function replaceRows(oldRows,next,prior){
    if(directoryRecords===oldRows){
      for(const row of next){
        const previous=prior.get(row.id);prior.delete(row.id);
        if(previous!==row){countDirectoryRow(previous,-1);countDirectoryRow(row,1)}
      }
      for(const removed of prior.values())countDirectoryRow(removed,-1);
      directoryRecords=next;
    }
  }
  function replaceRow(rows,previous,current){
    if(directoryRecords!==rows)return;
    countDirectoryRow(previous,-1);countDirectoryRow(current,1);
  }
  return {crewName,entrySuggestionDb,refresh,replaceRows,replaceRow};
}
