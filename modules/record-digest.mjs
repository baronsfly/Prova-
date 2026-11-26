export function stableHash128(value){
  const s=String(value||'');let h1=1779033703,h2=3144134277,h3=1013904242,h4=2773480762;
  for(let i=0,k;i<s.length;i++){k=s.charCodeAt(i);h1=h2^Math.imul(h1^k,597399067);h2=h3^Math.imul(h2^k,2869860233);h3=h4^Math.imul(h3^k,951274213);h4=h1^Math.imul(h4^k,2716044179)}
  h1=Math.imul(h3^(h1>>>18),597399067);h2=Math.imul(h4^(h2>>>22),2869860233);h3=Math.imul(h1^(h3>>>17),951274213);h4=Math.imul(h2^(h4>>>19),2716044179);
  const out=[(h1^h2^h3^h4)>>>0,(h2^h1)>>>0,(h3^h1)>>>0,(h4^h1)>>>0];return out.map(v=>v.toString(16).padStart(8,'0')).join('');
}

function canonicalJsonValue(v){
  if(Array.isArray(v))return v.map(canonicalJsonValue);
  if(v&&typeof v==='object'){const out=Object.create(null);for(const k of Object.keys(v).sort())out[k]=canonicalJsonValue(v[k]);return out}
  return v;
}
export function canonicalJsonStringify(v){return JSON.stringify(canonicalJsonValue(v??null))}
export function sectionDigest(v){return stableHash128(canonicalJsonStringify(v))}
export function legacySectionDigest(v){return stableHash128(JSON.stringify(v??null))}

const storedHashes=new WeakMap();
// Only use this cache for immutable records held by the database.
export function storedHash(row){
  if(row==null||typeof row!=='object')return contentHash(row);
  if(!storedHashes.has(row))storedHashes.set(row,contentHash(row));
  return storedHashes.get(row);
}
export function contentHash(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))return sectionDigest(value);
  const {_updatedAt,_syncRev,...content}=value;
  if(content.locked===false)delete content.locked;
  for(const key of ['manualFields','timeOverrides','fieldSources','logtenImportConflicts'])if(content[key]&&Object.keys(content[key]).length===0)delete content[key];
  return sectionDigest(content);
}
