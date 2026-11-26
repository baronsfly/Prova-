export function copyJson(value){
  if(Array.isArray(value))return value.map(copyJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,copyJson(v)]));
  return value;
}

const activityDisplayCopies=new WeakMap();
function immutableDisplayCopy(value){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return Object.freeze(value.map(immutableDisplayCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,immutableDisplayCopy(item)])));
}
export function displayRows(rows){
  return (rows||[]).filter(isEntryActivityRecord).map(row=>{
    let view=activityDisplayCopies.get(row);
    if(!view){view=immutableDisplayCopy(row);activityDisplayCopies.set(row,view)}
    return view;
  });
}
export function editableRows(rows){return(rows||[]).filter(x=>x?.recordKind==='activity').map(copyJson)}
export function editableActivity(rows,id){
  if(!id)return undefined;
  const row=rows?.find(record=>record.id===id&&isEntryActivityRecord(record));
  return row?copyJson(row):undefined;
}
export function isEntryActivityRecord(x){return x?.recordKind==='activity'}
