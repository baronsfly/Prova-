const base=new URL('.',import.meta.url);
let pdfLibrary;
export async function loadPdf(nativeMode=false){
  if(!pdfLibrary){
    pdfLibrary=(async()=>{
      const pdf=await import('./vendor/pdfjs/pdf.min.js');
      pdf.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.js',base).href;
      if(nativeMode)globalThis.pdfjsWorker=await import('./vendor/pdfjs/pdf.worker.min.js');
      return pdf;
    })().catch(error=>{
      pdfLibrary=undefined;
      console.warn('PDF reader dependencies could not load',error);
      throw Error(`The PDF reader could not load (${error.message}). You can still save or export the original.`);
    });
  }
  return pdfLibrary;
}
export async function openPdf(blob,nativeMode=false){
  const pdf=await loadPdf(nativeMode);
  return pdf.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,useWorkerFetch:false,
    cMapUrl:new URL('./vendor/pdfjs/cmaps/',base).href,cMapPacked:true,
    standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',base).href,
    wasmUrl:new URL('./vendor/pdfjs/wasm/',base).href}).promise;
}
