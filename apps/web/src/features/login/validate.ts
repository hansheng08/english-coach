export type LoginProblems = { readonly email: string | null; readonly password: string | null };

export const EMAIL_REQUIRED = '請輸入 Email。';
export const EMAIL_FORMAT = 'Email 格式不對，例如 name@example.com。';
export const PASSWORD_REQUIRED = '請輸入密碼。';

/** 去頭尾空白後：沒有空白字元、剛好一個 @、@ 前不空、@ 後有 . 且開頭與結尾都不是 .。 */
function isEmailShaped(value: string): boolean {
  if (/\s/u.test(value)) return false;
  const parts = value.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || local === undefined || domain === undefined) return false;
  return local !== '' && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** 前端檢查（login.md #1～3），只在按「登入」時呼叫。 */
export function validateLogin(email: string, password: string): LoginProblems {
  const trimmed = email.trim();
  return {
    email: trimmed === '' ? EMAIL_REQUIRED : isEmailShaped(trimmed) ? null : EMAIL_FORMAT,
    password: password === '' ? PASSWORD_REQUIRED : null,
  };
}
