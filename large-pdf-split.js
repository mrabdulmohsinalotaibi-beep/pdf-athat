// Split oversized PDFs locally. Nothing is uploaded to a server.
export const PDF_PART_LIMIT = 75 * 1024 * 1024;
export const PDF_SPLIT_INPUT_LIMIT = 300 * 1024 * 1024;
export const readableSize = bytes => (bytes / (1024 * 1024)).toFixed(1) + " ميجابايت";

/**
 * Yield one valid PDF File at a time. Actual serialized size is checked, not
 * merely estimated from page count. A too-large candidate is retried with
 * fewer pages; the source File is never modified.
 */
export async function* splitLargePdf(file, PDFDocument, onProgress = () => {}) {
  if (file.size > PDF_SPLIT_INPUT_LIMIT) {
    throw Error("هذا الكتاب أكبر من 300 ميجابايت؛ حفاظًا على ذاكرة الجهاز، قسّمه أولًا بأداة مخصصة ثم أضف الأجزاء.");
  }
  const source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const totalPages = source.getPageCount();
  if (!totalPages) throw Error("لا توجد صفحات في هذا الكتاب.");
  const name = file.name.replace(/\.pdf$/i, "");
  let start = 0, index = 1;
  while (start < totalPages) {
    // Aim below the 75 MB ceiling to leave margin for PDF serialization.
    const estimate = Math.max(1, Math.floor(55 * 1024 * 1024 * totalPages / Math.max(file.size, 1)));
    let count = Math.min(totalPages - start, estimate);
    let part;
    while (true) {
      onProgress({ page: start + 1, totalPages, part: index });
      const output = await PDFDocument.create();
      const indices = Array.from({ length: count }, (_, i) => start + i);
      const pages = await output.copyPages(source, indices);
      for (const page of pages) output.addPage(page);
      const bytes = await output.save({ useObjectStreams: true });
      if (bytes.byteLength <= PDF_PART_LIMIT) {
        part = new File([bytes], `${name} (${index}).pdf`, { type: "application/pdf" });
        break;
      }
      if (count === 1) throw Error(`الصفحة ${start + 1} وحدها أكبر من 75 ميجابايت، ولا يمكن تقسيمها دون ضغطها.`);
      count = Math.max(1, Math.floor(count / 2));
    }
    yield { file: part, partNumber: index, firstPage: start + 1, lastPage: start + count, totalPages };
    start += count;
    index++;
  }
}
