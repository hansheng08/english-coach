// @vitest-environment jsdom
import { err, ok, UserIdSchema } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../test/setup';
import { ApiProvider } from '../../api';
import type { ApiClient, AuthSession } from '../../api';
import { LoginPage } from './LoginPage';

// QA probes for T-052 AC-T52-2～5（login.md 錯誤狀態的順序、焦點、清除）。
const FORMAT = 'Email 格式不對，例如 name@example.com。';
const PASSWORD_REQUIRED = '請輸入密碼。';
const BAD_CREDENTIALS = 'Email 或密碼不對，再試一次。';
const OFFLINE_TITLE = '需要連網才能登入';
const SERVICE_TITLE = '現在登不進去';
const SESSION: AuthSession = { userId: UserIdSchema.parse('00000000-0000-4000-8000-000000000052'), email: 'a@example.com' };

type R = Result<AuthSession, AppError>;
function deferred() {
  let resolve: (r: R) => void = () => undefined;
  const promise = new Promise<R>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const internal = (): R => err({ kind: 'internal', message: 'x' });
const unauthenticated = (): R => err({ kind: 'unauthenticated', message: 'x' });

afterEach(() => {
  vi.restoreAllMocks();
});

const setOnline = (online: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);

function renderLogin(signIn: ApiClient['signInWithPassword']) {
  const client: ApiClient = { getSession: () => Promise.resolve(ok(null)), signInWithPassword: signIn, signOut: () => Promise.resolve(ok(undefined)) };
  const router = createElement(MemoryRouter, { initialEntries: ['/login'] }, createElement(LoginPage));
  render(createElement(ApiProvider, { runtime: { client, preview: null }, children: router }));
  const email = screen.getByLabelText<HTMLInputElement>('Email');
  const password = screen.getByLabelText<HTMLInputElement>('密碼');
  const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /^登入/u });
  const fill = (e: string, p: string) => {
    fireEvent.change(email, { target: { value: e } });
    fireEvent.change(password, { target: { value: p } });
  };
  return { email, password, submit, fill };
}
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe('T-052 QA login errors', () => {
  it('(QA-6) field errors win over offline: no request, no form notice, focus on Email', () => {
    setOnline(false);
    const signIn = vi.fn<ApiClient['signInWithPassword']>(() => Promise.resolve(internal()));
    const { email, fill, submit } = renderLogin(signIn);
    fill('name', 'x');
    fireEvent.click(submit());
    expect(screen.getByText(FORMAT)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(email);
  });

  it('(QA-7) focus goes to the first wrong field: Email before 密碼, 密碼 when only it is wrong', () => {
    const signIn = vi.fn<ApiClient['signInWithPassword']>(() => Promise.resolve(internal()));
    const { email, password, fill, submit } = renderLogin(signIn);
    fill('name', '');
    fireEvent.click(submit());
    expect(screen.getByText(FORMAT)).toBeTruthy();
    expect(screen.getByText(PASSWORD_REQUIRED)).toBeTruthy();
    expect(document.activeElement).toBe(email);
    fill('a@example.com', '');
    fireEvent.click(submit());
    expect(screen.queryByText(FORMAT)).toBeNull();
    expect(document.activeElement).toBe(password);
    expect(password.getAttribute('aria-describedby')).toBe('login-password-error');
  });

  it('(QA-8) offline notice sits before Email, only one alert; back online the next press sends once, password untouched', async () => {
    const online = setOnline(false);
    const signIn = vi.fn<ApiClient['signInWithPassword']>(() => Promise.resolve(ok(SESSION)));
    const { email, password, fill, submit } = renderLogin(signIn);
    fill('a@example.com', ' pw ');
    fireEvent.click(submit());
    fireEvent.click(submit());
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain(OFFLINE_TITLE);
    expect((alerts[0]?.compareDocumentPosition(email) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
    expect(email.value).toBe('a@example.com');
    expect(password.value).toBe(' pw ');
    online.mockReturnValue(true);
    fireEvent.click(submit());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith('a@example.com', ' pw ');
    await flush();
  });

  it('(QA-9) with a form notice, typing keeps focus in the field and keeps the notice; the next press clears it while sending', async () => {
    setOnline(true);
    const first = deferred();
    const second = deferred();
    const signIn = vi.fn<ApiClient['signInWithPassword']>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { email, fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    await act(async () => {
      first.resolve(internal());
      await first.promise;
    });
    expect(screen.getByRole('alert').textContent).toContain(SERVICE_TITLE);
    expect(document.activeElement).toBe(submit());
    email.focus();
    fireEvent.change(email, { target: { value: 'b@example.com' } });
    expect(document.activeElement).toBe(email);
    expect(screen.getByRole('alert').textContent).toContain(SERVICE_TITLE);
    fireEvent.click(submit());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit().disabled).toBe(true);
    await act(async () => {
      second.resolve(unauthenticated());
      await second.promise;
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(BAD_CREDENTIALS)).toBeTruthy();
  });

  it('(QA-10) after a failed request the focus lands on an enabled 登入', async () => {
    setOnline(true);
    const pending = deferred();
    const { fill, submit } = renderLogin(() => pending.promise);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    expect(submit().disabled).toBe(true);
    await act(async () => {
      pending.resolve(internal());
      await pending.promise;
    });
    expect(submit().disabled).toBe(false);
    expect(document.activeElement).toBe(submit());
  });

  it('(QA-11) offline when the answer comes back: unauthenticated stays a field message, internal becomes the offline notice', async () => {
    const online = setOnline(true);
    const a = deferred();
    const b = deferred();
    const signIn = vi.fn<ApiClient['signInWithPassword']>().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    online.mockReturnValue(false);
    await act(async () => {
      a.resolve(unauthenticated());
      await a.promise;
    });
    expect(screen.getByText(BAD_CREDENTIALS)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    online.mockReturnValue(true);
    fireEvent.click(submit());
    online.mockReturnValue(false);
    await act(async () => {
      b.resolve(internal());
      await b.promise;
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain(OFFLINE_TITLE);
    expect(screen.queryByText(BAD_CREDENTIALS)).toBeNull();
  });

  it('(QA-12) editing 密碼 clears only the 密碼 message; the Email message stays', () => {
    const { fill, password, submit } = renderLogin(() => Promise.resolve(internal()));
    fill('name', '');
    fireEvent.click(submit());
    fireEvent.change(password, { target: { value: 'x' } });
    expect(screen.queryByText(PASSWORD_REQUIRED)).toBeNull();
    expect(screen.getByText(FORMAT)).toBeTruthy();
  });

  it('(QA-13) a second submit while signing in (Enter on the form) does not send again', async () => {
    setOnline(true);
    const pending = deferred();
    const signIn = vi.fn<ApiClient['signInWithPassword']>(() => pending.promise);
    const { fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    const form = submit().closest('form');
    expect(form).not.toBeNull();
    if (form !== null) fireEvent.submit(form);
    expect(signIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(internal());
      await pending.promise;
    });
  });
});
