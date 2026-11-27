// @vitest-environment jsdom
import { err, ok } from '@english-coach/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../test/setup';
import { ApiProvider } from '../../api';
import type { ApiClient } from '../../api';
import { LoginPage } from './LoginPage';

afterEach(() => {
  vi.restoreAllMocks();
});

const EMAIL_FORMAT = 'Email 格式不對，例如 name@example.com。';
const OFFLINE_BODY = '目前沒有網路。連上網路後再按一次「登入」。';
const BAD_CREDENTIALS = 'Email 或密碼不對，再試一次。';

const setOnline = (online: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);

function renderLogin(signIn: ApiClient['signInWithPassword']) {
  const client: ApiClient = {
    getSession: () => Promise.resolve(ok(null)),
    signInWithPassword: signIn,
    signOut: () => Promise.resolve(ok(undefined)),
  };
  render(
    <ApiProvider runtime={{ client, preview: null }}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </ApiProvider>,
  );
  const emailInput = screen.getByLabelText('Email');
  const passwordInput = screen.getByLabelText('密碼');
  const submit = () => screen.getByRole('button', { name: /^登入/u });
  const fill = (email: string, password: string) => {
    fireEvent.change(emailInput, { target: { value: email } });
    fireEvent.change(passwordInput, { target: { value: password } });
  };
  return { emailInput, passwordInput, submit, fill };
}

const internalError = () => Promise.resolve(err({ kind: 'internal' as const, message: 'x' }));
const badCredentials = () => Promise.resolve(err({ kind: 'unauthenticated' as const, message: 'x' }));

describe('LoginPage errors', () => {
  it('(AC-T52-2) (TC-3) a malformed email shows the field message, does not submit, focuses Email', () => {
    const signIn = vi.fn<ApiClient['signInWithPassword']>(internalError);
    const { emailInput, fill, submit } = renderLogin(signIn);
    fill('name', 'x');
    fireEvent.click(submit());
    expect(screen.getByText(EMAIL_FORMAT)).toBeTruthy();
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');
    const describedBy = emailInput.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(EMAIL_FORMAT);
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(emailInput);
  });

  it('(AC-T52-3) (TC-4) offline before sending: no request, offline notice above Email, values kept, focus on 登入', () => {
    setOnline(false);
    const signIn = vi.fn<ApiClient['signInWithPassword']>(internalError);
    const { emailInput, passwordInput, fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    expect(signIn).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('需要連網才能登入');
    expect(alert.textContent).toContain(OFFLINE_BODY);
    expect(alert.compareDocumentPosition(emailInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((emailInput as HTMLInputElement).value).toBe('a@example.com');
    expect((passwordInput as HTMLInputElement).value).toBe('x');
    expect(document.activeElement).toBe(submit());
  });

  it('(AC-T52-4) (TC-5) failure after sending: offline → #5, online → #6, unauthenticated → field message', async () => {
    const signIn = vi.fn<ApiClient['signInWithPassword']>();
    const { passwordInput, fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');

    signIn.mockImplementationOnce(() => {
      setOnline(false);
      return internalError();
    });
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain(OFFLINE_BODY);
    await waitFor(() => {
      expect(document.activeElement).toBe(submit());
    });

    setOnline(true);
    signIn.mockImplementationOnce(internalError);
    fireEvent.click(submit());
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('現在登不進去');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() => {
      expect(document.activeElement).toBe(submit());
    });

    signIn.mockImplementationOnce(() => {
      setOnline(false);
      return badCredentials();
    });
    fireEvent.click(submit());
    expect(await screen.findByText(BAD_CREDENTIALS)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('(AC-T52-5) (TC-6) editing clears only that field; pressing 登入 clears the form notice first', async () => {
    setOnline(false);
    const signIn = vi.fn<ApiClient['signInWithPassword']>(badCredentials);
    const { emailInput, passwordInput, fill, submit } = renderLogin(signIn);
    fill('a@example.com', 'x');
    fireEvent.click(submit());
    expect(screen.getByRole('alert')).toBeTruthy();

    setOnline(true);
    fireEvent.change(passwordInput, { target: { value: 'y' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(submit());
    expect(await screen.findByText(BAD_CREDENTIALS)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(emailInput, { target: { value: 'b@example.com' } });
    expect(screen.getByText(BAD_CREDENTIALS)).toBeTruthy();
    fireEvent.change(passwordInput, { target: { value: 'z' } });
    expect(screen.queryByText(BAD_CREDENTIALS)).toBeNull();
    expect((passwordInput as HTMLInputElement).value).toBe('z');
  });
});
