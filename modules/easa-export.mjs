export function createEasaExport({$,coreActivityRows,isFlight,isSim,activityIncludedInResults,simulatorCompleted,entryHasTimeValue,numericTime,timeGroupFinalValue,upper,fmt,sum,durMins,totalFlightMins,picMins,sicMins,flightInstrMins,today,host=globalThis}){
const EASA_ROWS_PER_PAGE=26;

function euDate(v){
  const s=String(v||'').slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:s;
}
function blankIfZero(v){const n=Number(v)||0;return n>0?fmt(n):''}
function blankCount(v){const n=Number(v)||0;return n>0?String(n):''}
function experienceFlights(){
  return coreActivityRows().filter(f=>isFlight(f)&&activityIncludedInResults(f)).sort((a,b)=>`${a.date||''}${a.off||a.out||a.schedOut||''}`.localeCompare(`${b.date||''}${b.off||b.out||b.schedOut||''}`));
}
function experienceSims(){
  return coreActivityRows().filter(f=>isSim(f)&&activityIncludedInResults(f)&&simulatorCompleted(f)).sort((a,b)=>`${a.date||''}${a.onDuty||''}`.localeCompare(`${b.date||''}${b.onDuty||''}`));
}
function experienceRows(){
  const includeSim=($('easaIncludeSim')?.value||'yes')==='yes';
  return [
    ...experienceFlights().map(f=>({...f,_experienceKind:'flight'})),
    ...(includeSim?experienceSims().map(f=>({...f,_experienceKind:'sim'})):[])
  ].sort((a,b)=>{
    const ta=a._experienceKind==='flight'?(a.off||a.out||a.schedOut||'00:00'):(a.onDuty||'00:00');
    const tb=b._experienceKind==='flight'?(b.off||b.out||b.schedOut||'00:00'):(b.onDuty||'00:00');
    return `${a.date||''}${ta}`.localeCompare(`${b.date||''}${tb}`);
  });
}
function easaSimulatorMinutes(f){
  return entryHasTimeValue(f,'simulatorTime')?numericTime(f.simulatorTime):timeGroupFinalValue(f,'simulatorTime');
}
function slotSinglePilot(f,minutes,multiEngine){
  const engine=upper(f.engineType||f.engineClass||'');
  const minutesLogged=numericTime(multiEngine?f.singlePilotME:f.singlePilotSE);
  if(minutesLogged!==null)return blankIfZero(minutesLogged);
  const explicit=multiEngine?/^(ME|MULTI[- ]ENGINE)$/:/^(SE|SINGLE[- ]ENGINE)$/;
  return explicit.test(engine)?blankIfZero(minutes):'';
}
function expTotals(list){
  const flights=list.filter(x=>x._experienceKind!=='sim'&&isFlight(x));
  const sims=list.filter(x=>x._experienceKind==='sim'||isSim(x));
  return{
    total:sum(flights,totalFlightMins),pic:sum(flights,picMins),sic:sum(flights,sicMins),
    instr:sum(flights,flightInstrMins),night:sum(flights,f=>timeGroupFinalValue(f,'night')),
    ifr:sum(flights,f=>timeGroupFinalValue(f,'ifrTime')),
    ldDay:sum(flights,f=>Number(f.dayLandings)||0),ldNight:sum(flights,f=>Number(f.nightLandings)||0),
    sim:sum(sims,easaSimulatorMinutes),
    picUS:sum(flights,f=>timeGroupFinalValue(f,'picUS')),dual:sum(flights,f=>timeGroupFinalValue(f,'dualReceived')),
    multi:sum(flights,f=>timeGroupFinalValue(f,'multiPilot')),
    se:sum(flights,f=>durMins(slotSinglePilot(f,Math.max(0,totalFlightMins(f)-timeGroupFinalValue(f,'multiPilot')),false)||'0:00')),
    me:sum(flights,f=>durMins(slotSinglePilot(f,Math.max(0,totalFlightMins(f)-timeGroupFinalValue(f,'multiPilot')),true)||'0:00')),
    toDay:sum(flights,f=>Number(f.dayTakeoffs)||0),toNight:sum(flights,f=>Number(f.nightTakeoffs)||0)
  };
}
function plusTotals(a,b){const o={};Object.keys(a).forEach(k=>o[k]=(Number(a[k])||0)+(Number(b[k])||0));return o}
function selectedExperiencePageRange(){
  const all=experienceRows(),mode=$('easaExportMode')?.value||'last2';
  if(mode==='period'){
    const from=$('easaFrom')?.value||'',to=$('easaTo')?.value||'';
    return{all,selected:all.filter(f=>(!from||f.date>=from)&&(!to||f.date<=to)),firstPage:null,lastPages:false};
  }
  if(mode==='all')return{all,selected:all,firstPage:0,lastPages:false};
  const n=Number(mode.replace('last',''))||2,totalPages=Math.max(1,Math.ceil(all.length/EASA_ROWS_PER_PAGE)),firstPage=Math.max(0,totalPages-n);
  return{all,selected:all.slice(firstPage*EASA_ROWS_PER_PAGE),firstPage,lastPages:true};
}

/* Minimal PDF writer: produces a real fixed-size A4 PDF, so Safari print scaling
   no longer changes the logbook geometry. */
function pdfEsc(v){
  return String(v??'')
    .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
    .replace(/[^\x20-\x7E]/g,c=>{
      const cp1252={'€':128,'‘':145,'’':146,'“':147,'”':148,'–':150,'—':151,'…':133};
      const n=cp1252[c]??c.charCodeAt(0);
      return n>=128&&n<=255?'\\'+n.toString(8).padStart(3,'0'):c==='\n'?' ':'?';
    });
}
function pdfText(x,y,size,text,align='left',width=0,bold=false){
  const s=pdfEsc(text);
  let tx=x;
  if(align!=='left'&&width){
    const approx=s.length*size*0.49;
    if(align==='center')tx=x+(width-approx)/2;
    if(align==='right')tx=x+width-approx-2;
  }
  return `BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${s}) Tj ET\n`;
}
function pdfLine(x1,y1,x2,y2,w=.35){return `${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`}
function pdfRect(x,y,w,h,line=.35){return `${line} w ${x} ${y} ${w} ${h} re S\n`}
function easaCell(c,x1,x2,y,text,size=8,align='center',bold=false){
  if(!text)return;
  const value=String(text).replace(/\s+/g,' ').trim();
  // Upper bound on the width of the printable characters in Helvetica.
  const width=[...value].reduce((n,ch)=>n+('MW@%'.includes(ch)?1.02:/[A-Z]/.test(ch)?.77:/[ilI.,:;! |']/.test(ch)?.34:.62),0);
  const fitted=Math.min(size,(x2-x1-5)/Math.max(width,1));
  const estimatedWidth=width*fitted;
  const x=align==='left'?x1+2.5:(x1+x2-estimatedWidth)/2;
  c.push(pdfText(x,y-fitted*.32,fitted.toFixed(2),value,'left',0,bold));
}

function easaRemarksCell(c,x1,x2,centerY,remarks){
  if(!remarks)return;
  const source=String(remarks).replace(/\r/g,'').trim();
  // Keep every word, including those in a long instructor/trainee endorsement.
  const words=source.split(/\s+/),lines=[''];
  for(const word of words){
    const last=lines.length-1,candidate=(lines[last]+' '+word).trim();
    if(lines[last]&&candidate.length>75&&lines.length<2)lines.push(word);
    else lines[last]=candidate;
  }
  const longest=Math.max(...lines.map(line=>[...line].reduce((w,ch)=>w+('MW@%'.includes(ch)?1.02:/[A-Z]/.test(ch)?.77:/[ilI.,:;! |']/.test(ch)?.34:.62),0)));
  const size=Math.min(7,(x2-x1-5)/Math.max(longest,1));
  lines.forEach((line,i)=>c.push(pdfText(x1+2.5,centerY+(lines.length-1-2*i)*Math.min(size*0.56,3.5)-size*.32,size.toFixed(2),line)));
}

function buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo,side){
  const isA=side==='A',c=[];
  const x=isA
    ?[18.4,58.4,120.9,152.5,214.9,246.5,324.2,401.8,433.8,465,506.6,548.3,641.1,672.3,703.5,734.8,766]
    :[76,114.8,159.3,203.3,237.3,276.5,310.5,364.6,407,489.8,537.9,823.6];
  const left=x[0],right=x.at(-1),top=576,bodyTop=499,step=16,bottom=bodyTop-EASA_ROWS_PER_PAGE*step;
  const cell=(a,b,y,s,size=8,align='center',bold=false)=>easaCell(c,x[a],x[b],y,s,size,align,bold);
  c.push(isA?'q /GridA Do Q\n':'q /GridB Do Q\n');
  for(let i=0;i<EASA_ROWS_PER_PAGE;i++){
    const y=bodyTop-i*step;
    const f=rows[i];
    if(!f)continue;
    const sim=f._experienceKind==='sim'||isSim(f);
    if(sim){
      if(!isA){
        const type=[f.type,f.reg].map(v=>String(v||'').trim()).filter(Boolean).join(' ');
        cell(7,8,y-step/2,euDate(f.date));
        cell(8,9,y-step/2,type);
        cell(9,10,y-step/2,blankIfZero(easaSimulatorMinutes(f)));
        easaRemarksCell(c,x[10],x[11],y-step/2,f.remarks);
      }
      continue;
    }
    const total=totalFlightMins(f),multi=timeGroupFinalValue(f,'multiPilot'),single=Math.max(0,total-multi);
    const values=isA
      ?[euDate(f.date),f.dep,f.out||f.off,f.arr,f.in||f.on,f.variant||f.type,f.reg,slotSinglePilot(f,single,false),slotSinglePilot(f,single,true),blankIfZero(multi),blankIfZero(total),f.picName,blankCount(f.dayTakeoffs),blankCount(f.nightTakeoffs),blankCount(f.dayLandings),blankCount(f.nightLandings)]
      :[blankIfZero(timeGroupFinalValue(f,'night')),blankIfZero(timeGroupFinalValue(f,'ifrTime')),blankIfZero(picMins(f)),blankIfZero(timeGroupFinalValue(f,'picUS')),blankIfZero(sicMins(f)),blankIfZero(timeGroupFinalValue(f,'dualReceived')),blankIfZero(flightInstrMins(f)),'','','',f.remarks];
    values.forEach((v,j)=>cell(j,j+1,y-step/2,v,8,!isA&&j===10?'left':'center'));
  }
  [pageTotal,prior,toDate].forEach((tot,i)=>{
    const y=bottom-i*step;
    if(isA){
      [tot.se,tot.me,tot.multi,tot.total].forEach((v,j)=>cell(j+7,j+8,y-step/2,blankIfZero(v)));
      [tot.toDay,tot.toNight,tot.ldDay,tot.ldNight].forEach((v,j)=>cell(j+12,j+13,y-step/2,blankCount(v)));
    }else{
      [tot.night,tot.ifr,tot.pic,tot.picUS,tot.sic,tot.dual,tot.instr].forEach((v,j)=>cell(j,j+1,y-step/2,blankIfZero(v)));
      cell(9,10,y-step/2,blankIfZero(tot.sim));
    }
  });
  c.push(pdfText(right-62,23,8,`PAGE ${pageNo}${side}`,'right',62,true));
  return c.join('');
}
function makePdfDocument(pageStreams){
  const objects=[];
  const add=o=>{objects.push(o);return objects.length};
  const catalog=add('');
  const pagesObj=add('');
  const font1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  // Static table geometry and labels from the supplied A4 reference, reused on every page pair.
  const grids=["GhS^Z9lD>uO[]$@'jTIC?)m@n\\)^(rM3sT4BMeg8nBteK\")'JPc``tBAjk3#RO;u`@hphSpJp%=)4C63(@CP%gGD(ko:'1Wk.Z>4f<sAqojR:#IdA/2[Hm_giICn)i?-r.75:BkFmS7)\\1!*:n+L=kP%j.2@D,:!o!*=qSh^ds\\)6oC.HA'ab:lr<[WUnX]1Af=m`N]sakRE_Fup@3A(SJ@d6(.ZhQQZ[`aQDMetjqJq4bFP*Nt<cIdP]HQHX\\7Y%OK`f^8:\\b?@(foXClf2j/%EVK%G<><d8RgkV&,m^?\\d,X*f8EpBE60h!oN-AeURT2MS@T2MT+,gj!'UeZi_.%$=L$VlV`>VIa\\`2CR\"dBq\\UJSAOaSX)P#e%u`iQ@A2/@?.5('[a:T,aoKt8t?`H8t?`]7+9#93\\C?*?s6;Y3%_jb_6a=XT,*VYdrOm\\VM-===osOV$VP;>VQK=<03^loieh,I>S9_'n._L\\i$giA/d\\C$OSH34(\\+lfH(erO/'$*O8ShR8&kpKfbPTa$8:4SbM+pVcnS+EbDV`?H>\"fN&Mb0XWiMY1>iMY1>0hF2R/?.+X0++T<oRbQO.i1lP+Rs/#8Mi$n?=6r=;Pth&pp@9DVr\\2m7[34rBNe(B9aa1^:(':_:5_]<BjjT((4T18/Z0DT(14U[=osOVMb0XW\\b?0S_NHr3J]+I?,rR@82L\"I\";6DF$BlQ]u/\\tA5>(W[I[(%BKQ9aHY;I@AkEp&.RV61e69-gcVEChi9(GG5Q9-Eb=M'Ou2J]+Ht*m:Q9dBo8bRMM)Te&\"n[e&\"n[dpeJR>$+\\#`Es<QbNT2.`E+[ZQ9aHY@ZkD.m_-ECYbY#e+Rs/SM,2;kaC_qNdpe2J>\"fQ'$U:I_$U:I_Mb0XW@7d\"*Io.mOV\\bj=?b'QJ!f9^28YTq0pB&g\\Oub1G`2A;82D)gIaJPS]BlQQq/M7@,-$Y;C9CNXf(7,0Q&kICRlAKmjm_$oRe<T'.M'Ou2/d\\E:ioU,Q#p_\\dOi4+COSH1&qlk\"d[$W&+(6_/8_G@/[_G@/[@ZkD.=Al'9?PH2Wkln!(=\"]l+5iU7%P%\\%e]th\"ZUeXQ*nS)Eg:J9B@AK.@X0h!oN-AeURT2MS@T2MT+,gj!'UeZi_.%$=L$VlV`>VIa\\`2CR\"dBq\\UJSAOaSX)P#e%u`eQ@8+c-%]A8\"LDQp?rZn=4t6C<*u%WVF2A8+'7UBcam\"G4`#\"AF,Z*-LQm.oZHQV\\e#V19d!elU=/'9i9iV;t^'9E/ioL%<BBeTM!%1d%-bQ$&3kYCXDKCY]2DTn-507C<o9rUAGhu%jRRlkWXI/^?2's$Es_c0M)c@?;XU(YsWm.D*)B>5E!'U/bAk!&9B!qpRJ]^lJAEnuK<2U:[*\"mFp)J7Gm?E_C4[38&ojfY^_)0i:cEUta')1(Ujn*4a6C>[U?h!fkADb!@]<#i.lDDE*]D6fA)nJeW/t'[5lJY*ZqV$dcd1!QS^]jjK[ri,#t)kM_DNA$Vb4mF1J%D!l4J@=lrq/DuoD\"($S.]#uZabZf$Va]m$nI#5,D:,dO@hK&N$A^X@5H:Zq61+%@Pe'/r>\\\"&D6!^GN'JaY\"4bK6.<_+qIbi&aQfE\\\\sKr,e]hoIVG#Z3NJI3\"P7X:<$gq>p-$M\\>/+:-Y#aZ88<Ub$T&>@7)*e5a]m$nI#5,D:,dO@hK&N$A^X@5H:Zq61+%@Pe'/r>\\\"&D6!^GN'JaY\"4bK6.<_+qIbi&aQfE\\\\sKr,e]hoIVG#Z3NJI3\"P7X:<$gq>p-$M\\>/+:-Y&md^.l1mJ,d*+pPSbCk&'RAFUB`UGn$3mD`JTcnRiBcCQMns9`\"9L&*[k+`afU'r7OI2)O)sRi5a_;n0KEb5oGkLf^Um2I#5s\\:rYnS++NpE^'8.Bp0bo_k956_b*X`a$fpp[Q^GDiAP<e3j4%p=h2?.=k\"9G+JNZ:+jCS>ZK&_o'LLFX&/jKqc\"<<Ug%!+Ab[_'5?Y=n87F\"^u'a$dc68)4&HB6'QSEOu,MW<qnt;SY$?_q92)1@R?7!8$1hJ7J0/h7rjq\"C)0.3Ng6lkF@Y<YLW+9;\\>87rVI[9qt24`NWE^d*rjAofV1TdQ=s\\.-3k;gV$89PCr,R:0\"k3:6lI[g:c;aY)OSUoKa`h?DcJa4E$4[;#%\\HKX)<OR5k9U;M?<6H2N\\1P)3ditZ1:Sa#t\"o.JMlba#lk*b(c!KH]NX+o'7sa')&*82X_]0j))<V0Y]@G3%U]E2))<TI]Ns=r6\\<5b)3dit_t$Eq3C=#41]5t4]F[Z[O==?%aoV10,#D+/Td%X.*N$P1M#LtI7L`EQ8d#K6$20LYNSlD:BuLDNOU$n7>5$oC_*6;kO[tCf$5M]UR6b=Q+t`\\2XtUrV%@TBlBi.aT!e'.g,E\\:?3*kHijS:$_Q5'lHV[q\\jN?F(bW2PY`4r>G\"Kd>*@U1+?'aFd#-/c0M83;3SA6F03,/Li5dQk*d8N?a:em)+)Nf-=':M6qZ9%68AfZ:pF;apOmR^VbjW,aRYa\\r)O\\g7s.KRm7Wc\"Q7*'Y@@3f7h^?0FBY^^I5IUR:<Pi6MV1K@9lsQ<e1*?u!ENkjd:q9h=0_Q,YX5+A:5b!5`TX&t9lsS4iDkj.d=<Q)/M\"Jk:EP6))GP<W<7EBU*s#DU1sp#7;6(O^1n]\\#b<ERrc[?t<ctK0&U7t\\nq$=2kUPVah5.lkp4W;[8Vra+ZKoF3;-5.Db'o!0HLET_i16FS>'sD++gnN]*8>(eg!q9TO=#'TnUC\"\\(3iuD@4rVd9Ve$rV`U\"h1-9<_.C)*5!!%Tmpkd9]oX4Ve&=J=,1VaX%V@eA&u-9<aUn1)HRBL!6%Q5*`FV[pWON@$\\<.V]]fNrU[eRcq,WW)\\d?)ULmMAKP6tkIqL.BJe+N;,OCHHj!QFd6smD+5Y#I*XueWe+1Vh6H8+XPDP=B$H!(__iQAoRE1o0MTbpYIIo$-#rFA*!$862.V9cJ1uYo7VmVE07g#4D[-Y]2R!n&C7&NIBX^^l6@\"h&`SX+\\K'q:6a.l<^Y[&Bp'N'80,7&OT<?H\"lG%;;KbZGN[;oKcTQd6sm$7BL%j&R^;^':fmR[>N@%\".JG\\m),n!g_[g7N@$\\<.V]]fNrU[eRcq-F_qQ$[UB+)2>!CV?aLE4(1=8s%@G'L^(ik<U':Dd#nSR^6+oDcZN@(M.^k3A.`U\"h1-N\"YDZrSpXBL!6%Q@3umZ]@5;kd7:e<GXi#XO(XTe$9Lf@e11>Kgl`H()=67d74;-kd9]oWu1#p!DRZ><d5@O4pWYqRcq,WW)[Xt!j'a^U=5j2<\\aGa5SK]SI<ZL!qa+DYd6sm$7BL%j&R^;^':kG;GT5[h1n]\\#b9u$O)4)RB-9<V,$lf*S6`uM],'1mV55loZa!(?i%ZMg4#f)'-<lKWN4IYbDUf4I+p<eC;12YseW]9L17h_;V'jelI,JXYG-8KGr_lD@;\"B_AF7&FOL=#'Sc5SKPDn6o>@o?i(812W\\g._bL?=J=,1VIbH_Z24g26DKB2b6kF^p<eC;12YseWq^I=#V.a#aL&&<.Wum7<bO=PB`fI.`k3?%BHkn0-i:<5Gra;`,,5@\"=)=gZ(ik<U'9uKtnMli8DHm:FctMDG#*2%.i5%V*BG.sH3j%=k54WBM8BX1:4P3.B9bM/;;8L.t0NMjD8Yfo>%NabbYsP3W+tY8oGbC*[RO$=e%gNW8O$&jVd^$a+j7E@SU!Y-J()7QHbQhX37[$5D<)i?P+*f\\7Uh(VX*p:6;<bO<]Ud[]U&+dV>U!Y-JQ@1`;i-OJ3,a\"Bg[XeZ98!Zg];-@>ciHH,YKd7>&;cdtL+3/)UYX5+A.0B!HKi^#+aJ0'V767PNN'80,7&OT<?H)7UO!Zn>.V]]fNrU[eRcq-F_lMF;\"B_AF7&NIBX^^qMJ0m</qsZ)Tq.N#,SX(!s`MX6`$B6An/LkKMRu[P\"1n*X8W2N^T4rVd9Ve$rV`TOrH<bO>;Bi.a.fR*g(U!Z9+AKTdK\\/l)mU=8\\T[R/!q8<\\mjapQ#j^Vc-`,al`D\\r)F:bQ!Mb@tdAc;Zu$p$Emq4O[g(6Mf`.'(k\"66M,)5X]SbB4*_g`[<7EBU*s#DU1sp$jLKCbV#d?XjM,&td>/f^#!DRZ>p>K#1o?i(83\\;kpMGG=I'cKeg>#a!$2BMs#BJe+N;,OA2I5IUR:<Pi6MU-\\oXO(XTe\"WR;Z2\"[06DKB4b<ERuEBP5e7&T.1D2!qlOX:_^Pnf#_IYT(J82?;fFVSh92kGNlo6XT5dDQ_\"Gd,&cR!n&CK\\muEega-2%;;KbZ4F-Jp5qiYSJDsJMTnYA'cKeg>5$oTCd%p%ctK0&U7t[CqIi,-SX+\\K(#sZuTSZFe$ErI<#@W<U':fmR[>N4!J/&tsFBVYn.RkKhBVNt]&$Ou6?O//=Rcq,WW)[Xt!j'a^U=6CYDe!%5\"uO_Aq.*\\Qj)Us;6q:gB@>!HGa;'k3A56FL\\%\\6^,HT7*@Yt.J=Q*9(54WC(Dime1'r-fo1sp$jLK?5-aJ4SeMi(]Wjs.YKN@$\\<qsZ'n*s#DU1sp#7;6(O^1n]\\#b<ERrEBY;f7&OUM=7PO-YX5+A:5b!5`TAD\\$B6An/LkKMUQ5U9d:q9h=7NgSKG>D\"FBVYn.Q/@L<bO>;C\"\\9N0s4\"KRcq,+ZE94.3RVH4UU%b@_=')=$:uR\"Vl\\nB\\E_Z72`NX_Qm)M@<qtRFbs(]3_JbQ3leeFr4rVd9V@@qJhk\\L\\nn95rZD.>8g?'Wq$B6AfD;`>37W%`/@\"h&`R?eT\\Dq.<!%;6s7#!Vs'f#IN!5SKPD;#\"DUIJP(fctFWPZGNZpI0<ZGd6sjCKi^#+BL!6!2Xk-TI((b^'cKeW>#ok_]8lqB1n)LmJIcO+?B5:IO_KH3rE@:T*,.0j;$4cf2Ujes\\O)I9b,MFd)TT#=8UqNo9jGNm&L\\V]fLHiSK\"\":K'g0i5*_d8]fnY1bqadJR+tY8oGaK#]$B6Bh[-Y]H_gF.=BJ`;V77@@joT;Y-6sB<Ci.:K^8!?>E<]G>o4od)iRO$=UU4S0r@'%^gP\":Lg$6JCUO!]^jm)-[\"g_[a5N@'LhW2SW_4r>e,RO$=e%gNVMO$&jVddkL<nA+/,P\"?iI.h\"Q<%O8-<A>4/1.\\??OgnWcb8>(eg!q9TO=#'TnUC\"\\(3iuD@4rVd9Ve$rV`U\"h1-9<_.C)*5!!%Tmpkd9]oX4Ve&=J=,1VaX%V@eA&u-9<aUn1)HRBL!6%Q5*`FV[pWON@$\\<.V]]fNrU[eRcq,WW)\\d?)ULmMAKP6tkIqL.BJe+N;,OCHHj!QFd6smD+5Y#I*XueWe+1Vh6H8+XPDP=B$H!(__iQAoRE1o0MO1jmDp`KB,gaID!I1icX-e=rd=gC$S^o8[*t;nXe$9Lf@ePpS':fmR[>N4!J/&tsFB\\Cs<GXi#XO(XTe\"WR;1&>QK':kG;GST7d1n]\\#b6kH4dg'<87MD=.'t&qD7t;<m9lsQ<e1*p0%;;KbZ4F.uF'f2'1n*X8W2N^44p%h4BVNt]%rYr_Ns7GgC&):D+ldU=a[AX1KjfVk@E91H9Opn(`EQ\\C7)-R#5SI'!i5#c(@ePpS'7Pj]>,rKg1n]\\#b<ERrfgd)XFBVYn.Q/@L<bO>;C\"\\8CZ2\"[06DKB4Mi(]WkbA/QFB\\Cs<K-OsJ0m<//%ga8++t@I9lsQ<e1*?u!ENkjd:lHTWu-7ATSZFe5.ld!I3G]=BVNtMU/nPp#d?XjM,)5X]T$no)ULmMjcaP8N6@>1'-3>QL(/Te+]h2iOZ@P!mqXlTiGW[K1bhE!*j\"i\\Afl:TiO;@U[>N@%\".JG\\m),lkIH8dDVaX%V@e11>Kgl`HQ@3umRu[P\"1n*X8W2N^T4rVd9Ve$rV`AeqKBVNt]_Q3J(6!0i.7&NIBX^^l6@\"h&`SJDsJMU=orRcq-F_lNRf(W$N=-9<_.C)*5!!%Tmpkd9]ogDJP;!DRZ>51ruX\\/]3<d8=%Tf\\grjEePbPR8[/VglL8JKYP?sdDQ_\"Gd,&b3:N&#'7Pj]l;c%l)ULmL%=D7m#<q]l,1Ej7X4Vh'=J=,1V@@oT't]M,.l<^9[&iaHAfhIq,1?`[XGV9e)ULmL%2;j^G<Q9_1n)LmXRI]_*s#DU1m)KTiDn)c)ULmL%=D7mhsCe[Kgl`DQ5*`FmN]LSN@$Dti5=99f:r@@AD5sP^D8RX8\"*+^e3NP]%J:2uY)m1gEp>-GbG1phq@*po-E^bG#S[ailm%K:_-<_a$6JCUO!]^jm)-YlIAG79OVSZH4Nn%?Kgq7o>5$q5@6PMY1n#]<U8!5EqT,F'+t`\\2nA+k@UIcX].i^ZH++P(E9bM/;;8L.t0NMjD8YedD\"V:6f8!?>Ep>OqLmL*EV7[$5D<)i?@+,gpQ9bM0nLP#i77ikA;C&)9YGi3UQaWqI`'a>_.LCmTY1=8+)'d*IGU>Om\"TSY*!n6grO1&K%e$,8niX]:<D)ULmMAKP6tlm%Q<3\\;gr'q:6a.l<^Y[-Y]2fR*g(U!Z9+77F=fo[/193\\C6u.`V9t5SK]S'jekW&&J[5-9<_.C)*5!!%Tmpkd7:e<K'*[cpXdC+'uqL^(==Y1sp#7;6/>s\"B_AF7&OT<hT!&H%;;Kbo#\\=,`oTaTM2o^c_ZmlnO=MTEaIKi!QbJiCIY/kr-Dh'aK,%_3lm%Q<r\"eP(<\\aGa5SK]SI<ZL5O$&lp[&Bp'Cd%p%ctK0&Z4F-Jo+>Aa7MD=.'t&qH7g#4D[-Y]2)!@Xp9lsQ>GSQi7#V.a#kd7:e<GXi#XO(XTe\"WR;1&>QK':kG;GSQkJ6<Kr/7&NIBX^^l6@\"h&`SX+\\K)rl6$TSZFe-eetGQQo3O3[uWg)uL15Y)m0<F6Y5]f5@%Phr%%uM(&Mq@\"hZ:qoGN=^I:2c<K'*[cpXdC+'uqQ,EF04/LkKMRu[P\"1n*X8m),mVHj!QFd6sm$7BL%kd=<Q)/c5#e`qa:5':kF(?H&fQ_?u8L3\\;gr'q:6a.l<^Y[&Bp'N'80,7&OT<?H)*A&6<I$d:lHTX4Ve&=J=,1Ve$t,`jd'!BVNuHagOOUj[bSlNlh^H#/A';.jUP(S@XUPZ2A[#YX5+A.0B!HKi^#+aJ0'V767PNN'80,7&OT<?H)7UO!Zn>.V]]fNrU[eRcq-F_lMF;\"B_AF7&NIBX^^qMJ0m</qsZ)Tq.N#,SX(!s`MX6`$B6An/LkKMRu[P\"1n*X8W2N^T4rVd9Ve$rV`TOrH<bO>;Bi.a.fR*g(U!Z9+AKTdK\\/l)mU=8\\T[R/!q8<\\mjapQ#j^Vc-`,al`D\\r(EQ2m)%WE+h'_70\"C1n1&#lGr4Kh8>ikQd74;-kd9]oX-e=rd6sm$7BL%j&R^;^':kG;GSQ^/!%Tmpkd7:e<K'*[cpXdC+'uoG*t;nXe$?ikq\"-jSU!Z9+77F=fo+>Aa7MD=.'t&qH7g#4D[-Y]2ptQ\\&$B6An/LkKMRu[P\"1n*X8m).Qpf:r@@FBUl]<lhcjBen(5=^ft@G8P@S,SQSE*pI7k\\mYu]([3Hq'X'_>Dr!H*mpF]8.-sL^q4R%F?ZGuZl-td$qZs>PIDs=8XRIIZ4rUR`R5XPC8,@+1k^(ZYS4q*55LSsE\\=W=--dr8`lr<S&1gG#U/M$0qo5^XF3#RtrcLK(_3-l,8$ZGlgc/gPK;XTJ-c*nHh(rlkFo&\"6X/^gV>4Srge?6do'5)eM(+8P@_12UK-Q<Q<'hAa>@4/WhkXd0]E4j_7((\"3Nh2TZ=+?K45$mqDQEhIY6hTj*H4@-?qmrk6=\"\"Q.W!pH3n_FQuuD4rV/uag?U0LC^#<\\a-0`4g_0^X]2t4a<9T5()=7Lc,[&i?,(7FFh0d_+aM+boNLS3-[\"kNH$c_gr>AcNj@+dS*85YdK2N7KA]602f-s,sQQXU1qHb&SGGpjFl,Mae)9Y1TNpkh$5!<'^>c+HuQ^Bel.nX/ir\"e\\,?=N&LY:+hD-.8N^*[]d4^+B0PrnZKoUEr34<7Ksh:4g)$EPq\"YW2O@OB7qoCIDP-[]Ol?^d73t]d8=%Tf8%[$h%'\")d5b(N5Q(,Bs*/hap;?B=4DTCjq8^C%lYb1hbPs_i,>nGYGaR'\"l-\"+5T%\\'No#JY?L-Io8r6N:0MuN3BkbjNgjjR`=e$lH,9:@N+T$j7&`^6EsIeiW+rq(U)i,WtSUd)PW>B];8mp>UX^5_67?S7u-d\\#C=6!VRs^&R_bTAIbFHN37#9s1,2i(e\\ZQ%p>$rr2HLM*>::Q<q)f=a0c6-RE9ur:K+BJ,@^Ps8MC-Ish-sJ,Sc\\ki4(Yqrd>-483uIM(CUb5/-l<qW78=bAX#FJhT^O4#>tI_`h@to(`%PoC%_^1!n:4<k9BJj'(<KlSG+sJ+rd/_b73]K`geAWSb>LFuAjVo?TXKI/<.^cQ>Bb\"E)fFj[%X#etp.JcVM<(I!P]A5,&>?4CTc6_0XcYAR`86@2YB:8>V'%n%Qi'aqJ)F]nD;)c.=>-f%lC.ZBcjhY>9EBl070ULLAQ-iVJM=\\Q]rZj1hU;$t4G$LQBbGr:gme@_(jmZE;q@?#BN;=D[p+r#P3BWL(fbY\"QV1[@Hp#S>CX^c1:Y%:S0gup_B?aLKp-e.neTWf8\"a$r;$4F,P[A\\E\\7%?`QD/glGuna^?,0^5Mhb,pbp5j^8Bekk[Q;JbOYAUa!*-'\\Tc5C*2!3`Ied;.n+-#I\\?<upVkO%Lp#A970>4c0bH3>[II_$X^:`:=o'Y8<?\\8:hXkW6&os/j58)>Ql&RW7rqssI0?Q-@X1s9WH+i!2EC%Qj\\^NRqaNur$0lh:8Oo^QeZ/,+EA*'I'+YMA_d0%]GUiEs\"Ua1D_cIdN_Vq=q5]?a](;Vf0VR1OEFtqcZQqEI;$L6b1q&f+.T;j5Y>Z;&rp`0T9Qjb)LfKK]Do'4\"0i@2]d2\"='HM7qt0iU[STG3^HS=KmB(l?JSBNaTqBK8qj3)15(3J'nLs[1\\Q^\\=:i^q$TB!!%A:*kDj6,UGT3hXUD]iIL^:Pt`1nUChGlIBtoAe$c-_0F<kk7ZKbsT%X%q<(rd'$4G28/8J\\TH5Jh%sDHTr=:#l_f>Qa7knZCKgS@fH4FKI/`ftQcC3C=oDB]d</`mJs']dQ>W24]4ZQer9:,7?Tp^Qrqu#if8\"Cc*QrH!qK_AWj*tS3<dla[4$8;]rrE_BkKs~>", "GhS.JhiHRDQ%\\&n=7k5o&#MoVg\"h$TXKaQ`HXo\\7\"Teg/\"GuL<@\\![=kJ@&In*SN%1W,@?HoD8h+&dT+eZ$`Q<86[ZL[B=Kr:nt@1lV$L=AJ$f>u$18A[kFg@;>ga]GuBGJ,&!/Bj-87E_4BY%*Ld%-0mJ5kOH)nHm+ouj\"PECdmd%eSbJ<-GrUi1]X1+7GaY&WFhUhU*2g(?BMHTpoC>4g>))_JjCO``U1kuX`m_//a-9ik2M2g/b;NUcbL7r-[aDCEX=_h2IBkqAf&=:.#GV?\\l`_GNZ@J$9\"[#@m!SXJ#5a%iA^If7QP,\\N8/IDbT<Ie+!$4'4'5b$(\\/S+r+W=!m5fE/EW;1Ko\\!Ig:b+='qfZ<J\"SP,\\Ma;A9\\*U4D9L)O>6@$BV&3i0hLuO;mus;W8'4<`&m\\'Et:<?[sCj!P+(@5a&-tQ?KeYb5t\".(%<KR\"_a[*!(i%Lr$ki78?)`%[jW@E<<6:\"-m0d8!TSH=[u.JAOAlBG8SeF]W$jooU&_r#((cY/!8/q2#YA$H<[e@]8Q!9N?AE*_WWFFp$@!n;\"lr.eJ<]g1MH*W+,Xh`Jf,#Q$;*_;D$]q/6?o\\_a?<n<XP,a$[M(Lt3'a7-+']<'7!^]d\"+M1&C+fPgq.Ra@]W=#$HD.4u5_NIk%4@s>ig8HDbP+hrk8equ$WW:^($4'4'J6\"*+#Y@n/FDeREZ+LB9;AAUoiX3bdHiY\\d\"Ve#9!(i%Ld]P5gP+mJ3`>9Xg<P[&\"?cnkB,ZOk@&mKlE.LM95.)<$L\"b`[$5^&%e6;ePk<JgiE;ACmf6[Mug$OB=(^lu\\PTT+g1,Uj)iX(25SW=\"aCU4A>)\"_a0qJ<1HK>`Q^A/apNL.)u:_E7<DkIeZh9g&!W`qG7liQW$-D:_\\!&)Lh%Hpsdg6p6Xgua2c/b[b*W\"kE#(D>hWZIE+qP]h/7gS$\\+[LnDPa3X35QCbO&0Z$#YmW(-+K6f;E3:D%VA%!<o+JJkY$YR9D>66TZp&QtKVoTK/+La7LG,nX8,$#nQFu>h\\^n^-r<:\"Vga!<cC.];`j(!TcN^I[+dp!=9/RhVYAGdZF*>&?*pq!O1Qu1TIrdn@sYuD0\"c$Rjq%SYLV:LD[\"<\"/(L+eGk&@AJGO-X&*(]!tH4LJ!bED$s=kg4=D\\3%r+G#Sf\"moB1V`Bf*,P,X,G5PT>^s@EuUrV`T3-m\"jL_L:aDDAkYU_S\\,iP@;].I+AbPG3ip?l=b7`L,LLcm(Yt\"sQJjVA4n.iP@;].>fjnLS0F6YREpW@SAE\\HMBMm;A<VEJ`rdf=9]s<0rF[V!0IN05bogJ[\"<guWc/LpLgih!=F4N5*ZmGtKtIZ;M[)OKI/$;1`S3Ks56rl_6cqB7JJ].T4Gf3^+n.e\"5R\\#2T#A]j^BL#>___Tk@UqL=oH&TmiPC]p=cP5=5R\\#2T#A]jN9NJ._pjAd0sVd/H9j7/c_6]e(t/i10[7Fs(g2kR]naCj4BN4@b;#k/\"DUqj6SY8S1EsZDbHROt'o3aiU%nDV=fAb10e?RS&gPTe(2-SS$P/iIaE!5R\"_*k]?qH;.a-b^N0J#>2&gPRSVA4nqiPC]p=cP5MLL?L\\YTu](@n\\N]LA<k%Z5d@XJJb7E=:uk%0rF[V(m>1t@UqL=[\":QFWc0@5P[d0.fM/k=^4U;pbVTiaB=/H[@^=rqN&8\"jTM&-U-9R5!k8;\\UKX%&#V(qN\\K6e3I0q%Mj7\\F6f.hKd4_XeV$N^:@8+Bd9(JW*.?TO&0X.jiZeF:;mf@TcIC+rR)76+r-5=dlQg7]Krp.gY?N)ii'/F\\IW?RuV!bYZ4Bb!4sMJgKp$#%O[jkN-;rD4&'mR&!(>\"HUh8?8:51oQHfp6NjRYu#Tc/lTUG<jBrrR&*^2]])=nk_]ao*f]i[rakr[=>Ki%4#d1,u5ZrW;Gf/tUcRJ._9]ak-L4tNlTq&O1O6;1H4NnF^:Ni7oIV:G>8h\\19IGE>$7\"kKe\"5o39'BJ]GN0'kD\\(Hr1>1\\`u4<@$cb%hEL]5H\"0<\"M4)\"5b#U9BrrRF(Hr1>1\\`u4pE@n_(Ct?e5H\"/]J^2T:+8hY[.M?ilLPId?T@8*.@\\%mkBJ]EDX]5YLWl7jT\\^++jF/O<9[dr8B*qG)^^q*Mkke]mlD$Ic2Kq0RS_FFWD#!]#nM?KL4iM\"NSkHs*$5SlTkBJ]EDX]6Y1_FFWD#!]$Y4p3q>ih=WTkHnP=d.qtZK:gUr7=n;+nBbe:F'A$\"XHO/*D$E5&[0f3&[9./gpGj^5m^s\"h=M?NH6iN/]=LX.j>rX:+c/?(CYgW_\\paDf[i9.IJOeC/c4L?\"(SC[QKke]gjD$E5&[>G)mpaDf[i9.K(LHqbD4L?\"(SCT1n3^8[Sn8hd68C2&l*nh$O:@!=aFn4Lbc/@cl<Zrll(/&N*5\"B2.D<ilNoc*'7j:=h5FfS'[Kp)Sl%\">er4&+(UNrn#DISOYn#s->K6^tp<BtY%./pnA[B(0kFX%:TkNrn#DIST3W#^#@N6^tp<BtZj+oCM/N5GtoH\"J+]6U!;NY[,-R?-QaD`%\":re'nW`+Z.)82F&^*5m<>Ul;uO^]#Pg_b@,3:83]SX^c/?(CYZ$*J4pksZpbAmP#]r';%rDM8VCd/ukiALh2M3+#HA+U3*sK\"hr0Xq^&YR<R4L?\"(R'ofok_aZXK-/QgKg;!rnBbe:A(ndiYV(?KBJ]E<X]GXiZPH2Nj??%Ebg#bTnMe?%bjHUg,Tc8XO]W,A*nh$O^C*+tXG7;sD$GJ[>,t2qCE=8F%/u9ohM8<V5!61ir#KLR,-`1Q4L?\"(*GN1t@9pQKBJ]EFdX$VOmcVt,rf4?dO]^3t/@6;m*GN1t@9l&JZl/c^Brs^(=\"THdaSh-tN4Hr]nQ<MFhF%:('Nhi%\"C3u9TZuE(]<K`e?2,h@c/@cl<fs'(4?Ttgr1)@8&Epu$!Gr$*VmVBb?2,h@c/@clhM4@o?9GS4r1)=g\"?Jc.IdhD^X%:TO*Zj#DIST3WLir:IU!;NYZrS=uWtn?Fj??(FbcTVR0'+&84ld,FJT\\\"ad\"RYbg'iGB$Th)0KoZ;h%\":re'aZqG_aBp0cY:''JM)<act;cg>,t3@KoZ;h%\":t;I0ar[`C$-2cY:'ZT_%d=#=#,oM?KL4iM\"NSkHs*$==513g'iF*CDDH,C9c8XmW2@I>[(uKb;[^na<-QHlW0.@$RZ+b)>nXoG+,'3*sK\"hr1)=f&p0RtLGjdWds<);?2,h@c/@cl<fs$_*sK\"hr1)@8&EqW%LGjdWds?^5kNC5'ISOYn#s->K6^tp<BtY%^:-LeI)>p#U.Kj>5@]>@BkGX?MD/(]g2pOM++-H]k<fs$_-O$jpr,rm\"R\\1$1\"gf0FSCT/&FIIu?2M7XNH632opaDf[i9.IJOe<((\"gf0FSC[QKkgYNG2M7XNHA+WIkKsfh:2:RN3mGQ0S&*Eb]aqAC5!61ir1)=f\"D-+mWK#]rW//\"==3$8t;p\"A9nqX$V\\lIghAquQOg'iGB$TlU/c41p\"Zl/e/egp=?ZS`7(D$E5%/UZaq[)5B7D$E5%onrY]mI3t<S&(/\"$Qo3jD=un^c/?XLKgME/mH;k-ISB&Bq2*goLPId?+4CuhoYK8PiM\"NSa0]0H%ffZ_QJ0E.N67ML2XHIeV>U*m-GLfIlX#]U%k#>?3[\"4r0'kF\"*^5JMF[5G?UpZ)u]&qtdgB#.JOk0C@f#(#Jr=0,4NjMiL=:ZLmG<@#C448Es_Rb'`ht)BVmmuaZ_Rc@02u#J_>\")n+oC1Z3JDflel[9')o&7@T!Q!ZUegc>qeRH;gJ[jSLPqglk+#!;bRWjiX,R)c$,!d#?$>;6jm4R`^5o2]lBJ]EDX]6Y11_1+6#!]$Y4p8Id;*^VecY9L*5o2]lBJ]EDXnO!cW>?(^#!]$Y$A$LKUEBE(eg_;SRYQYVK:gV=+(CdgG\\Ao.3NZ9eb,WEY)nF9l)0>+)N8%Gi]7^#).Bm\\)$+b(R5b#T.G@@BU]'rQ^S&*EbXWg'/H$F!Ypc5JN+jbq(!nn'3:2:RN]'rQ^S&*Eb]aoZh]m+3Hpc5HX#]tM:rSZkG<fs'(4?Ttgr1)@8&F8Dp6^tp<Brs]u<\\9WkaF0)kQoe*g`MI*g#Pg_b@,3:FFQ'$G2M9oT_G1bdiM1o]K:gUr7=n;+nBbe:F'A$\"TF2hFZl/e3eg_;SiM1o]K:gV=*s/!Zn^(n;F'>aYkkmR>_9Zht,!i,PG\\Ao.3N`$!f#`]&2M7XN>(rWN=tI(Dq](kUG<$2_=MJk462lr[=LX.j>rX:+c/?(CYgW_\\paDf[i9.IJOeC/c4L?\"(SC[QKke]gjD$E5&[>G)mpaDf[i9.K(LHqbD4L?\"(SCT1n3^8[Sn8hd68C2&l*nh$O:@!=aFn4Lbc/@cl<Zrll(/&N*5\"A&c/`UhalB9g@j:=h5FfQ);jJ7;aKAZ+6:'E]S.%niCa0].rd,dAPZl/e/[dXm%PE,e!%\":n9'`sqR'[UI]A(ndiJ1c3=ct;cWg-QCE/*>4iISB&B!aX*h6^toQBaZ$!](FsTc/?XL?4g#Z=tI(Dq\\YSQ[nL!f7cbTP*TWR*A)/XJlf#cLS&+Q;@AetTnDU(ci9s3P'o@(X_a9j/hiZLe&D\"aSLGje\",HXrkf#*8u2M8ahXnO!?Wtu.\\#(K-HY7T:`4M&AdOk(upl^ET_2M8ahXnO!?bD1d0K>/Y5<=%oj`DISbh[u,.G?fpf=MAe36iN/]=LX.j>rX:+c/?(CYgW_\\paDf[i9.IJOeC/c4L?\"(SC[QKke]gjD$E5&[>G)mpaDf[i9.K(LHqbD4L?\"(SCT1n3^8[Sn8hd68C2&l*nh$O:@!=aFn4Lbc/@cl<Zrll(/&N*5\"B2.X]':<^2`!srf@gr[u(;o3%:NFi4$>&df`tO.%niCkHn9PT[Q\"cZl/e3f)$$B_FFWD#!]#nM?I5[.%niCkHs*$5c7pNZl/e3eggka5EC9_F'>V8ctOOBg'iF*l[=S3o&6:ei9.IJ+XjB,95W`R7qKo8cL!TXDk-Q`59pE`XWg%I:'tYjq!B^#1dMpA$>;6j3NZ:,kVNe\\D$E5&of`Min52H?_9Zht,!d#/$>;6j3N`$!d&@flD$E5&oa68qc_DT[SCT/&FIIu?2M7XNH66UeI!B<\\pc5HV#g00d;B*0m;&OG7:\"*:\\ESa\"\\O;(g+M?I3E.A4rD\\%Aln\"C:dNTZuEXZrW<^dl]b\")>p#Uq[hu.7fdH25GtoH\"C:dNTZuEX[,-R'Vd;Km)>p#U.g.mtO+-S>>,t3@Bc\\>L%\":t;I>E%:iM\"NSkHn85.'\"+VD<*lNA^##G0V.Jfc9')hOojrMOe<(0\"gf0FFr,=jTF2hFZl/e3eg_;SRYQYVK:gV=*s,aC.%niCkHn9PTF2hFZl/e3f)$$Be;K)?K:gV=Kg=had1:\\$CD@.:c,2o<_9Zi/&$\\kn4L?\"(SCT.mA^t7hNSN]q33IC1L@_tP9]hAq'8d;bRSUgV*C\"s$I&t])jJ/ZFO,s$d:5.GGh\\qNAlGJ*5DEka=RbtCGrT)5q@tekP+2t@7Da/[eF=Q).4T)=6Da0Vtn.E0qO5ea,[i\\<0'uI)#'XnRdrF\"?r7pJpEMnaE(m0D*d7:*I^j4sY-\\:*YBe<S:9T[[OTR^miMWt=N9*Zj!nI8&rAJ`Jp7QJ\"fWDZXb_0C-1YgK$P>G<F1>p,Pjbkr?A$<k!t)7lZp^c0\"-[.6;-Q*KlKLcbrkHLJ0L<aI1%DhESA<LZIKDfW1$'(qI#`qn^$,6RXA\"o\"`s_Nuu4&qsQL5P2u5Rq!sbm?BG<t-WU0eVo\\;D??9kM8^W%..H89HTn:1<566\"`336,=LEAbXe+N4L=4?-VronI5rbuPs$gfj#rP(_3_7)Y+__eL_cJ>@D>)-fr&(dEaJ(XaF\\Gl6]m`M`)fCL65T>,[j]3i9'k@$Esqj1+700ckVg\\H6R^O12Xhi>Ua5(EAd%F]D<i&mM_gZ,?lI!>>Yeb/pd_lI_B12ZBiAQj;Ep%CZ\"DJba%ELAK;4M8DC/T\\GYIsYg0]\"MK1c+2ZiQQ$_nm3egPV7sSAk0<Sgeb9S]np9V[J4k4r3A/K-iOcie>lT1q^&RYBIJ`=/iVqeO4776)eN@4,AoCjs8RLBRa8M?KmgegShS!_(XL2cpcF`Am@p>_1F_iAZVU3n?HhZp.\\,ZHqnEStTE<PFII[tI<h0r-p_c3DRj#VApYM[!@GPCL\\_tBQX['c+(CU'FjANHoPZ,cJ.\\B`\"jf71M<-ZaXMgKd?%anbXK0V>Ids4(=h?lYKgFJm=3SuZ$t[t!:a)5#(Or;PYr\\&pOf_gL/iF2#<gfPJe!cf\\4Ha)A^EL,t<rKA@aCdXG?H)IDTMq`,a.OjAq:m=B6NqXuGF[9_DO8`t?PT!Hu`Rb?LRju2,!*SKW)I/SJ5<R/LpZZ)GgJN1?Aj5JhemIssohq1s^mD9fdb;@/]0.-5ceb-*7ESKj5!k1+![r\"']^]*16s7kU:T>11\"pV6^T3a%2S\\'WQp1tQ_s6Ebn7m]O(\\VVOY+gPenJ?'OZEl`4qrW3g2le+r)\\lalKc^%mNcd-=l^0@/m1C<MPfenp2s&X`tBlgAMW)qn'Sd-Y1hpt$=sg/C0mG3md^DcCI2Bb)H;)COV8p\\2H#p<sPe++F*j^\\ua_n,;5D5C`RlVt[qIIem^SgRipXr6PEBGkbLT^]*rM^YTM\"\\#T.lEF*Na7/PGgMu,_cro^K<[_qNj3Sba;55]<2osd+iErX_KI/ilWX6]Lu<V$.lMk$R/~>"].map(data=>add(`<< /Type /XObject /Subtype /Form /BBox [0 0 842 595] /Resources << /Font << /F1 ${font1} 0 R >> >> /Filter [/ASCII85Decode /FlateDecode] /Length ${data.length} >>\nstream\n${data}\nendstream`));
  const pageRefs=[];
  for(const stream of pageStreams){
    const content=add(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`);
    const page=add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /GridA ${grids[0]} 0 R /GridB ${grids[1]} 0 R >> /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${content} 0 R >>`);
    pageRefs.push(page);
  }
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj-1]=`<< /Type /Pages /Kids [${pageRefs.map(n=>`${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=new TextEncoder().encode(pdf).length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([new TextEncoder().encode(pdf)],{type:'application/pdf'});
}
function exportEasaStylePdf(){
  const {all,selected,firstPage,lastPages}=selectedExperiencePageRange();
  if(!selected.length)return host.alert('No professional experience matches this selection.');
  const chunks=[];for(let i=0;i<selected.length;i+=EASA_ROWS_PER_PAGE)chunks.push(selected.slice(i,i+EASA_ROWS_PER_PAGE));
  const streams=chunks.flatMap((rows,pageIndex)=>{
    let prior,pageNo;
    if(lastPages){
      const absolutePage=(firstPage||0)+pageIndex;
      prior=expTotals(all.slice(0,absolutePage*EASA_ROWS_PER_PAGE));
      pageNo=absolutePage+1;
    }else{
      const idx=all.findIndex(x=>x.id===rows[0]?.id&&x._experienceKind===rows[0]?._experienceKind);
      prior=expTotals(idx>0?all.slice(0,idx):[]);
      pageNo=idx>=0?Math.floor(idx/EASA_ROWS_PER_PAGE)+1:pageIndex+1;
    }
    const pageTotal=expTotals(rows),toDate=plusTotals(prior,pageTotal);
    return ['A','B'].map(side=>buildEasaPdfPage(rows,prior,pageTotal,toDate,pageNo,side));
  });
  const blob=makePdfDocument(streams);
  const name=`PilotLog_EASA_${today()}.pdf`;
  if(host.PilotLogNative?.isNative){
    return host.PilotLogNative.exportFile(name,blob,'application/pdf').catch(error=>{
      if(!/cancel|annul/i.test(error.message||''))host.alert('Esportazione PDF non riuscita: '+error.message);
    });
  }
  const url=host.URL.createObjectURL(blob);
  const a=host.document.createElement('a');
  a.href=url;a.target='_blank';a.rel='noopener';a.download=name;
  host.document.body.appendChild(a);a.click();a.remove();
  host.setTimeout(()=>host.URL.revokeObjectURL(url),60000);
}
return {EASA_ROWS_PER_PAGE,euDate,blankIfZero,blankCount,experienceFlights,experienceSims,experienceRows,easaSimulatorMinutes,slotSinglePilot,expTotals,plusTotals,selectedExperiencePageRange,pdfEsc,pdfText,pdfLine,pdfRect,easaCell,easaRemarksCell,buildEasaPdfPage,makePdfDocument,exportEasaStylePdf};
}
