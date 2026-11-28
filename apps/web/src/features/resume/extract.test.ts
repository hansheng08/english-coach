import { describe, expect, it, vi } from 'vitest';
import { extractResumeText } from './extract';
import type { ExtractDeps, PdfTextItem, ResumeFile } from './extract';

const bytes = new Uint8Array([1, 2, 3]);
const file = (name: string, type = ''): ResumeFile => ({ name, type, bytes });
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fakeDeps(over: Partial<ExtractDeps> = {}) {
  const pdfPages = vi.fn((): Promise<readonly (readonly PdfTextItem[])[]> => Promise.resolve([]));
  const docxRawText = vi.fn((): Promise<string> => Promise.resolve(''));
  const deps: ExtractDeps = { pdfPages, docxRawText, ...over };
  return { deps, pdfPages, docxRawText };
}

const unsupported = {
  ok: false,
  error: { kind: 'validation', issues: [{ path: 'file', message: 'unsupported file type' }], message: 'unsupported file type' },
};

describe('extractResumeText', () => {
  it('(AC-T35-8) (TC-13) joins PDF text items by page and end-of-line flag', async () => {
    const { deps } = fakeDeps({
      pdfPages: () =>
        Promise.resolve([
          [
            { str: 'A', hasEOL: false },
            { str: 'B', hasEOL: true },
            { str: 'C', hasEOL: false },
          ],
          [{ str: 'D', hasEOL: false }],
        ]),
    });
    expect(await extractResumeText(file('cv.PDF'), deps)).toEqual({ ok: true, value: 'AB\nC\nD' });
  });

  it('(AC-T35-8) (TC-14) detects the type by extension or MIME and rejects the rest', async () => {
    const docxRawText = vi.fn((): Promise<string> => Promise.resolve('Hello'));
    const { deps, pdfPages } = fakeDeps({ docxRawText });
    expect(await extractResumeText(file('cv.docx'), deps)).toEqual({ ok: true, value: 'Hello' });
    expect(await extractResumeText(file('resume', DOCX_MIME), deps)).toEqual({ ok: true, value: 'Hello' });

    const guarded = fakeDeps();
    expect(await extractResumeText(file('cv.doc'), guarded.deps)).toEqual(unsupported);
    expect(await extractResumeText(file('cv.txt'), guarded.deps)).toEqual(unsupported);
    expect(guarded.pdfPages).not.toHaveBeenCalled();
    expect(guarded.docxRawText).not.toHaveBeenCalled();
    expect(pdfPages).not.toHaveBeenCalled();
    expect(docxRawText).toHaveBeenCalledTimes(2);
  });

  it('(AC-T35-8) (TC-15) reports unreadable and empty files as validation errors', async () => {
    const broken = fakeDeps({ pdfPages: () => Promise.reject(new Error('boom')) });
    expect(await extractResumeText(file('cv.pdf'), broken.deps)).toEqual({
      ok: false,
      error: { kind: 'validation', issues: [{ path: 'file', message: 'cannot read file' }], message: 'cannot read file' },
    });
    const blank = fakeDeps({ docxRawText: () => Promise.resolve('  \n ') });
    expect(await extractResumeText(file('cv.docx'), blank.deps)).toEqual({
      ok: false,
      error: { kind: 'validation', issues: [{ path: 'file', message: 'no text found' }], message: 'no text found' },
    });
  });

  it('(AC-T35-8) (TC-16) does not redact the extracted text', async () => {
    const { deps } = fakeDeps({ docxRawText: () => Promise.resolve('a@example.com') });
    expect(await extractResumeText(file('cv.docx'), deps)).toEqual({ ok: true, value: 'a@example.com' });
  });
});
