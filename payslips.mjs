import {createPayslipCloud} from './payslip-cloud.mjs?v=16.12';
import {followingMonth,parseIbcPayslip,compareIbcPayslip} from './payslip-compare.mjs?v=16.12';
const $=id=>document.getElementById(id);
const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const bytesLabel=n=>n<1e6?`${(n/1000).toFixed(1)} KB`:`${(n/1e6).toFixed(2)} MB`;
import {openPdf} from './document-pdf.mjs';
export {loadPdf,openPdf} from './document-pdf.mjs';
const base=new URL('.',import.meta.url);
export function detectedMonth(text){
  const found=String(text).match(/For\s+Period\s*:\s*(0[1-9]|1[0-2])\s*\/\s*(\d{4})/i);
  return found?`${found[2]}-${found[1]}`:'';
}
export async function base64(blob){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(r.error);r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(blob)});
}
export function recordBlob(record){
  const binary=atob(record.data),bytes=new Uint8Array(binary.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:record.type});
}
async function fingerprint(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function imageElement(blob){
  const url=URL.createObjectURL(blob),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Image format not supported. Choose a JPEG or PNG.'));img.src=url});return img}finally{URL.revokeObjectURL(url)}
}
export async function compactImage(blob){
  const img=await imageElement(blob),ratio=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));canvas.width=canvas.height=0;
  return compressed&&compressed.size<blob.size?compressed:blob;
}
export function ocrWorkerSource(core,worker,languageData,languageUrl){
  return core+`\nself.fetch=async function(url){if(String(url)!==${JSON.stringify(languageUrl)})throw new Error('Unexpected OCR resource');return new Response(Uint8Array.from(atob(${JSON.stringify(languageData)}),c=>c.charCodeAt(0)),{status:200});};\n`+worker;
}
async function newOcr(status){
  const {default:{createWorker}}=await import('./vendor/ocr/tesseract.esm.min.js');
  const resources=await Promise.all(['tesseract-core-lstm.wasm.js','worker.min.js','eng.traineddata'].map(async name=>{
    const response=await fetch(new URL('./vendor/ocr/'+name,base));
    if(!response.ok)throw Error('Local OCR resource unavailable: '+name);
    return name.endsWith('.traineddata')?new Uint8Array(await response.arrayBuffer()):response.text();
  }));
  // Preload both core and language in a Blob worker: no custom-scheme imports or
  // network requests are needed inside a WebView worker.
  const languageUrl=new URL('./vendor/ocr/eng.traineddata',base).href;
  const languageData=await base64(new Blob([resources[2]]));
  const url=URL.createObjectURL(new Blob([ocrWorkerSource(resources[0],resources[1],languageData,languageUrl)],{type:'application/javascript'}));
  try{
    const worker=await createWorker('eng',1,{workerPath:url,workerBlobURL:false,langPath:new URL('./vendor/ocr/',base).href,gzip:false,cacheMethod:'none',
      logger:m=>{if(m.status==='recognizing text')status(`Reading text… ${Math.round(100*m.progress)}%`)}});
    const terminate=worker.terminate;
    worker.terminate=async()=>{try{return await terminate()}finally{URL.revokeObjectURL(url)}};
    return worker;
  }catch(e){URL.revokeObjectURL(url);throw e}
}
function pageText(items){
  const lines=[];
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const y=item.transform?.[5]||0,x=item.transform?.[4]||0;
    let line=lines.find(r=>Math.abs(r.y-y)<2);
    if(!line){line={y,items:[]};lines.push(line)}line.items.push({x,text:item.str});
  }
  return lines.sort((a,b)=>b.y-a.y).map(line=>line.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
}
export async function extractDocument(blob,status=()=>{},nativeMode=false){
  let worker,pdf;const texts=[],methods=[];
  const recognize=async input=>{worker ||= await newOcr(status);return (await worker.recognize(input)).data.text||''};
  try{
    if(blob.type==='application/pdf'){
      pdf=await openPdf(blob,nativeMode);
      for(let n=1;n<=pdf.numPages;n++){
        status(`Reading page ${n} / ${pdf.numPages}…`);
        const page=await pdf.getPage(n),content=await page.getTextContent();
        let text=pageText(content.items),method='text';
        if(text.replace(/[^\p{L}\p{N}]/gu,'').length<20){
          const original=page.getViewport({scale:1}),scale=Math.min(2.5,Math.sqrt(8e6/(original.width*original.height))),view=page.getViewport({scale});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
          try{await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;text=await recognize(canvas);method='OCR'}finally{canvas.width=canvas.height=0}
        }
        texts.push(text);methods.push(method);page.cleanup();
      }
    }else{texts.push(await recognize(blob));methods.push('OCR')}
    const text=texts.join('\n\n');
    return {text,method:[...new Set(methods)].join(' + '),pages:texts.length,month:detectedMonth(text)};
  }finally{if(worker)await worker.terminate();if(pdf)await pdf.destroy()}
}
// Browser fallback has its own archive, outside the operational database and its backups.
function browserStore(){
  async function open(){return new Promise((resolve,reject)=>{
    const q=indexedDB.open('pilotlog-local-payslips',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('documents',{keyPath:'id'});
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  })}
  async function action(mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('documents',mode);let result;fn(tx.objectStore('documents'),x=>{result=x});
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Save interrupted'));
  })}finally{db.close()}}
  return {list:()=>action('readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result.map(({data,...meta})=>meta))}),
    read:id=>action('readonly',(s,done)=>{s.get(id).onsuccess=e=>done(e.target.result)}),
    save:r=>action('readwrite',(s,done)=>{s.get(r.id).onsuccess=e=>{const old=e.target.result;if(!old)s.add(r);done({duplicate:!!old,record:old||r})}}),
    remove:id=>action('readwrite',s=>s.delete(id))};
}
export function initializePayslips({auth,forMonth,nativeMode=false,store=browserStore(),exportFile,
  extract=extractDocument,compact=compactImage}){
  const cloud=createPayslipCloud(auth,fetch,nativeMode);
  let sessionRevision=0;
  let archiveRevision=0;
  const owners=()=>{try{return JSON.parse(window.localStorage.getItem('pilotlog_payslip_owners_v1')||'{}')}catch{return {}}};
  const assign=(id,uid)=>{const map=owners();if(map[id]===uid)return;map[id]=uid;window.localStorage.setItem('pilotlog_payslip_owners_v1',JSON.stringify(map))};
  let draft=null,busy=false,viewerPdf=null,viewerPage=1,viewerBlob=null,viewerName='',previewUrl='',previewRevision=0,opener=null;
  const status=text=>{$('payslipStatus').textContent=text};
  const setBusy=value=>{busy=value;for(const id of ['payslipFile','payslipCamera','payslipSave','payslipCancel','payslipKeepOriginal'])$(id).disabled=value};
  const monthLabel=month=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00'));
  function updateComparisonHint(){
    const worked=$('payrollMonth').value||new Date().toISOString().slice(0,7),paid=followingMonth(worked);
    $('payslipCompareHint').textContent=`To check ${monthLabel(worked)}, upload the ${monthLabel(paid)} payslip. It is filed under the month printed on the document.`;
    $('payslipComparison').replaceChildren();
  }
  function clearDraft(){draft=null;$('payslipReview').classList.add('hidden');$('payslipText').value='';$('payslipFile').value='';$('payslipCamera').value=''}
  function button(label,fn){
    const b=document.createElement('button');
    b.type='button';b.className='secondary';b.textContent=label;
    b.addEventListener('click',()=>{
      const revision=archiveRevision;
      Promise.resolve().then(fn).catch(e=>{if(revision===archiveRevision)status(e.message)});
    });
    return b;
  }
  async function render(publish=false){
    const revision=++archiveRevision,container=$('payslipArchive'),month=$('payrollMonth').value||new Date().toISOString().slice(0,7);
    if(!store){container.textContent='Local archive unavailable.';return}
    const session=sessionRevision,active=()=>revision===archiveRevision;
    const ctx=await cloud.context(),ownerMap=owners();
    let records=(await store.list()).filter(row=>row.month===month&&(!ownerMap[row.id]||ownerMap[row.id]===ctx?.id));
    let cloudError='';
    if(ctx){

      try{
        const remote=await cloud.list(ctx,month),remoteIds=new Set(remote.map(row=>row.id));
        for(const local of publish?records:[]){
          if(session!==sessionRevision)return;
          assign(local.id,ctx.id);
          if(!remoteIds.has(local.id)){const doc=await store.read(local.id);if(session!==sessionRevision)return;remote.push(await cloud.save(ctx,doc,recordBlob(doc)))}
        }
        const byId=new Map(records.map(row=>[row.id,row]));
        remote.forEach(row=>byId.set(row.id,{...byId.get(row.id),...row}));records=[...byId.values()];
      }catch(e){cloudError=e.message}
    }
    if(ctx?.id!==(await cloud.context())?.id)return;
    if(revision!==archiveRevision||$('payrollMonth').value&&$('payrollMonth').value!==month)return;
    container.replaceChildren();
    if(cloudError){const warning=document.createElement('p');warning.textContent='Online archive unavailable. Local copies shown. '+cloudError;container.append(warning)}
    if(!records.length){const empty=document.createElement('p');empty.textContent=`No payslips saved for ${month}.`;container.append(empty);return}
    for(const row of records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))){
      const item=document.createElement('div');item.className='payslip-row';
      const name=document.createElement('b');name.textContent=`${row.month.slice(5)}/${row.month.slice(0,4)} · ${row.name}`;
      const size=document.createElement('div');size.className='small';size.textContent=`${bytesLabel(row.size)} · ${row.cloud?'Online':'Local • upload pending'}`;
      const getBlob=async()=>{
        const current=await cloud.context();
        if(!active()||ctx?.id!==current?.id)throw Error('Account changed. Reopen the month.');
        if(row.cloud&&current){
          let blob;
          try{blob=await cloud.read(current,row)}
          catch(error){
            if(!active())return;
            const doc=await store.read(row.id).catch(()=>null);
            if(doc)return recordBlob(doc);
            throw error;
          }
          if(!active())return;
          try{
            const data=await base64(blob);
            if(active()){assign(row.id,current.id);await store.save({...row,data})}
          }catch{/* The retrieved file can still be opened without a local copy. */}
          return blob;
        }
        return recordBlob(await store.read(row.id));
      };
      const actions=document.createElement('div');actions.className='actions';
      actions.append(button('Open',async()=>{const blob=await getBlob();if(active())await preview(blob,row.name,row.text)}),
        button('Export',async()=>{const blob=await getBlob();if(active())await exportBlob(blob,row.name)}),
        button('Delete',async()=>{if(busy)return;if(confirm(`Delete ${row.name} from this archive and online storage?`)){
          const current=await cloud.context();if(!active()||ctx?.id!==current?.id)throw Error('Account changed. Reopen the month.');
          // Also remove a possibly uploaded copy after an interrupted metadata write.
          if(current)await cloud.remove(current,row);
          const rows=await store.list();
          if(session!==sessionRevision)return;
          if(rows.some(local=>local.id===row.id))await store.remove(row.id);
          if(active()){await render();if(session===sessionRevision)status('Deleted.')}
        }}));
      item.append(name,size,actions);container.append(item);
    }
  }
  async function renderComparison(){
    const worked=$('payrollMonth').value||new Date().toISOString().slice(0,7),paid=followingMonth(worked),view=$('payslipComparison');
    view.textContent=`Checking the ${monthLabel(paid)} payslip…`;
    const revision=archiveRevision;
    try{
      const model=forMonth(worked);
      if(!model)throw Error('Payroll calculation unavailable.');
      if(model.regime!=='IBC')throw Error('Payslip comparison supports the IBC format.');
      const ctx=await cloud.context(),locals=(await store.list()).filter(row=>row.month===paid&&(!owners()[row.id]||owners()[row.id]===ctx?.id));
      let rows=[...locals];if(ctx){
        const remote=await cloud.list(ctx,paid),byId=new Map(rows.map(row=>[row.id,row]));
        remote.forEach(row=>byId.set(row.id,{...byId.get(row.id),...row}));rows=[...byId.values()];
      }
      if(!rows.length)throw Error(`Upload the ${monthLabel(paid)} payslip to check work completed in ${monthLabel(worked)}.`);
      const row=rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      let read=row.text||'';
      if(!read.trim()){
        const blob=row.cloud&&ctx?await cloud.read(ctx,row):recordBlob(await store.read(row.id));
        read=(await extract(blob,()=>{},nativeMode)).text||'';
      }
      const current=await cloud.context();
      if(revision!==archiveRevision||$('payrollMonth').value!==worked||ctx?.id!==current?.id)return;
      const parsed=parseIbcPayslip(read);
      if(!parsed||parsed.month!==paid)throw Error('The payslip text is unreadable or the month does not match. The saved PDF is available in the archive.');
      if(!parsed.complete)throw Error('The extracted amounts do not match the payslip total. Comparison paused. The PDF is available in the archive.');
      const result=compareIbcPayslip(parsed,model.projection);
      view.replaceChildren();
      const heading=document.createElement('h4');heading.append(button(row.name,async()=>{
        if((await cloud.context())?.id!==ctx?.id)throw Error('Account changed. Reopen the month.');
        const blob=row.cloud&&ctx?await cloud.read(ctx,row):recordBlob(await store.read(row.id));
        if(revision===archiveRevision)await preview(blob,row.name,row.text);
      }),` · work in ${monthLabel(worked)}`);view.append(heading);
      const table=document.createElement('div');table.className='payslip-comparison-table';
      const money=n=>Number.isFinite(n)?`${n.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} DHM`:'Check required';
      const add=(label,expected,actual,diff,detail='')=>{
        const line=document.createElement('div');line.className='payslip-comparison-row';
        const name=document.createElement('strong');name.textContent=label+(detail?` · ${detail}`:'');
        const values=document.createElement('span');values.textContent=`Expected ${money(expected)} · paid ${money(actual)} · ${Number.isFinite(diff)?`difference ${money(Math.abs(diff))}`:'comparison unavailable'}`;
        const flag=document.createElement('b');flag.className=Number.isFinite(diff)?diff>0.005?'payslip-due':'payslip-ok':'payslip-unknown';flag.textContent=Number.isFinite(diff)?diff>0.005?'DUE':diff<-.005?'OVERPAID':'MATCH':'CHECK REQUIRED';
        line.append(name,values,flag);table.append(line);
      };
      for(const item of result.rows){
        let detail='';if(item.label==='Credit H'&&result.hours!==null)detail=`${Math.floor(result.hours/60)}:${String(result.hours%60).padStart(2,'0')} paid`;
        if(item.label==='Training sectors'&&result.training!==null)detail=`${result.training} sectors paid`;
        if(item.label==='Simulator allowance'&&result.sims!==null)detail=`${result.sims} activities paid`;
        if(item.label==='Layover + Day OFF'){
          const p=model.projection;
          const duration=m=>Math.floor(m/60)+':'+String(m%60).padStart(2,'0');
          detail=`${p.dayOffCount} recorded days off (${money(p.dayOffPay)})`;
          if(Number.isFinite(result.layoverPaidMinutes)&&Number.isFinite(p.layMins)){
            const delta=p.layMins-result.layoverPaidMinutes;
            detail+=` · expected layover ${duration(p.layMins)}, derived ${duration(result.layoverPaidMinutes)} · ${duration(Math.abs(delta))} ${delta>0?'short':delta<0?'over':'difference'}`;
          }
        }
        add(item.label,item.expected,item.paid,item.difference,detail);
      }
      add('TOTAL',result.expected,result.paid,result.difference);view.append(table);
    }catch(error){if(revision===archiveRevision)view.textContent=error.message}
  }
  async function exportBlob(blob,name){
    if(exportFile){await exportFile(name,blob,blob.type);return}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function closePreview(){
    previewRevision++;$('payslipViewer').classList.add('hidden');
    if(viewerPdf){const previous=viewerPdf;viewerPdf=null;await previous.destroy()}
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}
    $('payslipPreviewContent').replaceChildren();viewerBlob=null;opener?.focus();
  }
  async function renderPage(){
    const revision=++previewRevision,pdf=viewerPdf;if(!pdf)return;
    $('payslipPrev').disabled=true;$('payslipNext').disabled=true;
    const page=await pdf.getPage(viewerPage);if(revision!==previewRevision)return;
    const original=page.getViewport({scale:1}),scale=Math.min(2,1600/original.width),view=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
    if(revision!==previewRevision)return;
    $('payslipPreviewContent').replaceChildren(canvas);$('payslipPage').textContent=`${viewerPage} / ${pdf.numPages}`;
    $('payslipPrev').disabled=viewerPage<=1;$('payslipNext').disabled=viewerPage>=pdf.numPages;
    page.cleanup();
  }
  async function preview(blob,name,text=''){
    const session=sessionRevision;
    await closePreview();if(session!==sessionRevision)return;opener=document.activeElement;viewerBlob=blob;viewerName=name;
    $('payslipViewer').classList.remove('hidden');$('payslipViewerTitle').textContent=name;
    $('payslipViewerText').textContent=text||'No text available.';
    $('payslipPreviewContent').textContent='Opening…';$('payslipPageControls').classList.toggle('hidden',blob.type!=='application/pdf');
    $('payslipViewerClose').focus();
    try{
      if(blob.type==='application/pdf'){const revision=previewRevision,pdf=await openPdf(blob,nativeMode);if(revision!==previewRevision){await pdf.destroy();return}viewerPdf=pdf;viewerPage=1;await renderPage()}
      else{previewUrl=URL.createObjectURL(blob);const img=new Image();img.alt='Payslip';img.src=previewUrl;$('payslipPreviewContent').replaceChildren(img)}
    }catch(e){
      if(viewerBlob!==blob)return;
      $('payslipPageControls').classList.add('hidden');
      const content=$('payslipPreviewContent');
      content.textContent=e.message;
      if(blob.type==='application/pdf'&&!nativeMode){
        previewUrl=URL.createObjectURL(blob);
        const original=document.createElement('a');
        original.className='secondary';original.href=previewUrl;original.target='_blank';original.rel='noopener';
        original.textContent='Open original PDF';
        content.append(document.createElement('br'),original);
      }
    }
  }
  async function acquire(file){
    if(busy||!file)return;
    const session=sessionRevision,active=()=>session===sessionRevision;
    clearDraft();setBusy(true);status('Reading document…');
    try{
      let type=file.type;
      if(/\.pdf$/i.test(file.name))type='application/pdf';
      if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(type))throw Error('Choose a PDF, JPEG, PNG or WebP file.');
      if(!file.size)throw Error('The selected file is empty.');
      const original=file.slice(0,file.size,type),id=await fingerprint(original);
      const ownerMap=owners(),current=await cloud.context();
      const duplicate=(await store.list()).find(x=>x.id===id&&(!ownerMap[x.id]||ownerMap[x.id]===current?.id));
      if(!active())return;
      if(duplicate){
        status(`Already saved: ${duplicate.month}. `);
        $('payslipStatus').append(button('Open document',async()=>{
          if((await cloud.context())?.id!==current?.id)throw Error('Account changed. Reopen the month.');
          const doc=await store.read(duplicate.id);if(active())await preview(recordBlob(doc),duplicate.name,duplicate.text);
        }));
        return;
      }
      let result={text:'',method:'',pages:0,month:''},readError='';
      try{result=await extract(original,message=>{if(active())status(message)},nativeMode)}catch(e){readError=`Text could not be read: ${e.message}. The original can still be saved.`}
      let blob=original;
      if(type!=='application/pdf'){try{blob=await compact(original)}catch{}}
      const name=blob.type!==type?file.name.replace(/\.[^.]+$/,'')+'.jpg':file.name;
      if(!active())return;
      draft={id,original,blob,originalName:file.name,name,...result};
      $('payslipDocumentMonth').value=result.month||'';
      $('payslipDocumentMonth').dispatchEvent(new window.Event('change'));
      $('payslipText').value=result.text;$('payslipFileSummary').textContent=`${name} · ${bytesLabel(blob.size)}${blob.size<original.size?` (original ${bytesLabel(original.size)})`:''}`;
      $('payslipKeepOriginal').checked=false;$('payslipOriginalChoice').classList.toggle('hidden',blob===original);
      $('payslipReview').classList.remove('hidden');status(!result.month?'Select the month and year printed on the document.':readError||(result.text.trim()?'Ready to save.':'No text detected. You can save the document.'));
    }catch(e){if(active())status(e.message)}finally{setBusy(false)}
  }
  $('payslipFile').addEventListener('change',e=>acquire(e.target.files[0]));
  $('payslipCamera').addEventListener('change',e=>acquire(e.target.files[0]));
  $('payslipCancel').addEventListener('click',()=>{if(!busy){clearDraft();status('')}});
  $('payslipKeepOriginal').addEventListener('change',()=>{if(draft){const original=$('payslipKeepOriginal').checked;$('payslipFileSummary').textContent=`${original?draft.originalName:draft.name} · ${bytesLabel((original?draft.original:draft.blob).size)}`}});
  $('payslipPreviewDraft').addEventListener('click',()=>{if(draft){const original=$('payslipKeepOriginal').checked;preview(original?draft.original:draft.blob,original?draft.originalName:draft.name,draft.text)}});
  $('payslipSave').addEventListener('click',async()=>{
    if(busy||!draft)return;
    const month=$('payslipDocumentMonth').value;if(!validMonth(month)){status('Choose the payslip month.');return}
    const session=sessionRevision,active=()=>session===sessionRevision;
    setBusy(true);status('Saving…');
    try{
      const original=$('payslipKeepOriginal').checked,blob=original?draft.original:draft.blob;
      const record={id:draft.id,month,name:original?draft.originalName:draft.name,type:blob.type,size:blob.size,originalSize:draft.original.size,text:draft.text,method:draft.method,pages:draft.pages,createdAt:new Date().toISOString(),data:await base64(blob)};
      const ctx=await cloud.context();if(!active())return;if(ctx)assign(record.id,ctx.id);
      const result=await store.save(record);if(!active())return;clearDraft();
      const saved=result.record||record;
      let pending='';
      if(ctx&&!result.duplicate&&ctx.id===(await cloud.context())?.id){
        try{const document=await store.read(record.id);if(active())await cloud.save(ctx,document,recordBlob(document))}
        catch(error){pending='Upload pending ('+saved.month+'): '+error.message}
      }
      if(!active())return;await render();if(active())status(pending|| (result.duplicate?'Already saved.':'Saved. Online status is shown beside the document.'));
    }catch(e){if(active())status(`Save failed: ${e.message}`)}finally{setBusy(false)}
  });
  $('payslipViewerClose').addEventListener('click',closePreview);
  $('payslipViewerExport').addEventListener('click',()=>{if(viewerBlob)exportBlob(viewerBlob,viewerName).catch(e=>status(e.message))});
  $('payslipPrev').addEventListener('click',()=>{if(viewerPdf&&viewerPage>1){viewerPage--;renderPage().catch(e=>status(e.message))}});
  $('payslipNext').addEventListener('click',()=>{if(viewerPdf&&viewerPage<viewerPdf.numPages){viewerPage++;renderPage().catch(e=>status(e.message))}});
  $('payslipViewer').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePreview()}else if(event.key==='Tab'){
    const controls=[...$('payslipViewer').querySelectorAll('button:not(:disabled),summary')].filter(x=>x.getClientRects().length),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }});
  const refresh=()=>{
    updateComparisonHint();
    $('payslipArchive').replaceChildren();
    const pending=render(),revision=archiveRevision;
    pending.catch(e=>{if(revision===archiveRevision)status(`Archive unavailable: ${e.message}`)});
  };
  $('payrollMonth').addEventListener('change',refresh);
  $('payslipCompare').addEventListener('click',renderComparison);
  $('payslipSync')?.addEventListener('click',()=>render(true).catch(e=>status(e.message)));

  window.addEventListener('pilotlog-auth-change',()=>{sessionRevision++;clearDraft();status('');closePreview();refresh()});
  window.addEventListener('pilotlog-close-payslip',closePreview);
  refresh();
}
