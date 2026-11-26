// Read-only comparison: operational values always come from PilotLog's Core projection.
export function followingMonth(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return '';
  const [year,m]=month.split('-').map(Number);
  return `${year+(m===12)}-${String(m===12?1:m+1).padStart(2,'0')}`;
}
const amount=s=>Number(String(s||'').replace(/,/g,''));
export function parseIbcPayslip(text){
  const source=String(text||''),month=source.match(/For\s+Period\s*:\s*(0[1-9]|1[0-2])\s*\/\s*(\d{4})/i);
  if(!month)return null;
  const lines=source.split(/\n/),codes={};
  for(const line of lines){
    for(const code of ['1000','1001','1002','1005','1008','1010','1011','1014','3019','3037','3038','3116','3012','3062']){
      const match=line.match(new RegExp(`(?:^|\\s|\\|)${code}\\s+(.+)`));
      if(!match)continue;
      const chunk=match[1].split(/\|\||\s+\d{4}\s+[A-Za-z]/)[0];
      const amounts=[...chunk.matchAll(/-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b/g)].map(x=>amount(x[0]));
      if(amounts.length)codes[code]=amounts.at(-1);
    }
  }
  const summary=label=>{
    const line=lines.find(x=>new RegExp(`\\b${label}\\s*[:|]`,'i').test(x));
    const tail=line?.match(new RegExp(`\\b${label}\\s*[:|]\\s*([\\d,]+\\.\\d{2})`,'i'));
    return tail?amount(tail[1]):null;
  };
  const earnings=summary('Earnings'),deductions=summary('Deductions'),net=summary('Bank transfer');
  const earned=['1000','1001','1002','1005','1008','1010','1011','1014','3019','3037','3038','3116','3012'].reduce((n,k)=>n+(codes[k]||0),0);
  const complete=Number.isFinite(earnings)&&Number.isFinite(deductions)&&Number.isFinite(net)&&Math.abs(earned-earnings)<.02&&Math.abs(earnings-deductions-net)<.02;
  return {month:`${month[2]}-${month[1]}`,codes,earnings,deductions,net,complete};
}
export function compareIbcPayslip(parsed,p){
  if(!parsed?.complete||!p)return null;
  const c=parsed.codes,found=keys=>keys.every(k=>Number.isFinite(c[k]));
  const fixedCodes=['1000','1001','1002','1005','1008','1010','1011','1014'];
  const fixedPaid=found([...fixedCodes,'3062'])?fixedCodes.reduce((n,k)=>n+c[k],0)-c['3062']:null;
  const entries=[
    ['Fix Salary',Number(p.fixed),fixedPaid],
    ['Credit H',Number(p.flightPay),c['3012']],
    ['Training sectors',Number(p.trainingPay),c['3019']??0],
    ['Layover + Day OFF',Number(p.layoverPay)+Number(p.dayOffPay),c['3116']??0],
    ['Simulator allowance',Number(p.simPay),c['3038']??0],
    ['Arrears / adjustments',Number(p.arrears),c['3037']??0]
  ];
  const rows=entries.map(([label,expected,paid])=>({label,expected,paid,
    difference:Number.isFinite(expected)&&Number.isFinite(paid)?Math.round((expected-paid)*100)/100:null}));
  const expected=Number(p.total),paid=parsed.net;
  const combined=c['3116']??0;
  const remaining=combined-Number(p.dayOffPay);
  const hourlyRate=Number(p.st?.layoverRate);
  const layoverPaidMinutes=remaining>=0&&hourlyRate>0?Math.round(60*remaining/hourlyRate):null;
  return {rows,expected,paid,layoverPaidMinutes,difference:Number.isFinite(expected)&&Number.isFinite(paid)?Math.round((expected-paid)*100)/100:null,
    hours:Number.isFinite(c['3012'])?inferCreditMinutes(c['3012'],p.st):null,
    training:Number.isFinite(c['3019'])&&Number(p.st?.trainingRate)>0?c['3019']/Number(p.st.trainingRate):null,
    sims:Number.isFinite(c['3038'])&&Number(p.st?.simAllowance)>0?c['3038']/Number(p.st.simAllowance):null};
}
export function inferCreditMinutes(pay,settings){
  let remaining=Number(pay);
  if(!Number.isFinite(remaining)||remaining<0)return null;
  const caps=[settings?.t1Max,settings?.t2Max,settings?.t3Max].map(Number),rates=[settings?.t1Rate,settings?.t2Rate,settings?.t3Rate,settings?.t4Rate].map(Number);
  if(caps.some(x=>!Number.isFinite(x))||rates.some(x=>!Number.isFinite(x)||x<=0))return null;
  let h=0,previous=0;
  for(let i=0;i<3;i++){
    const cap=Math.max(0,caps[i]-previous),portion=Math.min(remaining,cap*rates[i]);
    h+=portion/rates[i];remaining-=portion;previous=caps[i];
  }
  h+=remaining/rates[3];
  return Math.round(h*60);
}
