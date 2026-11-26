export function createLogbookSearch({upper,getAirportIndex}){
  function logbookAirportText(code,airportIndex){
    const c=upper(code||''),a=airportIndex?.[c];return [c,a?.iata,a?.icao,a?.name,a?.city,a?.country].filter(Boolean).join(' ');
  }
  const logbookSearchIndex=new WeakMap();
  function logbookSearchText(f){
    const airportIndex=getAirportIndex();
    const cached=logbookSearchIndex.get(f);if(cached?.airports===airportIndex)return cached.text;

    const iso=String(f.date||'').slice(0,10),[year,month,day]=iso.split('-');
    const dateTerms=day?[iso,day+'/'+month+'/'+year,day+'/'+month+'/'+year.slice(-2),month+'/'+year]:[];
    const text=[...dateTerms,f.flightNo,f.dep,f.arr,f.reg,f.type,f.location,f.picName,f.sicName,f.soName,f.instructorName,f.role,f.remarks,logbookAirportText(f.dep,airportIndex),logbookAirportText(f.arr,airportIndex),logbookAirportText(f.location,airportIndex)].filter(Boolean).join(' ').toUpperCase();
    if(Object.isFrozen(f))logbookSearchIndex.set(f,{airports:airportIndex,text});return text;
  }
  function logbookMatchesQuery(f,q){
    const terms=String(q||'').trim().toUpperCase().split(/\s+/).filter(Boolean);if(!terms.length)return true;const hay=logbookSearchText(f);return terms.every(t=>hay.includes(t));
  }
  return {logbookMatchesQuery};
}
