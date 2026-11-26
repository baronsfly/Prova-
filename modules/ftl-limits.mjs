const FDP_TABLE=[
{a:360,b:809,v:[780,750,720,690,660,630,600,570,540]},
{a:810,b:839,v:[765,735,705,675,645,615,585,555,540]},
{a:840,b:869,v:[750,720,690,660,630,600,570,540,540]},
{a:870,b:899,v:[735,705,675,645,615,585,555,540,540]},
{a:900,b:929,v:[720,690,660,630,600,570,540,540,540]},
{a:930,b:959,v:[705,675,645,615,585,555,540,540,540]},
{a:960,b:989,v:[690,660,630,600,570,540,540,540,540]},
{a:990,b:1019,v:[675,645,615,585,555,540,540,540,540]},
{a:1020,b:1439,v:[660,630,600,570,540,540,540,540,540]},
{a:0,b:299,v:[660,630,600,570,540,540,540,540,540]},
{a:300,b:314,v:[720,690,660,630,600,570,540,540,540]},
{a:315,b:329,v:[735,705,675,645,615,585,555,540,540]},
{a:330,b:344,v:[750,720,690,660,630,600,570,540,540]},
{a:345,b:359,v:[765,735,705,675,645,615,585,555,540]}
];
export function createFtlLimits({sum,dateOnly,totalFlightMins,startOfDays,flightRows,tzParts,airport,zuluDate,timeSpanMins,rosterGroups}){
  function fdpLimit(localStartMins,sectors){const row=FDP_TABLE.find(r=>localStartMins>=r.a&&localStartMins<=r.b);if(!row)return 0;const idx=Math.max(0,Math.min(8,(sectors<=2?0:sectors-2)));return row.v[idx]}
  function rollingFlight(n,now=new Date()){
    const c=startOfDays(n,now);
    return sum(flightRows(),f=>{const d=dateOnly(f.date);return d>=c&&d<=now?totalFlightMins(f):0});
  }
  function rollingDuty(n,now=new Date(),sessions=[]){
    const start=startOfDays(n,now);
    return sessions.reduce((total,s)=>{
      const a=new Date(Math.max(s.startDateTime.getTime(),start.getTime())),b=new Date(Math.min(s.endDateTime.getTime(),now.getTime()));
      return total+(b>a?Math.round((b-a)/60000):0);
    },0);
  }
  function calendarYearFlight(now=new Date()){const y=now.getUTCFullYear();return sum(flightRows(),f=>{const d=dateOnly(f.date);return d.getUTCFullYear()===y&&d<=now?totalFlightMins(f):0})}
  function rollingCalendar12Flight(now=new Date()){const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1));return sum(flightRows(),f=>{const d=dateOnly(f.date);return d>=start&&d<=now?totalFlightMins(f):0})}
  function ftlLimitState(value,limit){
    const remaining=Number(limit||0)-Number(value||0);
    if(remaining<0)return{remaining,state:'red',textClass:'danger-text'};
    if(remaining<=300)return{remaining,state:'yellow',textClass:'warning'};
    return{remaining,state:'green',textClass:'success'};
  }
  async function sessionFdp(s){
    if(!s)return null;const dep=s.firstFlight?.dep||s.dep||'',a=dep?await airport(dep):null,localM=tzParts(s.startDateTime,a?.tz||'UTC'),sectors=Math.max(1,Number(s.sectors)||1),limit=fdpLimit(localM,sectors),margin=limit-s.minutes;
    return{date:s.reportDate,minutes:s.minutes,sectors,limit,margin,status:margin<0?'VIOLATION':margin<=300?'CAUTION':'OK',startDateTime:s.startDateTime};
  }
  async function rosterFdp(g){
    if(!g?.date||!g.start)return null;const start=zuluDate(g.date,g.start);if(!start)return null;const a=g.dep?await airport(g.dep):null,localM=tzParts(start,a?.tz||'UTC'),sectors=Math.max(1,Number(g.sectors)||1),minutes=g.end?timeSpanMins(g.start,g.end):0,limit=fdpLimit(localM,sectors),margin=limit-minutes;
    return{date:g.date,minutes,sectors,limit,margin,status:margin<0?'VIOLATION':margin<=300?'CAUTION':'OK',startDateTime:start};
  }
  async function nextFdpCandidate(sessions,now=new Date()){
    const futureSession=sessions.filter(s=>s.sectors>0&&s.startDateTime>now).sort((a,b)=>a.startDateTime-b.startDateTime)[0]||null;
    let futureRoster=null;
    const group=rosterGroups().filter(g=>g.kind==='flight').map(g=>({...g,_start:zuluDate(g.date,g.start)})).filter(g=>g._start&&g._start>now).sort((a,b)=>a._start-b._start)[0]||null;
    if(group)futureRoster=await rosterFdp(group);
    const entryCandidate=futureSession?await sessionFdp(futureSession):null;
    if(entryCandidate&&futureRoster)return entryCandidate.startDateTime<=futureRoster.startDateTime?entryCandidate:futureRoster;
    return entryCandidate||futureRoster;
  }
  return {fdpLimit,rollingFlight,rollingDuty,calendarYearFlight,rollingCalendar12Flight,ftlLimitState,sessionFdp,rosterFdp,nextFdpCandidate};
}
