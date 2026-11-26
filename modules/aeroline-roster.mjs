export function createAerolineRoster({upper,appSettings,rosterFlightLabel,rosterFlightDigits,normalDate,timeSpanMins,shiftTime,mins,rosterActivitySameIdentity}){
const AEROLINE_VALIDATION_SKIP=new Set(['CMC','A320/IR','JSIM','TRN','WP']);
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
  if(!sim||!tm)return{picName:'',sicName:'',instructorName:'',trainerType:'',selfIsTrainer:false};
  const joining=aerolinePeople(tm.joiningPilot),trainers=aerolinePeople(tm.trainerName),self=aerolineSelfName(root);
  const selfTrainer=trainers.find(name=>aerolineSamePerson(name,self))||'';
  const singleTrainer=trainers.length===1?trainers[0]:'';
  return{
    picName:upper(joining[0]||''),
    sicName:upper(joining[1]||''),
    instructorName:upper(selfTrainer||singleTrainer),
    trainerType:upper(tm.trainerType||''),
    selfIsTrainer:!!selfTrainer
  };
}
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
          aerolineLineTraining:lineTraining,aerolineAlc:alc,instructorName:'',instruction:lineTraining,remarks:trainingLabel||''
        });
      }
    }

    let eventCode=upper(r?.eventCode||'');
    if(!eventCode&&upper(r?.airportStandby)==='Y')eventCode='STBY';
    if(eventCode){
      const key=aerolineEventKey(r,eventCode);
      if(!seenEvents.has(key)){
        seenEvents.add(key);
        const start=aerolineDateTime(['OFF','ALV','SLV'].includes(eventCode)?(r.leaveStartTimeString||r.eventStartTimeString):r.eventStartTimeString);
        const end=aerolineDateTime(['OFF','ALV','SLV'].includes(eventCode)?(r.leaveEndTimeString||r.eventEndTimeString):r.eventEndTimeString);
        if(eventCode==='OFF'){
          if(start.date)daysOff.push({aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),date:start.date,type:'Day OFF',report:'',end:'',minutes:0,notes:'AeroLINE • OFF',source:'aeroline',aerolineRosterPlanned:true});
        }else if(eventCode==='ALV'||eventCode==='SLV'){
          if(start.date)activities.push({aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType:eventCode==='ALV'?'Annual Leave':'Sick Leave',date:start.date,onDuty:'',offDuty:'',totalDuty:0,credit:0,remarks:`AeroLINE • ${eventCode}`,source:'aeroline',aerolineRosterPlanned:true});
        }else if(eventCode==='SOD'){
          if(start.date)activities.push({aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),date:start.date,dutyType:'Ground Course',courseType:'SOD',trainerType:'SOD',onDuty:start.time,offDuty:end.time,source:'aeroline',aerolineRosterPlanned:true});
        }else if(eventCode==='MED'){
          if(start.date)activities.push({aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType:'Duty',date:start.date,onDuty:start.time,offDuty:end.time,totalDuty:timeSpanMins(start.time,end.time),credit:0,location:upper(r.eventEndLoc||r.eventStartLoc||appSettings().homeBase||'CMN'),remarks:'AeroLINE • MED • Medical examination',source:'aeroline',aerolineRosterPlanned:true,fieldSources:{onDuty:'aeroline',offDuty:'aeroline'}});
        }else if(eventCode==='DHD'||eventCode==='DHP'||eventCode==='HSBY'||eventCode==='STBY'){
          if(start.date){const positioning=eventCode==='DHD'||eventCode==='DHP';activities.push({
            aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType:positioning?eventCode:'STBY',date:start.date,
            flightNo:'',dep:upper(r.eventStartLoc||''),arr:upper(r.eventEndLoc||''),type:upper(r.fleetType||''),reg:aerolineRegistration(r),
            schedOut:positioning?start.time:'',schedIn:positioning?end.time:'',schedBlock:positioning?timeSpanMins(start.time,end.time):0,
            onDuty:start.time,offDuty:end.time,totalDuty:timeSpanMins(start.time,end.time),fieldSources:{onDuty:'aeroline',offDuty:'aeroline',schedOut:'aeroline',schedIn:'aeroline',totalDuty:'calculated'},
            out:'',off:'',on:'',in:'',block:null,credit:0,rolePic:false,instruction:false,simInstructor:false,simExaminer:false,night:null,sim:'no',ifr:'',pf:'no',approachType:'',
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
          const tm=aerolineTrainingForActivity(root,r,start),sim=aerolineIsSimulatorTraining(r,tm),dutyType=sim?'Simulator':'Ground Course',crew=aerolineTrainingCrewFields(root,tm,sim),trainerType=upper(tm?.trainerType||crew.trainerType||'');
          const fullName=upper(r.trainingSlotName||r.trainingProgramDesc||tm?.trainingTypeDesc||r.trainingProgramCode||'AEROLINE TRAINING');
          const desc=upper(r.trainingProgramDesc||tm?.trainingTypeDesc||'');
          const trainingLocationDirect=sim?upper(tm?.trainLocOrFlight||''):upper(r.trainingLocation||'');
          activities.push({
            aerolineKey:key,aerolineBlockId:String(r.crewScheduleBlockId||''),dutyType,date:start.date,flightNo:'',location:sim?trainingLocationDirect:'',dep:trainingLocationDirect,arr:'',type:upper(r.fleetType||''),reg:aerolineRegistration(r),
            schedOut:start.time,schedIn:end.time,schedBlock:timeSpanMins(start.time,end.time),onDuty:shiftTime(start.time,sim?-90:-60),offDuty:shiftTime(end.time,30),fieldSources:{schedOut:'aeroline',schedIn:'aeroline',schedBlock:'calculated',onDuty:'calculated',offDuty:'calculated'},out:'',off:'',on:'',in:'',block:null,
            simulatorTime:sim?timeSpanMins(start.time,end.time):null,totalDuty:timeSpanMins(shiftTime(start.time,sim?-90:-60),shiftTime(end.time,30)),credit:null,
            rolePic:false,instruction:false,simInstructor:sim&&crew.selfIsTrainer===true,simExaminer:false,night:null,sim:sim?'yes':'no',ifr:'',pf:'no',approachType:'',dayTakeoffs:0,nightTakeoffs:0,dayLandings:0,nightLandings:0,
            courseType:upper(r.trainingProgramCode||tm?.trainingType||r.trainingSlotName||''),remarks:desc&&desc!==fullName?`${fullName} • ${desc}`:fullName,source:'aeroline',aerolineRosterPlanned:true,rosterHidden:false,locked:false,
            picName:crew.picName,sicName:crew.sicName,soName:'',instructorName:crew.instructorName,aerolineTrainerType:trainerType,
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
return {aerolineRoot,aerolineDateTime,aerolineMonthLabel,aerolineFlightKey,aerolineEventKey,aerolineTrainingKey,aerolineNormalizePersonName,aerolineSamePerson,aerolinePeople,aerolineSelfName,aerolineOtherCrew,aerolineRegistration,aerolineTrainingMeta,aerolineTrainingForFlight,aerolineTrainingForActivity,aerolineTrainingLabel,aerolineIsAlc,aerolineIsLineTraining,aerolineIsSimulatorTraining,aerolineTrainingCrewFields,aerolineValidationCategory,parseAerolineValidations,parseAerolineRosterObject,aerolineWithinRange,aerolineTimeDistance,aerolineRosterMatch,aerolineActivityMatch,aerolineThanksDates};
}
