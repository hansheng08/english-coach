import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useApi } from './api';
import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/login/LoginPage';
import { useOnlineStatus, useUpdateApply } from './pwa/hooks';
import { OfflineBar } from './pwa/OfflineBar';
import { OfflinePanel } from './pwa/OfflinePanel';
import { ContentArea, SysBars } from './pwa/SysBars';
import { UpdateCard } from './pwa/UpdateCard';
import type { RegisterSW } from './pwa/update';
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

/**
 * 外殼：頁面頂端的 .sysbars（預覽：假資料、需要連網，pwa.md §3.1）、內容區、有新版時的卡片。
 * 離線開啟（外殼來自 precache）時，內容區顯示離線面板；開著的畫面中途斷線則內容照舊，只多一條斷線條。
 */
function Layout({ register }: { readonly register: RegisterSW | undefined }) {
  const { preview } = useApi();
  const online = useOnlineStatus();
  // 「離線開啟」只在開啟時離線、而且還沒恢復過連線時成立；恢復後再斷線只多斷線條，內容區不換掉。
  const [openedOffline, setOpenedOffline] = useState(() => !window.navigator.onLine);
  useEffect(() => {
    if (online) setOpenedOffline(false);
  }, [online]);
  const applyUpdate = useUpdateApply(register);
  return (
    <>
      <SysBars>
        {preview === null ? null : <PreviewBanner marker={preview.marker} unknownScenario={preview.unknownScenario} />}
        {online ? null : <OfflineBar />}
      </SysBars>
      <ContentArea updateShown={applyUpdate !== null}>
        {openedOffline && !online ? (
          <OfflinePanel
            onReload={() => {
              window.location.reload();
            }}
          />
        ) : (
          <Outlet />
        )}
      </ContentArea>
      {applyUpdate === null ? null : <UpdateCard apply={applyUpdate} />}
    </>
  );
}

export function App({ register }: { readonly register?: RegisterSW }) {
  return (
    <Routes>
      <Route element={<Layout register={register} />}>
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
