import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useApi } from './api';
import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/login/LoginPage';
import { PreviewBanner } from './ui/PreviewBanner';

type GateState = 'checking' | 'signed-in' | 'signed-out';

/** 登入閘門（ARCHITECTURE §7）：沒有登入就導到 /login。mock 的 getSession 一律回示範身分，所以直接放行。 */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const { client } = useApi();
  const [state, setState] = useState<GateState>('checking');

  useEffect(() => {
    let cancelled = false;
    void client.getSession().then((result) => {
      if (!cancelled) setState(result.ok && result.value !== null ? 'signed-in' : 'signed-out');
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  switch (state) {
    case 'checking':
      return null;
    case 'signed-out':
      return <Navigate to="/login" replace />;
    case 'signed-in':
      return <>{children}</>;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** 每一頁最頂端的「預覽：假資料」（只有 mock 才有 preview）。 */
function Layout() {
  const { preview } = useApi();
  return (
    <>
      {preview === null ? null : <PreviewBanner marker={preview.marker} unknownScenario={preview.unknownScenario} />}
      <Outlet />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireSession>
              <HomePage />
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
