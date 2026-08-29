/* Payroll */
function monthNow(){return new Date().toISOString().slice(0,7)}
function inMonth(date,month){return String(date||'').slice(0,7)===month}
function money(v){return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0)}
function trainingSector(f){return isFlight(f)&&f.instructionType==='Flight Instruction'}
function payrollCreditMins(f){return entryCreditMins(f)}
function tierPay(hours,st){hours=Math.max(0,Number(hours)||0);const a=Number(st.t1Max)||0,b=Math.max(a,Number(st.t2Max)||a),c=Math.max(b,Number(st.t3Max)||b);let left=hours,total=0,h=Math.min(left,a);total+=h*Number(st.t1Rate||0);left-=h;h=Math.min(Math.max(0,left),b-a);total+=h*Number(st.t2Rate||0);left-=h;h=Math.min(Math.max(0,left),c-b);total+=h*Number(st.t3Rate||0);left-=h;if(left>0)total+=left*Number(st.t4Rate||0);return total}
function seniorityPct(st,month){if(!st.joinDate)return 0;const start=new Date(`${st.joinDate}T00:00:00Z`),[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0,23,59,59));const years=(end-start)/(365.2425*86400000);return years>12?Number(st.seniority12||0):years>2?Number(st.seniority2||0):0}
function monthExtras(month){const all=loadObject(PAY_MONTH_KEY,{});return {dayOffCount:0,arrears:0,dayOffRemarks:{},...(all[month]||{})}}
function saveMonthExtras(month,x){const all=loadObject(PAY_MONTH_KEY,{});all[month]=x;all._updatedAt=new Date().toISOString();localStorage.setItem(PAY_MONTH_KEY,JSON.stringify(all))}

function dayOffEventsForMonth(month){
  const flagged=load(FLIGHTS_KEY)
    .filter(f=>inMonth(f.date,month)&&f.callFromDayOff)
    .sort((a,b)=>`${a.date}${a.onDuty||a.schedOut||a.out||''}`.localeCompare(`${b.date}${b.onDuty||b.schedOut||b.out||''}`));

  const byDate=new Map();
  flagged.forEach(f=>{
    if(!byDate.has(f.date))byDate.set(f.date,{date:f.date,entries:[]});
    byDate.get(f.date).entries.push(f);
  });
  return [...byDate.values()];
}
function saveDayOffRemark(month,date,remark){
  const ex=monthExtras(month);
  ex.dayOffRemarks={...(ex.dayOffRemarks||{}),[date]:String(remark||'')};
  saveMonthExtras(month,ex);
}
function dayOffEventLabel(ev){
  const entries=ev.entries||[],first=entries[0]||{};
  const flights=entries.filter(isFlight);
  if(flights.length){
    const a=flights[0],b=flights.at(-1);
    return `${a.dep||''}${b.arr?' → '+b.arr:''}${a.flightNo?' • '+a.flightNo:''}`;
  }
  return `${first.dutyType||'Duty'}${first.dep?' • '+first.dep:''}`;
}

function payrollData(month){
  const st=paySettings(),
    fs=load(FLIGHTS_KEY).filter(f=>inMonth(f.date,month)),
    trips=load(TRIPS_KEY).filter(t=>String(t.start||'').slice(0,7)===month),
    extras=monthExtras(month),
    dayOffEvents=dayOffEventsForMonth(month),
    dayOffCount=dayOffEvents.length,
    creditMins=sum(fs,payrollCreditMins),
    training=fs.filter(trainingSector).length,
    sims=fs.filter(isSim).length,
    layMins=sum(trips,t=>t.layover),
    layHours=layMins/60,
    seniorPct=seniorityPct(st,month),
    seniority=Number(st.base||0)*seniorPct/100,
    fixed=Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0),
    flightPay=tierPay(creditMins/60,st),
    trainingPay=training*Number(st.trainingRate||0),
    layoverPay=layHours*Number(st.layoverRate||0),
    simPay=sims*Number(st.simAllowance||0),
    dayOffPay=dayOffCount*Number(st.dayOffRate||0),
    arrears=Number(extras.arrears||0),
    total=fixed+flightPay+trainingPay+layoverPay+simPay+dayOffPay+arrears;

  return{st,extras,dayOffEvents,dayOffCount,creditMins,training,sims,layMins,layHours,seniorPct,seniority,fixed,flightPay,trainingPay,layoverPay,simPay,dayOffPay,arrears,total};
}
function fxStore(){return loadObject(FX_KEY,{})}
function dateKey(d){return d.toISOString().slice(0,10)}
async function fetchFxForDate(dateStr){for(let back=0;back<8;back++){const d=new Date(`${dateStr}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-back);const key=dateKey(d);try{const r=await fetch(`https://${key}.currency-api.pages.dev/v1/currencies/eur.json`,{cache:'no-store'});if(!r.ok)continue;const j=await r.json(),rate=Number(j?.eur?.mad);if(rate>0)return{rate,date:j.date||key}}catch{}}throw new Error('FX unavailable')}
async function fetchLatestFx(){const r=await fetch('https://latest.currency-api.pages.dev/v1/currencies/eur.json',{cache:'no-store'});if(!r.ok)throw new Error('FX unavailable');const j=await r.json(),rate=Number(j?.eur?.mad);if(!(rate>0))throw new Error('MAD rate unavailable');return{rate,date:j.date||today()}}
async function getMonthFx(month){
  const store=fxStore();if(store[month]?.locked)return store[month];
  const [y,m]=month.split('-').map(Number),
    target=`${y}-${String(m).padStart(2,'0')}-30`,
    now=new Date(),
    targetDate=new Date(`${target}T23:59:59Z`),
    nextMonth=new Date(Date.UTC(y,m,1));

  // Until the month satisfies the locking rule, including future payroll months,
  // always show the most recent available EUR/MAD rate as a provisional LIVE rate.
  if(now<targetDate&&now<nextMonth)return{...(await fetchLatestFx()),locked:false,provisional:true};

  const got=await fetchFxForDate(target),locked={...got,locked:true};
  store[month]=locked;localStorage.setItem(FX_KEY,JSON.stringify(store));return locked;
}
const PAY_MAP={setJoinDate:'joinDate',setBase:'base',setAllowance:'allowance',setTransport:'transport',setPos:'pos',setTelephone:'telephone',setUniform:'uniform',setMeal:'meal',setDeduction:'deduction',setSeniority2:'seniority2',setSeniority12:'seniority12',setT1Max:'t1Max',setT1Rate:'t1Rate',setT2Max:'t2Max',setT2Rate:'t2Rate',setT3Max:'t3Max',setT3Rate:'t3Rate',setT4Rate:'t4Rate',setTrainingRate:'trainingRate',setLayoverRate:'layoverRate',setSimAllowance:'simAllowance',setSimCredit:'simCredit',setGroundCredit:'groundCredit',setDayOffRate:'dayOffRate'};
function fillPaySettings(){const st=paySettings();Object.entries(PAY_MAP).forEach(([id,k])=>{if($(id))$(id).value=st[k]})}
function readPaySettings(){const st={};Object.entries(PAY_MAP).forEach(([id,k])=>st[k]=k==='joinDate'?$(id).value:Number($(id).value||0));return st}
let payrollRenderToken=0;
async function renderPayroll(){
  const token=++payrollRenderToken,month=$('payrollMonth').value||monthNow();
  $('payrollMonth').value=month;
  const ex=monthExtras(month),p=payrollData(month);

  $('payArrears').value=ex.arrears||0;
  $('payTotalDhm').textContent=`${money(p.total)} DHM`;
  $('payTotalEur').textContent='…';

  $('payBreakdown').innerHTML=[
    ['Fixed salary','',p.fixed],
    ['Seniority',money(p.seniorPct)+'%',p.seniority],
    ['Credit H',fmt(p.creditMins),p.flightPay],
    ['Training sectors',String(p.training),p.trainingPay],
    ['Layover',fmt(p.layMins),p.layoverPay],
    ['Simulator allowance',String(p.sims),p.simPay],
    ['Call from Day OFF',String(p.dayOffCount),p.dayOffPay],
    ['Arrears / adjustments','',p.arrears]
  ].map(([n,q,v],i)=>`<div class="pay-breakdown-row ${i%2?'pay-breakdown-alt':''}">
    <span class="pay-breakdown-label">${esc(n)}</span>
    <span class="pay-breakdown-qty">${esc(q)}</span>
    <b class="money pay-breakdown-amount">${money(v)} DHM</b>
  </div>`).join('');

  const remarks=p.extras.dayOffRemarks||{};
  $('payDayOffDetails').innerHTML=p.dayOffEvents.length?p.dayOffEvents.map(ev=>{
    const remark=remarks[ev.date]||'';
    return `<div class="pay-dayoff-row">
      <div class="pay-dayoff-main">
        <b>${esc(displayDate(ev.date))}</b>
        <div class="small">${esc(dayOffEventLabel(ev))}</div>
        <div class="small">${money(p.st.dayOffRate||0)} DHM premium</div>
      </div>
      <div class="pay-dayoff-remark-wrap">
        <label>Remark</label>
        <input class="pay-dayoff-remark" data-dayoff-date="${esc(ev.date)}" value="${esc(remark)}" placeholder="e.g. Not paid / email sent">
      </div>
    </div>`;
  }).join(''):'<div class="empty">No Day OFF calls in this payroll month.</div>';

  $('payFxStatus').textContent='Loading EUR/MAD…';
  try{
    const fx=await getMonthFx(month);
    if(token!==payrollRenderToken)return;
    if(!fx.rate){
      $('payTotalEur').textContent='—';
      $('payFxStatus').textContent='FX not available for a future month.';
      return
    }
    $('payTotalEur').textContent=`≈ €${money(p.total/fx.rate)}`;
    $('payFxStatus').innerHTML=`EUR/MAD ${money(fx.rate)} • ${esc(displayDate(fx.date))} ${fx.locked?'<span class="fx-lock">LOCKED</span>':'<span class="fx-live">LIVE</span>'}${fx.provisional?' • provisional until lock rule':''}`;
  }catch{
    $('payTotalEur').textContent='—';
    $('payFxStatus').textContent='FX unavailable. Payroll in DHM is unaffected.';
  }
}

