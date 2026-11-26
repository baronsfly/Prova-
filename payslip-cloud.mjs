// Private Supabase Storage: <account UUID>/<YYYY-MM>/<document hash>.
export const PAYSLIP_BUCKET='pilotlog-payslips';
const monthOK=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const idOK=id=>/^[a-f0-9]{64}$/.test(id);
export function createPayslipCloud(auth,fetcher=fetch,nativeMode=false){
  async function context(){const session=await auth?.session();if(!session?.user?.id||!session.access_token)return null;return {id:session.user.id,token:session.access_token}}
  async function request(ctx,path,{method='GET',body,contentType}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      // Capacitor's native fetch bridge recognizes File and encodes it as base64.
      // A plain Blob otherwise crosses the bridge as an unserializable JS object.
      if(nativeMode&&body instanceof Blob&&!(body instanceof File))body=new File([body],'payslip.document',{type:contentType||body.type||'application/octet-stream'});
      const r=await fetcher(`${auth.url()}/storage/v1${path}`,{method,signal:controller.signal,headers:{apikey:auth.key(),Authorization:`Bearer ${ctx.token}`,...(contentType?{'Content-Type':contentType}:{}),'x-upsert':'true'},body});
      if(!r.ok){const message=await r.text();throw Error(`Payslip cloud ${r.status}: ${message.slice(0,200)}`)}
      return r;
    }finally{clearTimeout(timer)}
  }
  function path(ctx,month,id){if(!monthOK(month)||!idOK(id))throw Error('Invalid payslip reference');return `${ctx.id}/${month}/${id}`}
  function encode(p){return p.split('/').map(encodeURIComponent).join('/')}
  async function list(ctx,month){
    if(!monthOK(month))return [];
    const prefix=`${ctx.id}/${month}`,rows=[];let offset=0;
    for(;;){const r=await request(ctx,`/object/list/${PAYSLIP_BUCKET}`,{method:'POST',contentType:'application/json',body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})});const page=await r.json();
      for(const item of page){if(!/^[a-f0-9]{64}\.json$/.test(item.name))continue;const response=await request(ctx,`/object/authenticated/${PAYSLIP_BUCKET}/${encode(prefix+'/'+item.name)}`);const meta=await response.json();if(meta.month===month&&idOK(meta.id))rows.push({...meta,cloud:true})}
      if(page.length<100)break;offset+=page.length;
    }return rows;
  }
  async function save(ctx,record,blob){
    const p=path(ctx,record.month,record.id),{data,...meta}=record;
    await request(ctx,`/object/${PAYSLIP_BUCKET}/${encode(p+'.document')}`,{method:'POST',contentType:record.type,body:blob});
    await request(ctx,`/object/${PAYSLIP_BUCKET}/${encode(p+'.json')}`,{method:'POST',contentType:'application/json',body:JSON.stringify(meta)});
    return {...meta,cloud:true};
  }
  async function read(ctx,meta){const p=path(ctx,meta.month,meta.id);return (await request(ctx,`/object/authenticated/${PAYSLIP_BUCKET}/${encode(p+'.document')}`)).blob()}
  async function remove(ctx,meta){const p=path(ctx,meta.month,meta.id);await request(ctx,`/object/${PAYSLIP_BUCKET}`,{method:'DELETE',contentType:'application/json',body:JSON.stringify({prefixes:[p+'.json',p+'.document']})})}
  return {context,list,save,read,remove};
}
