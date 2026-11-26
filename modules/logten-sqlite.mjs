export function createLogTenSqlite(){
const LOGTEN_TIME_COLUMNS=Object.freeze({totalFlightTime:'TOTALTIME',pic:'PIC',sic:'SIC',night:'NIGHT',picNight:'PICNIGHT',ifrTime:'IFR',multiPilot:'MULTIPILOT',dualGiven:'DUALGIVEN',dualReceived:'DUALRECEIVED',picUS:'P1US',simulatorTime:'SIMULATOR',sfiSfe:'SFI',totalInstrument:'TOTALINSTRUMENT'});
const LOGTEN_MIGRATION_MAGIC='PLGTN001';
function logTenSqliteSnapshot(database,wal,shm){
  const u8=new Uint8Array(database),w=new Uint8Array(wal),s=new Uint8Array(shm);
  if(u8.length<100||new TextDecoder().decode(u8.subarray(0,16))!=='SQLite format 3\0')throw new Error('Invalid LogTen SQLite database.');
  const d=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),pageSize=d.getUint16(16)===1?65536:d.getUint16(16);
  if(pageSize<512||pageSize>65536||(pageSize&(pageSize-1))||u8.length%pageSize)throw new Error('Invalid SQLite page size.');
  if(s.length&&s.length%32768)throw new Error('Incomplete LogTen SHM file. Select a consistent copy of all three files.');
  if(!w.length)return{database:u8.slice(),walFrames:0};
  if(w.length<32)throw new Error('Incomplete LogTen WAL header.');
  const v=new DataView(w.buffer,w.byteOffset,w.byteLength),magic=v.getUint32(0),little=magic===0x377f0682;
  if(![0x377f0682,0x377f0683].includes(magic)||v.getUint32(4)!==3007000||v.getUint32(8)!==pageSize)throw new Error('LogTen WAL does not match the database format.');
  let a=0,b=0;
  const checksum=(start,length)=>{for(let i=start;i<start+length;i+=8){a=(a+v.getUint32(i,little)+b)>>>0;b=(b+v.getUint32(i+4,little)+a)>>>0}};
  checksum(0,24);
  if(a!==v.getUint32(24)||b!==v.getUint32(28))throw new Error('LogTen WAL header checksum failed.');
  let committed=0,pages=0,valid=0;
  for(let p=32;p+24+pageSize<=w.length;p+=24+pageSize){
    if(v.getUint32(p+8)!==v.getUint32(16)||v.getUint32(p+12)!==v.getUint32(20))break;
    checksum(p,8);checksum(p+24,pageSize);
    if(a!==v.getUint32(p+16)||b!==v.getUint32(p+20))break;
    if(!v.getUint32(p))throw new Error('Invalid WAL page number.');
    valid++;if(v.getUint32(p+4)){committed=valid;pages=v.getUint32(p+4)}
  }
  // A copied, initialized SHM must not claim committed frames that were lost
  // or corrupted in the supplied WAL. Stale/uncommitted tail frames are ignored.
  if(s.length>=96){
    const sv=new DataView(s.buffer,s.byteOffset,s.byteLength),le=sv.getUint32(0,true)===3007000;
    if(s[12]===1&&sv.getUint32(0,le)===3007000){
      for(let i=0;i<48;i++)if(s[i]!==s[i+48])throw new Error('LogTen SHM changed while being copied. Copy the database files again.');
      for(let i=0;i<8;i++)if(s[32+i]!==w[16+i])throw new Error('LogTen WAL and SHM belong to different snapshots.');
      if(sv.getUint32(16,le)>committed)throw new Error('LogTen WAL is incomplete or damaged; committed records would be missing.');
    }
  }
  if(!committed){if(w.length>32)throw new Error('No complete committed LogTen WAL transaction found.');return{database:u8.slice(),walFrames:0}}
  if(pages*pageSize>512*1024*1024)throw new Error('LogTen database exceeds the supported import size.');
  const out=new Uint8Array(pages*pageSize);out.set(u8.subarray(0,out.length));
  for(let i=0;i<committed;i++){const p=32+i*(24+pageSize),n=v.getUint32(p);if(n<=pages)out.set(w.subarray(p+24,p+24+pageSize),(n-1)*pageSize)}
  // Export a standalone checkpointed snapshot; original sql/wal/shm are also archived.
  const ov=new DataView(out.buffer);out[18]=1;out[19]=1;ov.setUint32(28,pages);ov.setUint32(92,ov.getUint32(24));
  return{database:out,walFrames:committed};
}
function readLogTenSqlite(bytes){
  const b=new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength),size=v.getUint16(16)===1?65536:v.getUint16(16),usable=size-b[20];
  const encoding=({1:'utf-8',2:'utf-16le',3:'utf-16be'})[v.getUint32(56)];
  if(!encoding)throw new Error('Unsupported SQLite text encoding.');
  const decoder=new TextDecoder(encoding),limit=b.length/size;
  const page=n=>{if(!Number.isInteger(n)||n<1||n>limit)throw new Error('Invalid SQLite page reference.');return(n-1)*size};
  const varint=(buf,state)=>{let n=0;for(let i=0;i<9;i++){if(state.p>=buf.length)throw new Error('Truncated SQLite integer.');const x=buf[state.p++];n=n*(i===8?256:128)+(i===8?x:x&127);if(!(x&128)||i===8){if(!Number.isSafeInteger(n))throw new Error('SQLite integer exceeds safe precision.');return n}}};
  const record=payload=>{
    const state={p:0},end=varint(payload,state),types=[];if(end>payload.length)throw new Error('Invalid SQLite record header.');
    while(state.p<end)types.push(varint(payload,state));let p=end;const view=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
    return types.map(t=>{
      if(t===0)return null;if(t===8)return 0;if(t===9)return 1;if(t===10||t===11)throw new Error('Invalid SQLite serial type.');
      const n=t>=12?Math.floor((t-12)/2):[0,1,2,3,4,6,8,8][t];if(p+n>payload.length)throw new Error('Truncated SQLite record.');
      let value;if(t===7)value=view.getFloat64(p);else if(t<7){let x=0n;for(let i=0;i<n;i++)x=(x<<8n)|BigInt(payload[p+i]);if(payload[p]&128)x-=1n<<BigInt(n*8);value=Number(x);if(!Number.isSafeInteger(value))throw new Error('SQLite integer exceeds safe precision.')}
      else value=t%2?decoder.decode(payload.subarray(p,p+n)):payload.slice(p,p+n);p+=n;return value;
    });
  };
  const table=root=>{
    const rows=[],visited=new Set();
    const walk=n=>{
      if(visited.has(n))throw new Error('Cyclic SQLite table.');visited.add(n);
      const base=page(n),h=base+(n===1?100:0),type=b[h],count=v.getUint16(h+3),header=type===5?12:8;
      if(![5,13].includes(type)||h+header+count*2>base+usable)throw new Error('Unsupported or damaged LogTen table.');
      for(let i=0;i<count;i++){
        let p=base+v.getUint16(h+header+i*2);if(p<base||p>=base+usable)throw new Error('Invalid SQLite cell.');
        if(type===5){walk(v.getUint32(p));continue}
        const st={p},length=varint(b,st),rowid=varint(b,st);p=st.p;
        if(length>b.length)throw new Error('Invalid SQLite payload length.');
        const min=Math.floor((usable-12)*32/255)-23,k=min+(length-min)%(usable-4),local=length<=usable-35?length:k<=usable-35?k:min;
        if(p+local+(local<length?4:0)>base+usable)throw new Error('Invalid SQLite cell payload.');
        const payload=new Uint8Array(length);payload.set(b.subarray(p,p+local));let copied=local,next=local<length?v.getUint32(p+local):0;const seen=new Set();
        while(copied<length){if(seen.has(next))throw new Error('Cyclic SQLite overflow.');seen.add(next);const q=page(next),take=Math.min(length-copied,usable-4);payload.set(b.subarray(q+4,q+4+take),copied);copied+=take;next=v.getUint32(q)}
        rows.push({rowid,values:record(payload)});
      }
      if(type===5)walk(v.getUint32(h+8));
    };walk(root);return rows;
  };
  const schema=table(1).map(r=>r.values),tables=schema.filter(r=>r[0]==='table');
  const read=name=>{
    const spec=tables.find(r=>r[1]===name);if(!spec)return[];
    // Core Data uses flat column declarations, with no expressions/default clauses.
    const sql=String(spec[4]),body=sql.slice(sql.indexOf('(')+1,sql.lastIndexOf(')')),defs=body.split(',');
    const cols=defs.map(s=>s.trim().match(/^([A-Z_][A-Z0-9_]*)\s+(INTEGER|TIMESTAMP|FLOAT|VARCHAR|BLOB|REAL|TEXT|DOUBLE)\b/i)?.[1]);
    if(cols.some(x=>!x))throw new Error(`Unsupported LogTen schema: ${name}.`);
    return table(spec[3]).map(r=>Object.fromEntries(cols.map((key,i)=>[key,key==='Z_PK'?r.rowid:(r.values[i]??null)])));
  };
  return{read,tableCount:tables.length};
}
function logTenSqliteEntries(db){
  const index=t=>new Map(db.read(t).map(r=>[r.Z_PK,r])),types=index('ZAIRCRAFTTYPE'),aircraft=index('ZAIRCRAFT'),places=index('ZPLACE'),crew=index('ZFLIGHTCREW'),people=index('ZPERSON');
  const date=n=>n==null?'':new Date((Number(n)+978307200)*1000).toISOString(),clock=n=>date(n).slice(11,16);
  const place=id=>{const r=places.get(id)||{};return r.ZPLACE_IATAID||r.ZPLACE_ICAOID||r.ZPLACE_IDENTIFIER||''};
  const person=id=>{const r=people.get(id)||{};return r.ZPERSON_NAME||r.ZPERSON_FULLNAME||[r.ZPERSON_FIRSTNAME,r.ZPERSON_LASTNAME].filter(Boolean).join(' ')};
  const rows=db.read('ZFLIGHT');if(!rows.length)throw new Error('No LogTen ZFLIGHT records found.');
  return rows.map(r=>{
    const g=k=>r['ZFLIGHT_'+k],kind=Number(g('TYPE')),a=aircraft.get(g('AIRCRAFT'))||{},t=types.get(g('AIRCRAFTTYPE'))||{},c=crew.get(g('FLIGHTCREW'))||{};
    const e={logtenPk:r.Z_PK,logtenType:kind,logtenUniqueId:r.ZLOGTEN_UNIQUEID,date:date(g('FLIGHTDATE')).slice(0,10),dutyType:({0:'Flight',1:'Duty',2:'Ground Course',3:'Simulator',7:'STBY'})[kind],flightNo:g('FLIGHTNUMBER')||'',dep:place(g('FROMPLACE')),arr:place(g('TOPLACE')),type:t.ZAIRCRAFTTYPE_TYPE||'',reg:a.ZAIRCRAFT_AIRCRAFTID||'',remarks:g('REMARKS')||'',locked:!!g('ISLOCKED'),source:'logten',fieldSources:{},logtenCustom:{}};
    if(!e.dutyType)throw new Error(`Unsupported LogTen activity type ${kind}.`);
    for(const [key,col] of Object.entries(LOGTEN_TIME_COLUMNS)){e[key]=g(col)??null;e.fieldSources[key]='logten'}
    e.logtenCustom.totalInstrument=e.totalInstrument;
    for(const [key,col] of Object.entries({out:'ACTUALDEPARTURETIME',in:'ACTUALARRIVALTIME',off:'TAKEOFFTIME',on:'LANDINGTIME',schedOut:'SCHEDULEDDEPARTURETIME',schedIn:'SCHEDULEDARRIVALTIME',onDuty:'ONDUTYTIME',offDuty:'OFFDUTYTIME'})){e[key]=clock(g(col));if(g(col)!=null)e.fieldSources[key]='logten'}
    e.block=e.totalFlightTime;e.fieldSources.block='logten';e.rolePic=(e.pic||0)>0;e.role=e.rolePic?'PIC':(e.sic||0)>0?'SIC':'';e.instruction=(e.dualGiven||0)>0;
    for(const [key,col] of Object.entries({dayTakeoffs:'DAYTAKEOFFS',nightTakeoffs:'NIGHTTAKEOFFS',dayLandings:'DAYLANDINGS',nightLandings:'NIGHTLANDINGS',airTime:'DURATION',totalDuty:'TOTALDUTYTIME',groundInstruction:'GROUND',pax:'PAXCOUNT',fuelAboard:'FUELTOTALABOARD',fuelBurned:'FUELBURNED',fuelMinimum:'FUELMINIMUMFORDIVERSION'})){e[key]=g(col)??null;e.fieldSources[key]='logten'}
    for(const [key,col] of Object.entries({picName:'PIC',sicName:'SIC',instructorName:'INSTRUCTOR',studentName:'STUDENT',purserName:'PURSER',attendant1Name:'FLIGHTATTENDANT2',attendant2Name:'FLIGHTATTENDANT3',attendant3Name:'FLIGHTATTENDANT4'}))e[key]=person(c['ZFLIGHTCREW_'+col]);
    return e;
  });
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
return {LOGTEN_TIME_COLUMNS,LOGTEN_MIGRATION_MAGIC,logTenSqliteSnapshot,readLogTenSqlite,logTenSqliteEntries,parseLogTenMigrationPackage};
}
