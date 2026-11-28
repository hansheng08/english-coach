import { describe, expect, it } from 'vitest';
import { foldWidth, redactPii } from './redact';
import redactSource from './redact.ts?raw';

const run = (input: string) => redactPii(input);

describe('T-035 QA redactPii', () => {
  it('(QA-1) emails: plus tags, subdomains, uppercase, and a trailing period stays outside the marker', () => {
    const r = run('A.B+cv@Sub.Example.COM and z@example.org.');
    expect(r.text).toBe('[email] and [email].');
    expect(r.removed.email).toBe(2);
  });

  it('(QA-2) a full-width at-sign is folded and the email is replaced; a full-width colon stays', () => {
    const input = 'write me：user＠example.com please';
    const r = run(input);
    expect(r.text).toBe('write me：[email] please');
    expect(r.removed.email).toBe(1);
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

  it('(QA-7) full-width digits are folded and the mobile number is replaced', () => {
    const input = '撥打 ０９１２-０００-１２３';
    const r = run(input);
    expect(r.text).toBe('撥打 [phone]');
    expect(r.removed.phone).toBe(1);
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

const toFull = (s: string): string =>
  Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    if (c === ' ') return '\u3000';
    return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : c;
  }).join('');
const ABBREVIATIONS = [
  '北市', '新北', '桃市', '中市', '南市', '高市', '基市', '竹市', '竹縣', '苗縣',
  '彰縣', '投縣', '雲縣', '嘉市', '嘉縣', '屏縣', '宜縣', '花縣', '東縣', '澎縣',
] as const;

describe('T-035b QA foldWidth, full-width redaction, city abbreviations and year ranges', () => {
  it('(QA-21) (AC-T35-10) foldWidth maps exactly U+FF01..U+FF5E and U+3000; the neighbours, ASCII, NBSP and astral characters are untouched; length never changes', () => {
    for (let c = 0xff01; c <= 0xff5e; c += 1) expect(foldWidth(String.fromCharCode(c))).toBe(String.fromCharCode(c - 0xfee0));
    for (let c = 0x00; c <= 0x7f; c += 1) expect(foldWidth(String.fromCharCode(c))).toBe(String.fromCharCode(c));
    expect(foldWidth('\u3000')).toBe(' ');
    for (const c of ['\uff00', '\uff5f', '\uff61', '\uffe5', '\u00a0', '\u3001', '\u3002', 'é', '台']) expect(foldWidth(c)).toBe(c);
    const mixed = '😀０ａ　Ａ𝒳，.';
    expect(foldWidth(mixed)).toBe('😀0a A𝒳,.');
    expect(foldWidth(mixed).length).toBe(mixed.length);
    expect(foldWidth('')).toBe('');
  });

  it('(QA-22) (AC-T35-10) full-width variants of every phone and email shape give the same result as the half-width form', () => {
    const wholeMatches: readonly [string, keyof ReturnType<typeof run>['removed']][] = [
      ['0912-000-123', 'phone'],
      ['+886 912 000 123', 'phone'],
      ['(02) 2000-1234', 'phone'],
      ['(212) 555-0142', 'phone'],
      ['user+tag@example.com', 'email'],
      ['12 Example Rd., Taipei City', 'address'],
      ['No. 12, Example Rd., Taiwan', 'address'],
      ['123 Main St, Exampleville, EX 12345', 'address'],
    ];
    for (const [ascii, kind] of wholeMatches) {
      const half = run(ascii);
      const full = run(toFull(ascii));
      expect(full.removed, ascii).toEqual(half.removed);
      expect(foldWidth(full.text), ascii).toBe(half.text);
      expect(full.removed[kind], ascii).toBeGreaterThan(0);
    }
  });

  it('(QA-23) (AC-T35-10) full-width separators around a marker stay full-width: ideographic space, comma and colon are not folded in the output', () => {
    expect(run('電話：０９１２　０００　１２３，謝謝').text).toBe('電話：[phone]，謝謝');
    expect(run('信箱：ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ，謝謝').text).toBe('信箱：[email]，謝謝');
    expect(run('ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ資料').text).toBe('[email]資料');
    expect(run('電話　０２　２０００　１２３４').text).toBe('電話　[phone]');
  });

  it('(QA-24) (AC-T35-10) text without personal data is returned byte-for-byte even when it is full of full-width characters', () => {
    const input = '２０２４年，ＡＢＣ公司（台北）：負責Ｋ８Ｓ維運～　成效＋３０％！';
    const r = run(input);
    expect(r.text).toBe(input);
    expect(r.removed).toEqual({ phone: 0, email: 0, address: 0 });
  });

  it('(QA-25) (AC-T35-10) several replacements of different kinds in one full-width line keep raw and folded text aligned', () => {
    const input = '電話０９１２－０００－１２３；信箱ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ；北市範例路１２號；年份０６－２０１９－２０２１；Ｎｏ．１２，Ｅｘａｍｐｌｅ　Ｒｄ．，Ｉ　ｌｉｋｅ　ｔｅａ';
    const r = run(input);
    expect(r.text).toBe('電話[phone]；信箱[email]；[address]；年份０６－２０１９－２０２１；[address]，Ｉ　ｌｉｋｅ　ｔｅａ');
    expect(r.removed).toEqual({ phone: 1, email: 1, address: 2 });
    const again = run(r.text);
    expect(again.text).toBe(r.text);
    expect(again.removed).toEqual({ phone: 0, email: 0, address: 0 });
  });

  it('(QA-26) (AC-T35-11) each of the 20 listed abbreviations starts an address; the match needs a street word and a trailing 號', () => {
    expect(ABBREVIATIONS).toHaveLength(20);
    for (const a of ABBREVIATIONS) {
      const r = run(`${a}範例路1號`);
      expect(r.text, a).toBe('[address]');
      expect(r.removed.address, a).toBe(1);
      expect(run(`${a}範例路1號`.replace('範例路1號', '範例路')).removed.address, a).toBe(0);
      expect(run(`${a}12號`).removed.address, a).toBe(0);
    }
    for (const street of ['路', '街', '大道', '巷', '弄']) {
      expect(run(`北市範例${street}8號`).text, street).toBe('[address]');
      expect(run(`北市範例${street}8`).text, street).toBe(`北市範例${street}8`);
    }
    expect(run('北市範例路1號之2').text).toBe('[address]');
    expect(run('北市範例路1號3樓').text).toBe('[address]');
    expect(run('北市範例路1號-4').text).toBe('[address]');
    expect(run('100北市範例路1號').text).toBe('[address]');
  });

  it('(QA-27) (AC-T35-11) abbreviations outside the list are not addresses; surrounding Chinese text never lets an abbreviated address survive', () => {
    for (const input of ['北縣範例路1號', '台市範例路1號', '中縣範例路1號', '新市範例路1號']) {
      expect(run(input).text, input).toBe(input);
    }
    for (const input of ['我住北市範例路123號', '我們在北市範例路1號', '地址是北市範例路1號，謝謝']) {
      const r = run(input);
      expect(r.removed.address, input).toBe(1);
      expect(r.text, input).not.toMatch(/範例|路|\d/u);
    }
  });

  it('(QA-28) (AC-T35-12) area code plus two years is kept for every area, separator and year in 1900..2099; any other second or first group is still a phone', () => {
    const kept: string[] = [];
    for (const area of ['02', '03', '04', '05', '06', '07', '08', '037', '049', '(02)', '(037)']) {
      for (const sep of ['-', ' ', '.', '']) {
        if (sep === '' && !area.startsWith('(')) continue;
        for (const y1 of ['1900', '1999', '2000', '2099']) {
          for (const y2 of ['1900', '1999', '2000', '2099']) kept.push(`${area}${sep}${y1}-${y2}`, `${area}${sep}${y1} ${y2}`, `${area}${sep}${y1}.${y2}`);
        }
      }
    }
    for (const s of kept) {
      const r = run(s);
      expect(r.text, s).toBe(s);
      expect(r.removed.phone, s).toBe(0);
    }
    for (const s of ['06-2019-2100', '06-2019-1899', '06-2100-2019', '06-1899-2019', '06-3019-2021', '06-2019-3021', '02-2019-2121']) {
      expect(run(s).text, s).toBe('[phone]');
      expect(run(s).removed.phone, s).toBe(1);
    }
  });

  it('(QA-29) (AC-T35-12) a kept year range does not hide other numbers on the line, and an international-format number is not a year range', () => {
    const r = run('06-2019-2021, 02-2000-1234 and 0912-000-123');
    expect(r.text).toBe('06-2019-2021, [phone] and [phone]');
    expect(r.removed.phone).toBe(2);
    expect(run('Example Corp 06-2019-2021, 0912-000-123').text).toBe('Example Corp 06-2019-2021, [phone]');
    expect(run('+886-2-2019-2021').text).toBe('[phone]');
    expect(run('０６－２０１９－２０２１、０２－２０００－１２３４').text).toBe('０６－２０１９－２０２１、[phone]');
    expect(run('02-2019-2021').text).toBe('02-2019-2021');
    for (const s of ['0620192021', '06-20192021', '(06)20192021']) {
      expect(run(s).text, s).toBe('[phone]');
      expect(run(s).removed.phone, s).toBe(1);
    }
  });

  it('(QA-30) (AC-T35-13) the full-width folding is not NFKC and redact.ts stays import-free; foldWidth is the only new export', () => {
    expect(redactSource).not.toMatch(/\.normalize\s*\(/u);
    expect(redactSource).not.toMatch(/^\s*import\s/mu);
    const exported = [...redactSource.matchAll(/^export\s+(?:async\s+)?(?:function|const|type|class)\s+(\w+)/gmu)].map((m) => m[1]);
    expect(exported.sort()).toEqual(['PiiCounts', 'foldWidth', 'redactPii']);
    expect(run('ﬁ① ㎏ ㈱').text).toBe('ﬁ① ㎏ ㈱');
  });
});
