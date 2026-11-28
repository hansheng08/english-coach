import { describe, expect, it } from 'vitest';
import { foldWidth, redactPii } from './redact';
import redactSource from './redact.ts?raw';

const run = (input: string) => redactPii(input);
const lines = (xs: readonly string[]) => xs.join('\n');

describe('redactPii', () => {
  it('(AC-T35-1) (TC-1) replaces emails and keeps the trailing period', () => {
    const r = run('Mail: jane.doe+cv@example.com, j_d@mail.example.org.');
    expect(r.text).toBe('Mail: [email], [email].');
    expect(r.removed.email).toBe(2);
  });

  it('(AC-T35-2) (TC-2) replaces Taiwan mobile numbers in every format', () => {
    const input = lines(['0912-000-123', '0912 000 123', '0912000123', '+886 912 000 123', '+886-912-000-123', '(+886) 912000123']);
    const r = run(input);
    expect(r.text).toBe(lines(Array.from({ length: 6 }, () => '[phone]')));
    expect(r.removed.phone).toBe(6);
  });

  it('(AC-T35-2) (TC-3) replaces Taiwan landline numbers', () => {
    for (const n of ['(02) 2000-1234', '02-2000-1234', '03-500-0123', '+886-2-2000-1234', '+886 3 500 0123']) {
      expect(run(n).text).toBe('[phone]');
    }
  });

  it('(AC-T35-3) (TC-4) replaces US numbers', () => {
    for (const n of ['(415) 555-0123', '415-555-0123', '415.555.0123', '+1 415 555 0123', '1-415-555-0123', '+14155550123']) {
      const r = run(n);
      expect(r.text).toBe('[phone]');
      expect(r.removed.phone).toBe(1);
    }
  });

  it('(AC-T35-4) (TC-5) keeps numbers that are not phones', () => {
    for (const n of ['2019-2023', '2019 - 2023', '2023-01-15', '$1,200,000', '99.9%', 'v3.10.2', '2000-1234', '4155550123', 'ID 0123456789012']) {
      const r = run(n);
      expect(r.text).toBe(n);
      expect(r.removed.phone).toBe(0);
    }
  });

  it('(AC-T35-2) (AC-T35-4) (TC-6) replaces a phone inside a sentence only', () => {
    expect(run('Call 0912-000-123 (2019-2023) or email me').text).toBe('Call [phone] (2019-2023) or email me');
  });

  it('(AC-T35-5) (TC-7) replaces US street addresses as one marker', () => {
    const input = lines(['123 Example St, Apt 4B, Springfield, IL 62704', '1600 Sample Avenue', '45 Example Rd. Suite 200']);
    const r = run(input);
    expect(r.text).toBe(lines(['[address]', '[address]', '[address]']));
    expect(r.removed.address).toBe(3);
  });

  it("(AC-T35-5) (TC-8) replaces Taiwan English addresses", () => {
    const input = lines([
      "5F., No. 123, Sec. 4, Example Rd., Da'an Dist., Taipei City 106, Taiwan",
      'No. 8-2, Ln. 10, Sample St., Hsinchu City 300',
    ]);
    expect(run(input).text).toBe(lines(['[address]', '[address]']));
  });

  it('(AC-T35-5) (TC-9) replaces Chinese addresses', () => {
    const input = lines(['106台北市大安區範例路四段123號5樓', '新竹縣竹北市範例街8巷2號']);
    const r = run(input);
    expect(r.text).toBe(lines(['[address]', '[address]']));
    expect(r.removed.address).toBe(2);
  });

  it('(AC-T35-6) (TC-10) keeps places, organisations and plain sentences', () => {
    for (const s of ['Taipei, Taiwan', 'San Jose, CA 95134', 'No. 1 in sales', 'Example Semiconductor Co., Ltd.', 'National Example University']) {
      const r = run(s);
      expect(r.text).toBe(s);
      expect(r.removed.address).toBe(0);
    }
  });

  const resume = lines([
    'Jane Example',
    'jane@example.com | 0912-000-123',
    '123 Example St, Apt 4B, Springfield, IL 62704',
    '',
    'Experience',
    '- Example Corp, 2019-2023: raised throughput by 35%.',
  ]);
  const expected = lines([
    'Jane Example',
    '[email] | [phone]',
    '[address]',
    '',
    'Experience',
    '- Example Corp, 2019-2023: raised throughput by 35%.',
  ]);

  it('(AC-T35-7) (TC-11) changes only the marked parts of a whole resume', () => {
    const r = run(resume);
    expect(r.text).toBe(expected);
    expect(r.removed).toEqual({ phone: 1, email: 1, address: 1 });
  });

  it('(AC-T35-7) (TC-12) is idempotent', () => {
    const once = run(resume);
    const twice = run(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.removed).toEqual({ phone: 0, email: 0, address: 0 });
  });

  it('(AC-T35-7) (TC-18) redact.ts has no imports', () => {
    expect(redactSource).not.toMatch(/^\s*import\s/mu);
    expect(redactSource).not.toMatch(/\bimport\(/u);
  });
});

describe('redactPii full-width, city abbreviations, year ranges (T-035b)', () => {
  it('(AC-T35-10) (TC-19) foldWidth converts only full-width ASCII and ideographic space', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['０９１２－０００－１２３', '0912-000-123'],
      ['ａ＠ｂ．ｃｏ', 'a@b.co'],
      ['Ａ　Ｂ', 'A B'],
      ['台北，你好', '台北,你好'],
      ['', ''],
    ];
    for (const [input, expected] of cases) {
      const folded = foldWidth(input);
      expect(folded).toBe(expected);
      expect(folded.length).toBe(input.length);
    }
  });

  it('(AC-T35-10) (TC-20) replaces full-width phone numbers', () => {
    const a = run('撥打 ０９１２-０００-１２３');
    expect(a.text).toBe('撥打 [phone]');
    expect(a.removed.phone).toBe(1);
    const b = run('（０２）２０００－１２３４');
    expect(b.text).toBe('[phone]');
    expect(b.removed.phone).toBe(1);
  });

  it('(AC-T35-10) (TC-21) replaces full-width emails and keeps full-width punctuation', () => {
    const a = run('write me：user＠example.com please');
    expect(a.text).toBe('write me：[email] please');
    expect(a.removed.email).toBe(1);
    const b = run('ＪＡＮＥ＠ＥＸＡＭＰＬＥ．ＣＯＭ。');
    expect(b.text).toBe('[email]。');
    expect(b.removed.email).toBe(1);
  });

  it('(AC-T35-10) (TC-22) leaves everything except the marker untouched', () => {
    const input = '在ＡＢＣ公司工作，負責（後端）開發，電話：０９１２－０００－１２３，謝謝';
    const r = run(input);
    expect(r.text).toBe('在ＡＢＣ公司工作，負責（後端）開發，電話：[phone]，謝謝');
    expect(r.removed).toEqual({ phone: 1, email: 0, address: 0 });
  });

  it('(AC-T35-11) (TC-23) replaces addresses that start with a city abbreviation', () => {
    for (const a of ['北市範例路123號', '新北市範例街8巷2號', '中市範例大道一段5號3樓']) {
      const r = run(a);
      expect(r.text).toBe('[address]');
      expect(r.removed.address).toBe(1);
    }
    const full = run('地址：高市範例路１２號之１');
    expect(full.text).toBe('地址：[address]');
    expect(full.removed.address).toBe(1);
  });

  it('(AC-T35-11) (TC-24) keeps abbreviations that are not addresses', () => {
    for (const a of ['北市', '北市範例路', '北市123號', '新北分公司', '中市府']) {
      const r = run(a);
      expect(r.text).toBe(a);
      expect(r.removed.address).toBe(0);
    }
  });

  it('(AC-T35-12) (TC-25) keeps area code plus two years', () => {
    for (const a of ['06-2019-2021', '(06)2019-2021', '02 2019 2020', 'Example Corp 06-2019-2021']) {
      const r = run(a);
      expect(r.text).toBe(a);
      expect(r.removed.phone).toBe(0);
    }
  });

  it('(AC-T35-12) (TC-26) still replaces landlines that are not year ranges', () => {
    for (const a of ['06-2019-3456', '06-1899-2021', '02-2000-1234', '049-200-0123']) {
      const r = run(a);
      expect(r.text).toBe('[phone]');
      expect(r.removed.phone).toBe(1);
    }
  });

  it('(AC-T35-13) (TC-27) is idempotent on the new cases and stays import-free', () => {
    const inputs = [
      '撥打 ０９１２-０００-１２３',
      '（０２）２０００－１２３４',
      'write me：user＠example.com please',
      'ＪＡＮＥ＠ＥＸＡＭＰＬＥ．ＣＯＭ。',
      '在ＡＢＣ公司工作，電話：０９１２－０００－１２３，謝謝',
      '北市範例路123號',
      '地址：高市範例路１２號之１',
    ];
    for (const input of inputs) {
      const once = run(input);
      const twice = run(once.text);
      expect(twice.text).toBe(once.text);
      expect(twice.removed).toEqual({ phone: 0, email: 0, address: 0 });
    }
    expect(redactSource).not.toMatch(/^\s*import\s/mu);
  });
});
