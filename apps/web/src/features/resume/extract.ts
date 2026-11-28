import { err, ok, tryCatchAsync } from '@english-coach/contracts';
import type { Result, ValidationError } from '@english-coach/contracts';

export type ResumeFile = { readonly name: string; readonly type: string; readonly bytes: Uint8Array };
export type PdfTextItem = { readonly str: string; readonly hasEOL: boolean };
export type ExtractDeps = {
  readonly pdfPages: (bytes: Uint8Array) => Promise<readonly (readonly PdfTextItem[])[]>;
  readonly docxRawText: (bytes: Uint8Array) => Promise<string>;
};

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 只在被呼叫時才載入 pdfjs-dist（連同 worker）。 */
async function defaultPdfPages(bytes: Uint8Array): Promise<readonly (readonly PdfTextItem[])[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: PdfTextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if ('str' in item) items.push({ str: item.str, hasEOL: item.hasEOL });
    }
    pages.push(items);
  }
  return pages;
}

/** 只在被呼叫時才載入 mammoth。 */
async function defaultDocxRawText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export const defaultExtractDeps: ExtractDeps = {
  pdfPages: defaultPdfPages,
  docxRawText: defaultDocxRawText,
};

type FileKind = 'pdf' | 'docx' | 'unsupported';

function fileKind(file: ResumeFile): FileKind {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith('.pdf') || type === PDF_MIME) return 'pdf';
  if (name.endsWith('.docx') || type === DOCX_MIME) return 'docx';
  return 'unsupported';
}

function fail(message: string): Result<string, ValidationError> {
  return err({ kind: 'validation', issues: [{ path: 'file', message }], message });
}

function joinPages(pages: readonly (readonly PdfTextItem[])[]): string {
  return pages
    .map((items) => items.map((item) => (item.hasEOL ? `${item.str}\n` : item.str)).join(''))
    .join('\n');
}

export async function extractResumeText(
  file: ResumeFile,
  deps: ExtractDeps = defaultExtractDeps,
): Promise<Result<string, ValidationError>> {
  const kind = fileKind(file);
  if (kind === 'unsupported') return fail('unsupported file type');

  const read = await tryCatchAsync(
    async () => (kind === 'pdf' ? joinPages(await deps.pdfPages(file.bytes)) : await deps.docxRawText(file.bytes)),
    () => 'cannot read file',
  );
  if (!read.ok) return fail(read.error);
  if (read.value.trim() === '') return fail('no text found');
  return ok(read.value);
}
