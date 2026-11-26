// @vitest-environment jsdom
import { err, ok, UserIdSchema } from '@english-coach/contracts';
import type { ApiRuntime, AuthSession } from './api';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setSystemDark } from '../test/setup'; // 同時註冊 afterEach(cleanup) 與 matchMedia stub
import { App } from './App';
import { ApiProvider } from './api';
import { createMockApi } from './api/mock';

const USER = UserIdSchema.safeParse('3f2c1a90-6b7d-4e58-8a14-9c0d5e7b2f61');

function statefulClient(initial: AuthSession | null, signInResult: 'ok' | 'bad'): ApiRuntime {
  let session = initial;
  const fallback: AuthSession | null = USER.success ? { userId: USER.data, email: 'a@example.com' } : null;
  return {
    preview: null,
    client: {
      getSession: () => Promise.resolve(ok(session)),
      signInWithPassword: () => {
        if (signInResult === 'bad' || fallback === null) return Promise.resolve(err({ kind: 'unauthenticated', message: 'invalid credentials' }));
        session = fallback;
        return Promise.resolve(ok(fallback));
      },
      signOut: () => Promise.resolve(ok(undefined)),
    },
  };
}

function renderAt(runtime: ApiRuntime, path: string) {
  return render(
    <ApiProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ApiProvider>,
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
}

const openMenu = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '帳號與外觀' }));
  return screen.getByRole('dialog', { name: '帳號與外觀' });
};

describe('login gate', () => {
  it('(AC-T18-6) (TC-10) no session: "/" redirects to the login page', async () => {
    renderAt(statefulClient(null, 'ok'), '/');
    expect(await screen.findByRole('heading', { name: '登入' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '帳號與外觀' })).toBeNull();
  });

  it('(AC-T18-6) (TC-10) signing in successfully goes to "/"', async () => {
    renderAt(statefulClient(null, 'ok'), '/');
    await screen.findByRole('heading', { name: '登入' });
    fillAndSubmit('a@example.com', 'x');
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
  });

  it('(AC-T18-6) (TC-10) mock mode lets "/" through without a login', async () => {
    renderAt(createMockApi(''), '/');
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
  });
});

describe('login page', () => {
  it('(AC-T18-9) (TC-14) has the fields, the button and the footer, and none of the excluded items', () => {
    renderAt(createMockApi(''), '/login');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('密碼')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' })).toBeTruthy();
    expect(screen.getByText('連線加密。履歷與錄音只供你自己練習。')).toBeTruthy();
    expect(screen.getByText('每天 80 分鐘，把英文講得像 Senior。')).toBeTruthy();
    for (const item of ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題']) expect(screen.getByText(item)).toBeTruthy();
    for (const banned of [/註冊/, /忘記密碼/, /Google/, /Apple/]) expect(screen.queryByText(banned)).toBeNull();
  });

  it('(AC-T18-9) (TC-15) wrong credentials: message on the password field, aria-invalid and aria-describedby', async () => {
    renderAt(createMockApi('?scenario=error'), '/login');
    fillAndSubmit('a@example.com', 'x');
    const message = await screen.findByText('Email 或密碼不對，再試一次。');
    const password = screen.getByLabelText('密碼');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toBe(message.id);
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('密碼').value).toBe('x');
  });

  it('(AC-T18-9) (TC-16) success in the default scenario goes to "/"', async () => {
    renderAt(createMockApi(''), '/login');
    fillAndSubmit('a@example.com', 'x');
    expect(await screen.findByRole('button', { name: '帳號與外觀' })).toBeTruthy();
  });

  it('(AC-T18-9) (TC-15) empty fields are reported without sending, and editing a field clears its message', () => {
    renderAt(createMockApi(''), '/login');
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(screen.getByText('請輸入 Email。')).toBeTruthy();
    expect(screen.getByText('請輸入密碼。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    expect(screen.queryByText('請輸入 Email。')).toBeNull();
    expect(screen.getByText('請輸入密碼。')).toBeTruthy();
  });

  it('(AC-T18-9) (TC-15) a service error shows the form alert and keeps the input', async () => {
    const runtime: ApiRuntime = {
      preview: null,
      client: {
        getSession: () => Promise.resolve(ok(null)),
        signInWithPassword: () => Promise.resolve(err({ kind: 'internal', message: 'down' })),
        signOut: () => Promise.resolve(ok(undefined)),
      },
    };
    renderAt(runtime, '/login');
    fillAndSubmit('a@example.com', 'secret');
    expect((await screen.findByRole('alert')).textContent).toContain('現在登不進去');
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('a@example.com');
    expect(screen.getByLabelText('密碼').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('preview banner', () => {
  it('(AC-T18-8) (TC-13) both "/" and "/login" show 預覽：假資料 in mock mode', async () => {
    renderAt(createMockApi(''), '/login');
    expect(screen.getByRole('note').textContent).toContain('預覽：假資料');
    renderAt(createMockApi(''), '/');
    await screen.findAllByRole('button', { name: '帳號與外觀' });
    expect(screen.getAllByRole('note')).toHaveLength(2);
  });

  it('(AC-T18-8) (TC-13) no banner without a preview', () => {
    renderAt(statefulClient(null, 'ok'), '/login');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('(AC-T18-7) (TC-12) an unknown scenario is shown as plain text next to the banner and the page still renders', async () => {
    renderAt(createMockApi('?scenario=<b>x</b>'), '/');
    expect(await screen.findByText('未知情境「<b>x</b>」，改用 default')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: '帳號與外觀' })).toBeTruthy();
  });
});

describe('account and appearance', () => {
  it('(AC-T18-11) (TC-20) the avatar opens a dialog with radios in order, system selected, and the note', async () => {
    renderAt(createMockApi(''), '/');
    const dialog = await openMenu();
    const radios = screen.getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['淺色', '深色', '跟隨系統']);
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
    expect(dialog.textContent).toContain('跟隨系統，現在是淺色。只存在這台裝置。');
  });

  it('(AC-T18-11) (TC-21) choosing applies at once and the note follows; system changes update without a reload', async () => {
    renderAt(createMockApi(''), '/');
    await openMenu();
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(screen.getByText('現在是深色。只存在這台裝置。')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '淺色' }));
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(screen.getByText('現在是淺色。只存在這台裝置。')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '跟隨系統' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    act(() => {
      setSystemDark(true);
    });
    expect(screen.getByText('跟隨系統，現在是深色。只存在這台裝置。')).toBeTruthy();
    expect(window.localStorage.getItem('ec-theme')).toBe('system');
  });

  it('(AC-T18-11) (TC-21) Escape and the close button close the dialog', async () => {
    renderAt(createMockApi(''), '/');
    await openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('(AC-T18-11) (TC-22) the stored choice is the selected radio the next time the dialog opens', async () => {
    window.localStorage.setItem('ec-theme', 'dark');
    renderAt(createMockApi(''), '/');
    await openMenu();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '深色' }).checked).toBe(true);
  });
});
