export function createExpiryPresentation({upper,isoDateLocal,displayDate}){
  function expiryDaysRemaining(expiry,now=new Date()){
    if(!expiry)return null;
    const end=new Date(`${expiry}T00:00:00`);
    if(!Number.isFinite(end.getTime()))return null;
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    return Math.round((Date.UTC(end.getFullYear(),end.getMonth(),end.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/86400000);
  }
  function expiryStatus(expiry,now=new Date(),record={}){
    const days=expiryDaysRemaining(expiry,now);
    if(days===null)return{days:null,state:'unknown',label:'NO EXPIRY'};
    if(days<0)return{days,state:'expired',label:`EXPIRED ${Math.abs(days)} DAY${Math.abs(days)===1?'':'S'} AGO`};
    const title=upper([record.courseType,record.name,record.title,record.ratingType,record.licenseType,record.englishType,expiryTitle(record)].filter(Boolean).join(' '));
    const monthEnd=new Date(now.getFullYear(),now.getMonth()+2,0).getDate(),monthAhead=new Date(now.getFullYear(),now.getMonth()+1,Math.min(now.getDate(),monthEnd));
    const threshold=record.category==='instructor'?365:/OPC|LPC/.test(title)?90:record.category==='medical'?45:/EPC/.test(title)?expiryDaysRemaining(isoDateLocal(monthAhead),now):15;
    if(days<=threshold)return{days,state:'warning',label:`${days} DAY${days===1?'':'S'} REMAINING`};
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
  return {expiryStatus,expiryCategoryLabel,expiryTitle,expirySubtitle};
}
