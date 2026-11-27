import { describe, expect, it, vi } from 'vitest';
import { extractResumeText } from './extract';
import type { ExtractDeps, PdfTextItem, ResumeFile } from './extract';
import extractSource from './extract.ts?raw';

const bytes = new Uint8Array([1, 2, 3]);
const file = (name: string, type = ''): ResumeFile => ({ name, type, bytes });
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fakeDeps(over: Partial<ExtractDeps> = {}) {
  const pdfPages = vi.fn((): Promise<readonly (readonly PdfTextItem[])[]> => Promise.resolve([]));
  const docxRawText = vi.fn((): Promise<string> => Promise.resolve(''));
  const deps: ExtractDeps = { pdfPages, docxRawText, ...over };
  return { deps, pdfPages, docxRawText };
}

describe('T-035 QA extractResumeText', () => {
  it('(QA-14) type detection is case-insensitive for both the name and the MIME type', async () => {
    const pdfPages = vi.fn((): Promise<readonly (readonly PdfTextItem[])[]> =>
      Promise.resolve([[{ str: 'P', hasEOL: false }]]),
    );
    const docxRawText = vi.fn((): Promise<string> => Promise.resolve('D'));
    const deps: ExtractDeps = { pdfPages, docxRawText };
    expect(await extractResumeText(file('cv.PDF', 'APPLICATION/PDF'), deps)).toEqual({ ok: true, value: 'P' });
    expect(await extractResumeText(file('resume', 'APPLICATION/PDF'), deps)).toEqual({ ok: true, value: 'P' });
    expect(await extractResumeText(file('cv.DocX', DOCX_MIME.toUpperCase()), deps)).toEqual({ ok: true, value: 'D' });
    expect(pdfPages).toHaveBeenCalledTimes(2);
    expect(docxRawText).toHaveBeenCalledTimes(1);
  });

  it('(QA-15) a .doc or .txt file is rejected before either dependency is called', async () => {
    const { deps, pdfPages, docxRawText } = fakeDeps();
    const denied = await Promise.all([extractResumeText(file('cv.doc'), deps), extractResumeText(file('cv.txt'), deps)]);
    for (const r of denied) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.issues).toEqual([{ path: 'file', message: 'unsupported file type' }]);
      }
    }
    expect(pdfPages).not.toHaveBeenCalled();
    expect(docxRawText).not.toHaveBeenCalled();
  });

  it('(QA-16) empty, whitespace-only and image-only pages become no text found; thrown deps become cannot read file; neither case throws', async () => {
    const emptyPdf = await extractResumeText(
      file('cv.pdf'),
      fakeDeps({ pdfPages: () => Promise.resolve([[], [{ str: '   ', hasEOL: true }]]) }).deps,
    );
    const blankDocx = await extractResumeText(file('cv.docx'), fakeDeps({ docxRawText: () => Promise.resolve('\n\t  ') }).deps);
    const broken = await extractResumeText(
      file('cv.pdf'),
      fakeDeps({ pdfPages: () => Promise.reject(new Error('encrypted or corrupted')) }).deps,
    );
    const brokenDocx = await extractResumeText(
      file('cv.docx'),
      fakeDeps({ docxRawText: () => Promise.reject(new Error('bad zip')) }).deps,
    );
    for (const r of [emptyPdf, blankDocx]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.issues).toEqual([{ path: 'file', message: 'no text found' }]);
    }
    for (const r of [broken, brokenDocx]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.issues).toEqual([{ path: 'file', message: 'cannot read file' }]);
    }
  });

  it('(QA-17) success returns the raw text, including surrounding spaces, and does not redact PII', async () => {
    const raw = '  jane.doe+cv@example.com 0912-000-123 \n';
    const r = await extractResumeText(file('cv.docx'), fakeDeps({ docxRawText: () => Promise.resolve(raw) }).deps);
    expect(r).toEqual({ ok: true, value: raw });
  });

  it('(QA-18) PDF items are concatenated in order; hasEOL adds a newline; pages are joined with a newline; multi-column items have no extra spaces inserted', async () => {
    const r = await extractResumeText(
      file('cv.pdf'),
      fakeDeps({
        pdfPages: () =>
          Promise.resolve([
            [
              { str: 'ColA', hasEOL: false },
              { str: 'ColB', hasEOL: true },
              { str: 'Row2', hasEOL: false },
            ],
            [{ str: 'Page2', hasEOL: false }],
          ]),
      }).deps,
    );
    expect(r).toEqual({ ok: true, value: 'ColAColB\nRow2\nPage2' });
  });

  it('(QA-19) extract.ts only loads pdfjs-dist and mammoth through import(), passes PDF bytes as data (not a URL), and has no fetch/XHR/WebSocket/sendBeacon', () => {
    expect(extractSource).toMatch(/import\(\s*'pdfjs-dist'\s*\)/u);
    expect(extractSource).toMatch(/import\(\s*'mammoth'\s*\)/u);
    expect(extractSource).not.toMatch(/^\s*import\s+[^({].*pdfjs-dist/mu);
    expect(extractSource).not.toMatch(/^\s*import\s+[^({].*mammoth/mu);
    expect(extractSource).toMatch(/getDocument\(\s*\{\s*data:/u);
    expect(extractSource).not.toMatch(/getDocument\(\s*\{\s*url:/u);
    expect(extractSource).not.toMatch(/\bfetch\s*\(/u);
    expect(extractSource).not.toMatch(/\bXMLHttpRequest\b/u);
    expect(extractSource).not.toMatch(/\bWebSocket\b/u);
    expect(extractSource).not.toMatch(/\bsendBeacon\b/u);
  });
});
