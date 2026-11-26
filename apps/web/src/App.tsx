import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useApi } from './api/index.ts';
import { HomePage } from './features/home/HomePage.tsx';
import { LoginPage } from './features/login/LoginPage.tsx';
import { PreviewBanner } from './ui/index.ts';

type Gate = 'checking' | 'in' | 'out';

/** 登入閘門（ARCHITECTURE §7、AC-23 基礎）：沒有 session 就導到 /login。mock 的 getSession 一律回示範身分，所以直接放行。 */
function RequireSession({ children }: { readonly children: ReactNode }) {
  const { client } = useApi();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let alive = true;
    void client.getSession().then((r) => {
      if (alive) setGate(r.ok && r.value !== null ? 'in' : 'out');
    });
    return () => {
      alive = false;
    };
  }, [client]);

  if (gate === 'checking') return <p role="status" aria-live="polite" />;
  if (gate === 'out') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { preview } = useApi();
  return (
    <>
      {preview !== null && <PreviewBanner unknownScenario={preview.unknownScenario} />}
      <Routes>
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
      </Routes>
    </>
  );
}
