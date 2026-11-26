// @vitest-environment jsdom
import '../test/setup.ts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { err, ok } from '@english-coach/contracts';
import { App } from './App.tsx';
import { ApiProvider } from './api/index.ts';
import type { ApiClient, AuthSession, LoadedApi } from './api/index.ts';
import { DEMO_SESSION } from './api/mock/fixtures/identity.ts';
import { createMockApi } from './api/mock/index.ts';

const show = (api: LoadedApi, path = '/') =>
  render(
    <ApiProvider value={api}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ApiProvider>,
  );

// 一開始沒有 session；登入成功之後 getSession 才回得到身分（像真的 Supabase 一樣）
const loggedOut = (signIn: ApiClient['signInWithPassword']): LoadedApi => {
  let session: AuthSession | null = null;
  return {
    client: {
      getSession: () => Promise.resolve(ok(session)),
      signInWithPassword: async (email, password) => {
        const r = await signIn(email, password);
        if (r.ok) session = r.value;
        return r;
      },
      signOut: () => Promise.resolve(ok(undefined)),
    },
    preview: null,
  };
};

const fillAndSubmit = (): void => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
};

describe('login gate', () => {
  it('(AC-T18-6) (TC-10) no session → / goes to the login page; a successful sign-in goes to /', async () => {
    show(loggedOut(() => Promise.resolve(ok(DEMO_SESSION))));
    expect(await screen.findByRole('button', { name: '登入' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '今天' })).toBeNull();
    fillAndSubmit();
    expect(await screen.findByRole('heading', { name: '今天' })).toBeTruthy();
  });

  it('(AC-T18-6) (TC-10) mock mode lets / straight through', async () => {
    show(createMockApi(''));
    expect(await screen.findByRole('heading', { name: '今天' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '登入' })).toBeNull();
  });

  it('(AC-T18-7) (TC-12) an unknown scenario falls back to default and says so in plain text', async () => {
    show(createMockApi('?scenario=nope'));
    expect(await screen.findByRole('heading', { name: '今天' })).toBeTruthy();
    expect(screen.getByText('預覽：假資料')).toBeTruthy();
    expect(screen.getByText('未知情境「nope」，改用 default')).toBeTruthy();
  });

  it('(AC-T18-7) (TC-12) markup in the scenario name stays text', async () => {
    show(createMockApi('?scenario=<b>x</b>'));
    expect(await screen.findByText('未知情境「<b>x</b>」，改用 default')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('login page', () => {
  it('(AC-T18-9) (TC-14) has Email, 密碼, the 登入 button and the footer; no sign-up or forgot-password', async () => {
    show(createMockApi(''), '/login');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('密碼')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' })).toBeTruthy();
    expect(screen.getByText('連線加密。履歷與錄音只供你自己練習。')).toBeTruthy();
    expect(screen.getByText('每天 80 分鐘，把英文講得像 Senior。')).toBeTruthy();
    for (const p of ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題']) expect(screen.getByText(p)).toBeTruthy();
    expect(screen.queryByText(/註冊|忘記密碼/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText('預覽：假資料')).toBeTruthy();
    });
  });

  it('(AC-T18-9) (TC-15) wrong credentials: message, aria-invalid and aria-describedby on the password field', async () => {
    show(createMockApi('?scenario=error'), '/login');
    fillAndSubmit();
    const message = await screen.findByText('Email 或密碼不對，再試一次。');
    const password = screen.getByLabelText('密碼');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    const describedBy = password.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(message.textContent);
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull();
  });

  it('(AC-T18-9) (TC-15) a non-credential failure also shows the same message and the form stays usable', async () => {
    show(loggedOut(() => Promise.resolve(err({ kind: 'internal', message: 'x' }))), '/login');
    fillAndSubmit();
    expect(await screen.findByText('Email 或密碼不對，再試一次。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' })).toHaveProperty('disabled', false);
  });

  it('(AC-T18-9) (TC-16) default scenario: signing in goes to /', async () => {
    show(createMockApi(''), '/login');
    fillAndSubmit();
    expect(await screen.findByRole('heading', { name: '今天' })).toBeTruthy();
  });
});
