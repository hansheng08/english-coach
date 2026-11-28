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

const ZH_CITY_ABBREVIATIONS: readonly string[] = [
  '北市', '新北', '桃市', '中市', '南市', '高市', '基市', '竹市', '竹縣', '苗縣',
  '彰縣', '投縣', '雲縣', '嘉市', '嘉縣', '屏縣', '宜縣', '花縣', '東縣', '澎縣',
];
const ZH_ADDRESS_START = String.raw`(?:\p{Script=Han}{2}[市縣]|${ZH_CITY_ABBREVIATIONS.join('|')})`;

const ZH_ADDRESS_RE = new RegExp(
  String.raw`(?<!\d)(?:\d{3,6})?` +
    `(?=${ZH_ADDRESS_START})` +
    String.raw`(?=[\p{Script=Han}\d]*(?:路|街|大道|巷|弄))` +
    String.raw`[\p{Script=Han}\d]+號(?:\d+樓|之\d+|-\d+)*`,
  'gu',
);

// 區碼＋兩個年份（19xx／20xx）的區間，不當市話。
const YEAR_RANGE_RE = /^(?:\(0[2-8]\d?\)|0[2-8]\d?)[ .-]?(?:19|20)\d{2}[ .-](?:19|20)\d{2}$/u;

/** 全形 U+FF01～U+FF5E 換成半形 U+0021～U+007E，U+3000 換成半形空白；其他字元不變，長度不變。 */
export function foldWidth(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
    else if (c === 0x3000) out += ' ';
    else out += text[i] ?? '';
  }
  return out;
}

type Pair = { readonly raw: string; readonly folded: string };
type Replacement = { readonly mark: string; readonly keepTail: number };

/** 在 folded 上找範圍，原字串與 folded 的同一段一起換；keepTail 是比對結果尾端要原樣保留的字元數。 */
function substitute(
  pair: Pair,
  re: RegExp,
  decide: (match: RegExpExecArray) => Replacement | null,
): Pair {
  let raw = '';
  let folded = '';
  let last = 0;
  for (const match of pair.folded.matchAll(re)) {
    const r = decide(match);
    if (r === null) continue;
    const start = match.index;
    const end = start + match[0].length;
    const keepFrom = end - r.keepTail;
    raw += pair.raw.slice(last, start) + r.mark + pair.raw.slice(keepFrom, end);
    folded += pair.folded.slice(last, start) + r.mark + pair.folded.slice(keepFrom, end);
    last = end;
  }
  return { raw: raw + pair.raw.slice(last), folded: folded + pair.folded.slice(last) };
}

/** 把電話、Email、街道地址換成 [phone]、[email]、[address]；標記以外的字元不變。純函式。 */
export function redactPii(text: string): { readonly text: string; readonly removed: PiiCounts } {
  let email = 0;
  let phone = 0;
  let address = 0;

  let cur: Pair = { raw: text, folded: foldWidth(text) };

  cur = substitute(cur, EMAIL_RE, () => {
    email += 1;
    return { mark: EMAIL_MARK, keepTail: 0 };
  });

  cur = substitute(cur, TW_PHONE_RE, (m) => {
    if (YEAR_RANGE_RE.test(m[0])) return null;
    phone += 1;
    return { mark: PHONE_MARK, keepTail: 0 };
  });
  cur = substitute(cur, US_PHONE_RE, (m) => {
    if (TEN_DIGITS.test(m[0])) return null;
    phone += 1;
    return { mark: PHONE_MARK, keepTail: 0 };
  });

  cur = substitute(cur, TW_EN_RE, (m) => {
    const parts = (m[1] ?? '').split(',');
    let accepted = 1;
    while (accepted < parts.length && isTwSegment(parts[accepted] ?? '')) accepted += 1;
    if (accepted === 1) return null;
    address += 1;
    const lastAccepted = parts[accepted - 1] ?? '';
    const tail = TRAILING_SPACE.exec(lastAccepted)?.[0] ?? '';
    const leftover = parts
      .slice(accepted)
      .map((p) => `,${p}`)
      .join('');
    return { mark: ADDRESS_MARK, keepTail: tail.length + leftover.length };
  });
  cur = substitute(cur, US_ADDRESS_RE, () => {
    address += 1;
    return { mark: ADDRESS_MARK, keepTail: 0 };
  });
  cur = substitute(cur, ZH_ADDRESS_RE, () => {
    address += 1;
    return { mark: ADDRESS_MARK, keepTail: 0 };
  });

  return { text: cur.raw, removed: { phone, email, address } };
}
