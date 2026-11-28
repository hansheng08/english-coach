export type PiiCounts = { readonly phone: number; readonly email: number; readonly address: number };

const EMAIL_MARK = '[email]';
const PHONE_MARK = '[phone]';
const ADDRESS_MARK = '[address]';

/** 每個字母寫成 [sS]，讓同一條規則裡其他部分（例如城市首字大寫）仍分大小寫。 */
function ci(word: string): string {
  return Array.from(word, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`).join('');
}

// ---------- Email ----------
const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/gu;

// ---------- 電話 ----------
const SEP = '[ .-]';
const NOT_ALNUM_BEFORE = '(?<![A-Za-z0-9])';
const NOT_ALNUM_AFTER = '(?![A-Za-z0-9])';
const TW_CC = String.raw`(?:\+886|\(\+886\)|886)`;
const TW_MOBILE = String.raw`(?:0|${TW_CC}${SEP}?)9\d{2}${SEP}?\d{3}${SEP}?\d{3}`;
const TW_AREA_LOCAL = String.raw`(?:\(0[2-8]\d?\)|0[2-8]\d?)`;
const TW_AREA_CC = String.raw`${TW_CC}${SEP}?[2-8]\d?`;
const TW_LANDLINE = String.raw`(?:${TW_AREA_LOCAL}|${TW_AREA_CC})${SEP}?(?:\d{6,8}|\d{3,4}${SEP}\d{3,4})`;
const TW_PHONE_RE = new RegExp(`${NOT_ALNUM_BEFORE}(?:${TW_MOBILE}|${TW_LANDLINE})${NOT_ALNUM_AFTER}`, 'gu');

const US_AREA = String.raw`(?:\([2-9]\d{2}\)|[2-9]\d{2})`;
const US_CORE = String.raw`${US_AREA}${SEP}?[2-9]\d{2}${SEP}?\d{4}`;
const US_PHONE_RE = new RegExp(
  `${NOT_ALNUM_BEFORE}(?:\\+1${SEP}?|1${SEP}?)?${US_CORE}${NOT_ALNUM_AFTER}`,
  'gu',
);
const TEN_DIGITS = /^\d{10}$/u;

// ---------- 地址 ----------
const H = String.raw`[ \t]`;
const STREET_TYPES = [
  'Street', 'St', 'Avenue', 'Ave', 'Road', 'Rd', 'Boulevard', 'Blvd', 'Drive', 'Dr', 'Lane', 'Ln',
  'Way', 'Court', 'Ct', 'Place', 'Pl', 'Parkway', 'Pkwy', 'Highway', 'Hwy',
].map(ci).join('|');
const UNIT_WORDS = ['Apt', 'Suite', 'Ste', 'Unit'].map(ci).join('|');
const US_STREET = String.raw`\d{1,6}${H}+(?:[A-Za-z0-9][A-Za-z0-9'’-]*${H}+){1,4}(?:${STREET_TYPES})(?![A-Za-z0-9])\.?`;
const US_UNIT = String.raw`(?:(?:${UNIT_WORDS})\.?${H}*[A-Za-z0-9-]+|#${H}*[A-Za-z0-9-]+)`;
const US_SEP = String.raw`(?:,${H}*|${H}+)`;
const US_CITY_STATE = String.raw`${US_SEP}[A-Z][A-Za-z]*(?:${H}+[A-Z][A-Za-z]*){0,2},${H}*[A-Z]{2}${H}+\d{5}(?:-\d{4})?(?!\d)`;
const US_ADDRESS_RE = new RegExp(
  `${NOT_ALNUM_BEFORE}${US_STREET}(?:${US_SEP}${US_UNIT})?(?:${US_CITY_STATE})?`,
  'gu',
);

const TW_EN_RE =
  /(?<![A-Za-z0-9])(?:\d{1,3}F\.?,[ \t]*)?No\.[ \t]*\d+(?:-\d+)?((?:,[^,\r\n]*)*)/gu;
const TW_KEYWORD =
  /\b(?:Rd|Road|St|Street|Ave|Avenue|Sec|Section|Ln|Lane|Aly|Alley|Dist|District|Vil|Village|City|County|Township)\b/iu;
const TW_POSTAL = /^\s*\d{3,6}\s*$/u;
const TW_COUNTRY = /^\s*(?:Taiwan(?:\s*\(R\.O\.C\.\))?|R\.O\.C\.)\s*$/iu;
const TRAILING_SPACE = /[ \t]*$/u;

function isTwSegment(segment: string): boolean {
  return TW_KEYWORD.test(segment) || TW_POSTAL.test(segment) || TW_COUNTRY.test(segment);
}

const ZH_ADDRESS_RE = new RegExp(
  String.raw`(?<!\d)(?:\d{3,6})?` +
    String.raw`(?=\p{Script=Han}{2}[市縣])` +
    String.raw`(?=[\p{Script=Han}\d]*(?:路|街|大道|巷|弄))` +
    String.raw`[\p{Script=Han}\d]+號(?:\d+樓|之\d+|-\d+)*`,
  'gu',
);

/** 把電話、Email、街道地址換成 [phone]、[email]、[address]；標記以外的字元不變。純函式。 */
export function redactPii(text: string): { readonly text: string; readonly removed: PiiCounts } {
  let email = 0;
  let phone = 0;
  let address = 0;

  let out = text.replace(EMAIL_RE, () => {
    email += 1;
    return EMAIL_MARK;
  });

  out = out.replace(TW_PHONE_RE, () => {
    phone += 1;
    return PHONE_MARK;
  });
  out = out.replace(US_PHONE_RE, (match: string) => {
    if (TEN_DIGITS.test(match)) return match;
    phone += 1;
    return PHONE_MARK;
  });

  out = out.replace(TW_EN_RE, (match: string, rest: string) => {
    const parts = rest.split(',');
    let accepted = 1;
    while (accepted < parts.length && isTwSegment(parts[accepted] ?? '')) accepted += 1;
    if (accepted === 1) return match;
    address += 1;
    const lastAccepted = parts[accepted - 1] ?? '';
    const tail = TRAILING_SPACE.exec(lastAccepted)?.[0] ?? '';
    const leftover = parts
      .slice(accepted)
      .map((p) => `,${p}`)
      .join('');
    return `${ADDRESS_MARK}${tail}${leftover}`;
  });
  out = out.replace(US_ADDRESS_RE, () => {
    address += 1;
    return ADDRESS_MARK;
  });
  out = out.replace(ZH_ADDRESS_RE, () => {
    address += 1;
    return ADDRESS_MARK;
  });

  return { text: out, removed: { phone, email, address } };
}
