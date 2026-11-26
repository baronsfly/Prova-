export function createOperationalPersist({
  getDatabase,setDatabase,emptyDatabase,getStoreReady,normalizeDatabase,openDatabase,
  markLocalRevision,isImportStaging,metaKey,fallbackKey,storeName,recordKey
}){
  let flightPersistActive=false,flightPersistDirty=false,flightPersistTimer=null,flightPersistPromise=Promise.resolve();
  async function writeFlightStore(database,{verifiedSnapshot=false}={}){
    const data=verifiedSnapshot?database:normalizeDatabase(database);
    if(!verifiedSnapshot)data.updatedAt=new Date().toISOString();
    if(window.PilotLogNative?.isNative){await window.PilotLogNative.writeDatabase(data);return true}
    const db=await openDatabase();
    try{await new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite');tx.objectStore(storeName).put(data,recordKey);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('PilotLog data write aborted'))})}
    finally{db.close()}
    try{localStorage.setItem(metaKey,JSON.stringify({records:data.records.length,updatedAt:data.updatedAt,schemaVersion:data.schemaVersion}))}catch{}
    return true;
  }
  function queueFlightPersist(){
    flightPersistDirty=true;
    if(!getStoreReady())return Promise.resolve(false);
    if(flightPersistTimer){clearTimeout(flightPersistTimer);flightPersistTimer=null}
    if(flightPersistActive)return flightPersistPromise;
    flightPersistActive=true;
    flightPersistPromise=(async()=>{
      try{while(flightPersistDirty){flightPersistDirty=false;try{await writeFlightStore(getDatabase(),{verifiedSnapshot:true})}catch(error){flightPersistDirty=true;throw error}}}
      finally{flightPersistActive=false}
      return true;
    })();
    return flightPersistPromise;
  }
  function scheduleFlightPersist(delay=0){
    flightPersistDirty=true;
    if(!getStoreReady()){const database=getDatabase();if(database)localStorage.setItem(fallbackKey,JSON.stringify(database));return false}
    if(flightPersistTimer)return true;
    flightPersistTimer=setTimeout(()=>{flightPersistTimer=null;queueFlightPersist().catch(e=>console.error('PilotLog IndexedDB write failed',e))},delay);
    return true;
  }
  async function flushFlightStore(){
    if(!getStoreReady())return true;
    if(!flightPersistDirty&&!flightPersistTimer)return flightPersistActive?flightPersistPromise:true;
    if(flightPersistTimer){clearTimeout(flightPersistTimer);flightPersistTimer=null}
    await queueFlightPersist();
    return true;
  }
  function touchOperationalDatabase(){
    if(isImportStaging())return true;
    markLocalRevision();
    let database=getDatabase();
    if(!database){database=emptyDatabase();setDatabase(database)}
    database.updatedAt=new Date().toISOString();
    if(getStoreReady())scheduleFlightPersist();
    else try{localStorage.setItem(fallbackKey,JSON.stringify(database))}catch{}
    return true;
  }
  return {writeFlightStore,queueFlightPersist,scheduleFlightPersist,flushFlightStore,touchOperationalDatabase};
}
