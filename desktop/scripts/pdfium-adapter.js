// PDFium/WASM page renderer. Bundled locally for the website and desktop application.
// The original PDF bytes remain untouched; image pixels are used only for preview.
import { PDFiumLibrary } from '@hyzyla/pdfium/inline';
let libraryPromise=null;
export async function createPdfiumDocument(bytes){
  if(!libraryPromise)libraryPromise=PDFiumLibrary.init().catch(e=>{libraryPromise=null;throw e});
  const library=await libraryPromise;
  const doc=await library.loadDocument(bytes);
  return {
    pages:doc.getPageCount(),
    async renderPage(number,width,height){
      const p=doc.getPage(number-1);
      try{
        const size=p.getOriginalSize();
        const ratio=Math.min(width/size.originalWidth,height/size.originalHeight);
        return await p.render({scale:ratio,render:'bitmap',renderFormFields:true});
      }finally{p.close()}
    },
    destroy(){doc.destroy()}
  };
}
