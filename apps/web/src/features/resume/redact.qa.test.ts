import { describe, expect, it } from 'vitest';
import { redactPii } from './redact';
import redactSource from './redact.ts?raw';

const run = (input: string) => redactPii(input);

describe('T-035 QA redactPii', () => {
  it('(QA-1) emails: plus tags, subdomains, uppercase, and a trailing period stays outside the marker', () => {
    const r = run('A.B+cv@Sub.Example.COM and z@example.org.');
    expect(r.text).toBe('[email] and [email].');
    expect(r.removed.email).toBe(2);
  });

  it('(QA-2) a full-width at-sign is outside the interface and is left unchanged', () => {
    const input = 'write me：user＠example.com please';
    const r = run(input);
    expect(r.text).toBe(input);
    expect(r.removed.email).toBe(0);
  });

  it('(QA-3) an email inside a URL is still replaced with [email]', () => {
    const r = run('See https://example.com/u/jane.doe+cv@example.com thanks');
    expect(r.text).toBe('See https://example.com/u/[email] thanks');
    expect(r.removed.email).toBe(1);
  });

  it('(QA-4) Taiwan mobiles accept mixed separators and a bare 886 country code', () => {
    for (const n of ['0912.000-123', '0912-000.123', '886-912-000-123', '886 912000123']) {
      const r = run(n);
      expect(r.text, n).toBe('[phone]');
      expect(r.removed.phone, n).toBe(1);
    }
  });

  it('(QA-5) phones without an area or trunk prefix are kept, including 7-8 digit local numbers and a leading-9 mobile without 0', () => {
    for (const n of ['2000-1234', '500-0123', '912-000-123', '555-0123']) {
      const r = run(n);
      expect(r.text, n).toBe(n);
      expect(r.removed.phone, n).toBe(0);
    }
  });

  it('(QA-6) landline variants and an extension after the number: the number is replaced, the extension text stays', () => {
    expect(run('(07)2000-1234').text).toBe('[phone]');
    expect(run('04-2000-1234').text).toBe('[phone]');
    expect(run('049-200-0123').text).toBe('[phone]');
    expect(run('(02)2000-1234').text).toBe('[phone]');
    expect(run('02-2000-1234#12').text).toBe('[phone]#12');
    expect(run('02-2000-1234 ext. 12').text).toBe('[phone] ext. 12');
    expect(run('02-2000-1234分機12').text).toBe('[phone]分機12');
  });

  it('(QA-7) full-width digits are outside the interface and are left unchanged', () => {
    const input = '撥打 ０９１２-０００-１２３';
    const r = run(input);
    expect(r.text).toBe(input);
    expect(r.removed.phone).toBe(0);
  });

  it('(QA-8) a compact 10-digit US number without +1 is kept; 7-digit local US is kept; +1 compact is replaced', () => {
    expect(run('4155550123').text).toBe('4155550123');
    expect(run('555-0123').text).toBe('555-0123');
    expect(run('+14155550123').text).toBe('[phone]');
  });

  it('(QA-9) years, dates, money, GPA, scores, versions and ordinary URLs stay as-is', () => {
    const samples = [
      '2019-2023',
      '2019 - 2023',
      '2023-01-15',
      '2019/01/15',
      '$1,200,000',
      '99.9%',
      'v3.10.2',
      'GPA 3.87',
      '4.00/4.00',
      'TOEIC 990',
      'IELTS 7.5',
      '120/120',
      'https://example.com/v3.10.2',
      'https://linkedin.com/in/jane-example',
    ];
    for (const n of samples) {
      const r = run(n);
      expect(r.text, n).toBe(n);
      expect(r.removed).toEqual({ phone: 0, email: 0, address: 0 });
    }
  });

  it('(QA-10) Chinese addresses keep 巷/弄/樓/之 suffixes as one marker; a place without 號 is kept', () => {
    expect(run('台北市範例路1巷2弄3號4樓').text).toBe('[address]');
    expect(run('台北市範例路123號之5').text).toBe('[address]');
    expect(run('台北市範例路123號-2').text).toBe('[address]');
    expect(run('106台北市大安區範例路四段123號5樓').text).toBe('[address]');
    for (const s of ['台北市大安區', '範例路', '台北市範例路', '台北市123號', 'Taipei, Taiwan', 'San Jose, CA']) {
      const r = run(s);
      expect(r.text, s).toBe(s);
      expect(r.removed.address, s).toBe(0);
    }
  });

  it('(QA-11) names, a fictional national-id pattern, and a LinkedIn URL are out of scope and stay', () => {
    const input = 'Jane Example  A123456789  https://linkedin.com/in/jane-example';
    const r = run(input);
    expect(r.text).toBe(input);
    expect(r.removed).toEqual({ phone: 0, email: 0, address: 0 });
  });

  it('(QA-12) mixed Chinese and English: only phone, email and street address change; other characters stay', () => {
    const input = [
      '王範例 Jane Example',
      '信箱：jane.doe+cv@example.com 電話：0912-000-123',
      '地址：106台北市大安區範例路四段123號5樓',
      '經歷：Example Corp, 2019-2023, GPA 3.87, https://example.org/v3.10.2',
    ].join('\n');
    const r = run(input);
    expect(r.text).toBe(
      [
        '王範例 Jane Example',
        '信箱：[email] 電話：[phone]',
        '地址：[address]',
        '經歷：Example Corp, 2019-2023, GPA 3.87, https://example.org/v3.10.2',
      ].join('\n'),
    );
    expect(r.removed).toEqual({ phone: 1, email: 1, address: 1 });
    const again = run(r.text);
    expect(again.text).toBe(r.text);
    expect(again.removed).toEqual({ phone: 0, email: 0, address: 0 });
  });

  it('(QA-13) redact.ts is a pure module: no import, fetch, WebSocket or sendBeacon', () => {
    expect(redactSource).not.toMatch(/^\s*import\s/mu);
    expect(redactSource).not.toMatch(/\bimport\(/u);
    expect(redactSource).not.toMatch(/\bfetch\s*\(/u);
    expect(redactSource).not.toMatch(/\bXMLHttpRequest\b/u);
    expect(redactSource).not.toMatch(/\bWebSocket\b/u);
    expect(redactSource).not.toMatch(/\bsendBeacon\b/u);
  });

  it('(QA-20) a one-letter TLD is not an email; the trailing period of a valid email stays outside the marker', () => {
    expect(run('write user@example.c later').text).toBe('write user@example.c later');
    expect(run('user@example.com.').text).toBe('[email].');
    expect(run('user@example.c').removed.email).toBe(0);
  });
});
