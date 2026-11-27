import { describe, expect, it } from 'vitest';
import { validateLogin } from './validate';

const FORMAT = 'Email 格式不對，例如 name@example.com。';

describe('validateLogin', () => {
  it('(AC-T52-1) (TC-1) rejects malformed emails with the format message only', () => {
    const bad = ['name', 'name@', '@example.com', 'name@example', 'name@example.', 'name@.example.com', 'a b@example.com', 'a@@example.com'];
    for (const email of bad) {
      expect(validateLogin(email, 'x')).toEqual({ email: FORMAT, password: null });
    }
  });

  it('(AC-T52-1) (TC-2) accepts good emails, trims them, and reports both empty fields', () => {
    for (const email of ['a@example.com', '  a@example.com  ', 'a.b@mail.example.com']) {
      expect(validateLogin(email, 'x')).toEqual({ email: null, password: null });
    }
    expect(validateLogin('   ', '')).toEqual({ email: '請輸入 Email。', password: '請輸入密碼。' });
    expect(validateLogin('name', '')).toEqual({ email: FORMAT, password: '請輸入密碼。' });
  });
});
