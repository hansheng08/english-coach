import { describe, expect, it } from 'vitest';
import { validateLogin } from './validate';

// QA probes for T-052 AC-T52-1（login.md #1～3、任務單「Email 格式」）。
const FORMAT = 'Email 格式不對，例如 name@example.com。';
const EMAIL_REQUIRED = '請輸入 Email。';
const PASSWORD_REQUIRED = '請輸入密碼。';

describe('T-052 QA validateLogin', () => {
  it('(QA-1) any whitespace inside the address is a format error (tab, newline, NBSP, full-width space); outer whitespace is trimmed', () => {
    for (const email of ['a\tb@example.com', 'a\nb@example.com', 'a\u00a0b@example.com', 'a\u3000b@example.com', 'a@exa mple.com']) {
      expect(validateLogin(email, 'x')).toEqual({ email: FORMAT, password: null });
    }
    for (const email of ['\ta@example.com\n', '\u3000a@example.com\u3000', '\u00a0a@example.com']) {
      expect(validateLogin(email, 'x')).toEqual({ email: null, password: null });
    }
  });

  it('(QA-2) the rule only checks shape: short, tagged and multi-level domains pass', () => {
    for (const email of ['a@b.c', 'first.last+tag@sub.example.co.jp', 'A@EXAMPLE.COM', '名字@例子.台灣']) {
      expect(validateLogin(email, 'x')).toEqual({ email: null, password: null });
    }
  });

  it('(QA-3) domain edge cases: no dot, leading or trailing dot, lone @, padded bare name, two @ with dotted parts', () => {
    for (const email of ['a@bc', 'a@.b.c', 'a@b.c.', '@', '.@', '   name   ', 'a@b@c.d', 'a@b.c@d.e']) {
      expect(validateLogin(email, 'x')).toEqual({ email: FORMAT, password: null });
    }
  });

  it('(QA-4) the password is not trimmed: spaces count as a password, only the empty string is missing', () => {
    expect(validateLogin('a@example.com', '   ')).toEqual({ email: null, password: null });
    expect(validateLogin('a@example.com', '')).toEqual({ email: null, password: PASSWORD_REQUIRED });
    expect(validateLogin(' \t ', '')).toEqual({ email: EMAIL_REQUIRED, password: PASSWORD_REQUIRED });
    expect(validateLogin('', 'x')).toEqual({ email: EMAIL_REQUIRED, password: null });
  });

  it('(QA-5) the result has exactly the two fields', () => {
    expect(Object.keys(validateLogin('name', '')).sort()).toEqual(['email', 'password']);
  });
});
