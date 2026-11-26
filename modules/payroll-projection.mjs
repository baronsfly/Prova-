export function tierPay(hours,st){hours=Math.max(0,Number(hours)||0);const a=Number(st.t1Max)||0,b=Math.max(a,Number(st.t2Max)||a),c=Math.max(b,Number(st.t3Max)||b);let left=hours,total=0,h=Math.min(left,a);total+=h*Number(st.t1Rate||0);left-=h;h=Math.min(Math.max(0,left),b-a);total+=h*Number(st.t2Rate||0);left-=h;h=Math.min(Math.max(0,left),c-b);total+=h*Number(st.t3Rate||0);left-=h;if(left>0)total+=left*Number(st.t4Rate||0);return total}
export function seniorityPct(st,month){if(!st.joinDate)return 0;const start=new Date(`${st.joinDate}T00:00:00Z`),[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,0,23,59,59));const years=(end-start)/(365.2425*86400000);if(years>=25&&st.seniority25!=null)return Number(st.seniority25);if(years>=5&&years<=12&&st.seniority5!=null)return Number(st.seniority5);return years>12?Number(st.seniority12||0):years>2?Number(st.seniority2||0):0}
export function fixedSalaryAmount(st,seniority){return Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0)}
export function projectPayroll({st,rosterPrimary,fs,tripResults,extras,dayOffEvents,month},rules){
  const {creditMinsForEntry,instructionSectorForPayroll,isSim,userIsSimTrainer,isFlight}=rules;
  const sourceName=rosterPrimary?'Roster':(fs.some(f=>String(f.source||'').toLowerCase()==='logten')?'LogTen Pro':'Logbook'),
    dayOffCount=dayOffEvents.length,
    calculatedCreditMins=fs.reduce((n,f)=>n+creditMinsForEntry(f,fs),0),
    nonFlightCredit=fs.reduce((acc,f)=>{const c=creditMinsForEntry(f,fs);if(!isFlight(f)&&c>0){acc.count++;acc.mins+=c}return acc},{count:0,mins:0}),
    creditMins=calculatedCreditMins,
    training=fs.filter(instructionSectorForPayroll).length,
    sims=fs.filter(f=>isSim(f)&&userIsSimTrainer(f)).length,
    layMins=tripResults.reduce((n,t)=>n+(Number(t.cashAmount||0)>0?0:Number(t.layover)||0),0),
    layHours=layMins/60,
    seniorPct=seniorityPct(st,month),
    seniority=Number(st.base||0)*seniorPct/100,
    fixed=Number(st.base||0)+Number(st.allowance||0)+Number(st.transport||0)+seniority+Number(st.pos||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(st.deduction||0),
    flightPay=tierPay(creditMins/60,st),
    trainingPay=training*Number(st.trainingRate||0),
    layoverPay=tripResults.reduce((n,t)=>n+(Number(t.allowance)||0),0),
    simPay=sims*Number(st.simAllowance||0),
    dayOffPay=dayOffCount*Number(st.dayOffRate||0),
    arrears=Number(extras.arrears||0),
    total=fixed+flightPay+trainingPay+layoverPay+simPay+dayOffPay+arrears;

  return{st,extras,sourceName,rosterPrimary,dayOffEvents,dayOffCount,creditMins,nonFlightCreditCount:nonFlightCredit.count,nonFlightCreditMins:nonFlightCredit.mins,training,sims,layMins,layHours,tripResults,seniorPct,seniority,fixed,flightPay,trainingPay,layoverPay,simPay,dayOffPay,arrears,total};
}


// v12.5 MAC payroll model.
// IBC calculation above is intentionally unchanged. MAC starts from the same contractual
// amounts, applies the taxability observed in 2026 Air Arabia Maroc payslips, and grosses
// protected regular taxable pay so that its net target is preserved. Positive arrears /
// adjustments are treated as taxable, non-protected extra pay.
const MAC_TAX={cnssRate:.0448,cnssCap:6000,amoRate:.0226,healthRate:.0112,cimrRate:.0375,professionalExpenseMonthlyCap:2917,professionalExpenseRate:.45,companyTopIrRate:.37,companyTopIrDeduction:2272.92,familyDeductionMonthlyPerPerson:41.67};
function macIrFromRni(rni,dependents=0){
  rni=Math.max(0,Number(rni)||0);dependents=Math.max(0,Math.min(6,Math.trunc(Number(dependents)||0)));
  let ir=0;
  // The upper bracket reproduces the regular Jul/Aug 2026 company payslips supplied for validation.
  // Lower brackets retain the 2025/2026 Moroccan progressive schedule.
  if(rni<=3333.33)ir=0;
  else if(rni<=5000)ir=rni*.10-333.33;
  else if(rni<=6666.67)ir=rni*.20-833.33;
  else if(rni<=8333.33)ir=rni*.30-1500;
  else if(rni<=15000)ir=rni*.34-1833.33;
  else ir=rni*MAC_TAX.companyTopIrRate-MAC_TAX.companyTopIrDeduction;
  ir-=dependents*MAC_TAX.familyDeductionMonthlyPerPerson;
  return Math.max(0,ir);
}
function macTaxFromGross(taxableGross,cimrBase,dependents=0){
  taxableGross=Math.max(0,Number(taxableGross)||0);cimrBase=Math.max(0,Math.min(taxableGross,Number(cimrBase)||0));
  const cnss=Math.min(taxableGross,MAC_TAX.cnssCap)*MAC_TAX.cnssRate;
  const amo=taxableGross*MAC_TAX.amoRate;
  const health=taxableGross*MAC_TAX.healthRate;
  const cimr=cimrBase*MAC_TAX.cimrRate;
  const contributions=cnss+amo+health+cimr;
  const professionalExpense=Math.min(taxableGross*MAC_TAX.professionalExpenseRate,MAC_TAX.professionalExpenseMonthlyCap);
  const netTaxable=Math.max(0,taxableGross-contributions-professionalExpense);
  const ir=macIrFromRni(netTaxable,dependents);
  return{cnss,amo,health,cimr,contributions,professionalExpense,netTaxable,ir};
}
export function macPayrollProjection(p,dependents){
  const st=p.st;
  // Confirmed/observed non-taxable categories in the supplied MAC payslips:
  // transport, telephone, uniform/salissure, meal and layover/DHD allowance.
  const nonTaxableRegular=Number(st.transport||0)+Number(st.telephone||0)+Number(st.uniform||0)+Number(st.meal||0)+Number(p.layoverPay||0);
  const postTaxFixed=Number(st.deduction||0);
  // Base + seniority are CIMR-bearing. Other regular protected pay is taxable but not CIMR-bearing.
  const cimrTarget=Math.max(0,Number(st.base||0)+Number(p.seniority||0));
  const otherTaxableTarget=Math.max(0,Number(st.allowance||0)+Number(st.pos||0)+Number(p.flightPay||0)+Number(p.trainingPay||0)+Number(p.simPay||0)+Number(p.dayOffPay||0));
  const regularTarget=Number(p.total||0)-Number(p.arrears||0);
  const factorCimr=1/((1-MAC_TAX.amoRate-MAC_TAX.healthRate-MAC_TAX.cimrRate)*(1-MAC_TAX.companyTopIrRate));
  const factorOther=1/((1-MAC_TAX.amoRate-MAC_TAX.healthRate)*(1-MAC_TAX.companyTopIrRate));
  const baseCimrGross0=cimrTarget*factorCimr,otherGross0=otherTaxableTarget*factorOther;
  function regularAt(scale){
    const cimrGross=baseCimrGross0*scale,otherGross=otherGross0*scale,taxableGross=cimrGross+otherGross;
    const tax=macTaxFromGross(taxableGross,cimrGross,dependents);
    const net=taxableGross+nonTaxableRegular+postTaxFixed-tax.contributions-tax.ir;
    return{scale,cimrGross,otherGross,taxableGross,tax,net};
  }
  let lo=.25,hi=3;
  for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(regularAt(mid).net<regularTarget)lo=mid;else hi=mid}
  const regular=regularAt((lo+hi)/2);
  const taxableExtra=Math.max(0,Number(p.arrears||0)),postTaxExtra=Math.min(0,Number(p.arrears||0));
  const taxableGross=regular.taxableGross+taxableExtra,cimrBase=regular.cimrGross;
  const tax=macTaxFromGross(taxableGross,cimrBase,dependents);
  const grossPayroll=taxableGross+nonTaxableRegular+postTaxFixed+postTaxExtra;
  const netPayroll=grossPayroll-tax.contributions-tax.ir;
  return{...p,regime:'MAC',dependents,contractTarget:p.total,regularTarget,nonTaxableRegular,postTaxFixed,cimrTarget,otherTaxableTarget,cimrGross:regular.cimrGross,otherTaxableGross:regular.otherGross,taxableExtra,postTaxExtra,taxableGross,cimrBase,grossPayroll,netPayroll,tax,grossUpScale:regular.scale};
}
