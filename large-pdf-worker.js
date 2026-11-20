// Runs in a dedicated Web Worker. One generated part is held at a time,
// and the next part is not produced until the UI confirms its IndexedDB save.
// The original PDF never leaves the user's device.
import { PDFDocument } from "./vendor/pdf-lib.esm.js";
import { splitLargePdf } from "./large-pdf-split.js";
let running = false;
let acknowledgement = null;
self.onmessage = async ({data}) => {
  if (data?.type === "saved" && acknowledgement) {
    const resolve = acknowledgement; acknowledgement = null; resolve();
    return;
  }
  if (data?.type !== "start" || running) return;
  running = true;
  try {
    let pages = 0;
    for await (const part of splitLargePdf(data.file, PDFDocument, value => {
      self.postMessage({type:"progress",...value});
    })) {
      pages = part.totalPages;
      self.postMessage({type:"part",...part});
      await new Promise(resolve => { acknowledgement = resolve; });
    }
    self.postMessage({type:"done",totalPages:pages});
  } catch (error) {
    self.postMessage({type:"error",message:String(error?.message||error||"تعذر تقسيم الكتاب")});
  } finally {
    running = false;
  }
};
