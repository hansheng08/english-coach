// @vitest-environment jsdom
import { err, ok, UserIdSchema } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setSystemDark } from '../test/setup';
import { App } from './App';
import { ApiProvider } from './api';
import type { ApiRuntime, AuthSession } from './api';

// QA probes for T-018 AC-T18-6、AC-T18-9、AC-T18-11 (login.md 規則、theme.md).
const USER = UserIdSchema.parse('00000000-0000-4000-8000-000000000002');
const SESSION: AuthSession = { userId: USER, email: 'a@example.com' };

type Deferred = { promise: Promise<Result<AuthSession, AppError>>; resolve: (r: Result<AuthSession, AppError>) => void };
function deferred(): Deferred {
  let resolve: (r: Result<AuthSession, AppError>) => void = () => undefined;
  const promise = new Promise<Result<AuthSession, AppError>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function runtime(opts: {
  session?: Result<AuthSession | null, AppError>;
  signIn?: (email: string, password: string) => Promise<Result<AuthSession, AppError>>;
}): ApiRuntime {
  return {
    preview: null,
    client: {
      getSession: () => Promise.resolve(opts.session ?? ok(null)),
      signInWithPassword: opts.signIn ?? (() => Promise.resolve(ok(SESSION))),
      signOut: () => Promise.resolve(ok(undefined)),
    },
  };
}

function renderAt(rt: ApiRuntime, path: string) {
  const router = createElement(MemoryRouter, { initialEntries: [path] }, createElement(App));
  return render(createElement(ApiProvider, { runtime: rt, children: router }));
}
const email = () => screen.getByLabelText<HTMLInputElement>('Email');
const password = () => screen.getByLabelText<HTMLInputElement>('密碼');
const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /登入/ });

describe('T-018 QA gate and login', () => {
  it('(QA-10) a failing getSession is treated as signed out (goes to /login, no crash)', async () => {
    renderAt(runtime({ session: err({ kind: 'internal', message: 'x' }) }), '/');
    expect(await screen.findByRole('heading', { name: '登入' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '帳號與外觀' })).toBeNull();
  });

  it('(QA-11) a session goes straight to home; unknown paths fall back to /', async () => {
    renderAt(runtime({ session: ok(SESSION) }), '/nowhere');
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
  });

  it('(QA-12) empty checks: whitespace-only email counts as empty, focus goes to the first bad field, nothing is sent', () => {
    let calls = 0;
    renderAt(
      runtime({
        signIn: () => {
          calls += 1;
          return Promise.resolve(ok(SESSION));
        },
      }),
      '/login',
    );
    fireEvent.change(email(), { target: { value: '   ' } });
    fireEvent.click(submit());
    expect(screen.getByText('請輸入 Email。')).toBeTruthy();
    expect(screen.getByText('請輸入密碼。')).toBeTruthy();
    expect(document.activeElement).toBe(email());
    expect(email().getAttribute('aria-invalid')).toBe('true');
    expect(email().getAttribute('aria-describedby')).toBe('login-email-error');
    fireEvent.change(email(), { target: { value: 'a@example.com' } });
    fireEvent.click(submit());
    expect(document.activeElement).toBe(password());
    expect(screen.queryByText('請輸入 Email。')).toBeNull();
    expect(calls).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('(QA-13) while signing in the button says 登入中…, is disabled and aria-busy; the email is trimmed', async () => {
    const d = deferred();
    const sent: [string, string][] = [];
    renderAt(
      runtime({
        signIn: (e, p) => {
          sent.push([e, p]);
          return d.promise;
        },
      }),
      '/login',
    );
    fireEvent.change(email(), { target: { value: '  a@example.com  ' } });
    fireEvent.change(password(), { target: { value: ' pw ' } });
    fireEvent.click(submit());
    expect(submit().textContent).toBe('登入中…');
    expect(submit().disabled).toBe(true);
    expect(submit().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(submit());
    expect(sent).toEqual([['a@example.com', ' pw ']]);
    await act(async () => {
      d.resolve(err({ kind: 'unauthenticated', message: 'x' }));
      await d.promise;
    });
    expect(submit().textContent).toBe('登入');
    expect(submit().disabled).toBe(false);
    expect(screen.getByText('Email 或密碼不對，再試一次。')).toBeTruthy();
    expect(email().getAttribute('aria-invalid')).toBeNull();
    expect(password().value).toBe(' pw ');
  });

  it('(QA-14) the service alert is cleared when signing in again, and editing the password clears its message', async () => {
    let n = 0;
    renderAt(
      runtime({
        signIn: () => {
          n += 1;
          return Promise.resolve(n === 1 ? err({ kind: 'internal', message: 'x' }) : err({ kind: 'unauthenticated', message: 'x' }));
        },
      }),
      '/login',
    );
    fireEvent.change(email(), { target: { value: 'a@example.com' } });
    fireEvent.change(password(), { target: { value: 'x' } });
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain('現在登不進去');
    fireEvent.click(submit());
    expect(await screen.findByText('Email 或密碼不對，再試一次。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(password(), { target: { value: 'y' } });
    expect(screen.queryByText('Email 或密碼不對，再試一次。')).toBeNull();
    expect(password().getAttribute('aria-invalid')).toBeNull();
  });
});

describe('T-018 QA theme menu', () => {
  it('(QA-15) manual choices ignore the system; system follows it both ways; toggling the avatar closes the dialog', async () => {
    renderAt(runtime({ session: ok(SESSION) }), '/');
    const avatar = await screen.findByRole('button', { name: '帳號與外觀' });
    fireEvent.click(avatar);
    expect(avatar.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '淺色' }));
    act(() => {
      setSystemDark(true);
    });
    expect(screen.getByText('現在是淺色。只存在這台裝置。')).toBeTruthy();
    expect(document.documentElement.dataset['theme']).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: '跟隨系統' }));
    expect(screen.getByText('跟隨系統，現在是深色。只存在這台裝置。')).toBeTruthy();
    act(() => {
      setSystemDark(false);
    });
    expect(screen.getByText('跟隨系統，現在是淺色。只存在這台裝置。')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    fireEvent.click(avatar);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(avatar.getAttribute('aria-expanded')).toBe('false');
  });
});
