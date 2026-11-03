// PDFium WebAssembly page renderer, bundled for both offline site and desktop.
// The original file is never edited. PDF.js remains available for search/export/fallback.
import { PDFiumLibrary } from '@hyzyla/pdfium';
let libraryPromise;
export async function createPdfiumDocument(bytes){
  if(!libraryPromise)libraryPromise=PDFiumLibrary.init({wasmUrl:new URL('./vendor/pdfium/pdfium.wasm',import.meta.url).href}).catch(error=>{libraryPromise=null;throw error});
  const library=await libraryPromise;
  const doc=await library.loadDocument(bytes);
  return {
    pages:doc.getPageCount(),
    async renderPage(number,scale){
      const page=doc.getPage(number-1);
      try{return await page.render({scale,render:'bitmap',renderFormFields:true})}
      finally{page.close()}
    },
    destroy(){doc.destroy()}
  };
}
